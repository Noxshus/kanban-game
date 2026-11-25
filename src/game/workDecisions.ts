import type { AssessmentDecision, Developer, GameState, Ticket } from './types'
import type { EventTime } from './eventTime'
import { eventTime } from './eventTime.ts'
import { isWorkComplete } from './work.ts'
import { pauseDiscovery, resumeDiscovery } from './estimateHistory.ts'
import { beginEstimateReporting, evaluateEstimate, prepareDiscovery } from './reestimation.ts'
import { selectWork } from './selectWork.ts'
import { compareRank } from './rank.ts'
import { nextRandom } from './random.ts'
import { applySwitchLoss, beginWorkStint } from './workLoss.ts'
import { reportStatus, scheduleIdleWorkCheck, validateReview } from './discipline.ts'
import { observeBoard } from './boardActivity.ts'
import type { BoardObserver } from './boardActivity'
import type { InternalObserver } from './simulationActivity'

export function simulationDraw(state: GameState) {
  return () => {
    const next = nextRandom(state.randomState)
    state.randomState = next.state
    return next.value
  }
}

// Mutates only the caller-owned clone. Both elapsed events and reducer actions
// use this same reservation/claim/publication path, without another event queue.
export function workTransitions(state: GameState, now: EventTime, draw: () => number, observe?: BoardObserver, internal?: InternalObserver) {
  const byId = new Map(state.tickets.map(t => [t.id, t]))
  const claimed = new Set<string>()
  // Call-local restoration encounters, not saved completion knowledge. Clearing
  // the old active claim prevents another chance on every subsequent advance.
  const completed = new Map<string, Ticket>()
  const clear = (developer: Developer) => {
    // Becoming available gets one immediate pickup; already-idle engineers keep
    // their saved deadline when reservation checks run again at another boundary.
    if (developer.activeTicketID !== undefined) delete developer.idleWorkCheck
    const previous = byId.get(developer.estimateDiscovery?.ticketId ?? developer.activeTicketID ?? '')
    if (previous && !isWorkComplete(previous)) pauseDiscovery(developer)
    delete developer.activeTicketID
    delete developer.flowStreak
    delete developer.workSession
    delete developer.estimateDiscovery
    delete developer.assessmentClock
    delete developer.workStint
    delete developer.estimateReview
  }
  // Reserve existing work before any idle pickup, irrespective of engineer order.
  for (const developer of state.developers) {
    const t = byId.get(developer.activeTicketID ?? '')
    if (t && t.actualStatus !== 'backlog' && isWorkComplete(t)
        && ![...completed.values()].some(previous => previous.id === t.id)) completed.set(developer.id, t)
    if (!t || t.actualStatus === 'backlog' || isWorkComplete(t) || claimed.has(t.id)) clear(developer)
    else {
      delete developer.idleWorkCheck
      claimed.add(t.id)
    }
  }
  const current = (developer: Developer) => byId.get(developer.activeTicketID ?? '')
  const context = (developer: Developer) => state.tickets.filter(t =>
    (t.id === developer.activeTicketID || !claimed.has(t.id)) && t.actualStatus !== 'backlog'
    && (t.id === developer.activeTicketID || t.reportedStatus === 'todo' || t.reportedStatus === 'in_progress'))
  const restore = (developer: Developer) => {
    validateReview(developer)
    delete developer.assessmentClock
    // Old decision snapshots use a different formula; never mislabel them as a new assessment.
    if (developer.lastAssessment && !('trigger' in developer.lastAssessment)) delete developer.lastAssessment
    const ticket = current(developer)
    if (!ticket) return
    // A restored To Do claim genuinely begins execution once. A missed report
    // on already-started work does not gain another chance on each caller slice.
    const started = ticket.actualStatus === 'todo'
    if (started) ticket.actualStatus = 'in_progress'
    beginWorkStint(state, developer, ticket)
    if (developer.estimateDiscovery && developer.estimateDiscovery.ticketId !== ticket.id) pauseDiscovery(developer)
    if (developer.flowStreak && developer.flowStreak.ticketId !== ticket.id) {
      pauseDiscovery(developer)
      delete developer.flowStreak
      delete developer.workSession
    }
    beginEstimateReporting(state, developer, ticket, now, draw, undefined, internal)
    if (started) reportStatus(ticket, developer, 'in_progress', draw)
    observeBoard(observe, ticket, now)
    resumeDiscovery(developer, ticket.id)
  }
  const decide = (developer: Developer, trigger: AssessmentDecision['trigger'], alternatives?: ReadonlySet<string>, currentInsight?: number, justCompleted?: Ticket) => {
    let correctedStaleStatus = false
    while (true) {
      const previous = current(developer)
      // A completion already got its report attempt at this instant. Other
      // engineers can encounter it; this engineer can rediscover it at a later check.
      const decision = selectWork(context(developer).filter(t => t.id !== justCompleted?.id), developer, draw, trigger, now, previous, alternatives, currentInsight)
      if (!decision) {
        if (correctedStaleStatus) scheduleIdleWorkCheck(developer, now, draw)
        return
      }
      developer.lastAssessment = decision
      internal?.({ kind: 'decision', ticketId: decision.selectedId, ticketTitle: byId.get(decision.selectedId)!.title,
        developerId: developer.id, developerName: developer.name, at: { ...now }, decision: structuredClone(decision) })
      if (decision.selectedId === previous?.id) return
      if (previous) {
        // A discovery-triggered switch already had its one reporting opportunity.
        // Rank departure may freshly assess own work, reusing an Unknown preview.
        if (trigger !== 'estimate_revision') {
          const preview = decision.considered.find(option => option.id === previous.id)!
          evaluateEstimate(state, developer, previous, 'departure', draw, now, false,
            preview.estimateSource === 'temporary' ? preview.estimatedTotal : undefined, internal)
          observeBoard(observe, previous, now)
        }
        applySwitchLoss(state, developer, previous)
        claimed.delete(previous.id)
        previous.actualStatus = 'in_progress'
      }
      const ticket = byId.get(decision.selectedId)!
      if (isWorkComplete(ticket)) {
        ticket.actualStatus = 'done'
        const published = reportStatus(ticket, developer, 'done', draw)
        observeBoard(observe, ticket, now)
        clear(developer)
        if (published) {
          // Each correction removes one option from reported eligibility, so the
          // same engineer's normal pickups terminate without a retry cap or memory.
          correctedStaleStatus = true
          trigger = 'pickup'
          alternatives = undefined
          currentInsight = undefined
          continue
        }
        scheduleIdleWorkCheck(developer, now, draw)
        return
      }
      const appraisal = decision.considered.find(t => t.id === ticket.id)!
      pauseDiscovery(developer)
      developer.activeTicketID = ticket.id
      delete developer.idleWorkCheck
      developer.flowStreak = { ticketId: ticket.id, duration: 0 }
      delete developer.workStint
      beginWorkStint(state, developer, ticket)
      delete developer.workSession
      delete developer.estimateDiscovery
      delete developer.assessmentClock
      delete developer.estimateReview
      claimed.add(ticket.id)
      ticket.assignedDeveloperId = developer.id
      ticket.actualStatus = 'in_progress'
      observeBoard(observe, ticket, now)
      beginEstimateReporting(state, developer, ticket, now, draw,
        appraisal.estimateSource === 'temporary' ? appraisal.estimatedTotal : undefined, internal)
      reportStatus(ticket, developer, 'in_progress', draw)
      observeBoard(observe, ticket, now)
      resumeDiscovery(developer, ticket.id)
      return
    }
  }
  return { claimed, completed, clear, context, current, restore, decide }
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

export function reconsiderPriorities(before: GameState, reordered: GameState, observe?: BoardObserver, internal?: InternalObserver): GameState {
  if (reordered === before) return before
  const original = workTransitions(structuredClone(before), eventTime(before.simulationTime, before.simulationTimeRemainder), () => { throw Error('No preview during relevance filtering') })
  const initiallyEligible = new Map(before.developers.map(d => [d.id,
    new Set(original.current(d) ? original.context(d).map(t => t.id) : [])]))
  const result = structuredClone(reordered)
  const now = eventTime(result.simulationTime, result.simulationTimeRemainder)
  const draw = simulationDraw(result), transitions = workTransitions(result, now, draw, observe, internal)
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
  // A priority action is not this restored completion's recognition event.
  // Preserve the saved reference for advanceSimulation's existing completion
  // pass, rather than losing its report and immediate next-work opportunity.
  result.developers = result.developers.map((developer, index) => transitions.completed.has(developer.id)
    ? structuredClone(reordered.developers[index]) : developer)
  return assessed ? result : reordered
}
