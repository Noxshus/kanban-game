import type { EventTime } from '../game/eventTime'
import { addEventTime, compareEventTime, eventInterval, eventTime } from '../game/eventTime.ts'
import { DEFAULT_WORKING_CALENDAR, sprintSimulationSeconds, sprintWorkingMinutes, workingMinutes, convertPlaybackElapsed } from '../game/workingCalendar.ts'
import type { WorkingCalendar } from '../game/workingCalendar'
import type { BoardObserver } from '../game/boardActivity'
import type { InternalObserver } from '../game/simulationActivity'
import { advanceSession, createSimulationSession, simulationReducer } from './simulationControls.ts'
import type { SimulationAction, SimulationSession } from './simulationControls'
import { createPlanning, resolveEstimation } from '../game/planning.ts'
import type { PlanningAction, PlanningState } from '../game/planning'
import { availableForCommitment, commitScope } from '../game/commitment.ts'
import type { CommitmentAction } from '../game/commitment'

export interface SprintState {
  phase: 'planning' | 'execution'
  calendar: WorkingCalendar
  startedAt: EventTime
  deadline: EventTime | null
  // Optional on #95 saves; missing means an editable empty shortlist.
  planning?: PlanningState
  // Persist the conversion origin and cumulative unpaused milliseconds. Scaling each tick
  // independently rounds fractional speeds differently across call partitions.
  playback?: { origin: EventTime; elapsed: EventTime; speed: number; unit: 'milliseconds' }
}

export interface SprintSession {
  simulation: SimulationSession
  sprint: SprintState
}

export type SprintAction = Exclude<SimulationAction, { type: 'tick' }>
  | PlanningAction
  | CommitmentAction
  | { type: 'tick'; elapsedRealMilliseconds: EventTime }
  | { type: 'startSprint' }

export function createSprintSession(calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR): SprintSession {
  sprintSimulationSeconds(calendar)
  return { simulation: createSimulationSession(), sprint: {
    phase: 'planning', calendar: { ...calendar }, startedAt: eventTime(0), deadline: null, planning: createPlanning(),
  } }
}

export function sprintWorkingTime(sprint: SprintState, now: EventTime) {
  return {
    elapsedMinutes: workingMinutes(eventInterval(now, sprint.startedAt), sprint.calendar),
    totalMinutes: sprintWorkingMinutes(sprint.calendar),
  }
}

