import type { GameState } from '../../src/game/types.ts'

// These scenarios isolate pre-#57 timing/RNG invariants, after estimation already happened.
export function estimatedFixture<T extends GameState>(state: T): T {
  for (const ticket of state.tickets) {
    ticket.initialEffortEstimate = { developerId: state.developers[0]?.id ?? 'previous-engineer', totalWork: ticket.requiredWork }
    ticket.reportedEffortEstimate = ticket.requiredWork
  }
  return state
}
