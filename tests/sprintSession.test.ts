import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_WORKING_CALENDAR, convertPlaybackElapsed, sprintSimulationSeconds, sprintWorkingMinutes, validateCalendar, workingMinutes } from '../src/game/workingCalendar.ts'
import type { WorkingCalendar } from '../src/game/workingCalendar'
import { createSprintSession, sprintReducer, sprintWorkingTime } from '../src/store/sprintSession.ts'
import type { SprintAction } from '../src/store/sprintSession'
import { boardReducer, createBoardSession, createDevelopmentBoardSession } from '../src/store/boardSession.ts'
import type { BoardSession } from '../src/store/boardSession'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { addEventTime, compareEventTime, eventTime } from '../src/game/eventTime.ts'
import { projectWork } from '../src/game/completionTime.ts'
import { workAmount } from '../src/game/work.ts'
import { nextRandom } from '../src/game/random.ts'
import { reviewDelay } from '../src/game/discipline.ts'
import { collectSimulationActivity } from '../src/game/simulationActivity.ts'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { decisionFixture, setPublishedEstimate } from './helpers/decisionFixture.ts'

const restore = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const tick = (milliseconds: number, low = 0) => ({ type: 'tick' as const, elapsedRealMilliseconds: { high: milliseconds, low } })
const fractionalCalendar = { ...DEFAULT_WORKING_CALENDAR, sprintWeeks: 1, workingDaysPerWeek: 1,
  workingHoursPerDay: 1, workingMinutesPerSimulationSecond: 48 }

function activeSprint(calendar: WorkingCalendar = fractionalCalendar, at = 0) {
  const planning = createSprintSession(calendar)
  planning.simulation.game = decisionFixture()
  planning.simulation.game.simulationTime = at
  planning.simulation.game.developers[0].focus = 0
  planning.simulation.game.developers[0].competencies.frontend = 5
  return sprintReducer(sprintReducer(planning, { type: 'startSprint' }), { type: 'togglePause' })
}

test('default working-only calendar yields 80 hours and 240 normal playback seconds without changing internal units', () => {
  const c = DEFAULT_WORKING_CALENDAR
  assert.equal(sprintWorkingMinutes(c), 80 * 60)
  assert.equal(sprintSimulationSeconds(c), 240)
  assert.deepEqual(convertPlaybackElapsed(eventTime(1000), c), eventTime(1))
  assert.equal(workingMinutes(1, c), 20)
  assert.equal(workingMinutes(24, c), 8 * 60)
  assert.equal(workingMinutes(120, c), 5 * 8 * 60)
  assert.equal(reviewDelay(0, .5), 12) // Same internal review model: 240 calendar minutes, not a new rate.
  assert.equal(workingMinutes(reviewDelay(0, .5), c), 240)
})

test('calendar, fractional duration and playback speed are independently configurable and snapshot-owned', () => {
  const calendar = { ...DEFAULT_WORKING_CALENDAR, workingDaysPerWeek: 6, workingHoursPerDay: 6,
    sprintWeeks: 1.5, simulationSecondsPerRealSecond: 2 }
  assert.equal(sprintWorkingMinutes(calendar), 3240)
  assert.equal(sprintSimulationSeconds(calendar), 162)
  assert.deepEqual(convertPlaybackElapsed(eventTime(81000), calendar), eventTime(162))
  assert.equal(sprintSimulationSeconds(fractionalCalendar), 1.25)
  const s = createSprintSession(calendar)
  calendar.sprintWeeks = 9
  assert.equal(s.sprint.calendar.sprintWeeks, 1.5)
  assert.equal(DEFAULT_WORKING_CALENDAR.sprintWeeks, 2)
  const first = sprintReducer(s, { type: 'startSprint' })
  const running = sprintReducer(first, { type: 'togglePause' })
  const ticked = sprintReducer(running, tick(1000))
  assert.deepEqual(ticked.simulation.game, advanceSimulation(running.simulation.game, 2))
  const stepped = sprintReducer(first, { type: 'step' })
  assert.deepEqual(stepped.simulation.game, advanceSimulation(first.simulation.game, 1)) // Step stays one internal second, independent of playback speed.
})

