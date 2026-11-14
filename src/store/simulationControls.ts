import { exampleGameState } from '../data/exampleGameState.ts'
import { advanceSimulation } from '../game/advanceSimulation.ts'
import type { GameState } from '../game/types'

export interface SimulationSession {
  game: GameState
  isPaused: boolean
}

export type SimulationAction =
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

export function simulationReducer(
  session: SimulationSession,
  action: SimulationAction,
): SimulationSession {
  switch (action.type) {
    case 'togglePause':
      return { ...session, isPaused: !session.isPaused }
    case 'tick':
    case 'step':
      // Guard against queued timer ticks after pause/restart, and stepping during a live run.
      if (action.type === 'tick' ? session.isPaused : !session.isPaused) return session
      return { ...session, game: advanceSimulation(session.game, 1) }
    case 'restart':
      return createSimulationSession()
    case 'applySeed':
      if (!session.isPaused || !Number.isInteger(action.seed)
        || action.seed < 0 || action.seed > 0xffffffff) return session
      return { ...session, game: { ...session.game, randomState: action.seed } }
  }
}
