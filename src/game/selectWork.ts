import type { AssessmentDecision, CandidateScore, Developer, Ticket } from './types'
import { compareRank } from './rank.ts'
import { clampReportedProgress } from './reportedProgress.ts'
import { projectCompletion } from './completionTime.ts'
import { getFlowDuration } from './flow.ts'
import { assessmentNoise, RANK_PREFERENCE } from './reconsideration.ts'

const RANK_WEIGHT = 0.5
const OPPORTUNITY_WEIGHT = 0.5

export function validateSelectionAttributes(developer: Pick<Developer, 'judgement' | 'focus'>) {
  for (const value of [developer.judgement, developer.focus]) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError('Judgement and Focus must be finite and non-negative')
  }
}

// Nomination reads only public information. Ordinals never alter stored global Rank.
export function scoreCandidates(eligible: readonly Ticket[]): CandidateScore[] {
  return [...eligible].sort(compareRank).map((ticket, index) => {
    const rankScore = 1 / (index + 1)
    const reportedProgress = clampReportedProgress(ticket.reportedProgress)
    const opportunityScore = reportedProgress / 100
    const rankContribution = RANK_WEIGHT * rankScore
    const opportunityContribution = OPPORTUNITY_WEIGHT * opportunityScore
    return { id: ticket.id, rank: ticket.rank, reportedProgress, rankScore, opportunityScore,
      rankContribution, opportunityContribution, score: rankContribution + opportunityContribution }
  })
}

export function nominateCandidate(eligible: readonly Ticket[]) {
  return scoreCandidates(eligible).reduce<CandidateScore | undefined>((best, candidate) =>
    !best || candidate.score > best.score ? candidate : best, undefined)
}

// This privileged, noisy comparison is the explicit Judgement mechanic; it is
// distinct from reported-information nomination and never enters the player view.
export function assessWork(
  current: Ticket, alternative: Ticket | undefined, eligible: readonly Ticket[],
  developer: Developer, kind: AssessmentDecision['kind'], draw: () => number,
): AssessmentDecision {
  validateSelectionAttributes(developer)
  const scores = scoreCandidates(eligible)
  const currentScore = scores.find(candidate => candidate.id === current.id)!
  const alternativeScore = scores.find(candidate => candidate.id === alternative?.id) ?? null
  const flowDuration = kind === 'reconsideration' ? getFlowDuration(developer, current.id) : 0
  const stay = projectCompletion(developer, current, kind === 'reconsideration')
  const change = alternative ? projectCompletion(developer, alternative) : null
  // Equal impossible times are a neutral efficiency tie, not Infinity-Infinity.
  const advantage = !change || stay.logSeconds === change.logSeconds ? 0 : stay.logSeconds - change.logSeconds
  const rankPreference = alternativeScore ? RANK_PREFERENCE * (alternativeScore.rankScore - currentScore.rankScore) : 0
  const roll = alternative ? draw() : null
  const uncertainty = roll === null ? { complexity: 1, noiseScale: 0, error: 0 }
    : assessmentNoise(developer.judgement, eligible.length - 1, roll)
  const perceived = advantage + rankPreference + uncertainty.error
  const switchWork = !!alternative && perceived > 0
  return {
    kind, current: currentScore, alternative: alternativeScore,
    nomination: nominateCandidate(kind === 'pickup' ? eligible : eligible.filter(ticket => ticket.id !== current.id)) ?? null,
    judgement: developer.judgement,
    flowDuration, staySeconds: stay.seconds, switchSeconds: change?.seconds ?? null,
    efficiencyAdvantage: Number.isFinite(advantage) ? advantage : null,
    efficiencyLimit: Number.isFinite(advantage) ? null : advantage > 0 ? 'switch' : 'stay',
    rankPreference, ...uncertainty, draw: roll,
    perceivedAdvantage: Number.isFinite(perceived) ? perceived : null,
    outcome: !alternative ? 'unambiguous' : switchWork ? 'switch' : 'stay',
    selectedId: switchWork ? alternative!.id : current.id,
  }
}

export function selectWork(eligible: readonly Ticket[], developer: Developer, draw: () => number) {
  validateSelectionAttributes(developer)
  const nominated = nominateCandidate(eligible)
  if (!nominated) return undefined
  const current = eligible.find(ticket => ticket.id === nominated.id)!
  // Initial pickup compares the public nominee with the objectively fastest
  // other eligible ticket, using fresh Flow on both. Projection ties use Rank.
  const fastest = eligible.filter(ticket => ticket.id !== current.id).sort(compareRank).reduce<Ticket | undefined>((best, ticket) =>
    !best || projectCompletion(developer, ticket).logSeconds < projectCompletion(developer, best).logSeconds ? ticket : best, undefined)
  return assessWork(current, fastest, eligible, developer, 'pickup', draw)
}