test('invalid calendars, intervals and unsupported conversion precision are rejected explicitly', () => {
  for (const key of Object.keys(DEFAULT_WORKING_CALENDAR) as (keyof WorkingCalendar)[]) {
    for (const value of [0, -1, NaN, Infinity, undefined]) {
      assert.throws(() => validateCalendar({ ...DEFAULT_WORKING_CALENDAR, [key]: value } as WorkingCalendar), RangeError)
    }
  }
  for (const overrides of [{ workingDaysPerWeek: 1.5 }, { workingDaysPerWeek: 8 }, { workingHoursPerDay: 25 }]) {
    assert.throws(() => createSprintSession({ ...DEFAULT_WORKING_CALENDAR, ...overrides }), RangeError)
  }
  for (const value of [-1, Infinity, NaN]) assert.throws(() => convertPlaybackElapsed({ high: value, low: 0 }, DEFAULT_WORKING_CALENDAR), RangeError)
  assert.deepEqual(convertPlaybackElapsed(eventTime(0), DEFAULT_WORKING_CALENDAR), eventTime(0))
  assert.throws(() => convertPlaybackElapsed(eventTime(Number.MIN_VALUE), { ...DEFAULT_WORKING_CALENDAR, simulationSecondsPerRealSecond: .1 }), /resolution/)
  assert.throws(() => workingMinutes(Number.MIN_VALUE, { ...DEFAULT_WORKING_CALENDAR, workingMinutesPerSimulationSecond: .1 }), /resolution/)
  assert.throws(() => sprintSimulationSeconds({ ...DEFAULT_WORKING_CALENDAR, sprintWeeks: Number.MAX_VALUE }), /numeric range/)
})

test('Planning blocks Resume, Step and queued ticks, and starting a prototype timebox is silent and paused', () => {
  const s = createSprintSession(), original = structuredClone(s), c = collectSimulationActivity(s.simulation.game.tickets)
  for (const type of ['togglePause', 'step', 'tick'] as const) assert.strictEqual(sprintReducer(s, type === 'tick' ? tick(1000) : { type }, c.board.observe, c.internal), s)
  assert.deepEqual(s.simulation.game, exampleGameState)
  const started = sprintReducer(s, { type: 'startSprint' }, c.board.observe, c.internal)
  assert.equal(started.sprint.phase, 'execution')
  assert.equal(started.simulation.isPaused, true)
  assert.strictEqual(started.simulation.game, s.simulation.game)
  assert.deepEqual(started.sprint.deadline, eventTime(240))
  assert.deepEqual(c.board.events, []); assert.deepEqual(c.diagnostics, [])
  assert.strictEqual(sprintReducer(started, { type: 'startSprint' }), started)
  assert.deepEqual(s, original)
})

test('Planning Rank edits remain frozen until execution Resume or Step uses the existing pending-priority path', () => {
  const initial = createSprintSession()
  const staged = sprintReducer(initial, { type: 'reorderTodo', ticketId: 'ticket-5', targetId: 'ticket-2' })
  assert.deepEqual(staged.simulation.game.developers, initial.simulation.game.developers)
  assert.equal(staged.simulation.game.randomState, 1)
  assert.equal(staged.simulation.game.simulationTime, 0)
  assert.ok(staged.simulation.pausedPriorityOrder)
  assert.strictEqual(sprintReducer(staged, { type: 'togglePause' }), staged)
  const started = sprintReducer(restore(staged), { type: 'startSprint' })
  assert.deepEqual(started.simulation, staged.simulation)
  const resumed = sprintReducer(started, { type: 'togglePause' })
  assert.equal(resumed.simulation.game.simulationTime, 0)
  assert.equal(resumed.simulation.game.developers[0].activeTicketID, 'ticket-5')
  assert.equal(resumed.simulation.pausedPriorityOrder, undefined)
  const stepped = sprintReducer(started, { type: 'step' })
  assert.deepEqual(stepped.simulation.game, advanceSimulation(resumed.simulation.game, 1))
  assert.equal(stepped.simulation.isPaused, true)
})

