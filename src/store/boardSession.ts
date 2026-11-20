import { ACTIVITY_LIMIT, collectBoardActivity } from '../game/boardActivity.ts'
import type { BoardActivity } from '../game/boardActivity'
import { createSimulationSession, simulationReducer } from './simulationControls.ts'
import type { SimulationAction, SimulationSession } from './simulationControls'
import { collectSimulationActivity } from '../game/simulationActivity.ts'
import type { DiagnosticActivity } from '../game/simulationActivity'

export interface BoardSession {
  simulation: SimulationSession
  activity: BoardActivity[]
  nextActivityId: number
  diagnosticActivity?: DiagnosticActivity[]
  nextDiagnosticId?: number
}

export function createBoardSession(): BoardSession {
  return { simulation: createSimulationSession(), activity: [], nextActivityId: 1 }
}

export function createDevelopmentBoardSession(): BoardSession {
  return { ...createBoardSession(), diagnosticActivity: [], nextDiagnosticId: 1 }
}

// Local, transactional observation: StrictMode replay cannot double-append, and
// a thrown simulation discards the buffer alongside its uncommitted state clone.
export function boardReducer(session: BoardSession, action: SimulationAction): BoardSession {
  if (action.type === 'restart') return session.diagnosticActivity ? createDevelopmentBoardSession() : createBoardSession()
  const diagnostic = session.diagnosticActivity ? collectSimulationActivity(session.simulation.game.tickets, session.nextActivityId, session.nextDiagnosticId) : undefined
  const collected = diagnostic?.board ?? collectBoardActivity(session.simulation.game.tickets, session.nextActivityId)
  const simulation = simulationReducer(session.simulation, action, collected.observe, diagnostic?.internal)
  if (simulation === session.simulation) return session
  return { simulation, activity: collected.events.length ? [...session.activity, ...collected.events].slice(-ACTIVITY_LIMIT) : session.activity, nextActivityId: collected.nextId,
    ...(diagnostic ? { diagnosticActivity: diagnostic.diagnostics.length ? [...session.diagnosticActivity!, ...diagnostic.diagnostics].slice(-ACTIVITY_LIMIT) : session.diagnosticActivity,
      nextDiagnosticId: diagnostic.nextDiagnosticId } : {}) }
}
