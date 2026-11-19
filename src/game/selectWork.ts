import type { AssessmentDecision, Developer, Ticket, TicketAppraisal } from './types'
import type { EventTime } from './eventTime'
import { compareRank } from './rank.ts'
import { clampReportedProgress } from './reportedProgress.ts'
import { projectWork } from './completionTime.ts'
import { getFlowDuration } from './flow.ts'
import { estimateInitialEffort } from './effortEstimate.ts'
import { scaleWork, workAmount } from './work.ts'
import { getDiscipline } from './discipline.ts'

export const RANK_PREFERENCE = 0.25

export function validateSelectionAttributes(developer: Pick<Developer, 'judgement' | 'focus' | 'discipline'>) {
  getDiscipline(developer)
  for (const value of [developer.judgement, developer.focus]) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError('Judgement and Focus must be finite and non-negative')
  }
}

// Full context supplies Rank ordinals, even for a trigger-specific subset.
// Unchosen previews live only in this single DEV snapshot, never belief history.
export function selectWork(
  context: readonly Ticket[], developer: Developer, draw: () => number,
  trigger: AssessmentDecision['trigger'] = 'pickup', at: EventTime = { high: 0, low: 0 },
  current?: Ticket, alternatives?: ReadonlySet<string>,
  currentInsight?: number,
): AssessmentDecision | undefined {
  validateSelectionAttributes(developer)
  const ordered = [...context].sort(compareRank)
  let best: { ticket: Ticket; score: number } | undefined
  const considered: TicketAppraisal[] = []
  for (const [index, ticket] of ordered.entries()) {
    if (alternatives && ticket.id !== current?.id && !alternatives.has(ticket.id)) continue
    const published = ticket.reportedEffortEstimate
    const insight = ticket.id === current?.id ? currentInsight : undefined
    const estimatedTotal = insight ?? published
      ?? estimateInitialEffort(ticket.requiredWork, developer.judgement, developer.competencies[ticket.workDomain], draw())
    const reportedProgress = clampReportedProgress(ticket.reportedProgress)
    const remaining = scaleWork(workAmount(estimatedTotal), 1 - reportedProgress / 100)
    const projection = projectWork(developer, ticket, remaining,
      ticket.id === current?.id ? getFlowDuration(developer, ticket.id) : 0, true)
    const rankScore = 1 / (index + 1)
    const rankContribution = RANK_PREFERENCE * rankScore
    const score = -projection.logSeconds + rankContribution
    const scalar = remaining.mantissa * 2 ** remaining.exponent
    considered.push({
      id: ticket.id, rank: ticket.rank, rankScore, reportedProgress, estimatedTotal,
      estimateSource: insight !== undefined ? 'insight' : published !== undefined ? 'published' : 'temporary',
      perceivedRemaining: remaining.mantissa > 0 && (scalar === 0 || !Number.isFinite(scalar)) ? null : scalar,
      completionSeconds: projection.seconds,
      logCompletionTime: Number.isFinite(projection.logSeconds) ? projection.logSeconds : null,
      timeLimit: projection.logSeconds === -Infinity ? 'zero' : projection.logSeconds === Infinity ? 'infinite' : null,
      rankContribution, score: Number.isFinite(score) ? score : null,
    })
    // No Infinity-Infinity subtraction; Rank/ID iteration resolves even zero or
    // impossible-time ties, including misleading 100%-complete reports.
    if (!best || score > best.score) best = { ticket, score }
  }
  if (!best) return undefined
  return { trigger, currentTicketId: current?.id ?? null, at: { ...at }, considered,
    flowDuration: current ? getFlowDuration(developer, current.id) : 0,
    outcome: !current ? 'pickup' : best.ticket.id === current.id ? 'stay' : 'switch',
    selectedId: best.ticket.id }
}
