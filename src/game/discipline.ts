import type { Developer, EffortAssessmentReason, Ticket } from './types'
import type { EventTime } from './eventTime'
import { addEventTime, compareEventTime, eventTime } from './eventTime.ts'
import { openUnit } from './reconsideration.ts'
import { encounterEstimate, publishEstimate } from './estimateHistory.ts'
import type { InternalObserver } from './simulationActivity'

// Provisional #63 calibration, independent of estimation quality and work rate.
export const DISCIPLINE_SCALE = 10
export const REVIEW_MEDIAN_SECONDS = 12

export function getDiscipline(developer: Pick<Developer, 'discipline'>) {
  const value = developer.discipline === undefined ? 0 : developer.discipline
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Discipline must be finite and non-negative')
  return value
}

export function reportProbability(discipline: number) {
  const s = 1 + getDiscipline({ discipline }) / DISCIPLINE_SCALE
  return s / (1 + s)
}

export function reviewDelay(discipline: number, uniform: number) {
  const median = REVIEW_MEDIAN_SECONDS / (1 + Math.log1p(getDiscipline({ discipline }) / DISCIPLINE_SCALE))
  return median * Math.sqrt(-Math.log1p(-openUnit(uniform)) / Math.LN2)
}

export function scheduleReview(developer: Developer, ticketId: string, now: EventTime, draw: () => number) {
  const delay = reviewDelay(getDiscipline(developer), draw())
  const dueTime = addEventTime(now, delay)
  if (delay <= 0 || compareEventTime(dueTime, now) <= 0) throw new RangeError('Review has no positive representable time interval')
  developer.estimateReview = { ticketId, dueTime }
}

export function scheduleIdleWorkCheck(developer: Developer, now: EventTime, draw: () => number) {
  // Provisional reuse of own-ticket housekeeping cadence, not a new balance curve.
  const delay = reviewDelay(getDiscipline(developer), draw())
  const dueTime = addEventTime(now, delay)
  if (delay <= 0 || compareEventTime(dueTime, now) <= 0) throw new RangeError('Idle work check has no positive representable time interval')
  developer.idleWorkCheck = dueTime
}

export function validateReview(developer: Developer) {
  getDiscipline(developer)
  const review = developer.estimateReview
  if (review && (!review.ticketId || !Number.isFinite(review.dueTime?.high) || !Number.isFinite(review.dueTime?.low)
      || compareEventTime(eventTime(review.dueTime.high, review.dueTime.low), review.dueTime) !== 0)) {
    throw new RangeError('Review requires a ticket and a finite normalized event time')
  }
  const idle = developer.idleWorkCheck
  if (idle && (!Number.isFinite(idle.high) || !Number.isFinite(idle.low)
      || compareEventTime(eventTime(idle.high, idle.low), idle) !== 0)) {
    throw new RangeError('Idle work check requires a finite normalized event time')
  }
}

// Recognition and publication are separate. Bounded DEV observations may retain
// a missed candidate; no selection or future assessment reads them back.
export function reportEffort(ticket: Ticket, developer: Developer, candidate: number,
  reason: EffortAssessmentReason, personalWork: number | null, at: EventTime, draw: () => number, guaranteed = false, internal?: InternalObserver) {
  if (!Number.isFinite(candidate) || candidate < 0 || candidate > ticket.requiredWork || ticket.requiredWork > 0 && candidate === 0) {
    throw new RangeError('Report candidate must be representable and within actual total effort')
  }
  const boardBefore = ticket.reportedEffortEstimate ?? null
  const improved = ticket.reportedEffortEstimate === undefined || candidate > ticket.reportedEffortEstimate
  let probability: number | undefined, uniform: number | undefined
  if (improved && !guaranteed) {
    probability = reportProbability(getDiscipline(developer))
    uniform = draw()
    if (!Number.isFinite(uniform) || uniform < 0 || uniform >= 1) throw new RangeError('Report RNG draw must be in [0, 1)')
  }
  const published = improved && (guaranteed || uniform! < probability!)
  if (published) {
    if (ticket.reportedEffortEstimate === undefined) {
      encounterEstimate(ticket, developer, at, () => { throw Error('An assessment must not be rerolled for publication') }, candidate)
      ticket.overrunEvaluationConsumed ??= false
    } else publishEstimate(ticket, developer.id, candidate, 'revision', at)
    if (developer.workSession) delete developer.workSession.estimateEvents
  }
  ticket.lastEstimateEvaluation = { developerId: developer.id, reason, personalWork, candidate, improved, published,
    ...(probability !== undefined ? { reportProbability: probability, reportDraw: uniform } : {}) }
  internal?.({ kind: 'assessment', ticketId: ticket.id, ticketTitle: ticket.title, at: { ...at },
    developerId: developer.id, developerName: developer.name, reason, candidate, boardBefore,
    boardAfter: ticket.reportedEffortEstimate ?? null, improved, published, proactive: guaranteed,
    probability: probability ?? null, draw: uniform ?? null })
  return { candidate, improved, published }
}