// Owns phase boundaries around the existing engine, not another event scheduler.
export function sprintReducer(session: SprintSession, action: SprintAction, observe?: BoardObserver, internal?: InternalObserver): SprintSession {
  const { simulation, sprint } = session
  if (action.type === 'addCommitment' || action.type === 'removeCommitment' || action.type === 'moveCommitment') {
    const planning = sprint.planning
    if (sprint.phase !== 'planning' || planning?.stage !== 'estimated' || simulation.game.committedTicketIds !== undefined) return session
    const ids = [...planning.commitmentIds ?? []], index = ids.indexOf(action.ticketId)
    if (action.type === 'addCommitment') {
      if (index !== -1 || !simulation.game.tickets.some(ticket => ticket.id === action.ticketId && availableForCommitment(ticket))) return session
      ids.push(action.ticketId)
    } else if (action.type === 'removeCommitment') {
      if (index === -1) return session
      ids.splice(index, 1)
    } else {
      const target = index + (action.direction === 'up' ? -1 : 1)
      if (index === -1 || target < 0 || target >= ids.length) return session
      ;[ids[index], ids[target]] = [ids[target], ids[index]]
    }
    return { simulation, sprint: { ...sprint, planning: { ...planning, commitmentIds: ids } } }
  }
  if (action.type === 'addEstimation' || action.type === 'removeEstimation' || action.type === 'moveEstimation' || action.type === 'resolveEstimation') {
    const planning = sprint.planning ?? createPlanning()
    if (sprint.phase !== 'planning' || planning.stage !== 'shortlist' || simulation.game.committedTicketIds !== undefined) return session
    if (action.type === 'resolveEstimation') {
      const result = resolveEstimation(simulation.game, planning.ticketIds, observe)
      return { simulation: { ...simulation, game: result.game }, sprint: { ...sprint, planning: result.planning } }
    }
    const ticketIds = [...planning.ticketIds], index = ticketIds.indexOf(action.ticketId)
    if (action.type === 'addEstimation') {
      if (index !== -1 || !simulation.game.tickets.some(ticket => ticket.id === action.ticketId)) return session
      ticketIds.push(action.ticketId)
    } else if (action.type === 'removeEstimation') {
      if (index === -1) return session
      ticketIds.splice(index, 1)
    } else {
      const target = index + (action.direction === 'up' ? -1 : 1)
      if (index === -1 || target < 0 || target >= ticketIds.length) return session
      ;[ticketIds[index], ticketIds[target]] = [ticketIds[target], ticketIds[index]]
    }
    return { simulation, sprint: { ...sprint, planning: { stage: 'shortlist', ticketIds } } }
  }
  if (action.type === 'tick') {
    const input = action.elapsedRealMilliseconds
    if ('elapsedRealSeconds' in action || !input || typeof input !== 'object'
        || typeof input.high !== 'number' || typeof input.low !== 'number') {
      throw new TypeError('Playback ticks require explicit compensated elapsedRealMilliseconds; seconds input is unsupported')
    }
    // Pre-release seconds anchors (including unlabelled ones) cannot be
    // reinterpreted losslessly under a different rounding contract. Restart
    // clears them; current millisecond anchors require no migration or RNG.
    if (sprint.playback && sprint.playback.unit !== 'milliseconds') {
      throw new TypeError('Stored playback anchor must explicitly use milliseconds; restart the prototype session')
    }
  }
  if (action.type === 'restart') return createSprintSession(sprint.calendar)
  if (action.type === 'startSprint' || action.type === 'commitSprint') {
    // #97 supports the first player commitment only. Do not invent #98 carryover
    // or reset frozen claims at a later boundary. Restart opens another test run.
    if (sprint.phase !== 'planning' || simulation.game.committedTicketIds !== undefined) return session
    if (action.type === 'commitSprint' && sprint.planning?.stage !== 'estimated') return session
    const startedAt = eventTime(simulation.game.simulationTime, simulation.game.simulationTimeRemainder)
    const duration = sprintSimulationSeconds(sprint.calendar)
    const deadline = addEventTime(startedAt, duration)
    if (compareEventTime(deadline, startedAt) <= 0) throw new RangeError('Sprint has no positive representable interval')
    if (action.type === 'commitSprint') {
      // This establishes opening Rank, not a mid-sprint priority-change event.
      const { pausedPriorityOrder: _pending, ...ready } = simulation
      const game = commitScope(simulation.game, sprint.planning!.stage === 'estimated' ? sprint.planning!.commitmentIds ?? [] : [], observe)
      return { simulation: { ...ready, game, isPaused: true }, sprint: { ...sprint, phase: 'execution', startedAt, deadline } }
    }
    // Isolated DEV/timing-test bridge; never rendered as a production action.
    return { simulation: { ...simulation, isPaused: true }, sprint: { ...sprint, phase: 'execution', startedAt, deadline } }
  }
  if (action.type === 'tick' || action.type === 'step') {
    if (sprint.phase !== 'execution' || (action.type === 'tick' ? simulation.isPaused : !simulation.isPaused)) return session
    const input = action.type === 'tick'
      ? eventTime(action.elapsedRealMilliseconds.high, action.elapsedRealMilliseconds.low)
      : eventTime(1)
    if (compareEventTime(input, eventTime(0)) < 0) throw new RangeError('Playback interval must be non-negative')
    if (compareEventTime(input, eventTime(0)) === 0) return session
    if (!sprint.deadline) throw new RangeError('Execution requires a sprint deadline')
    const before = eventTime(simulation.game.simulationTime, simulation.game.simulationTimeRemainder)
    if (compareEventTime(before, sprint.deadline) > 0) throw new RangeError('Execution is beyond its sprint deadline')
    if (compareEventTime(before, sprint.deadline) === 0) {
      return { simulation: { ...simulation, isPaused: true }, sprint: { ...sprint, phase: 'planning', planning: createPlanning() } }
    }
    const { playback: savedPlayback, ...withoutPlayback } = sprint
    let playback: SprintState['playback']
    let target: EventTime
    let conversionProgress = true
    if (action.type === 'step') target = addEventTime(before, 1)
    else {
      const speed = sprint.calendar.simulationSecondsPerRealSecond
      const anchor = savedPlayback?.speed === speed
        ? savedPlayback : { origin: before, elapsed: eventTime(0), speed, unit: 'milliseconds' as const }
      const elapsed = addEventTime(addEventTime(anchor.elapsed, input.high), input.low)
      if (compareEventTime(elapsed, anchor.elapsed) <= 0) throw new RangeError('Playback input is below numeric resolution')
      playback = { ...anchor, elapsed }
      const converted = convertPlaybackElapsed(elapsed, sprint.calendar)
      conversionProgress = compareEventTime(converted, convertPlaybackElapsed(anchor.elapsed, sprint.calendar)) > 0
      target = addEventTime(addEventTime(anchor.origin, converted.high), converted.low)
    }
    if (compareEventTime(target, sprint.deadline) > 0) target = sprint.deadline
    if (compareEventTime(target, before) < 0) throw new RangeError('Playback target moved backward')
    // A rounded conversion may have a plateau. Retain its elapsed input, but do
    // not call the engine, flush priorities, publish reports or draw RNG there.
    if (compareEventTime(target, before) === 0) {
      if (conversionProgress) throw new RangeError('Playback target is below absolute-clock numeric resolution')
      return { simulation, sprint: { ...sprint, playback } }
    }
    const next = advanceSession(simulation, target, observe, internal)
    const now = eventTime(next.game.simulationTime, next.game.simulationTimeRemainder)
    // Finish all ordinary events at the exact deadline, then freeze the snapshot.
    // Claims, Flow and work are preserved pending the separately designed #98 lifecycle.
    return compareEventTime(now, sprint.deadline) === 0
      ? { simulation: { ...next, isPaused: true }, sprint: { ...withoutPlayback, phase: 'planning', planning: createPlanning() } }
      : { simulation: next, sprint: playback ? { ...sprint, playback } : withoutPlayback }
  }
  if (action.type === 'togglePause' && sprint.phase === 'planning') return session
  const next = simulationReducer(simulation, action, observe, internal)
  return next === simulation ? session : { simulation: next, sprint }
}
