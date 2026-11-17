import type { Developer, Ticket } from './types'
import { getComplexityMultiplier } from './complexity.ts'

export function getDomainModifier(
  developer: Developer,
  ticket: Pick<Ticket, 'workDomain' | 'complexity'>,
): number {
  const competency = developer.competencies[ticket.workDomain]
  if (!Number.isFinite(competency) || competency < 0) {
    throw new RangeError('Domain competency must be a finite, non-negative number')
  }
  if (!Number.isFinite(developer.productivity)) {
    throw new RangeError('Base productivity must be finite')
  }
  // One unified modifier: complexity reduces the novice baseline, while growing
  // competency mitigates its relative cost. S exactly preserves the previous rate.
  return 0.5 / getComplexityMultiplier(ticket) + competency / 10
}

// Log rate remains representable even when the ordinary rate over/underflows.
export function getLogDomainRate(developer: Developer, ticket: Pick<Ticket, 'workDomain' | 'complexity'>) {
  const modifier = getDomainModifier(developer, ticket)
  return developer.productivity > 0 ? Math.log(developer.productivity) + Math.log(modifier) : -Infinity
}

// An unrepresentable rate is unavailable, not a balancing cap or infinite work.
export function getEffectiveProductivity(developer: Developer, ticket: Pick<Ticket, 'workDomain' | 'complexity'>): number | null {
  const rate = Math.max(0, developer.productivity) * getDomainModifier(developer, ticket)
  return Number.isFinite(rate) && !(rate === 0 && developer.productivity > 0) ? rate : null
}

export function getWorkCompleted(developer: Developer, ticket: Pick<Ticket, 'workDomain' | 'complexity'>, elapsedSeconds: number): number {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    throw new RangeError('Elapsed time must be finite and non-negative')
  }
  const modifier = getDomainModifier(developer, ticket)
  const base = Math.max(0, developer.productivity)
  if (elapsedSeconds === 0) return 0
  const rate = base * modifier
  // Preserve ordinary rounding. Only reassociate when the intermediate rate
  // overflows: a tiny elapsed time can still produce representable actual work.
  const work = Number.isFinite(rate) ? rate * elapsedSeconds : (base * elapsedSeconds) * modifier
  // If actual work itself overflows, reject the pure transition explicitly.
  // No Infinity reaches completion logic, and no artificial progression cap is imposed.
  if (!Number.isFinite(work)) throw new RangeError('Work over elapsed time exceeds the numeric range')
  if (work === 0 && base > 0) throw new RangeError('Work over elapsed time is below the numeric range; use scaled accumulation')
  return work
}
