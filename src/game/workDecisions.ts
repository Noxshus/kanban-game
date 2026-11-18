import type { AssessmentDecision, Developer, GameState, Ticket } from './types'
import type { EventTime } from './eventTime'
import { eventTime } from './eventTime.ts'
import { isWorkComplete } from './work.ts'
import { encounterEstimate, pauseDiscovery, resumeDiscovery } from './estimateHistory.ts'
import { prepareDiscovery } from './reestimation.ts'
import { selectWork } from './selectWork.ts'
import { compareRank } from './rank.ts'
import { nextRandom } from './random.ts'
import { applySwitchLoss, beginWorkStint } from './workLoss.ts'

export function simulationDraw(state: GameState) {
  return () => {
    const next = nextRandom(state.randomState)
    state.randomState = next.state
    return next.value
  }
}

// Mutates only the caller-owned clone. Both elapsed events and reducer actions
// use this same reservation/claim/publication path, without another event queue.
export function workTransitions(state: GameState, now: EventTime, draw: () => number) {
  const byId = new Map(state.tickets.map(t => [t.id, t]))
  const claimed = new Set<string>()
  const clear = (developer: Developer) => {
    const previous = byId.get(developer.estimateDiscovery?.ticketId ?? developer.activeTicketID ?? '')
    if (previous && !isWorkComplete(previous)) pauseDiscovery(developer)
    delete developer.activeTicketID
    delete developer.flowStreak
    delete developer.workSession
    delete developer.estimateDiscovery
    delete developer.assessmentClock
    delete developer.workStint
  }
  // Reserve existing work before any idle pickup, irrespective of engineer order.
  for (const developer of state.developers) {
    const t = byId.get(developer.activeTicketID ?? '')
    if (!t || t.actualStatus === 'backlog' || isWorkComplete(t) || claimed.has(t.id)) clear(developer)
    else claimed.add(t.id)
  }
  const current = (developer: Developer) => byId.get(developer.activeTicketID ?? '')
  const context = (developer: Developer) => state.tickets.filter(t =>
    (t.id === developer.activeTicketID || !claimed.has(t.id)) && !isWorkComplete(t)
    && (t.actualStatus === 'todo' || t.actualStatus === 'in_progress'))
  const restore = (developer: Developer) => {
    delete developer.assessmentClock
    // Old decision snapshots use a different formula; never mislabel them as a new assessment.
    if (developer.lastAssessment && !('trigger' in developer.lastAssessment)) delete developer.lastAssessment
    const ticket = current(developer)
    if (!ticket) return
    beginWorkStint(state, developer, ticket)
    if (developer.estimateDiscovery && developer.estimateDiscovery.ticketId !== ticket.id) pauseDiscovery(developer)
    if (developer.flowStreak && developer.flowStreak.ticketId !== ticket.id) {
      pauseDiscovery(developer)
      delete developer.flowStreak
      delete developer.workSession
    }
    encounterEstimate(ticket, developer, now, draw, true)
    resumeDiscovery(developer, ticket.id)
  }
  const decide = (developer: Developer, trigger: AssessmentDecision['trigger'], alternatives?: ReadonlySet<string>) => {
    const previous = current(developer)
    const decision = selectWork(context(developer), developer, draw, trigger, now, previous, alternatives)
    if (!decision) return
    developer.lastAssessment = decision
    if (decision.selectedId === previous?.id) return
    if (previous) {
      applySwitchLoss(state, developer, previous)
      claimed.delete(previous.id)
      previous.actualStatus = 'in_progress'
    }
    const ticket = byId.get(decision.selectedId)!
    const appraisal = decision.considered.find(t => t.id === ticket.id)!
    pauseDiscovery(developer)
    developer.activeTicketID = ticket.id
    developer.flowStreak = { ticketId: ticket.id, duration: 0 }
    delete developer.workStint
    beginWorkStint(state, developer, ticket)
    delete developer.workSession
    delete developer.estimateDiscovery
    delete developer.assessmentClock
    claimed.add(ticket.id)
    ticket.assignedDeveloperId = developer.id
    ticket.actualStatus = 'in_progress'
    ticket.reportedStatus = 'in_progress'
    encounterEstimate(ticket, developer, now, draw, false,
      appraisal.estimateSource === 'temporary' ? appraisal.estimatedTotal : undefined)
    resumeDiscovery(developer, ticket.id)
  }
  return { claimed, clear, context, current, restore, decide }
}

function changedRelativeOrder(before: ReadonlyMap<string, Ticket>, options: Ticket[]) {
  const affected = new Set<string>()
  for (let i = 0; i < options.length; i++) for (let j = i + 1; j < options.length; j++) {
    const a = options[i], b = options[j]
    if (Math.sign(compareRank(before.get(a.id)!, before.get(b.id)!)) !== Math.sign(compareRank(a, b))) {
      affected.add(a.id); affected.add(b.id)
    }
  }
  return affected
}

export function reconsiderPriorities(before: GameState, reordered: GameState): GameState {
  if (reordered === before) return before
  const original = workTransitions(structuredClone(before), eventTime(before.simulationTime, before.simulationTimeRemainder), () => { throw Error('No preview during relevance filtering') })
  const initiallyEligible = new Map(before.developers.map(d => [d.id,
    new Set(original.current(d) ? original.context(d).map(t => t.id) : [])]))
  const result = structuredClone(reordered)
  const now = eventTime(result.simulationTime, result.simulationTimeRemainder)
  const draw = simulationDraw(result), transitions = workTransitions(result, now, draw)
  const oldTickets = new Map(before.tickets.map(t => [t.id, t]))
  let assessed = false
  const prepared: Developer[] = []
  for (const developer of result.developers) {
    if (!transitions.current(developer)) continue
    // Newly freed work alone is not a trigger. Filter using pre-action relevance,
    // then respect claims made by earlier engineers at this same instant.
    const options = transitions.context(developer).filter(t => initiallyEligible.get(developer.id)!.has(t.id))
    const affected = changedRelativeOrder(oldTickets, options)
    if (!affected.size) continue
    transitions.restore(developer)
    transitions.decide(developer, 'priority', affected)
    prepared.push(developer)
    assessed = true
  }
  for (const developer of prepared) {
    const ticket = transitions.current(developer)
    if (ticket) prepareDiscovery(result, developer, ticket, draw)
  }
  return assessed ? result : reordered
}
