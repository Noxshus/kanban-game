import type { Developer, Ticket } from './types'
import { getDomainModifier } from './productivity.ts'
import { getAverageFlowMultiplier } from './flow.ts'

export interface WorkAmount { mantissa: number; exponent: number; correction: number }
const zero = (): WorkAmount => ({ mantissa: 0, exponent: 0, correction: 0 })

function normalize(mantissa: number, exponent: number, correction = 0): WorkAmount {
  if (mantissa === 0) return zero()
  const shift = Math.floor(Math.log2(mantissa))
  return { mantissa: mantissa / 2 ** shift, exponent: exponent + shift, correction: correction / 2 ** shift }
}

function amount(value: number): WorkAmount {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Work values must be finite and non-negative')
  if (value === 0) return zero()
  // log2(MAX_VALUE) rounds to 1024 although 2**1024 is not representable.
  const exponent = Math.min(1023, Math.floor(Math.log2(value)))
  return normalize(value / 2 ** exponent, exponent)
}

// Reuse the engine's scaled quantity for durable effort, including subnormal work.
export { amount as workAmount }

function multiply(a: WorkAmount, b: WorkAmount): WorkAmount {
  return normalize(a.mantissa * b.mantissa, a.exponent + b.exponent)
}

// Perceived remaining fractions can fall below the scalar subnormal range.
export function scaleWork(work: WorkAmount, factor: number): WorkAmount {
  return multiply(work, amount(factor))
}

export function compareWork(a: WorkAmount, b: WorkAmount): number {
  if (a.mantissa === 0 || b.mantissa === 0) return Math.sign(a.mantissa - b.mantissa)
  if (a.exponent < b.exponent) return -compareWork(b, a)
  const scale = 2 ** (b.exponent - a.exponent)
  return Math.sign((a.mantissa - b.mantissa * scale) - a.correction + b.correction * scale)
}

export function remainingWork(ticket: Ticket): WorkAmount {
  amount(ticket.requiredWork)
  amount(ticket.completedWork)
  const saved = ticket.workRemainder
  if (saved && saved.requiredWork === ticket.requiredWork && saved.completedWork === ticket.completedWork) {
    if (!Number.isFinite(saved.mantissa) || saved.mantissa < 1 || saved.mantissa >= 2 || !Number.isSafeInteger(saved.exponent)
        || !Number.isFinite(saved.roundingError) || !Number.isFinite(saved.remainderCorrection)
        || Math.abs(saved.remainderCorrection) > Number.EPSILON * saved.mantissa) {
      throw new RangeError('Invalid numerical work remainder')
    }
    return { mantissa: saved.mantissa, exponent: saved.exponent, correction: saved.remainderCorrection }
  }
  return amount(Math.max(0, ticket.requiredWork - ticket.completedWork))
}

export function remainingWorkNumber(ticket: Ticket): number | null {
  const value = remainingWork(ticket)
  const number = (value.mantissa - value.correction) * 2 ** value.exponent
  return value.mantissa > 0 && (number === 0 || !Number.isFinite(number)) ? null : number
}

export function isWorkComplete(ticket: Ticket) {
  return ticket.actualStatus === 'done' || remainingWork(ticket).mantissa === 0
}

export function validWorkSession(developer: Developer, ticket: Ticket) {
  const session = developer.workSession
  return session && session.ticketId === ticket.id && session.requiredWork === ticket.requiredWork
    && session.lastCompletedWork === ticket.completedWork && session.productivity === developer.productivity
    && session.competency === developer.competencies[ticket.workDomain] && session.focus === developer.focus
    && developer.flowStreak?.ticketId === ticket.id
    && developer.flowStreak.duration === session.initialFlowDuration + session.elapsed ? session : undefined
}

// A small binary-scaled work quantity, not arbitrary precision: each mantissa
// still has normal double precision. Scaling avoids intermediate overflow and
// subnormal underflow in the SAME integrated work used by projections and work.
export function integratedWork(developer: Developer, ticket: Ticket, seconds: number, flowDuration: number): WorkAmount {
  const modifier = getDomainModifier(developer, ticket)
  const multiplier = getAverageFlowMultiplier(flowDuration, seconds, developer.focus)
  return [Math.max(0, developer.productivity), modifier, seconds, multiplier]
    .map(amount).reduce(multiply, amount(1))
}

export function accumulateWork(ticket: Ticket, work: WorkAmount) {
  if (work.mantissa === 0) return
  const remaining = remainingWork(ticket)
  if (compareWork(work, remaining) >= 0) {
    ticket.completedWork = ticket.requiredWork
    delete ticket.workRemainder
    return
  }
  const decrement = work.mantissa * 2 ** (work.exponent - remaining.exponent)
  const correctedDecrement = -decrement - remaining.correction
  // We cannot retain arbitrarily tiny increments with a double mantissa. Fail
  // explicitly instead of losing work; no gameplay or attribute cap is imposed.
  if (decrement === 0 || (correctedDecrement === -remaining.correction && decrement > 0)) {
    throw new RangeError('Work increment is below remaining-work numeric resolution')
  }
  const mantissa = remaining.mantissa + correctedDecrement
  if (mantissa <= 0) throw new RangeError('Remaining work is below compensated numeric resolution')
  const correction = (mantissa - remaining.mantissa) - correctedDecrement
  const next = normalize(mantissa, remaining.exponent, correction)
  const saved = ticket.workRemainder
  const carry = saved?.requiredWork === ticket.requiredWork && saved.completedWork === ticket.completedWork ? saved.roundingError : 0
  const increment = work.mantissa * 2 ** work.exponent
  // Compensated addition keeps ordinary completed totals accurate without
  // subtracting nearly equal ticket-sized values. Subnormal fractions remain
  // in the scaled remainder even when no display-compatible increment exists.
  const corrected = increment - carry
  const displayed = ticket.completedWork + corrected
  let roundingError = (displayed - ticket.completedWork) - corrected
  if (displayed < ticket.requiredWork) ticket.completedWork = displayed
  else roundingError = carry - increment // never display full work while a positive remainder exists
  ticket.workRemainder = { mantissa: next.mantissa, exponent: next.exponent, remainderCorrection: next.correction,
    requiredWork: ticket.requiredWork, completedWork: ticket.completedWork, roundingError }
}
