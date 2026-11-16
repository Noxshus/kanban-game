import type { Developer, GameState, Ticket } from './types'
import { compareWork, integratedWork, remainingWork, workAmount } from './work.ts'
import type { WorkAmount } from './work'

const maximum = workAmount(Number.MAX_VALUE)

function validateAmount(value: WorkAmount) {
  if (!value || !Number.isFinite(value.mantissa) || !Number.isFinite(value.correction)
      || !Number.isSafeInteger(value.exponent)
      || (value.mantissa === 0 ? value.exponent !== 0 || value.correction !== 0
        : value.mantissa < 1 || value.mantissa >= 2 || Math.abs(value.correction) > Number.EPSILON * value.mantissa)
      || compareWork(value, maximum) > 0) {
    throw new RangeError('Work-log effort must be a finite non-negative scaled quantity within the numeric range')
  }
}

export function validateWorkLog(log: GameState['workLog']) {
  const pairs = new Map<string, Set<string>>()
  for (const entry of log ?? []) {
    if (typeof entry.developerId !== 'string' || !entry.developerId
        || typeof entry.ticketId !== 'string' || !entry.ticketId) throw new RangeError('Work-log IDs must be nonempty strings')
    const tickets = pairs.get(entry.developerId) ?? new Set<string>()
    if (tickets.has(entry.ticketId)) throw new RangeError('Duplicate engineer/ticket work-log pair')
    tickets.add(entry.ticketId)
    pairs.set(entry.developerId, tickets)
    validateAmount(entry.effort)
  }
}

// Two-word scaled addition retains rounding across separate work sessions. Like
// ticket work accounting, unsupported precision/overflow is explicit, never a cap.
function combine(a: WorkAmount, b: WorkAmount, sign = 1): WorkAmount {
  if (b.mantissa === 0) return { ...a }
  if (a.mantissa === 0 && sign === 1) return { ...b }
  const exponent = Math.max(a.exponent, b.exponent)
  const scaleA = 2 ** (a.exponent - exponent), scaleB = 2 ** (b.exponent - exponent)
  if ((a.mantissa > 0 && scaleA === 0) || scaleB === 0) throw new RangeError('Work-log increment is below numeric resolution')
  const align = (value: number, scale: number) => {
    const aligned = value * scale
    // A nonzero power-of-two scale can still partially underflow the product.
    // Require exact round-tripping of BOTH words before compensated summation.
    if (aligned / scale !== value) throw new RangeError('Work-log exponent alignment loses numeric precision')
    return aligned
  }
  const sum = (x: number, y: number) => {
    const high = x + y, recovered = high - x
    return { high, low: (x - (high - recovered)) + (y - recovered) }
  }
  let words = sum(align(a.mantissa, scaleA), sign * align(b.mantissa, scaleB))
  for (const low of [-align(a.correction, scaleA), -sign * align(b.correction, scaleB)]) {
    const added = sum(words.high, low)
    words = sum(added.high, added.low + words.low)
  }
  if (words.high < 0) throw new RangeError('Work-log cumulative production decreased')
  if (words.high === 0) return workAmount(0)
  let shift = Math.floor(Math.log2(words.high)), scale = 2 ** shift
  let mantissa = words.high / scale
  // log2 can round across a power-of-two boundary. Verify the interval rather
  // than rejecting a valid quantity whose estimated exponent was one too large.
  if (mantissa < 1) { shift--; scale /= 2; mantissa *= 2 }
  else if (mantissa >= 2) { shift++; scale *= 2; mantissa /= 2 }
  const correction = words.low === 0 ? 0 : -words.low / scale // JSON preserves this canonical zero.
  if (correction * scale !== -words.low) throw new RangeError('Work-log normalization loses numeric precision')
  const result = { mantissa, exponent: exponent + shift, correction }
  validateAmount(result)
  if (sign === 1 && compareWork(result, a) <= 0) throw new RangeError('Work-log increment is below compensated numeric resolution')
  return result
}

// A subnormal fraction can be retained in state before it has a scalar display.
export function effortNumber(effort: WorkAmount): number | null {
  validateAmount(effort)
  const value = (effort.mantissa - effort.correction) * 2 ** effort.exponent
  return effort.mantissa > 0 && (value === 0 || !Number.isFinite(value)) ? null : value
}

/** Updates only the cloned transition's ledger and its numerical session baseline. */
export function recordProductiveEffort(state: GameState, developer: Developer, ticket: Ticket, work: WorkAmount) {
  const session = developer.workSession!
  const capacity = remainingWork({ ...ticket, completedWork: session.initialCompletedWork, workRemainder: session.initialRemainder })
  const capped = (quantity: WorkAmount) => compareWork(quantity, capacity) < 0 ? quantity : capacity
  const entry = state.workLog?.find(item => item.developerId === developer.id && item.ticketId === ticket.id)
  if (!session.effortOrigin || !entry) {
    // A legacy integration session may already contain hours of work. Anchor at
    // its CURRENT elapsed time, not at zero: none of that unlogged past is known.
    session.effortOrigin = { total: entry ? { ...entry.effort } : workAmount(0),
      produced: capped(integratedWork(developer, ticket, session.elapsed, session.initialFlowDuration)) }
  }
  const origin = session.effortOrigin
  const produced = capped(work)
  const contribution = combine(produced, origin.produced, -1)
  if (contribution.mantissa === 0) return
  // Recompute from a fixed baseline, just as the ticket recomputes its integral;
  // do not repeatedly add the whole cumulative integral or subtract rounded totals.
  const effort = combine(origin.total, contribution)
  if (entry) entry.effort = effort
  else (state.workLog ??= []).push({ developerId: developer.id, ticketId: ticket.id, effort })
}
