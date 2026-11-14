import type { GameState } from './types'
import { clampReportedProgress } from './reportedProgress.ts'

export function advanceSimulation(
  state: GameState,
  elapsedSeconds: number,
): GameState {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    throw new RangeError('elapsedSeconds must be a finite, non-negative number')
  }

  const tickets = state.tickets.map((ticket) => ({
    ...ticket,
    reportedProgress: clampReportedProgress(ticket.reportedProgress),
  }))
  const developers = state.developers.map((developer) => ({ ...developer }))
  const ticketsById = new Map(tickets.map((ticket) => [ticket.id, ticket]))

  for (const developer of developers) {
    // Active work can differ from ownership; assignments do not drive progress.
    if (developer.activeTicketID === undefined || elapsedSeconds === 0) continue

    const ticket = ticketsById.get(developer.activeTicketID)
    if (!ticket || ticket.actualStatus === 'done') continue

    if (ticket.completedWork >= ticket.requiredWork) {
      ticket.actualStatus = 'done'
      ticket.reportedProgress = 100
      continue
    }

    const work = developer.productivity * elapsedSeconds
    if (work <= 0) continue

    ticket.completedWork = Math.min(
      ticket.requiredWork,
      ticket.completedWork + work,
    )
    ticket.actualStatus =
      ticket.completedWork === ticket.requiredWork ? 'done' : 'in_progress'
    // For now active work reports its percentage immediately, without moving the board card.
    ticket.reportedProgress = clampReportedProgress(
      (ticket.completedWork / ticket.requiredWork) * 100,
    )
  }

  return {
    ...state,
    tickets,
    developers,
    simulationTime: state.simulationTime + elapsedSeconds,
  }
}
