import type { Developer, EffortAssessmentReason, GameState, Ticket } from './types'
import type { WorkAmount } from './work'
import { compareWork, integratedWork, remainingWork, workAmount } from './work.ts'
import { addWorkAmounts, anchorEffort, effortNumber, subtractWorkAmounts } from './workLog.ts'
import { projectWork } from './completionTime.ts'
import { addEventTime, compareEventTime, eventTime } from './eventTime.ts'
import { openUnit } from './reconsideration.ts'
import { firstPublishedEstimate, migrateEstimateHistory } from './estimateHistory.ts'
import { estimateInitialEffort } from './effortEstimate.ts'
import { reportEffort, scheduleReview } from './discipline.ts'
import type { InternalObserver } from './simulationActivity'
import { reportProgress } from './progressReporting.ts'

// Provisional #58 balance, deliberately independent of Focus and Flow.
export const DISCOVERY_BASE = 0.8
export const ERROR_REFERENCE = 0.2
export const ACCURACY_BASE = 0.30

function nonnegative(value: number) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Estimation inputs must be finite and non-negative')
}

function estimates(total: number, board: number, baseline: number) {
  for (const value of [total, board, baseline]) nonnegative(value)
  if (total <= 0 || baseline <= 0 || baseline > total || board <= 0 || board > total) {
    throw new RangeError('Unfinished ticket estimates require positive baseline and board values no greater than actual total')
  }
}

function logWork(work: WorkAmount) {
  effortNumber(work) // Validate without discarding subnormal quantities that lack a scalar display.
  return work.mantissa === 0 ? -Infinity : Math.log(work.mantissa) + Math.log1p(-work.correction / work.mantissa) + work.exponent * Math.LN2
}

function logOnePlusRatio(logRatio: number) {
  return logRatio > 0 ? logRatio + Math.log1p(Math.exp(-logRatio)) : Math.log1p(Math.exp(logRatio))
}

export function discoveryResponsiveness(total: number, board: number, judgement: number) {
  estimates(total, board, board)
  nonnegative(judgement)
  const r = (total - board) / total
  const k = DISCOVERY_BASE * (1 + Math.log1p(judgement / 10))
  return k * (2 * r / (r + ERROR_REFERENCE))
}

export function revisedEffort(total: number, baseline: number, personalWork: WorkAmount, judgement: number, competency: number) {
  estimates(total, baseline, baseline)
  nonnegative(judgement); nonnegative(competency)
  const a = ACCURACY_BASE * (1 + Math.log1p(judgement / 10) + Math.log1p(competency / 10))
  const exposure = logOnePlusRatio(logWork(personalWork) - Math.log(baseline))
  // E0 + gap * gain avoids cancellation in T - gap * decay for tiny baselines.
  // Rounding may reach T, but there is no observed-work floor or accuracy bonus.
  return Math.min(total, baseline + (total - baseline) * -Math.expm1(-a * exposure))
}

export function nextDiscoveryTarget(total: number, board: number, baseline: number, personalWork: WorkAmount,
  judgement: number, available: WorkAmount, uniform: number): WorkAmount | null {
  estimates(total, board, baseline)
  const rate = discoveryResponsiveness(total, board, judgement)
  const u = openUnit(uniform)
  if (rate === 0) return null
  // With k*g fixed for this board and engineer, integrated hazard is
  // rate * log((E0 + w_next)/(E0 + w_now)); invert one seeded draw, not tick rolls.
  const exponent = -Math.log1p(-u) / rate
  const logBase = Math.log(baseline) + logOnePlusRatio(logWork(personalWork) - Math.log(baseline))
  // Equivalent log-expm1 forms avoid overflowing an otherwise censored threshold.
  const logDelta = logBase + (exponent > 50 ? exponent + Math.log1p(-Math.exp(-exponent)) : Math.log(Math.expm1(exponent)))
  // A threshold beyond all remaining productive work is censored by completion,
  // not clipped to a smaller threshold or repeatedly resampled every call.
  if (logDelta > logWork(available)) return null
  if (!Number.isFinite(logDelta)) throw new RangeError('Discovery threshold is outside numerical resolution')
  let power = Math.floor(logDelta / Math.LN2)
  let mantissa = Math.exp(logDelta - power * Math.LN2)
  if (mantissa < 1) { mantissa *= 2; power-- }
  else if (mantissa >= 2) { mantissa /= 2; power++ }
  const delta = { mantissa, exponent: power, correction: 0 }
  if (compareWork(delta, available) > 0) return null
  const target = addWorkAmounts(personalWork, delta)
  if (compareWork(target, personalWork) <= 0) throw new RangeError('Discovery target has no positive representable work interval')
  return target
}

