import type { Developer, Ticket } from './types'

function getModifier(
  developer: Developer,
  ticket: Pick<Ticket, 'workDomain'>,
): number {
  const competency = developer.competencies[ticket.workDomain]
  if (!Number.isFinite(competency) || competency < 0) {
    throw new RangeError('Domain competency must be a finite, non-negative number')
  }
  if (!Number.isFinite(developer.productivity)) {
    throw new RangeError('Base productivity must be finite')
  }
  // Provisional balance: even zero expertise retains half the base rate. Base
  // productivity has no upper cap, so incremental progression can overcome poor fit.
  return 0.5 + competency / 10
}

// An unrepresentable rate is unavailable, not a balancing cap or infinite work.
export function getEffectiveProductivity(developer: Developer, ticket: Pick<Ticket, 'workDomain'>): number | null {
  const rate = Math.max(0, developer.productivity) * getModifier(developer, ticket)
  return Number.isFinite(rate) ? rate : null
}

export function getWorkCompleted(developer: Developer, ticket: Pick<Ticket, 'workDomain'>, elapsedSeconds: number): number {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    throw new RangeError('Elapsed time must be finite and non-negative')
  }
  const modifier = getModifier(developer, ticket)
  const base = Math.max(0, developer.productivity)
  if (elapsedSeconds === 0) return 0
  const rate = base * modifier
  // Preserve ordinary rounding. Only reassociate when the intermediate rate
  // overflows: a tiny elapsed time can still produce representable actual work.
  const work = Number.isFinite(rate) ? rate * elapsedSeconds : (base * elapsedSeconds) * modifier
  // If actual work itself overflows, reject the pure transition explicitly.
  // No Infinity reaches completion logic, and no artificial progression cap is imposed.
  if (!Number.isFinite(work)) throw new RangeError('Work over elapsed time exceeds the numeric range')
  return work
}
