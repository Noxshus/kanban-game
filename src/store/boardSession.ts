import { ACTIVITY_LIMIT, collectBoardActivity } from '../game/boardActivity.ts'
import type { BoardActivity } from '../game/boardActivity'
import { createSimulationSession, simulationReducer } from './simulationControls.ts'
import type { SimulationAction, SimulationSession } from './simulationControls'
import { collectSimulationActivity } from '../game/simulationActivity.ts'
import type { DiagnosticActivity } from '../game/simulationActivity'
import { collectPlayerObservations, createPlayerObservations } from './playerObservations.ts'
import type { TicketObservation } from './playerObservations'
import { getPlayerView } from './playerView.ts'

export interface BoardSession {
  simulation: SimulationSession
  activity: BoardActivity[]
  nextActivityId: number
  observations?: TicketObservation[]
  diagnosticActivity?: DiagnosticActivity[]
  nextDiagnosticId?: number
}

export function createBoardSession(): BoardSession {
  const simulation = createSimulationSession()
  return { simulation, activity: [], nextActivityId: 1,
    observations: createPlayerObservations(getPlayerView(simulation.game).tickets) }
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
  const game = session.simulation.game
  const evidence = collectPlayerObservations(session.observations ?? createPlayerObservations(
    getPlayerView(game).tickets))
  // Both consumers see every public report boundary, even if a single action
  // exceeds the ticker limit. Neither consumer drives simulation or reporting.
  const simulation = simulationReducer(session.simulation, action, (report, at) => {
    collected.observe(report, at)
    evidence.observe(report, at)
  }, diagnostic?.internal)
  if (simulation === session.simulation) return session
  return { simulation, observations: evidence.observations,
    activity: collected.events.length ? [...session.activity, ...collected.events].slice(-ACTIVITY_LIMIT) : session.activity, nextActivityId: collected.nextId,
    ...(diagnostic ? { diagnosticActivity: diagnostic.diagnostics.length ? [...session.diagnosticActivity!, ...diagnostic.diagnostics].slice(-ACTIVITY_LIMIT) : session.diagnosticActivity,
      nextDiagnosticId: diagnostic.nextDiagnosticId } : {}) }
}
