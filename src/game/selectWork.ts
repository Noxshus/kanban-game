import type { Developer, SelectionDecision, Ticket } from './types'
import { compareRank } from './rank.ts'
import { clampReportedProgress } from './reportedProgress.ts'

export function validateSelectionAttributes(developer: Pick<Developer, 'judgement' | 'discipline'>) {
  for (const value of [developer.judgement, developer.discipline]) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError('Judgement and Discipline must be finite, non-negative numbers')
    }
  }
}

// Legality/claims are filtered by the engine; appraisal reads only public Rank and reports.
export function selectWork(
  eligible: readonly Ticket[], developer: Developer, draw: () => number,
): SelectionDecision | undefined {
  validateSelectionAttributes(developer)
  const ordered = [...eligible].sort(compareRank)
  const manager = ordered[0]
  if (!manager) return undefined
  const opportunity = ordered.reduce((best, ticket) =>
    clampReportedProgress(ticket.reportedProgress) > clampReportedProgress(best.reportedProgress) ? ticket : best,
  manager)
  const snapshot = (ticket: Ticket) => ({ id: ticket.id, rank: ticket.rank,
    reportedProgress: clampReportedProgress(ticket.reportedProgress) })
  let probability = 0
  let roll: number | null = null
  if (manager.id !== opportunity.id) {
    const gap = (clampReportedProgress(opportunity.reportedProgress) - clampReportedProgress(manager.reportedProgress)) / 100
    // Subtract before scaling: equal enormous finite attributes must cancel exactly.
    const score = 0.35 * (developer.judgement - developer.discipline) + 4 * gap - 2.5
    // Stable sigmoid avoids exp overflow for large negative scores.
    const exponential = Math.exp(-Math.abs(score))
    probability = score >= 0 ? 1 / (1 + exponential) : exponential / (1 + exponential)
    roll = draw()
  }
  return {
    managerChoice: snapshot(manager), opportunity: snapshot(opportunity),
    judgement: developer.judgement, discipline: developer.discipline,
    overrideProbability: probability, draw: roll,
    selectedId: roll !== null && roll < probability ? opportunity.id : manager.id,
  }
}