test('default execution clips excess elapsed time, handles deadline events and never spills into Planning', () => {
  const planning = createSprintSession()
  const running = sprintReducer(sprintReducer(planning, { type: 'startSprint' }), { type: 'togglePause' })
  const c = collectSimulationActivity(running.simulation.game.tickets)
  const finished = sprintReducer(running, tick(1000000), c.board.observe, c.internal)
  assert.equal(finished.simulation.game.simulationTime, 240)
  assert.deepEqual(finished.simulation.game, advanceSimulation(running.simulation.game, 240))
  assert.equal(finished.sprint.phase, 'planning')
  assert.equal(finished.simulation.isPaused, true)
  assert.deepEqual(sprintWorkingTime(finished.sprint, eventTime(240)), { elapsedMinutes: 4800, totalMinutes: 4800 })
  for (const type of ['tick', 'step', 'togglePause'] as const) assert.strictEqual(sprintReducer(finished, type === 'tick' ? tick(1000) : { type }), finished)
  let stepped = sprintReducer(planning, { type: 'startSprint' })
  for (let i = 0; i < 240; i++) stepped = restore(sprintReducer(stepped, { type: 'step' }))
  assert.deepEqual(stepped, finished)
})

test('fractional deadlines retain compensated instants across nonbinary partitions, JSON, work and RNG', () => {
  for (const start of [0, .3]) {
    const s = activeSprint(fractionalCalendar, start), original = structuredClone(s)
    const a = collectSimulationActivity(s.simulation.game.tickets), b = collectSimulationActivity(s.simulation.game.tickets)
    const whole = sprintReducer(s, tick(10000), a.board.observe, a.internal)
    let split = restore(s)
    for (const ms of [300, 300, 400, 250, 2000]) split = restore(sprintReducer(split, tick(ms), b.board.observe, b.internal))
    assert.deepEqual(split, whole)
    assert.deepEqual(a.board.events, b.board.events); assert.deepEqual(a.diagnostics, b.diagnostics)
    assert.deepEqual(eventTime(whole.simulation.game.simulationTime, whole.simulation.game.simulationTimeRemainder), s.sprint.deadline)
    if (start) assert.notEqual(s.sprint.deadline!.low, 0)
    assert.equal(whole.sprint.phase, 'planning')
    assert.deepEqual(s, original)
  }
})

test('a paused Step uses only the fractional remainder and zero elapsed input cannot flush priorities or draw RNG', () => {
  const running = activeSprint()
  assert.strictEqual(sprintReducer(running, tick(0)), running)
  const first = sprintReducer(sprintReducer(running, { type: 'togglePause' }), { type: 'step' })
  assert.equal(first.simulation.game.simulationTime, 1)
  assert.equal(first.sprint.phase, 'execution')
  assert.strictEqual(sprintReducer(first, tick(1000)), first)
  const last = sprintReducer(first, { type: 'step' })
  assert.equal(last.simulation.game.simulationTime, 1.25)
  assert.equal(last.sprint.phase, 'planning')
  assert.deepEqual(last.simulation.game, advanceSimulation(running.simulation.game, 1.25))
})

test('a scheduled review exactly at sprint end runs once, while later reviews and all planning time stay frozen', () => {
  const s = activeSprint(), d = s.simulation.game.developers[0]
  d.estimateReview!.dueTime = { ...s.sprint.deadline! }
  const r = sprintReducer(s, tick(10000))
  assert.equal(r.simulation.game.tickets[0].lastEstimateEvaluation!.reason, 'review')
  assert.deepEqual(r.simulation.game.tickets[0].progressReport!.at, s.sprint.deadline)
  assert.equal(r.simulation.game.randomState, nextRandom(s.simulation.game.randomState).state)
  assert.ok(r.simulation.game.developers[0].estimateReview!.dueTime.high > 1.25)
  assert.strictEqual(sprintReducer(restore(r), tick(100000)).simulation.game.simulationTime, 1.25)
  const after = activeSprint(); after.simulation.game.developers[0].estimateReview!.dueTime = addEventTime(after.sprint.deadline!, .000001)
  const stopped = sprintReducer(after, tick(10000))
  assert.equal(stopped.simulation.game.tickets[0].lastEstimateEvaluation, undefined)
  assert.equal(stopped.simulation.game.randomState, after.simulation.game.randomState)
})

