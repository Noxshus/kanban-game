import type { Developer, GameState, Ticket } from './types'
import { clampReportedProgress } from './reportedProgress.ts'
import { nextRandom } from './random.ts'
import { estimateInitialEffort } from './effortEstimate.ts'
import { assessWork, nominateCandidate, selectWork, validateSelectionAttributes } from './selectWork.ts'
import { getFlowDuration } from './flow.ts'
import { projectCompletion } from './completionTime.ts'
import { sampleReconsideration } from './reconsideration.ts'
import { accumulateWork, integratedWork, isWorkComplete, validWorkSession } from './work.ts'
import { addEventTime, compareEventTime, eventInterval, eventTime, requireTimeProgress } from './eventTime.ts'

export function advanceSimulation(state: GameState, elapsedSeconds: number, random?: () => number): GameState {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 || !Number.isFinite(state.simulationTime + elapsedSeconds)) {
    throw new RangeError('Elapsed time and resulting simulation time must be finite and non-negative')
  }
  const result = structuredClone(state)
  if (elapsedSeconds === 0) return result
  let now = eventTime(state.simulationTime, state.simulationTimeRemainder)
  const end = addEventTime(now, elapsedSeconds)
  requireTimeProgress(now.high, end.high, elapsedSeconds)
  const { tickets, developers } = result
  developers.forEach(validateSelectionAttributes)
  const byId = new Map(tickets.map(ticket => [ticket.id, ticket]))
  const draw = () => {
    if (random) return random()
    const next = nextRandom(result.randomState)
    result.randomState = next.state
    return next.value
  }
  const publishInitialEstimate = (developer: Developer, ticket: Ticket) => {
    // Either persisted record means this is not a first publication. In particular,
    // never fabricate an original belief/author for a legacy board-only estimate.
    if (ticket.initialEffortEstimate !== undefined || ticket.reportedEffortEstimate !== undefined) return
    const totalWork = estimateInitialEffort(ticket.requiredWork, developer.judgement,
      developer.competencies[ticket.workDomain], draw())
    ticket.initialEffortEstimate = { developerId: developer.id, totalWork }
    ticket.reportedEffortEstimate = totalWork
  }
  const complete = isWorkComplete
  const claimed = new Set<string>()
  const clearWork = (developer: Developer) => {
    delete developer.activeTicketID
    delete developer.flowStreak
    delete developer.assessmentClock
    delete developer.workSession
  }
  const schedule = (developer: Developer) => {
    const dueTime = addEventTime(now, sampleReconsideration(draw()))
    if (compareEventTime(dueTime, now) <= 0) throw new RangeError('Assessment deadline is below event-time numeric resolution')
    developer.assessmentClock = { elapsed: 0, remaining: eventInterval(dueTime, now), originTime: now, dueTime }
  }
  for (const developer of developers) {
    const ticket = byId.get(developer.activeTicketID ?? '')
    if (!ticket || ticket.actualStatus === 'backlog' || complete(ticket) || claimed.has(ticket.id)) {
      clearWork(developer)
      continue
    }
    claimed.add(ticket.id)
    if (developer.flowStreak && developer.flowStreak.ticketId !== ticket.id) {
      delete developer.flowStreak
      delete developer.assessmentClock
      delete developer.workSession
    }
    // First positive advance migrates valid pre-existing active claims once, in
    // engineer order. Estimate precedes scheduling, just as on a new claim below.
    publishInitialEstimate(developer, ticket)
    if (!developer.assessmentClock) schedule(developer)
    const { elapsed, remaining } = developer.assessmentClock!
    if (!Number.isFinite(elapsed) || elapsed < 0 || !Number.isFinite(remaining) || remaining < 0) {
      throw new RangeError('Assessment clock must be finite and non-negative')
    }
    const clock = developer.assessmentClock!
    // Accept fixtures/old JSON clocks and deliberate clock edits, then anchor
    // once. Public elapsed/remaining are derived views, never countdown inputs.
    if (!clock.originTime || !clock.dueTime || clock.elapsed !== eventInterval(now, clock.originTime)
        || clock.remaining !== Math.max(0, eventInterval(clock.dueTime, now))) {
      clock.originTime = addEventTime(now, -elapsed)
      clock.dueTime = addEventTime(now, remaining)
    }
  }
  const eligible = (excludedId?: string) => tickets.filter(ticket => ticket.id !== excludedId
    && !claimed.has(ticket.id) && !complete(ticket)
    && (ticket.actualStatus === 'todo' || ticket.actualStatus === 'in_progress'))
  const begin = (developer: Developer, ticket: Ticket) => {
    developer.activeTicketID = ticket.id
    developer.flowStreak = { ticketId: ticket.id, duration: 0 }
    delete developer.workSession
    claimed.add(ticket.id)
    ticket.assignedDeveloperId = developer.id
    ticket.actualStatus = 'in_progress'
    ticket.reportedStatus = 'in_progress'
    publishInitialEstimate(developer, ticket)
    schedule(developer)
  }
  const decideDue = () => {
    for (const developer of developers) {
      if (developer.activeTicketID === undefined) {
        const decision = selectWork(eligible(), developer, draw)
        if (!decision) continue
        developer.lastAssessment = decision
        begin(developer, byId.get(decision.selectedId)!)
      } else if (compareEventTime(developer.assessmentClock!.dueTime!, now) <= 0) {
        const current = byId.get(developer.activeTicketID)!
        const alternatives = eligible(current.id)
        const nominated = nominateCandidate(alternatives)
        const decision = assessWork(current, byId.get(nominated?.id ?? ''), [current, ...alternatives], developer, 'reconsideration', draw)
        developer.lastAssessment = decision
        if (decision.selectedId !== current.id) {
          current.actualStatus = 'in_progress'
          claimed.delete(current.id)
          begin(developer, byId.get(decision.selectedId)!)
        } else schedule(developer)
      }
    }
  }
  const report = () => {
    for (const ticket of tickets) {
      if (ticket.actualStatus === 'backlog') continue
      ticket.reportedProgress = clampReportedProgress(ticket.reportedProgress)
      if (complete(ticket)) {
        ticket.actualStatus = 'done'
        ticket.reportedStatus = 'done'
        ticket.reportedProgress = 100
      } else if (claimed.has(ticket.id)) {
        ticket.reportedStatus = ticket.actualStatus
        ticket.reportedProgress = clampReportedProgress(ticket.completedWork / ticket.requiredWork * 100)
      }
    }
  }
  report()
  decideDue()
  // Process globally ordered event boundaries, not independent per-developer
  // timelines. Completion wins a simultaneous assessment; developer order breaks
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
    // Exact ordering of stored compensated instants: no broad epsilon merges
    // near events, and true ties are independent of elapsed-call partitioning.
    const boundaries = [...completions.filter(time => time !== null), ...active.map(developer => developer.assessmentClock!.dueTime!)]
    const nextTime = boundaries.reduce((first, time) => compareEventTime(time, first) < 0 ? time : first, end)
    const interval = eventInterval(nextTime, now)
    if (interval <= 0) throw new RangeError('Event has no positive representable time interval')
    for (let index = 0; index < active.length; index++) {
      const developer = active[index]
      const ticket = byId.get(developer.activeTicketID!)!
      const clock = developer.assessmentClock!
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
        accumulateWork(ticket, integratedWork(developer, ticket, elapsed, session.initialFlowDuration))
        session.elapsed = elapsed
        session.currentTime = nextTime
        session.lastCompletedWork = ticket.completedWork
      }
      const assessedElapsed = eventInterval(nextTime, clock.originTime!)
      requireTimeProgress(clock.elapsed, assessedElapsed, interval)
      developer.flowStreak = { ticketId: ticket.id, duration: session.initialFlowDuration + session.elapsed }
      developer.assessmentClock = { ...clock, elapsed: assessedElapsed,
        remaining: Math.max(0, eventInterval(clock.dueTime!, nextTime)) }
      ticket.assignedDeveloperId = developer.id
      ticket.actualStatus = complete(ticket) ? 'done' : 'in_progress'
    }
    const previous = now
    now = nextTime
    report()
    // Release all completed claims before anybody makes a decision at this instant.
    for (const developer of active) {
      const ticket = byId.get(developer.activeTicketID!)!
      if (complete(ticket)) { claimed.delete(ticket.id); clearWork(developer) }
    }
    // Pickups and reconsiderations share ONE engineer-ordered pass; neither
    // decision type implicitly gets priority after completed claims are released.
    decideDue()
    if (compareEventTime(now, end) === 0) break
    if (eventInterval(end, now) === eventInterval(end, previous)
        && !completions.some(time => time && compareEventTime(time, now) === 0)) {
      // Reject time resolution loss instead of hanging or inventing a minimum tick.
      throw new RangeError('Event interval is below the elapsed-time numeric resolution')
    }
  }
  result.simulationTime = end.high
  if (end.low !== 0) result.simulationTimeRemainder = end.low
  else delete result.simulationTimeRemainder
  return result
}
