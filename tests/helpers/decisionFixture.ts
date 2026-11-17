import type { GameState, Ticket } from '../../src/game/types'
import { encounterEstimate } from '../../src/game/estimateHistory.ts'
import { eventTime } from '../../src/game/eventTime.ts'
import { workTransitions } from '../../src/game/workDecisions.ts'

// Exercise the shared transition at a deliberate decision event. Other suites
// verify real reducer/revision triggers and their chronological boundaries.
export function decideNow(state: GameState, draw: () => number = () => 0.5) {
  const result = structuredClone(state)
  const now = eventTime(result.simulationTime, result.simulationTimeRemainder)
  const transitions = workTransitions(result, now, draw)
  for (const developer of result.developers) transitions.restore(developer)
  for (const developer of result.developers) transitions.decide(developer, 'priority')
  return result
}

export function remember(ticket: Ticket, developerId: string, totalWork = ticket.requiredWork) {
  (ticket.estimateHistory ??= []).push({ kind: 'assessment', developerId, totalWork, reason: 'initial', at: { high: 0, low: 0 } })
}

export function decisionFixture(): GameState {
  const developer = { id: 'a', name: 'A', productivity: 1, judgement: 0, focus: 5,
    competencies: { frontend: 10, backend: 10 }, activeTicketID: 'current' }
  const ticket: Ticket = { id: 'current', title: 'Current', rank: 1, workDomain: 'frontend',
    actualStatus: 'in_progress', reportedStatus: 'in_progress', reportedProgress: 0,
    requiredWork: 100, completedWork: 0 }
  encounterEstimate(ticket, developer, { high: 0, low: 0 }, () => 0)
  return { randomState: 1, simulationTime: 0, developers: [developer], tickets: [ticket] }
}