test('completion beats its coincident review at the sprint deadline; normal next pickup adds no post-boundary work', () => {
  const s = activeSprint(), game = s.simulation.game, d = game.developers[0], t = game.tickets[0]
  t.requiredWork = 1; setPublishedEstimate(t, d.id, 1)
  d.discipline = Number.MAX_VALUE
  // Pin a saved timebox to the engine's existing completion instant to test a true tie.
  const due = projectWork(d, t, workAmount(1)).seconds!
  s.sprint.deadline = eventTime(due); d.estimateReview!.dueTime = eventTime(due)
  const next = { ...structuredClone(t), id: 'next', rank: 2, requiredWork: 100, completedWork: 0 }
  setPublishedEstimate(next, d.id, 100); game.tickets.push(next)
  const r = sprintReducer(s, tick(10000))
  assert.equal(r.sprint.phase, 'planning')
  assert.equal(r.simulation.game.tickets[0].actualStatus, 'done')
  assert.equal(r.simulation.game.tickets[0].lastEstimateEvaluation!.reason, 'completion')
  assert.equal(r.simulation.game.developers[0].activeTicketID, 'next')
  assert.deepEqual(r.simulation.game.developers[0].flowStreak, { ticketId: 'next', duration: 0 })
  assert.equal(r.simulation.game.tickets[1].completedWork, 0)
  assert.equal(r.simulation.game.workLog!.length, 1)
  assert.deepEqual(r.simulation.game, advanceSimulation(game, due))
})

test('sprint end preserves existing Flow, claims, useful work, gross effort and future deadlines without loss', () => {
  const s = activeSprint(), d = s.simulation.game.developers[0], t = s.simulation.game.tickets[0]
  t.complexity = 'XXL'; t.completedWork = 40; t.requiredWork = 1e4; setPublishedEstimate(t, d.id)
  d.flowStreak = { ticketId: t.id, duration: 30 }
  s.simulation.game.workLog = [{ developerId: d.id, ticketId: t.id, effort: workAmount(40) }]
  const r = sprintReducer(s, tick(10000))
  const expected = advanceSimulation(s.simulation.game, 1.25)
  assert.deepEqual(r.simulation.game, expected)
  assert.equal(r.simulation.game.developers[0].activeTicketID, t.id)
  assert.equal(r.simulation.game.developers[0].flowStreak!.duration, 31.25)
  const nextPrototype = sprintReducer(restore(r), { type: 'startSprint' })
  assert.deepEqual(nextPrototype.simulation.game, expected)
  assert.deepEqual(nextPrototype.sprint.startedAt, eventTime(1.25))
  assert.deepEqual(nextPrototype.sprint.deadline, eventTime(2.5))
})

test('simultaneous sprint-end completions preserve both engineer-order permutations and exclusive claims across JSON partitions', () => {
  for (const reverse of [false, true]) {
    const s = activeSprint(), game = s.simulation.game, base = game.developers[0], template = game.tickets[0]
    game.developers = ['a', 'b'].map(id => ({ ...structuredClone(base), id, activeTicketID: `finish-${id}`,
      estimateReview: { ticketId: `finish-${id}`, dueTime: eventTime(1e308) } }))
    game.tickets = ['finish-a', 'finish-b', 'contested', 'other'].map((id, i) => {
      const ticket = { ...structuredClone(template), id, rank: i < 2 ? i + 3 : i - 1,
        requiredWork: i < 2 ? 1 : 100, reportedStatus: i < 2 ? 'done' as const : 'todo' as const }
      setPublishedEstimate(ticket, 'a', i < 2 ? 1 : i === 2 ? 10 : 20)
      return ticket
    })
    if (reverse) game.developers.reverse()
    const due = projectWork(game.developers[0], game.tickets[0], workAmount(1)).seconds!
    s.sprint.deadline = eventTime(due)
    const whole = sprintReducer(s, tick(10000))
    let split = restore(s)
    for (const ms of [130, 170, 10000]) split = restore(sprintReducer(split, tick(ms)))
    assert.deepEqual(split, whole)
    assert.deepEqual(whole.simulation.game, advanceSimulation(game, due))
    assert.deepEqual(whole.simulation.game.developers.map(d => [d.id, d.activeTicketID]),
      game.developers.map((d, i) => [d.id, i ? 'other' : 'contested']))
    assert.equal(whole.simulation.game.workLog!.some(entry => ['contested', 'other'].includes(entry.ticketId)), false)
    assert.equal(whole.sprint.phase, 'planning')
  }
})

test('restart returns to fresh Planning, retains custom calendar and discards staged priorities/history', () => {
  let s = boardReducer(createDevelopmentBoardSession(fractionalCalendar), { type: 'startSprint' })
  s = boardReducer(s, { type: 'step' })
  s = boardReducer(s, { type: 'reorderTodo', ticketId: 'ticket-5', targetId: 'ticket-2' })
  const restarted = boardReducer(s, { type: 'restart' })
  assert.deepEqual(restarted, createDevelopmentBoardSession(fractionalCalendar))
  assert.deepEqual(restarted.simulation.game, exampleGameState)
  assert.strictEqual(boardReducer(restarted, tick(1000)), restarted)
})

