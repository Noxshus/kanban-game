import { exampleGameState } from '../data/exampleGameState.ts'
import { advanceSimulation } from '../game/advanceSimulation.ts'
import type { GameState } from '../game/types'
import { compareRank, reorderTodo } from '../game/rank.ts'
import { reconsiderPriorities } from '../game/workDecisions.ts'
import type { BoardObserver } from '../game/boardActivity'
import type { InternalObserver } from '../game/simulationActivity'
import type { EventTime } from '../game/eventTime'

export interface SimulationSession {
  game: GameState
  isPaused: boolean
  // Session-only, JSON-safe staging: no simulation changes occur during paused edits.
  pausedPriorityOrder?: string[]
}

export type SimulationAction =
  | { type: 'reorderTodo'; ticketId: string; targetId: string; after?: boolean }
  | { type: 'togglePause' }
  | { type: 'tick' }
  | { type: 'step' }
  | { type: 'restart' }
  | { type: 'applySeed'; seed: number }

export function createSimulationSession(): SimulationSession {
  // Every run owns its nested objects; the example fixture is never used as mutable state.
  return { game: structuredClone(exampleGameState), isPaused: true }
}

export function parseSeed(input: string): number | null {
  const value = input.trim()
  if (!/^\d+$/.test(value)) return null
  const seed = Number(value)
  return Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff ? seed : null
}

function priorityOrder(game: GameState): string[] {
  return [...game.tickets].sort(compareRank).map(ticket => ticket.id)
}

function applyPendingPriorities(session: SimulationSession, observe?: BoardObserver, internal?: InternalObserver): SimulationSession {
  const { pausedPriorityOrder, ...ready } = session
  if (!pausedPriorityOrder) return session
  // Ranks are globally consecutive. Reconstruct only the old ordering, keeping
  // the current seed and shared decision path instead of saving a stale GameState.
  const ranks = new Map(pausedPriorityOrder.map((id, i) => [id, i + 1]))
  const before = { ...session.game, tickets: session.game.tickets.map(ticket => ({
    ...ticket, rank: ranks.get(ticket.id) ?? ticket.rank,
  })) }
  return { ...ready, game: reconsiderPriorities(before, session.game, observe, internal) }
}

export function advanceSession(session: SimulationSession, advance: number | EventTime, observe?: BoardObserver, internal?: InternalObserver): SimulationSession {
  const ready = applyPendingPriorities(session, observe, internal)
  return { ...ready, game: advanceSimulation(ready.game, advance, undefined, observe, internal) }
}

export function simulationReducer(
  session: SimulationSession,
  action: SimulationAction,
  observe?: BoardObserver,
  internal?: InternalObserver,
): SimulationSession {
  switch (action.type) {
    case 'reorderTodo': {
      const game = reorderTodo(session.game, action.ticketId, action.targetId, action.after)
      if (game === session.game) return session
      if (!session.isPaused) return { ...session, game: reconsiderPriorities(session.game, game, observe, internal) }
      // Capture lazily: before the first paused edit this is also the pause-start
      // order. Compare net order, so reversing edits never creates an assessment.
      const { pausedPriorityOrder = priorityOrder(session.game), ...rest } = session
      return priorityOrder(game).every((id, i) => id === pausedPriorityOrder[i])
        ? { ...rest, game }
        : { ...rest, game, pausedPriorityOrder }
    }
    case 'togglePause':
      return session.isPaused
        ? { ...applyPendingPriorities(session, observe, internal), isPaused: false }
        : { ...session, isPaused: true }
    case 'tick':
    case 'step':
      // Guard against queued timer ticks after pause/restart, and stepping during a live run.
      if (action.type === 'tick' ? session.isPaused : !session.isPaused) return session
      return advanceSession(session, 1, observe, internal)
    case 'restart':
      return createSimulationSession()
    case 'applySeed':
      if (!session.isPaused || !Number.isInteger(action.seed)
        || action.seed < 0 || action.seed > 0xffffffff) return session
      return { ...session, game: { ...session.game, randomState: action.seed } }
  }
}
