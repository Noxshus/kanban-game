import { ESTIMATION_COSTS } from '../game/planning.ts'
import type { SprintState } from './sprintSession'
import type { getPlayerView } from './playerView'
import { availableForCommitment } from '../game/commitment.ts'
import { forecastDelivery } from './deliveryForecast.ts'

// Public input only: neither hidden Discipline nor actual capacity can enter this view.
export function getPlanningView(view: ReturnType<typeof getPlayerView>, sprint: SprintState) {
  const planning = sprint.planning ?? { stage: 'shortlist' as const, ticketIds: [] }
  const tickets = view.tickets.map(ticket => ({ id: ticket.id, title: ticket.title, complexity: ticket.complexity,
    reportedStatus: ticket.reportedStatus, reportedEffortEstimate: ticket.reportedEffortEstimate,
    cost: ESTIMATION_COSTS[ticket.complexity] }))
  const requests = planning.ticketIds.map(id => tickets.find(ticket => ticket.id === id)!).filter(Boolean)
  const commitmentIds = planning.stage === 'estimated' ? planning.commitmentIds ?? [] : []
  const commitment = commitmentIds.map(id => view.tickets.find(ticket => ticket.id === id)!).filter(Boolean)
  return {
    command: view.manager.command,
    stage: planning.stage,
    availableCapacity: null,
    requestedCapacity: requests.reduce((sum, ticket) => sum + ticket.cost, 0),
    requests,
    candidates: tickets.filter(ticket => !planning.ticketIds.includes(ticket.id)),
    outcomes: planning.stage === 'estimated' ? planning.outcomes.map(outcome => ({ ...outcome })) : [],
    commitment,
    commitmentCandidates: view.tickets.filter(ticket => availableForCommitment(ticket) && !commitmentIds.includes(ticket.id)),
    forecast: forecastDelivery(commitment, view.developers, sprint.calendar),
    prototypeComplete: sprint.phase === 'planning' && view.committedTicketIds !== undefined,
  }
}

export type PlanningView = ReturnType<typeof getPlanningView>