test('legacy board saves without phase metadata restore into silent Planning at their existing time', () => {
  const legacy = restore(createBoardSession())
  legacy.simulation.game.simulationTime = 42.5; legacy.simulation.isPaused = false
  delete (legacy as Partial<BoardSession>).sprint
  const before = structuredClone(legacy.simulation.game)
  const restored = boardReducer(legacy, tick(1000))
  assert.equal(restored.sprint.phase, 'planning')
  assert.deepEqual(restored.sprint.startedAt, eventTime(42.5))
  assert.equal(restored.simulation.isPaused, true)
  assert.deepEqual(restored.simulation.game, before)
  assert.deepEqual(restored.activity, [])
  assert.deepEqual(boardReducer(restore(restored), tick(1000)), restored)
})

test('public observations and DEV collection preserve identical bounded execution, seeded replay and JSON', () => {
  let player = boardReducer(createBoardSession(fractionalCalendar), { type: 'startSprint' })
  let dev = boardReducer(createDevelopmentBoardSession(fractionalCalendar), { type: 'startSprint' })
  player = boardReducer(player, { type: 'togglePause' }); dev = boardReducer(dev, { type: 'togglePause' })
  const whole = boardReducer(dev, tick(10000))
  for (const ms of [300, 300, 400, 250, 100000]) {
    player = restore(boardReducer(player, tick(ms)))
    dev = restore(boardReducer(dev, tick(ms)))
  }
  assert.deepEqual(dev, whole)
  assert.deepEqual(player.simulation, dev.simulation)
  assert.deepEqual(player.activity, dev.activity)
  assert.deepEqual(player.observations, dev.observations)
  assert.deepEqual(player.projections, dev.projections)
  assert.equal(player.diagnosticActivity, undefined)
})

test('invalid time and unsupported sprint precision fail without mutating input or consuming seeded state', () => {
  const s = activeSprint(), before = structuredClone(s)
  for (const value of [-1, Infinity, NaN]) assert.throws(() => sprintReducer(s, tick(value)), RangeError)
  assert.deepEqual(s, before)
  const tooOld = createSprintSession({ ...fractionalCalendar, workingMinutesPerSimulationSecond: 1e308 })
  tooOld.simulation.game.simulationTime = 1e308
  tooOld.simulation.game.simulationTimeRemainder = 1 // The proposed interval is lost by both words.
  assert.throws(() => sprintReducer(tooOld, { type: 'startSprint' }), /representable|numeric range|resolution/)
  assert.equal(tooOld.sprint.phase, 'planning')
  assert.equal(tooOld.simulation.game.randomState, 1)
})

test('review regression: exact fractional totals and speed 0.3 reach the deadline without an oversized final tick', () => {
  const qMilliseconds = 2 ** -43
  for (const stillWorking of [false, true]) for (const [speed, parts] of [[1, [239000, 1000 - qMilliseconds, qMilliseconds]], [.3, Array(800).fill(1000)]] as const) {
    let s = activeSprint({ ...DEFAULT_WORKING_CALENDAR, simulationSecondsPerRealSecond: speed })
    if (stillWorking) {
      s.simulation.game.tickets[0].requiredWork = 10000
      setPublishedEstimate(s.simulation.game.tickets[0], 'a', 10000)
    }
    const expected = advanceSimulation(s.simulation.game, 240)
    for (const [index, milliseconds] of parts.entries()) {
      s = restore(sprintReducer(s, tick(milliseconds)))
      if (index < parts.length - 1) assert.equal(s.sprint.phase, 'execution') // No early rounding/snap to the deadline.
    }
    assert.equal(s.sprint.phase, 'planning')
    assert.equal(s.simulation.isPaused, true)
    assert.deepEqual(eventTime(s.simulation.game.simulationTime, s.simulation.game.simulationTimeRemainder), eventTime(240))
    assert.deepEqual(s.simulation.game, expected)
    // Preserve the original seconds reproduction at the engine's seconds API.
    if (speed === 1) {
      let game = activeSprint().simulation.game
      const whole = advanceSimulation(game, 240)
      for (const seconds of [239, 1 - 2 ** -53, 2 ** -53]) game = restore(advanceSimulation(game, seconds))
      assert.deepEqual(game, whole)
    }
  }
})

