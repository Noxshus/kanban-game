import type { GameState } from '../../src/game/types.ts'

// These scenarios isolate pre-#57 timing/RNG invariants, after estimation already happened.
export function estimatedFixture<T extends GameState>(state: T): T {
  // Isolate work arithmetic from reporting cadence, including huge elapsed spans.
  // New #63 tests exercise real seeded scheduling at ordinary simulation scales.
  for (const developer of state.developers) if (developer.activeTicketID) {
    developer.estimateReview = { ticketId: developer.activeTicketID, dueTime: { high: 1e308, low: 0 } }
  }
  for (const ticket of state.tickets) {
    ticket.initialEffortEstimate = { developerId: state.developers[0]?.id ?? 'previous-engineer', totalWork: ticket.requiredWork }
    ticket.reportedEffortEstimate = ticket.requiredWork
    ticket.estimateHistory = [{ kind: 'publication', developerId: ticket.initialEffortEstimate.developerId,
      totalWork: ticket.requiredWork, reason: 'initial', at: { high: 0, low: 0 } }]
  }
  return state
}
