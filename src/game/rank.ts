import type { GameState, Ticket } from './types'

// Lower numbers express higher managerial priority; ID breaks ties independently of array order.
export function compareRank(a: Pick<Ticket, 'rank' | 'id'>, b: Pick<Ticket, 'rank' | 'id'>) {
  return a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export function reorderTodo(state: GameState, ticketId: string, targetId: string, after = false): GameState {
  const globallyOrdered = [...state.tickets].sort(compareRank)
  // Reject malformed state rather than repair ranks in unrelated columns during a drop.
  if (globallyOrdered.some((ticket, i) => ticket.rank !== i + 1)) return state
  const group = globallyOrdered.filter(t => t.reportedStatus === 'todo')
  const source = group.find(t => t.id === ticketId)
  const target = group.find(t => t.id === targetId)
  if (!source || !target || source === target) return state
  const reordered = group.filter(t => t !== source)
  reordered.splice(reordered.indexOf(target) + (after ? 1 : 0), 0, source)
  if (reordered.every((t, i) => t === group[i])) return state
  // These are global slots, including gaps occupied by other columns. Permute only their owners.
  const ranks = group.map(t => t.rank)
  const byId = new Map(reordered.map((t, i) => [t.id, ranks[i]]))
  return { ...state, tickets: state.tickets.map(t => {
    const rank = byId.get(t.id)
    return rank === undefined || rank === t.rank ? t : { ...t, rank }
  }) }
}