test('review regression: speed 0.1 uses the same seeded review instant for a three-second tick and one plus two seconds', () => {
  const initial = activeSprint({ ...DEFAULT_WORKING_CALENDAR, simulationSecondsPerRealSecond: .1 })
  initial.simulation.game.developers[0].estimateReview!.dueTime = eventTime(3 * .1)
  const whole = sprintReducer(initial, tick(3000))
  const first = sprintReducer(initial, tick(1000))
  assert.equal(first.simulation.game.randomState, 1)
  const split = sprintReducer(restore(first), tick(2000))
  assert.equal(whole.simulation.game.randomState, 1015568748)
  assert.deepEqual(split, whole)
})

test('review regression: a positive interval lost by both clock words fails before any opening decision or observation', () => {
  const game = decisionFixture()
  game.simulationTime = 1; game.simulationTimeRemainder = Number.EPSILON / 4
  delete game.developers[0].activeTicketID
  const original = structuredClone(game)
  let calls = 0
  assert.throws(() => advanceSimulation(game, 1e-40, () => { calls++; return .5 }, () => { calls++ }), /resolution/)
  assert.equal(calls, 0)
  assert.deepEqual(game, original)
})

test('fractional playback anchors survive pause/resume and JSON; Step and speed changes start a new conversion origin', () => {
  const initial = activeSprint({ ...DEFAULT_WORKING_CALENDAR, simulationSecondsPerRealSecond: .1 })
  initial.simulation.game.developers[0].estimateReview!.dueTime = eventTime(3 * .1)
  const first = sprintReducer(initial, tick(1000))
  const paused = sprintReducer(first, { type: 'togglePause' })
  assert.strictEqual(sprintReducer(paused, tick(10000000)), paused)
  const resumed = sprintReducer(restore(paused), { type: 'togglePause' })
  assert.deepEqual(sprintReducer(resumed, tick(2000)),
    sprintReducer(initial, tick(3000)))

  const step = sprintReducer(paused, { type: 'step' })
  assert.equal(step.sprint.playback, undefined)
  assert.deepEqual(step.simulation.game, advanceSimulation(paused.simulation.game, 1))
  const afterStep = sprintReducer(sprintReducer(restore(step), { type: 'togglePause' }), tick(2000))
  assert.deepEqual(afterStep.simulation.game, advanceSimulation(step.simulation.game, 2 * .1))

  const changed = restore(first)
  changed.sprint.calendar.simulationSecondsPerRealSecond = .3
  const whole = sprintReducer(changed, tick(2000))
  const split = sprintReducer(restore(sprintReducer(changed, tick(1000))), tick(1000))
  assert.deepEqual(split, whole)
  assert.deepEqual(whole.simulation.game, advanceSimulation(first.simulation.game, 2 * .3))
})

test('fractional-speed event order, claims and RNG match through the deadline for original and review seeds', () => {
  for (const seed of [0, 1, 2, 7, 35, 42, 87, 95, 0xffffffff]) {
    const initial = createSprintSession({ ...DEFAULT_WORKING_CALENDAR, simulationSecondsPerRealSecond: .1 })
    initial.simulation.game.randomState = seed
    const running = sprintReducer(sprintReducer(initial, { type: 'startSprint' }), { type: 'togglePause' })
    const a = collectSimulationActivity(running.simulation.game.tickets), b = collectSimulationActivity(running.simulation.game.tickets)
    const whole = sprintReducer(running, tick(2400000), a.board.observe, a.internal)
    let split = running
    // Nonuniform, exactly equal real duration, with a JSON-restored conversion origin.
    for (let i = 0; i < 800; i++) split = restore(sprintReducer(split, tick(i % 2 ? 4000 : 2000), b.board.observe, b.internal))
    assert.deepEqual(split, whole)
    assert.deepEqual(a.board.events, b.board.events)
    assert.deepEqual(a.diagnostics, b.diagnostics)
    assert.deepEqual(whole.simulation.game, advanceSimulation(running.simulation.game, 240))
  }
})

