import type { GameState, Ticket } from './types'
import type { BoardObserver } from './boardActivity'
import { observeBoard } from './boardActivity.ts'
import { eventTime } from './eventTime.ts'
import { compareRank } from './rank.ts'

export type CommitmentAction = { type: 'addCommitment'; ticketId: string }
  | { type: 'removeCommitment'; ticketId: string }
  | { type: 'moveCommitment'; ticketId: string; direction: 'up' | 'down' }
  | { type: 'commitSprint' }

// Availability is a public planning choice, not a hidden completion detector.
export const availableForCommitment = (ticket: Pick<Ticket, 'reportedStatus'>) => ticket.reportedStatus !== 'done'
export const inCommittedScope = (state: Pick<GameState, 'committedTicketIds'>, id: string) =>
  state.committedTicketIds === undefined || state.committedTicketIds.includes(id)

export function validateCommittedScope(state: GameState) {
  const ids = state.committedTicketIds
  if (ids !== undefined && (!Array.isArray(ids) || new Set(ids).size !== ids.length
      || ids.some(id => typeof id !== 'string' || !state.tickets.some(ticket => ticket.id === id)))) {
    throw new RangeError('Committed scope must contain distinct existing ticket IDs')
  }
}

// No decisions or RNG at commitment. The first positive execution advance uses
// normal claim restoration/selection, with scope as an extra eligibility gate.
export function commitScope(state: GameState, ids: readonly string[], observe?: BoardObserver): GameState {
  if (new Set(ids).size !== ids.length || ids.some(id => !state.tickets.some(t => t.id === id && availableForCommitment(t)))) {
    throw new RangeError('Commitment requires distinct available tickets')
  }
  const game = structuredClone(state)
  const ordered = [...game.tickets].sort(compareRank)
  if (ordered.some((ticket, index) => ticket.rank !== index + 1)) throw new RangeError('Commitment requires consecutive global Rank')
  const selected = new Set(ids)
  const slots = ordered.filter(ticket => selected.has(ticket.id)).map(ticket => ticket.rank)
  const byId = new Map(game.tickets.map(ticket => [ticket.id, ticket]))
  const at = eventTime(game.simulationTime, game.simulationTimeRemainder)
  game.committedTicketIds = [...ids]
  for (const [index, id] of ids.entries()) {
    const ticket = byId.get(id)!
    ticket.rank = slots[index] // Permute selected global slots; leave unrelated ranks intact.
    if (ticket.actualStatus === 'backlog') {
      ticket.actualStatus = ticket.reportedStatus = 'todo'
      observeBoard(observe, ticket, at)
    }
  }
  return game
}
