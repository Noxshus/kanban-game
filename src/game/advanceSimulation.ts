import type { GameState, Ticket } from './types'
import { clampReportedProgress } from './reportedProgress.ts'
import { workTransitions, simulationDraw } from './workDecisions.ts'
import { migrateEstimateHistory, validateEstimateHistory } from './estimateHistory.ts'
import { validateSelectionAttributes } from './selectWork.ts'
import { getFlowDuration } from './flow.ts'
import { projectCompletion } from './completionTime.ts'
import { accumulateWork, integratedWork, isWorkComplete, validWorkSession } from './work.ts'
import { addEventTime, compareEventTime, eventInterval, eventTime, requireTimeProgress } from './eventTime.ts'
import { recordProductiveEffort, validateWorkLog } from './workLog.ts'
import { evaluateEstimate, prepareDiscovery, projectEstimateEvents } from './reestimation.ts'
import { getTicketComplexity } from './complexity.ts'
import { scheduleReview, validateReview } from './discipline.ts'
import { observeBoard } from './boardActivity.ts'
import type { BoardObserver } from './boardActivity'
import type { InternalObserver } from './simulationActivity'
import { publishProgress } from './progressReporting.ts'

export function advanceSimulation(state: GameState, elapsedSeconds: number, random?: () => number, observe?: BoardObserver, internal?: InternalObserver): GameState {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 || !Number.isFinite(state.simulationTime + elapsedSeconds)) {
    throw new RangeError('Elapsed time and resulting simulation time must be finite and non-negative')
  }
  const result = structuredClone(state)
  if (elapsedSeconds === 0) return result
  let now = eventTime(state.simulationTime, state.simulationTimeRemainder)
  const end = addEventTime(now, elapsedSeconds)
  requireTimeProgress(now.high, end.high, elapsedSeconds)
  const { tickets, developers } = result
  validateWorkLog(result.workLog)
  tickets.forEach(validateEstimateHistory)
  for (const ticket of tickets) if (ticket.estimateHistory !== undefined) migrateEstimateHistory(ticket)
  developers.forEach(validateSelectionAttributes)
  developers.forEach(validateReview)
  const byId = new Map(tickets.map(ticket => [ticket.id, ticket]))
  const draw = random ?? simulationDraw(result)
  let transitions = workTransitions(result, now, draw, observe, internal)
  const complete = isWorkComplete
  for (const developer of developers) transitions.restore(developer)
  const completedAtInstant = new Map<string, Ticket>()
  const decideDue = () => {
    // Completed claims are released first; pickups and revision decisions then
    // share one engineer-ordered pass. No-op evaluations never trigger a choice.
    transitions = workTransitions(result, now, draw, observe, internal)
    for (const developer of developers) {
      const events = developer.workSession?.estimateEvents
      const overrun = events?.overrun && compareEventTime(events.overrun, now) <= 0
      const discovery = events?.discovery && compareEventTime(events.discovery, now) <= 0
      const review = developer.estimateReview
      const reviewDue = review && compareEventTime(review.dueTime, now) <= 0
      let insight: number | undefined
      const finished = completedAtInstant.get(developer.id)
      if (finished) {
        evaluateEstimate(result, developer, finished, 'completion', draw, now, false, undefined, internal)
        observeBoard(observe, finished, now)
      }
      else if (developer.activeTicketID !== undefined && (overrun || discovery || reviewDue)) {
        const ticket = byId.get(developer.activeTicketID)!
        // Completion wins. At a work/review tie assess once, using the review's
        // guaranteed follow-through; only the work event can trigger a decision.
        const assessment = evaluateEstimate(result, developer, ticket, overrun ? 'overrun' : discovery ? 'discovery' : 'review', draw, now, !!reviewDue, undefined, internal)
        observeBoard(observe, ticket, now)
        if ((overrun || discovery) && assessment.improved) insight = assessment.candidate
      }
      if (developer.activeTicketID === undefined) transitions.decide(developer, 'pickup')
      else if (insight !== undefined) transitions.decide(developer, 'estimate_revision', undefined, insight)
      // A switched engineer already scheduled a new ticket's first review.
      if (reviewDue && developer.activeTicketID === review.ticketId) scheduleReview(developer, review.ticketId, now, draw)
    }
    completedAtInstant.clear()
    for (const developer of developers) {
      if (developer.activeTicketID !== undefined) {
        prepareDiscovery(result, developer, byId.get(developer.activeTicketID)!, draw)
      }
    }
  }
  const report = (workBoundary = false) => {
    for (const ticket of tickets) {
      if (ticket.actualStatus === 'backlog') continue
      ticket.reportedProgress = clampReportedProgress(ticket.reportedProgress)
      if (complete(ticket)) {
        ticket.actualStatus = 'done'
        ticket.reportedStatus = 'done'
        if (workBoundary && transitions.claimed.has(ticket.id)) publishProgress(ticket, 100, now)
        else {
          // A restored inconsistent Done snapshot supplies no historical report time.
          if (ticket.reportedProgress !== 100) delete ticket.progressReport
          ticket.reportedProgress = 100
        }
      } else if (transitions.claimed.has(ticket.id)) {
        ticket.reportedStatus = ticket.actualStatus
      }
      observeBoard(observe, ticket, now)
    }
  }
  report()
  decideDue()
  // Process globally ordered event boundaries, not independent per-developer
  // timelines. Completion wins a simultaneous estimate event; developer order breaks
  // simultaneous claims. Unused time can progress the next naturally selected work.
  while (compareEventTime(now, end) < 0) {
    const active = developers.filter(developer => developer.activeTicketID !== undefined)
    if (!active.length) break
    for (const developer of active) {
      const ticket = byId.get(developer.activeTicketID!)!
      if (!validWorkSession(developer, ticket)) {
        delete developer.workSession
        developer.workSession = {
          ticketId: ticket.id, requiredWork: ticket.requiredWork, productivity: developer.productivity,
          competency: developer.competencies[ticket.workDomain], focus: developer.focus,
          complexity: getTicketComplexity(ticket),
          initialFlowDuration: getFlowDuration(developer, ticket.id), elapsed: 0,
          originTime: now,
          currentTime: now,
          completionSeconds: projectCompletion(developer, ticket, true).seconds,
          initialCompletedWork: ticket.completedWork,
          ...(ticket.workRemainder ? { initialRemainder: structuredClone(ticket.workRemainder) } : {}),
          lastCompletedWork: ticket.completedWork,
        }
      }
      const session = developer.workSession!
      if (!session.originTime) session.originTime = addEventTime(now, -session.elapsed)
      if (!session.currentTime) session.currentTime = now
    }
    const completions = active.map(developer => {
      const session = developer.workSession!
      return session.completionSeconds === null ? null : addEventTime(session.originTime!, session.completionSeconds)
    })
    const estimateEvents = active.map(developer => projectEstimateEvents(result, developer, byId.get(developer.activeTicketID!)!))
    const reviews = active.map(developer => developer.estimateReview!.dueTime)
    // Exact ordering of stored compensated instants: no broad epsilon merges
    // near events, and true ties are independent of elapsed-call partitioning.
    const boundaries = [...completions.filter(time => time !== null),
      ...estimateEvents.flatMap(events => [events.discovery, events.overrun]).filter(time => time !== null), ...reviews]
    const nextTime = boundaries.reduce((first, time) => compareEventTime(time, first) < 0 ? time : first, end)
    const interval = eventInterval(nextTime, now)
    if (interval <= 0) throw new RangeError('Event has no positive representable time interval')
    for (let index = 0; index < active.length; index++) {
      const developer = active[index]
      const ticket = byId.get(developer.activeTicketID!)!
      const session = developer.workSession!
      if (interval > 0) {
        const elapsed = completions[index] && compareEventTime(nextTime, completions[index]!) === 0
          ? session.completionSeconds! : eventInterval(nextTime, session.originTime!)
        if (completions[index] && compareEventTime(nextTime, completions[index]!) < 0
            && session.completionSeconds !== null && elapsed >= session.completionSeconds) {
          throw new RangeError('Distinct completion events exceed session-time numeric resolution')
        }
        requireTimeProgress(session.elapsed, elapsed, interval)
        // A very old Flow streak may round unchanged while the independently
        // anchored work-session interval still advances and delivers real work.
        if (!Number.isFinite(session.initialFlowDuration + elapsed)) throw new RangeError('Flow duration exceeds the numeric range')
        // Re-evaluate one cumulative integral, rather than summing independently
        // rounded segment integrals. A scheduled deadline never sets work done.
        ticket.completedWork = session.initialCompletedWork
        if (session.initialRemainder) ticket.workRemainder = structuredClone(session.initialRemainder)
        else delete ticket.workRemainder
        const produced = integratedWork(developer, ticket, elapsed, session.initialFlowDuration)
        accumulateWork(ticket, produced)
        recordProductiveEffort(result, developer, ticket, produced)
        session.elapsed = elapsed
        session.currentTime = nextTime
        session.lastCompletedWork = ticket.completedWork
      }
      developer.flowStreak = { ticketId: ticket.id, duration: session.initialFlowDuration + session.elapsed }
      ticket.assignedDeveloperId = developer.id
      // Existing active claims synchronize visible ownership on their first work
      // interval. Anchor that observation to the interval's start, not an arbitrary
      // caller's slice endpoint; the original assignment/work mutation is unchanged.
      observeBoard(observe, ticket, now)
      // A restored active To Do claim starts work at this interval's beginning,
      // even if the first caller's slice also completes it. Observe that report
      // without moving the existing actual/reported status writes or work integral.
      if (observe && ticket.actualStatus === 'todo') observeBoard(observe, { ...ticket, reportedStatus: 'in_progress' }, now)
      ticket.actualStatus = complete(ticket) ? 'done' : 'in_progress'
    }
    const previous = now
    now = nextTime
    report(true)
    // Release all completed claims before anybody makes a decision at this instant.
    for (const developer of active) {
      const ticket = byId.get(developer.activeTicketID!)!
      if (complete(ticket)) {
        completedAtInstant.set(developer.id, ticket)
        transitions.claimed.delete(ticket.id); transitions.clear(developer)
      }
    }
    // Pickups and reconsiderations share ONE engineer-ordered pass; neither
    // decision type implicitly gets priority after completed claims are released.
    decideDue()
    if (compareEventTime(now, end) === 0) break
    if (eventInterval(end, now) === eventInterval(end, previous)
        && !completions.some(time => time && compareEventTime(time, now) === 0)
        && !reviews.some(time => compareEventTime(time, now) === 0)
        && !estimateEvents.some(events => [events.discovery, events.overrun].some(time => time && compareEventTime(time, now) === 0))) {
      // Reject time resolution loss instead of hanging or inventing a minimum tick.
      throw new RangeError('Event interval is below the elapsed-time numeric resolution')
    }
  }
  result.simulationTime = end.high
  if (end.low !== 0) result.simulationTimeRemainder = end.low
  else delete result.simulationTimeRemainder
  return result
}