test('second review: active work closes a compensated one-second deadline from either side of rounded elapsed work', () => {
  const q = 2 ** -53
  const qMilliseconds = 2 ** -43
  for (const offset of [0, q, -q]) {
    const planning = createSprintSession({ ...fractionalCalendar, workingMinutesPerSimulationSecond: 60 })
    planning.simulation.game = advanceSimulation(decisionFixture(), offset < 0 ? 1 + offset : offset)
    const running = sprintReducer(sprintReducer(planning, { type: 'startSprint' }), { type: 'togglePause' })
    const whole = sprintReducer(running, tick(1000))
    let split = running
    for (const milliseconds of [1000 - qMilliseconds, qMilliseconds]) split = restore(sprintReducer(split, tick(milliseconds)))
    assert.deepEqual(split, whole)
    assert.equal(split.sprint.phase, 'planning')
    assert.deepEqual(eventTime(split.simulation.game.simulationTime, split.simulation.game.simulationTimeRemainder), running.sprint.deadline)
  }
})

test('second review: compensated fractional-speed inputs remain monotonic across a high-word transition', () => {
  const q = 2 ** -44
  const initial = activeSprint({ ...DEFAULT_WORKING_CALENDAR, simulationSecondsPerRealSecond: .3 })
  initial.simulation.game.developers = []
  let a = initial, b = initial
  for (const milliseconds of [1750, q, 2 * q]) {
    const before = eventTime(a.simulation.game.simulationTime, a.simulation.game.simulationTimeRemainder)
    a = restore(sprintReducer(a, tick(milliseconds)))
    assert.ok(compareEventTime(eventTime(a.simulation.game.simulationTime, a.simulation.game.simulationTimeRemainder), before) >= 0)
  }
  for (const milliseconds of [1750 - 4 * q, 7 * q]) b = restore(sprintReducer(b, tick(milliseconds)))
  assert.deepEqual(a, b)
})

test('cumulative playback conversion is monotonic and partition-equivalent around binary rounding boundaries', () => {
  for (const speed of [.1, .3, 1, 2, 10]) {
    const calendar = { ...DEFAULT_WORKING_CALENDAR, simulationSecondsPerRealSecond: speed }
    for (const base of [2 ** -40, 1, 1.75, 2, 240, 1000, 2 ** 40]) {
      const quantum = 2 ** (Math.floor(Math.log2(base)) - 54)
      let previous = eventTime(0)
      for (let i = -4; i <= 12; i++) {
        const input = eventTime(base, i * quantum)
        const actual = convertPlaybackElapsed(input, calendar)
        assert.ok(compareEventTime(actual, previous) >= 0, `milliseconds, speed ${speed}, base ${base}, offset ${i}`)
        if (input.low === 0) assert.deepEqual(actual, eventTime(input.high / 1000 * speed))
        previous = actual
      }
      const a = addEventTime(addEventTime(eventTime(base), quantum), 2 * quantum)
      const b = addEventTime(eventTime(base - 4 * quantum), 7 * quantum)
      assert.deepEqual(a, b)
      assert.deepEqual(convertPlaybackElapsed(a, calendar), convertPlaybackElapsed(restore(b), calendar))
    }
  }
})

test('conversion plateaus retain elapsed input without decisions, while unsupported absolute-clock progress rejects atomically', () => {
  const running = activeSprint({ ...DEFAULT_WORKING_CALENDAR, simulationSecondsPerRealSecond: .1 })
  const first = sprintReducer(running, tick(1500))
  delete first.simulation.game.developers[0].activeTicketID // A call into the engine would select work and draw RNG.
  let observed = 0
  const plateau = sprintReducer(first, tick(2 ** -45), () => { observed++ }, () => { observed++ })
  assert.strictEqual(plateau.simulation, first.simulation)
  assert.equal(observed, 0)
  assert.ok(compareEventTime(plateau.sprint.playback!.elapsed, first.sprint.playback!.elapsed) > 0)
  const game = running.simulation.game
  game.simulationTime = 1; game.simulationTimeRemainder = Number.EPSILON / 4
  const before = structuredClone(running)
  assert.throws(() => sprintReducer(running, tick(1e-37), () => { observed++ }), /resolution/)
  assert.deepEqual(running, before)
  assert.equal(observed, 0)
})

