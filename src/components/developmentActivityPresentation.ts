import type { DiagnosticActivity } from '../game/simulationActivity'
import { describeActivity } from './boardActivityPresentation'
import type { ActivityEngineer, ActivityRow } from './boardActivityPresentation'
import { formatEffort } from './formatEffort'

export function describeDiagnosticActivity(event: DiagnosticActivity, engineers: readonly ActivityEngineer[]): ActivityRow {
  const common = { id: `diagnostic-${event.id}`, ticketId: event.ticketId, ticketTitle: event.ticketTitle, at: event.at }
  if (event.kind === 'reported') return { ...common, text: describeActivity(event.report, engineers) }
  if (event.kind === 'assessment') {
    const outcome = event.published ? 'published' : event.improved ? 'report missed' : 'no higher correction'
    const reason = event.reason + (event.proactive && event.reason !== 'review' ? ' + review' : '')
    return { ...common, internal: true,
      text: `${event.developerName} · ${reason}: ${outcome}. Board ${formatEffort(event.boardBefore ?? undefined)}; candidate ${formatEffort(event.candidate)}.`,
      details: `Engineer ${event.developerId}. Board after: ${formatEffort(event.boardAfter ?? undefined)}. `
        + (event.draw === null ? event.proactive ? 'Proactive review follow-through; no reporting roll.' : 'No reporting roll.'
          : `Reporting draw ${event.draw}; probability ${event.probability}.`) }
  }
  const decision = event.decision
  const trigger = { pickup: 'pickup', estimate_revision: 'effort revision', priority: 'Rank change' }[decision.trigger]
  return { ...common, internal: true,
    text: `${event.developerName} · ${trigger}: ${decision.outcome}${decision.outcome === 'stay' ? ` on ${decision.selectedId}` : ` ${decision.currentTicketId ?? 'idle'} → ${decision.selectedId}`}.`,
    details: `Engineer ${event.developerId}. ` + decision.considered.map(option => `${option.id}: ${option.estimateSource} total ${formatEffort(option.estimatedTotal)}, Rank ${option.rank}, score ${option.score ?? option.timeLimit}.`).join(' ') }
}
