import type { GameState, Ticket } from './types'
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

  if (elapsedSeconds > 0) {
    const claimedTickets = new Set<string>()
    const isComplete = (ticket: Ticket) =>
      ticket.actualStatus === 'done' || ticket.completedWork >= ticket.requiredWork

    // Reserve existing work before selection so idle developers cannot steal it.
    // Array order resolves duplicate active references deterministically; collaboration is not enabled.
    for (const developer of developers) {
      const ticket = ticketsById.get(developer.activeTicketID ?? '')
      if (!ticket || isComplete(ticket) || claimedTickets.has(ticket.id)) {
        delete developer.activeTicketID
      } else {
        claimedTickets.add(ticket.id)
      }
    }

    for (const developer of developers) {
      if (developer.activeTicketID !== undefined) continue
      const ticket = tickets.find((candidate) =>
        !isComplete(candidate) && !claimedTickets.has(candidate.id),
      )
      if (ticket) {
        developer.activeTicketID = ticket.id
        claimedTickets.add(ticket.id)
      }
    }

    for (const developer of developers) {
      const ticket = ticketsById.get(developer.activeTicketID ?? '')
      if (!ticket) continue

      // Temporary prototype rule: ownership follows active work, but remains recorded after completion.
      // Keep the fields separate so future reporting can intentionally diverge.
      ticket.assignedDeveloperId = developer.id

      ticket.completedWork = Math.min(
        ticket.requiredWork,
        ticket.completedWork + Math.max(0, developer.productivity) * elapsedSeconds,
      )
      ticket.actualStatus = ticket.completedWork >= ticket.requiredWork ? 'done' : 'in_progress'
    }

    for (const ticket of tickets) {
      if (isComplete(ticket)) {
        ticket.actualStatus = 'done'
        ticket.reportedProgress = 100
      } else if (claimedTickets.has(ticket.id)) {
        ticket.reportedProgress = clampReportedProgress(
          (ticket.completedWork / ticket.requiredWork) * 100,
        )
      }
      // Temporary proof-of-concept reporting rule: start/finish reports follow actual work.
      // Keep both fields separate so future reporting can diverge without changing the UI.
      if (claimedTickets.has(ticket.id) || ticket.actualStatus === 'done') {
        ticket.reportedStatus = ticket.actualStatus
      }
    }

    // No leftover-time chaining: a developer picks subsequent work on the next simulation call.
    for (const developer of developers) {
      const ticket = ticketsById.get(developer.activeTicketID ?? '')
      if (ticket?.actualStatus === 'done') delete developer.activeTicketID
    }
  }

  return {
    ...state,
    tickets,
    developers,
    simulationTime: state.simulationTime + elapsedSeconds,
  }
}