test('anchored simulation targets remain monotonic and partition-equivalent at nonzero origins and fractional speeds', () => {
  const q = 2 ** -44
  for (const origin of [0, .3, 1.75, 1e6]) for (const speed of [.1, .3, 1, 2]) {
    const calendar = { ...DEFAULT_WORKING_CALENDAR, simulationSecondsPerRealSecond: speed }
    const initial = activeSprint(calendar, origin)
    initial.simulation.game.developers = []
    const run = (parts: number[]) => {
      let session = initial
      for (const milliseconds of parts) {
        const previous = eventTime(session.simulation.game.simulationTime, session.simulation.game.simulationTimeRemainder)
        session = restore(sprintReducer(session, tick(milliseconds)))
        const now = eventTime(session.simulation.game.simulationTime, session.simulation.game.simulationTimeRemainder)
        assert.ok(compareEventTime(now, previous) >= 0)
        assert.equal(session.simulation.game.randomState, 1)
      }
      return session
    }
    assert.deepEqual(run([1750, q, 2 * q]), run([1750 - 4 * q, 7 * q]))
  }
})

test('canonical milliseconds close the reviewed sprint with identical events and RNG after JSON restoration', () => {
  const initial = activeSprint({ ...DEFAULT_WORKING_CALENDAR, simulationSecondsPerRealSecond: .1 })
  initial.sprint.deadline = eventTime(3 * .1)
  initial.simulation.game.developers[0].estimateReview!.dueTime = { ...initial.sprint.deadline }
  const a = collectSimulationActivity(initial.simulation.game.tickets), b = collectSimulationActivity(initial.simulation.game.tickets)
  const whole = sprintReducer(initial, tick(3000), a.board.observe, a.internal)
  const split = sprintReducer(restore(sprintReducer(initial, tick(1000), b.board.observe, b.internal)), tick(2000), b.board.observe, b.internal)
  assert.deepEqual(split, whole)
  assert.deepEqual(a.board.events, b.board.events)
  assert.deepEqual(a.diagnostics, b.diagnostics)
  assert.equal(split.sprint.phase, 'planning')
  assert.equal(split.simulation.game.randomState, 1015568748)
})

test('removed seconds input is rejected in both mixed-unit directions rather than resetting the conversion origin', () => {
  const initial = activeSprint({ ...DEFAULT_WORKING_CALENDAR, simulationSecondsPerRealSecond: .1 })
  initial.sprint.deadline = eventTime(3 * .1)
  initial.simulation.game.developers[0].estimateReview!.dueTime = { ...initial.sprint.deadline }
  const seconds = (value: number) => ({ type: 'tick', elapsedRealSeconds: value }) as unknown as SprintAction
  let observed = 0
  for (const [first, rejected] of [[initial, seconds(1)], [restore(sprintReducer(initial, tick(1000))), seconds(2)]] as const) {
    const before = structuredClone(first)
    assert.throws(() => sprintReducer(first, rejected, () => { observed++ }, () => { observed++ }), /milliseconds/i)
    assert.deepEqual(first, before)
    const remaining = first.simulation.game.simulationTime === 0 ? 3000 : 2000
    const recovered = sprintReducer(first, tick(remaining))
    assert.equal(recovered.simulation.game.randomState, 1015568748)
    assert.equal(recovered.sprint.phase, 'planning')
  }
  for (const malformed of [{ type: 'tick' }, { ...tick(1000), elapsedRealSeconds: 1 }, { type: 'tick', elapsedRealMilliseconds: 1000 }]) {
    assert.throws(() => sprintReducer(initial, malformed as unknown as SprintAction), /milliseconds/i)
  }
  assert.equal(observed, 0)
})

test('serialized millisecond anchors restore unchanged; seconds and unlabelled prototype anchors reject without reinterpretation', () => {
  const initial = activeSprint({ ...DEFAULT_WORKING_CALENDAR, simulationSecondsPerRealSecond: .1 })
  const first = sprintReducer(initial, tick(1000))
  assert.deepEqual(sprintReducer(restore(first), tick(2000)), sprintReducer(initial, tick(3000)))
  for (const unit of ['seconds', undefined]) {
    const legacy = restore(first)
    Object.assign(legacy.sprint.playback!, { elapsed: eventTime(1), unit })
    const restoredLegacy = restore(legacy) // An undefined legacy unit is actually absent after JSON.
    const before = structuredClone(restoredLegacy)
    assert.throws(() => sprintReducer(restoredLegacy, tick(2000)), /anchor.*milliseconds/i)
    assert.deepEqual(restoredLegacy, before)
    assert.deepEqual(sprintReducer(restoredLegacy, { type: 'restart' }), createSprintSession(restoredLegacy.sprint.calendar))
  }
})
