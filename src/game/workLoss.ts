import type { Developer, GameState, Ticket } from './types'
import type { WorkAmount } from './work'
import { compareWork, isWorkComplete, remainingWork, scaleWork, workAmount } from './work.ts'
import { addWorkAmounts, effortNumber, subtractWorkAmounts } from './workLog.ts'
import { getComplexityMultiplier } from './complexity.ts'

export function switchLossFraction(developer: Developer, ticket: Ticket): number {
  const competency = developer.competencies[ticket.workDomain]
  if (!Number.isFinite(competency) || competency < 0) throw new RangeError('Domain competency must be finite and non-negative')
  return (1 - 1 / getComplexityMultiplier(ticket)) / (1 + competency / 5)
}

function grossEffort(state: GameState, developer: Developer, ticket: Ticket): WorkAmount {
  return state.workLog?.find(e => e.developerId === developer.id && e.ticketId === ticket.id)?.effort ?? workAmount(0)
}

export function beginWorkStint(state: GameState, developer: Developer, ticket: Ticket) {
  if (developer.workStint?.ticketId === ticket.id) {
    effortNumber(developer.workStint.effortOrigin)
    return
  }
  // Do not infer a legacy stint's starting point from Flow or a numeric session.
  developer.workStint = { ticketId: ticket.id, effortOrigin: { ...grossEffort(state, developer, ticket) } }
}

function scaledEffort(effort: WorkAmount, factor: number): WorkAmount {
  const high = scaleWork(effort, factor)
  if (effort.correction === 0) return high
  // Preserve the ledger's low word, including subnormal fractional contributions.
  const low = scaleWork(workAmount(Math.abs(effort.correction)), factor)
  low.exponent += effort.exponent
  return effort.correction > 0 ? subtractWorkAmounts(high, low) : addWorkAmounts(high, low)
}

// Keep the two existing numerical anchors: add loss to scaled remaining work,
// and subtract it from completed work WITH its saved display compensation.
// requiredWork - remaining cannot recover small protected progress at huge scales.
function removeProgress(ticket: Ticket, loss: WorkAmount) {
  const next = addWorkAmounts(remainingWork(ticket), loss)
  const total = workAmount(ticket.requiredWork)
  if (compareWork(next, total) > 0) throw new RangeError('Switch loss exceeds retained ticket progress')
  const saved = ticket.workRemainder
  const rounding = saved?.requiredWork === ticket.requiredWork && saved.completedWork === ticket.completedWork
    ? saved.roundingError : 0
  const scalarBefore = workAmount(ticket.completedWork)
  const completed = rounding > 0 ? subtractWorkAmounts(scalarBefore, workAmount(rounding))
    : rounding < 0 ? addWorkAmounts(scalarBefore, workAmount(-rounding)) : scalarBefore
  if (compareWork(loss, completed) > 0) throw new RangeError('Retained progress is below scalar compensation range')
  const useful = subtractWorkAmounts(completed, loss)
  let displayed = effortNumber(useful)
  if (displayed === null) throw new RangeError('Retained progress is below scalar compensation range')
  // An existing lower display can represent extra work in its negative carry.
  // Retain that display rather than increasing completedWork during rollback.
  if (displayed > ticket.completedWork) displayed = ticket.completedWork
  const scalar = workAmount(displayed)
  const above = compareWork(scalar, useful) >= 0
  const carry = above ? subtractWorkAmounts(scalar, useful) : subtractWorkAmounts(useful, scalar)
  const roundingError = effortNumber(carry)
  if (roundingError === null) throw new RangeError('Switch-loss display compensation is below numeric range')
  ticket.completedWork = displayed
  ticket.workRemainder = { mantissa: next.mantissa, exponent: next.exponent, remainderCorrection: next.correction,
    requiredWork: ticket.requiredWork, completedWork: displayed, roundingError: above ? roundingError : -roundingError }
}

// Called only AFTER an actual switch decision. Option B deliberately leaves
// scoring unaware of this consequence (#72), and neither reports nor gross effort change.
export function applySwitchLoss(state: GameState, developer: Developer, ticket: Ticket) {
  if (isWorkComplete(ticket)) return
  const fraction = switchLossFraction(developer, ticket)
  if (fraction === 0 || developer.workStint?.ticketId !== ticket.id) return
  const produced = subtractWorkAmounts(grossEffort(state, developer, ticket), developer.workStint.effortOrigin)
  if (produced.mantissa === 0) return
  const loss = scaledEffort(produced, fraction)
  removeProgress(ticket, loss)
}
