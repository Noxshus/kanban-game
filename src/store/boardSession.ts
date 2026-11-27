import { ACTIVITY_LIMIT, collectBoardActivity } from '../game/boardActivity.ts'
import type { BoardActivity } from '../game/boardActivity'
import { createSprintSession, sprintReducer } from './sprintSession.ts'
import type { SprintAction, SprintSession } from './sprintSession'
import type { WorkingCalendar } from '../game/workingCalendar'
import { collectSimulationActivity } from '../game/simulationActivity.ts'
import type { DiagnosticActivity } from '../game/simulationActivity'
import { collectPlayerObservations, createPlayerObservations } from './playerObservations.ts'
import type { TicketObservation } from './playerObservations'
import { getPlayerView } from './playerView.ts'
import { collectProgressProjections, createProgressProjections } from './progressProjection.ts'
import type { ProgressProjection } from './progressProjection'
import { eventTime } from '../game/eventTime.ts'

export interface BoardSession extends SprintSession {
  activity: BoardActivity[]
  nextActivityId: number
  observations?: TicketObservation[]
  projections?: ProgressProjection[]
  diagnosticActivity?: DiagnosticActivity[]
  nextDiagnosticId?: number
}

export function createBoardSession(calendar?: WorkingCalendar): BoardSession {
  const { simulation, sprint } = createSprintSession(calendar)
  const view = getPlayerView(simulation.game)
  return { simulation, sprint, activity: [], nextActivityId: 1,
    observations: createPlayerObservations(view.tickets),
    projections: createProgressProjections(view.tickets, view.developers) }
}

export function createDevelopmentBoardSession(calendar?: WorkingCalendar): BoardSession {
  return { ...createBoardSession(calendar), diagnosticActivity: [], nextDiagnosticId: 1 }
}

// Local, transactional observation: StrictMode replay cannot double-append, and
// a thrown simulation discards the buffer alongside its uncommitted state clone.
export function boardReducer(session: BoardSession, action: SprintAction): BoardSession {
  if (action.type === 'restart') return session.diagnosticActivity ? createDevelopmentBoardSession(session.sprint?.calendar) : createBoardSession(session.sprint?.calendar)
  // Pre-sprint saved board sessions enter Planning without changing their game
  // snapshot or inventing elapsed sprint history.
  const sprint = session.sprint ?? { ...createSprintSession().sprint,
    startedAt: eventTime(session.simulation.game.simulationTime, session.simulation.game.simulationTimeRemainder) }
  const previous = session.sprint ? session : { ...session, sprint, simulation: { ...session.simulation, isPaused: true } }
  const diagnostic = session.diagnosticActivity ? collectSimulationActivity(session.simulation.game.tickets, session.nextActivityId, session.nextDiagnosticId) : undefined
  const collected = diagnostic?.board ?? collectBoardActivity(session.simulation.game.tickets, session.nextActivityId)
  const game = session.simulation.game
  const view = getPlayerView(game)
  const forecast = collectProgressProjections(session.projections ?? createProgressProjections(view.tickets, view.developers,
    eventTime(game.simulationTime, game.simulationTimeRemainder)), view.developers)
  const evidence = collectPlayerObservations(session.observations ?? createPlayerObservations(view.tickets))
  // All observers see every public report boundary, even if a single action
  // exceeds the ticker limit. Neither consumer drives simulation or reporting.
  const next = sprintReducer(previous, action, (report, at) => {
    collected.observe(report, at)
    evidence.observe(report, at)
    forecast.observe(report, at)
  }, diagnostic?.internal)
  if (next.simulation === session.simulation && next.sprint === session.sprint) return session
  return { simulation: next.simulation, sprint: next.sprint, observations: evidence.observations, projections: forecast.projections,
    activity: collected.events.length ? [...session.activity, ...collected.events].slice(-ACTIVITY_LIMIT) : session.activity, nextActivityId: collected.nextId,
    ...(diagnostic ? { diagnosticActivity: diagnostic.diagnostics.length ? [...session.diagnosticActivity!, ...diagnostic.diagnostics].slice(-ACTIVITY_LIMIT) : session.diagnosticActivity,
      nextDiagnosticId: diagnostic.nextDiagnosticId } : {}) }
}
