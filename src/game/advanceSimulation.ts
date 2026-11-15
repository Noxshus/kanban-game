import type { GameState, Ticket } from './types'
import { clampReportedProgress } from './reportedProgress.ts'
import { nextRandom } from './random.ts'
import { compareRank } from './rank.ts'
import { getWorkCompleted } from './productivity.ts'

export function advanceSimulation(
  state: GameState,
  elapsedSeconds: number,
  random?: () => number,
): GameState {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    throw new RangeError('elapsedSeconds must be a finite, non-negative number')
  }

  // Whole seconds are real simulation ticks, including selection after earlier completions.
  // A fractional remainder uses the equivalent survival probability; fractional partitions
  // can change decision timing, so replay requires the same elapsed-time call sequence.
  if (elapsedSeconds > 1) {
    let result = state
    for (let seconds = 0; seconds < Math.floor(elapsedSeconds); seconds++) {
      result = advanceSimulation(result, 1, random)
    }
    const remainder = elapsedSeconds % 1
    return remainder > 0 ? advanceSimulation(result, remainder, random) : result
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

    const selectTicket = (excludedId?: string) => {
      const eligible = tickets.filter((candidate) =>
        candidate.id !== excludedId && !isComplete(candidate) && !claimedTickets.has(candidate.id),
      )
      const todo = eligible.filter((candidate) => candidate.actualStatus === 'todo').sort(compareRank)[0]
      const inProgress = eligible.filter((candidate) => candidate.actualStatus === 'in_progress')
      // Provisional category choice, independent of category size; roll only for new work.
      // Inject random values in tests. Call boundaries still determine when new selections occur.
      const chooseInProgress = inProgress.length > 0 && (!todo || draw() >= 0.5)
      return chooseInProgress
        ? inProgress[inProgress.length === 1 ? 0 : Math.floor(draw() * inProgress.length)]
        : todo
    }

    // Existing workers get one switch opportunity before any work. Keep their claim
    // until a replacement is secured, so failed switches never drop active work.
    const switchProbability = elapsedSeconds === 1 ? 0.01 : 1 - 0.99 ** elapsedSeconds
    for (const developer of developers) {
      const current = ticketsById.get(developer.activeTicketID ?? '')
      if (!current || draw() >= switchProbability) continue
      const replacement = selectTicket(current.id)
      if (!replacement) continue
      current.actualStatus = 'in_progress'
      claimedTickets.delete(current.id)
      developer.activeTicketID = replacement.id
      claimedTickets.add(replacement.id)
    }

    for (const developer of developers) {
      if (developer.activeTicketID !== undefined) continue
      const ticket = selectTicket()
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

      const work = getWorkCompleted(developer, ticket, elapsedSeconds)
      // Bound the increment before addition so even a large finite increment
      // cannot overflow completedWork on the way to a finite ticket requirement.
      ticket.completedWork = work >= ticket.requiredWork - ticket.completedWork
        ? ticket.requiredWork : ticket.completedWork + work
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

    // Subsequent work starts on the next tick, with no leftover-time chaining within a tick.
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
