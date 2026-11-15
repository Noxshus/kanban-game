import type { Developer, Ticket } from './types'
import { getLogDomainRate } from './productivity.ts'
import { getFlowDuration, getFlowBonus, getProjectedFlowMultiplier } from './flow.ts'
import { compareWork, integratedWork, remainingWork, validWorkSession } from './work.ts'
import { addEventTime, eventInterval } from './eventTime.ts'

export interface CompletionProjection { seconds: number | null; logSeconds: number }

// Invert integrated work in log time: bounded bisection avoids overflowing rates,
// tiny time underflow, and scale-dependent accuracy. No per-ticket beliefs are stored.
export function projectCompletion(developer: Developer, ticket: Ticket, retainFlow = false): CompletionProjection {
  if (!Number.isFinite(ticket.requiredWork) || !Number.isFinite(ticket.completedWork)
      || ticket.requiredWork < 0 || ticket.completedWork < 0) throw new RangeError('Ticket work must be finite and non-negative')
  const remaining = remainingWork(ticket)
  if (remaining.mantissa === 0) return { seconds: 0, logSeconds: -Infinity }
  const session = retainFlow ? validWorkSession(developer, ticket) : undefined
  if (session?.completionSeconds !== undefined && session.completionSeconds !== null) {
    const seconds = Math.max(0, session.originTime && session.currentTime
      ? eventInterval(addEventTime(session.originTime, session.completionSeconds), session.currentTime)
      : session.completionSeconds - session.elapsed)
    return { seconds, logSeconds: Math.log(seconds) }
  }
  const time = retainFlow ? getFlowDuration(developer, ticket.id) : 0
  const initialMultiplier = 1 + getFlowBonus(time, developer.focus)
  const logRate = getLogDomainRate(developer, ticket)
  if (logRate === -Infinity) return { seconds: null, logSeconds: Infinity }
  const target = Math.log(remaining.mantissa) + Math.log1p(-remaining.correction / remaining.mantissa)
    + remaining.exponent * Math.LN2 - logRate
  let high = target - Math.log(initialMultiplier)
  let low = high - 1
  const delivered = (logTime: number) => logTime + Math.log(getProjectedFlowMultiplier(time, logTime, developer.focus))
  let width = 1
  while (delivered(low) > target) { width *= 2; low = high - width }
  for (let i = 0; i < 80; i++) {
    const middle = low + (high - low) / 2
    if (delivered(middle) < target) low = middle
    else high = middle
  }
  const seconds = Math.exp(high)
  if (seconds === 0) throw new RangeError('Positive completion interval is below the numeric time range')
  if (!Number.isFinite(seconds) || !Number.isFinite(time + seconds)) return { seconds: null, logSeconds: high }
  // The log solve is only a bracket estimate. Refine against the SAME integrated
  // work arithmetic as accumulation so a deadline never manufactures completion.
  const enough = (interval: number) => compareWork(integratedWork(developer, ticket, interval, time), remaining) >= 0
  let upper = seconds
  let lower = 0
  if (!enough(upper)) {
    lower = upper
    upper *= 2
    if (!Number.isFinite(upper) || !Number.isFinite(time + upper)) {
      throw new RangeError('Completion interval cannot be represented consistently')
    }
  }
  for (let i = 0; i < 80; i++) {
    const middle = lower + (upper - lower) / 2
    if (middle === lower || middle === upper) break
    if (enough(middle)) upper = middle
    else lower = middle
  }
  return { seconds: upper, logSeconds: Math.log(upper) }
}
