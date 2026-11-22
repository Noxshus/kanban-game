import type { Developer, GameState, Ticket } from './types'
import type { EventTime } from './eventTime'
import { compareWork, workAmount } from './work.ts'
import { addWorkAmounts, effortNumber, subtractWorkAmounts } from './workLog.ts'
import { getDiscipline, reportProbability } from './discipline.ts'

// Gross team effort deliberately includes lost useful work. Missing legacy
// provenance contributes nothing; neither actual work field supplies a fallback.
export function assessProgress(state: Pick<GameState, 'workLog'>, ticket: Pick<Ticket, 'id' | 'reportedEffortEstimate'>): number | null {
  const estimate = ticket.reportedEffortEstimate
  if (estimate === undefined) return null
  if (!Number.isFinite(estimate) || estimate < 0) throw new RangeError('Progress requires a finite non-negative published estimate')
  if (estimate === 0) return null // Zero effort is handled by explicit completion, not division.
  const denominator = workAmount(estimate)
  let total = workAmount(0)
  for (const entry of state.workLog ?? []) {
    if (entry.ticketId !== ticket.id) continue
    effortNumber(entry.effort) // Validate compensated quantities before using them.
    // Once bounded reporting reaches 100, summing beyond MAX_VALUE is unnecessary.
    if (compareWork(entry.effort, denominator) >= 0) return 100
    // Only large sums need a pre-add overflow check. Subtracting an enormous
    // denominator from tiny contributions would demand unrelated precision.
    if (Math.max(total.exponent, entry.effort.exponent) >= 1022
        && compareWork(entry.effort, subtractWorkAmounts(denominator, total)) >= 0) return 100
    total = addWorkAmounts(total, entry.effort)
    if (compareWork(total, denominator) >= 0) return 100
  }
  if (total.mantissa === 0) return 0
  const ratio = (total.mantissa - total.correction) / denominator.mantissa
  const exponent = total.exponent - denominator.exponent
  const percentage = exponent < -1074
    ? Math.exp(Math.log(ratio * 100) + exponent * Math.LN2) : ratio * 100 * 2 ** exponent
  if (percentage === 0) throw new RangeError('Reported progress is below percentage numeric resolution')
  return Math.min(100, percentage)
}

export function publishProgress(ticket: Ticket, percentage: number, at: EventTime) {
  ticket.reportedProgress = percentage
  ticket.progressReport = { at: { ...at }, estimate: ticket.reportedEffortEstimate ?? null }
}

export function reportProgress(state: Pick<GameState, 'workLog'>, ticket: Ticket, developer: Developer,
  at: EventTime, draw: () => number, guaranteed = false) {
  const candidate = assessProgress(state, ticket)
  if (candidate === null || candidate === ticket.reportedProgress && (!guaranteed || ticket.progressReport)) return false
  // An unchanged snapshot needs no event-report roll. A proactive review can
  // confirm that untimed snapshot (including 0%) as an explicit publication.
  if (!guaranteed) {
    const probability = reportProbability(getDiscipline(developer)), uniform = draw()
    if (!Number.isFinite(uniform) || uniform < 0 || uniform >= 1) throw new RangeError('Progress report RNG draw must be in [0, 1)')
    if (uniform >= probability) return false
  }
  publishProgress(ticket, candidate, at)
  return true
}