export function personalEffort(state: GameState, developer: Developer, ticket: Ticket) {
  return state.workLog?.find(entry => entry.developerId === developer.id && entry.ticketId === ticket.id)?.effort ?? workAmount(0)
}

function baselineFor(ticket: Ticket) {
  const baseline = firstPublishedEstimate(ticket)
  if (baseline !== null) estimates(ticket.requiredWork, ticket.reportedEffortEstimate!, baseline)
  return baseline
}

function overrunWork(developer: Developer, board: number) {
  const session = developer.workSession!
  let required = workAmount(board - session.initialCompletedWork)
  const carry = session.initialRemainder?.roundingError ?? 0
  if (carry > 0) required = addWorkAmounts(required, workAmount(carry))
  else if (carry < 0) required = subtractWorkAmounts(required, workAmount(-carry))
  return required
}

function reachedBoard(developer: Developer, ticket: Ticket) {
  const board = ticket.reportedEffortEstimate!
  const session = developer.workSession
  if (!session || board <= session.initialCompletedWork) return ticket.completedWork >= board
  // completedWork can round to the estimate before its compensated productive
  // work reaches it (especially at subnormal scales). Do not consume that crossing early.
  return compareWork(integratedWork(developer, ticket, session.elapsed, session.initialFlowDuration), overrunWork(developer, board)) >= 0
}

function migrateOverrunState(ticket: Ticket, originalBaseline: number | undefined) {
  if (ticket.overrunEvaluationConsumed !== undefined) return false
  // The old marker was also written on pickup, so it cannot prove consumption.
  // An overrun snapshot is conclusive. Otherwise monotonic work below a saved
  // original baseline proves no crossing occurred. Equality or a missing baseline
  // cannot exclude an earlier overrun hidden by a later discovery snapshot.
  const evaluation = ticket.lastEstimateEvaluation
  ticket.overrunEvaluationConsumed = evaluation?.reason === 'overrun'
    || evaluation !== undefined && !(originalBaseline !== undefined && ticket.completedWork < originalBaseline)
  delete ticket.evaluatedOverrunEstimate
  return true
}

export function prepareDiscovery(state: GameState, developer: Developer, ticket: Ticket, draw: () => number) {
  migrateEstimateHistory(ticket)
  // Capture provenance before baselineFor supplies a fallback for board-only saves.
  const originalBaseline = ticket.initialEffortEstimate?.totalWork ?? ticket.learningBaseline
  const baseline = baselineFor(ticket)
  if (baseline === null) {
    delete developer.estimateDiscovery
    if (developer.workSession) delete developer.workSession.estimateEvents
    return
  }
  // Reproject migrated caches from their saved work targets, without resampling
  // RNG. An old suppressed or re-armed crossing may no longer be appropriate.
  if (migrateOverrunState(ticket, originalBaseline) && developer.workSession) delete developer.workSession.estimateEvents
  if (ticket.overrunEvaluationConsumed && developer.workSession?.estimateEvents) {
    developer.workSession.estimateEvents.overrun = null
  }
  const board = ticket.reportedEffortEstimate!
  const old = developer.estimateDiscovery
  const productive = developer.productivity > 0
  if (old?.ticketId === ticket.id && old.boardEstimate === board && old.requiredWork === ticket.requiredWork && old.judgement === developer.judgement && old.productive === productive
      && (old.baseline === undefined || old.baseline === baseline)) return
  const rate = discoveryResponsiveness(ticket.requiredWork, board, developer.judgement)
  const target = rate > 0 && developer.productivity > 0
    ? nextDiscoveryTarget(ticket.requiredWork, board, baseline, personalEffort(state, developer, ticket),
      developer.judgement, remainingWork(ticket), draw()) : null
  developer.estimateDiscovery = { ticketId: ticket.id, boardEstimate: board, requiredWork: ticket.requiredWork, judgement: developer.judgement, productive, baseline, target }
  if (developer.workSession) delete developer.workSession.estimateEvents
}

