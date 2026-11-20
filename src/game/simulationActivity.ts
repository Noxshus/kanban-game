import type { AssessmentDecision, EffortAssessmentReason } from './types'
import type { EventTime } from './eventTime'
import { ACTIVITY_LIMIT, collectBoardActivity } from './boardActivity.ts'
import type { BoardActivity, BoardReport } from './boardActivity'

type Identity = { ticketId: string; ticketTitle: string; at: EventTime; developerId: string; developerName: string }
export type InternalActivity = Identity & (
  | { kind: 'assessment'; reason: EffortAssessmentReason; candidate: number; boardBefore: number | null; boardAfter: number | null;
      improved: boolean; published: boolean; proactive: boolean; probability: number | null; draw: number | null }
  | { kind: 'decision'; decision: AssessmentDecision }
)
export type InternalObserver = (event: Readonly<InternalActivity>) => void
export type DiagnosticActivity = { id: number } & (InternalActivity | {
  kind: 'reported'; ticketId: string; ticketTitle: string; at: EventTime; report: BoardActivity
})

// A DEV caller opts into this buffer. Public IDs/data remain identical with or
// without diagnostics; the separate sequence orders both surfaces at exact ties.
export function collectSimulationActivity(initial: readonly BoardReport[], firstPublicId = 1, firstDiagnosticId = 1) {
  const diagnostics: DiagnosticActivity[] = []
  let nextDiagnosticId = firstDiagnosticId
  const append = (event: InternalActivity | Omit<Extract<DiagnosticActivity, { kind: 'reported' }>, 'id'>) => {
    diagnostics.push({ ...structuredClone(event), id: nextDiagnosticId++ })
    if (diagnostics.length > ACTIVITY_LIMIT) diagnostics.shift()
  }
  const board = collectBoardActivity(initial, firstPublicId, report => append({
    kind: 'reported', ticketId: report.ticketId, ticketTitle: report.ticketTitle, at: report.at, report,
  }))
  const internal: InternalObserver = event => append(event)
  return { board, internal, diagnostics, get nextDiagnosticId() { return nextDiagnosticId } }
}

export interface DiagnosticActivityFilters { assessments: boolean; decisions: boolean; noopReviews: boolean }
export function filterDiagnosticActivity(events: readonly DiagnosticActivity[], filters: DiagnosticActivityFilters) {
  return events.filter(event => event.kind === 'reported' || (event.kind === 'decision' ? filters.decisions
    : filters.assessments && (event.reason !== 'review' || event.improved || filters.noopReviews)))
}
