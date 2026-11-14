import type { GameState, Ticket } from './types'
import { clampReportedProgress } from './reportedProgress.ts'
import { nextRandom } from './random.ts'

export function advanceSimulation(
  state: GameState,
  elapsedSeconds: number,
  random?: () => number,
): GameState {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    throw new RangeError('elapsedSeconds must be a finite, non-negative number')
  }

  const tickets = state.tickets.map((ticket) => ({
    ...ticket,
    reportedProgress: ticket.actualStatus === 'backlog'
      ? ticket.reportedProgress : clampReportedProgress(ticket.reportedProgress),
  }))
  const developers = state.developers.map((developer) => ({ ...developer }))
  const ticketsById = new Map(tickets.map((ticket) => [ticket.id, ticket]))
  let randomState = state.randomState
  // Keep RNG state local until return: StrictMode updater replays have no external effects.
  // Test overrides control draws directly and leave the stored sequence unchanged.
  const draw = () => {
    if (random) return random()
    const next = nextRandom(randomState)
    randomState = next.state
    return next.value
  }

  if (elapsedSeconds > 0) {
    const claimedTickets = new Set<string>()
    const isComplete = (ticket: Ticket) =>
      ticket.actualStatus === 'done' || ticket.completedWork >= ticket.requiredWork

    // Reserve existing work before selection so idle developers cannot steal it.
    // Array order resolves duplicate active references deterministically; collaboration is not enabled.
    for (const developer of developers) {
      const ticket = ticketsById.get(developer.activeTicketID ?? '')
      if (!ticket || ticket.actualStatus === 'backlog' || isComplete(ticket) || claimedTickets.has(ticket.id)) {
        delete developer.activeTicketID
      } else {
        claimedTickets.add(ticket.id)
      }
    }

    for (const developer of developers) {
      if (developer.activeTicketID !== undefined) continue
      const eligible = tickets.filter((candidate) =>
        !isComplete(candidate) && !claimedTickets.has(candidate.id),
      )
      const todo = eligible.find((candidate) => candidate.actualStatus === 'todo')
      const inProgress = eligible.filter((candidate) => candidate.actualStatus === 'in_progress')
      // Provisional category choice, independent of category size; roll only for new work.
      // Inject random values in tests. Call boundaries still determine when new selections occur.
      const chooseInProgress = inProgress.length > 0 && (!todo || draw() >= 0.5)
      const ticket = chooseInProgress
        ? inProgress[inProgress.length === 1 ? 0 : Math.floor(draw() * inProgress.length)]
        : todo
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
      // Backlog is uncommitted work, even if reported state differs.
      if (ticket.actualStatus === 'backlog') continue
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
    randomState,
    tickets,
    developers,
    simulationTime: state.simulationTime + elapsedSeconds,
  }
}