export function projectEstimateEvents(state: GameState, developer: Developer, ticket: Ticket) {
  const session = developer.workSession!
  if (session.estimateEvents) return session.estimateEvents
  const discovery = developer.estimateDiscovery
  if (!discovery) return { discovery: null, overrun: null }
  const { origin, capacity } = anchorEffort(state, developer, ticket)
  const deadline = (quantity: WorkAmount) => {
    const seconds = compareWork(quantity, capacity) === 0 ? session.completionSeconds
      : projectWork(developer, ticket, quantity, session.initialFlowDuration).seconds
    if (seconds === null) return null
    const due = addEventTime(session.originTime!, seconds)
    if (compareEventTime(due, session.currentTime!) <= 0) throw new RangeError('Estimate event has no positive representable time interval')
    return due
  }
  const target = discovery.target
    ? addWorkAmounts(subtractWorkAmounts(discovery.target, origin.total), origin.produced) : null
  const board = ticket.reportedEffortEstimate!
  let overrun: ReturnType<typeof deadline> = null
  // Pickup above an existing report is not a crossing and does not consume the
  // lifetime alarm. A later discovery may still establish its first future target.
  if (!ticket.overrunEvaluationConsumed && board > session.initialCompletedWork && !reachedBoard(developer, ticket)) {
    overrun = deadline(overrunWork(developer, board))
  }
  // Other contributors can exhaust capacity while this engineer is away. Retain
  // the saved target, censoring it at completion rather than rerolling on return.
  session.estimateEvents = { discovery: target && compareWork(target, capacity) <= 0 ? deadline(target) : null, overrun }
  return session.estimateEvents
}

export function beginEstimateReporting(state: GameState, developer: Developer, ticket: Ticket, at: ReturnType<typeof eventTime>, draw: () => number, appraisal?: number, internal?: InternalObserver) {
  if (developer.estimateReview?.ticketId === ticket.id) return
  migrateEstimateHistory(ticket)
  if (ticket.reportedEffortEstimate === undefined) {
    // A failed pickup leaves no baseline, including private-only legacy records.
    delete ticket.initialEffortEstimate
    delete ticket.learningBaseline
    const candidate = appraisal ?? estimateInitialEffort(ticket.requiredWork, developer.judgement, developer.competencies[ticket.workDomain], draw())
    reportEffort(ticket, developer, candidate, 'pickup', effortNumber(personalEffort(state, developer, ticket)), at, draw, false, internal)
  }
  reportProgress(state, ticket, developer, at, draw)
  scheduleReview(developer, ticket.id, at, draw)
}

export function evaluateEstimate(state: GameState, developer: Developer, ticket: Ticket, reason: Exclude<EffortAssessmentReason, 'pickup'>,
  draw: () => number, at = developer.workSession?.currentTime ?? eventTime(state.simulationTime, state.simulationTimeRemainder),
  proactive = reason === 'review', initialAppraisal?: number, internal?: InternalObserver) {
  migrateEstimateHistory(ticket)
  const originalBaseline = ticket.initialEffortEstimate?.totalWork ?? ticket.learningBaseline
  const baseline = baselineFor(ticket)
  if (baseline === null && (reason === 'discovery' || reason === 'overrun')) throw new RangeError('Unknown estimates cannot have discovery or overrun events')
  if (baseline !== null) migrateOverrunState(ticket, originalBaseline)
  const personal = personalEffort(state, developer, ticket)
  const candidate = baseline === null
    ? initialAppraisal ?? estimateInitialEffort(ticket.requiredWork, developer.judgement, developer.competencies[ticket.workDomain], draw())
    : revisedEffort(ticket.requiredWork, baseline, personal, developer.judgement, developer.competencies[ticket.workDomain])
  const result = reportEffort(ticket, developer, candidate, reason, effortNumber(personal), at, draw, proactive, internal)
  // Estimate and progress have independent publication chances, in that order.
  // Completion has already published its terminal 100% without a reporting roll.
  if (reason !== 'completion') reportProgress(state, ticket, developer, at, draw, proactive)
  // One crossing for the entire ticket lifetime, even if this evaluation leaves
  // the report unchanged. Later revisions and handoffs only learn via discovery.
  if (reason === 'overrun') ticket.overrunEvaluationConsumed = true
  if (reason === 'discovery' || reason === 'overrun') {
    delete developer.estimateDiscovery
    if (developer.workSession) delete developer.workSession.estimateEvents
  }
  // The caller passes this ephemeral insight directly to the SAME work decision,
  // independently of reporting success; it never retrieves it from DEV history.
  return result
}
