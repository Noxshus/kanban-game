import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GameState } from '../src/game/types'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { scheduleIdleWorkCheck, reviewDelay } from '../src/game/discipline.ts'
import { eventTime, addEventTime, compareEventTime, eventInterval } from '../src/game/eventTime.ts'
import { nextRandom } from '../src/game/random.ts'
import { projectWork } from '../src/game/completionTime.ts'
import { workAmount } from '../src/game/work.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { simulationReducer } from '../src/store/simulationControls.ts'
import { collectSimulationActivity } from '../src/game/simulationActivity.ts'
import { decisionFixture, setPublishedEstimate } from './helpers/decisionFixture.ts'

const noDraw = () => { throw Error('Unexpected RNG between idle work checks') }
const restore = <T>(value: T): T => JSON.parse(JSON.stringify(value))
function sequence(values: number[]) {
  let used = 0
  return { draw: () => { assert.ok(used < values.length, 'Unexpected RNG draw'); return values[used++] }, count: () => used }
}
function idle(): GameState {
  const state = decisionFixture()
  delete state.developers[0].activeTicketID
  delete state.developers[0].estimateReview
  state.tickets = []
  return state
}
function ticket(id = 'available') {
  const t = decisionFixture().tickets[0]
  // Already reported In Progress isolates check timing from new start-status rolls.
  t.id = id; t.actualStatus = 'todo'; t.reportedStatus = 'in_progress'
  setPublishedEstimate(t, 'previous-author')
  return t
}

test('legacy/newly available engineers retain immediate first pickup, with no idle scheduling draw on success', () => {
  const s = idle(); s.tickets.push(ticket())
  const original = structuredClone(s), random = sequence([.5])
  const first = advanceSimulation(s, .25, random.draw)
  assert.equal(random.count(), 1) // Existing active-ticket review, not an idle deadline.
  assert.equal(first.developers[0].activeTicketID, 'available')
  assert.equal(first.developers[0].lastAssessment!.at.high, 0)
  assert.equal(first.developers[0].idleWorkCheck, undefined)
  assert.ok(first.tickets[0].completedWork > 0)
  assert.deepEqual(s, original)
})

test('unsuccessful initial search schedules once; unchanged caller boundaries neither redraw nor search', () => {
  const s = idle(), random = sequence([.5]), first = advanceSimulation(s, 1, random.draw)
  assert.equal(random.count(), 1)
  assert.deepEqual(first.developers[0].idleWorkCheck, eventTime(12))
  assert.equal(first.developers[0].lastAssessment, undefined)
  first.tickets.push(ticket()) // New availability alone does not bypass the saved search deadline.
  const waiting = advanceSimulation(restore(first), 10, noDraw)
  assert.equal(waiting.simulationTime, 11)
  assert.equal(waiting.developers[0].activeTicketID, undefined)
  assert.equal(waiting.developers[0].lastAssessment, undefined)
  assert.equal(waiting.tickets[0].completedWork, 0)
  assert.deepEqual(waiting.developers[0].idleWorkCheck, eventTime(12))
  const retry = sequence([.5]), picked = advanceSimulation(waiting, 1, retry.draw)
  assert.equal(retry.count(), 1) // Only the new active-ticket review.
  assert.equal(picked.developers[0].activeTicketID, 'available')
  assert.equal(picked.developers[0].idleWorkCheck, undefined)
  assert.deepEqual(picked.developers[0].lastAssessment!.at, eventTime(12))
  assert.equal(picked.tickets[0].completedWork, 0) // Selection at the endpoint charges no work early.
  assert.ok(advanceSimulation(picked, 1, noDraw).tickets[0].completedWork > 0)
})

test('all-idle simulation processes every due retry, including a deadline at the exact interval endpoint', () => {
  const s = idle(), random = sequence(Array(6).fill(.5))
  const result = advanceSimulation(s, 60, random.draw)
  assert.equal(result.simulationTime, 60)
  assert.equal(random.count(), 6) // Initial attempt at 0, then checks at 12/24/36/48/60.
  assert.deepEqual(result.developers[0].idleWorkCheck, eventTime(72))
  assert.equal(result.developers[0].activeTicketID, undefined)
  assert.equal(result.workLog, undefined)
  assert.equal(result.developers[0].flowStreak, undefined)
  assert.equal(result.developers[0].estimateReview, undefined)
  assert.deepEqual(advanceSimulation(result, 0, noDraw), result)
  assert.deepEqual(advanceSimulation(result, .1, noDraw).developers, result.developers)
})

test('seeded idle draws match an independently computed deadline sequence and survive 60 one-second JSON partitions', () => {
  for (const seed of [1, 35, 87]) for (const discipline of [0, 10, 100]) {
    const s = idle(); s.randomState = seed; s.developers[0].discipline = discipline
    const original = structuredClone(s)
    let expectedSeed = seed, due = eventTime(0), draws = 0
    do {
      const random = nextRandom(expectedSeed); expectedSeed = random.state; draws++
      const median = 12 / (1 + Math.log1p(discipline / 10))
      due = addEventTime(due, median * Math.sqrt(-Math.log1p(-random.value) / Math.LN2))
    } while (compareEventTime(due, eventTime(60)) <= 0)
    const whole = advanceSimulation(s, 60)
    let split = s
    for (let i = 0; i < 60; i++) split = restore(advanceSimulation(split, 1))
    assert.deepEqual(split, whole)
    assert.equal(whole.randomState, expectedSeed)
    assert.deepEqual(whole.developers[0].idleWorkCheck, due)
    assert.ok(draws > 1)
    assert.deepEqual(advanceSimulation(s, 60), whole)
    assert.deepEqual(s, original)
  }
})

test('nonbinary fractional caller partitions preserve all-idle deadlines and exact seeded RNG', () => {
  const s = idle(), whole = advanceSimulation(s, 60)
  let split = s
  for (let i = 0; i < 60; i++) for (const seconds of [.3, .3, .4]) split = restore(advanceSimulation(split, seconds))
  assert.deepEqual(split, whole)
})

test('coincident idle checks claim work in engineer order and the unsuccessful engineer schedules one retry', () => {
  for (const reverse of [false, true]) {
    const s = idle(), a = s.developers[0]
    a.idleWorkCheck = eventTime(1)
    s.developers.push({ ...a, id: 'b' }); s.tickets.push(ticket())
    if (reverse) s.developers.reverse()
    const random = sequence([.5, .75]), result = advanceSimulation(s, 1, random.draw)
    assert.equal(random.count(), 2) // Winner's review, then loser's idle retry, in engineer order.
    assert.equal(result.developers[0].activeTicketID, 'available')
    assert.equal(result.developers[0].idleWorkCheck, undefined)
    assert.equal(result.tickets[0].assignedDeveloperId, s.developers[0].id)
    assert.equal(result.developers[1].activeTicketID, undefined)
    assert.deepEqual(result.developers[1].idleWorkCheck, addEventTime(eventTime(1), reviewDelay(0, .75)))
    assert.equal(result.tickets[0].completedWork, 0)
  }
})

test('completion and an idle deadline release claims first, then share engineer-order pickups across partitions', () => {
  for (const reverse of [false, true]) {
    const s = decisionFixture(), a = s.developers[0], t = s.tickets[0]
    a.focus = 0; a.competencies.frontend = 5
    t.requiredWork = 1; setPublishedEstimate(t, a.id, 1)
    t.reportedStatus = 'done' // No status change needed; isolate the clock/claim tie.
    const due = projectWork(a, t, workAmount(1)).seconds!
    s.tickets.push({ ...ticket('contested'), rank: 2 })
    s.developers.push({ ...a, id: 'idle', activeTicketID: undefined, estimateReview: undefined, idleWorkCheck: eventTime(due) })
    if (reverse) s.developers.reverse()
    const end = due + .25, whole = advanceSimulation(s, end)
    let split = s
    for (const seconds of [.3, .3, .4, end - 1]) split = restore(advanceSimulation(split, seconds))
    assert.deepEqual(split, whole)
    assert.equal(whole.developers[0].activeTicketID, 'contested')
    assert.equal(whole.developers[1].activeTicketID, undefined)
    assert.deepEqual(whole.developers[0].lastAssessment!.at, eventTime(due))
    assert.ok(compareEventTime(whole.developers[1].idleWorkCheck!, eventTime(due)) > 0)
    assert.equal(whole.randomState, nextRandom(nextRandom(s.randomState).state).state)
    assert.equal(whole.tickets[0].actualStatus, 'done')
    assert.equal(whole.tickets[0].reportedStatus, 'done')
    assert.equal(whole.tickets[0].reportedProgress, 100)
    assert.equal(new Set(whole.developers.flatMap(d => d.activeTicketID ? [d.activeTicketID] : [])).size, 1)
  }
})

test('idle checks and active reporting reviews share chronological engineer order without interrupting active work', () => {
  for (const reverse of [false, true]) {
    const s = decisionFixture(), a = s.developers[0]
    a.estimateReview!.dueTime = eventTime(1)
    s.tickets.push({ ...ticket(), rank: 2 })
    s.developers.push({ ...a, id: 'idle', activeTicketID: undefined, estimateReview: undefined, idleWorkCheck: eventTime(1) })
    if (reverse) s.developers.reverse()
    const collector = collectSimulationActivity(s.tickets), random = sequence([.5, .5])
    const result = advanceSimulation(s, 1, random.draw, collector.board.observe, collector.internal)
    assert.equal(random.count(), 2) // Two active review schedules, no idle retry after successful selection.
    assert.deepEqual(collector.diagnostics.filter(event => event.kind !== 'reported').map(event => event.developerId), s.developers.map(d => d.id))
    assert.equal(result.developers.find(d => d.id === 'a')!.activeTicketID, 'current')
    assert.equal(result.developers.find(d => d.id === 'idle')!.activeTicketID, 'available')
    assert.equal(result.developers.find(d => d.id === 'a')!.flowStreak!.duration, 1)
  }
})

test('one-ULP-distinct idle and completion deadlines retain chronological priority rather than merging', () => {
  for (const earlier of [true, false]) for (const reverse of [false, true]) {
    const s = decisionFixture(), a = s.developers[0], t = s.tickets[0]
    a.focus = 0; a.competencies.frontend = 5
    t.requiredWork = 1; setPublishedEstimate(t, a.id, 1)
    const due = projectWork(a, t, workAmount(1)).seconds!
    const bits = new DataView(new ArrayBuffer(8))
    bits.setFloat64(0, due); bits.setBigUint64(0, bits.getBigUint64(0) + (earlier ? -1n : 1n))
    s.tickets.push({ ...ticket('contested'), rank: 2 })
    s.developers.push({ ...a, id: 'idle', activeTicketID: undefined, estimateReview: undefined, idleWorkCheck: eventTime(bits.getFloat64(0)) })
    if (reverse) s.developers.reverse()
    const result = advanceSimulation(s, due + .25, () => .9)
    assert.equal(result.developers.find(d => d.activeTicketID === 'contested')!.id, earlier ? 'idle' : 'a')
    assert.equal(result.tickets[0].actualStatus, 'done')
  }
})

test('initial failed searches and active reviews use the same engineer-ordered draw stream at time zero', () => {
  const s = decisionFixture(), a = s.developers[0]
  a.productivity = 0; a.estimateReview!.dueTime = eventTime(0)
  s.developers.unshift({ ...a, id: 'idle', activeTicketID: undefined, estimateReview: undefined })
  const random = sequence([.75, .5]), result = advanceSimulation(s, 1, random.draw)
  assert.equal(random.count(), 2)
  assert.deepEqual(result.developers[0].idleWorkCheck, eventTime(reviewDelay(0, .75)))
  assert.deepEqual(result.developers[1].estimateReview!.dueTime, eventTime(12))
  assert.equal(result.workLog, undefined)
  assert.equal(result.tickets[0].lastEstimateEvaluation!.reason, 'review')
})

test('paused calls preserve deadlines/RNG; Resume does not tick them and Restart discards them', () => {
  const game = advanceSimulation(idle(), 1, () => .5), session = { game, isPaused: true }
  assert.strictEqual(simulationReducer(session, { type: 'tick' }), session)
  const resumed = simulationReducer(restore(session), { type: 'togglePause' })
  assert.deepEqual(resumed.game, game)
  const stepped = simulationReducer(restore(session), { type: 'step' })
  assert.deepEqual(stepped.game.developers[0].idleWorkCheck, game.developers[0].idleWorkCheck)
  assert.equal(stepped.game.randomState, game.randomState)
  const restart = simulationReducer(resumed, { type: 'restart' })
  assert.ok(restart.game.developers.every(d => d.idleWorkCheck === undefined))
  assert.equal(restart.isPaused, true)
})

test('Discipline changes affect the next sampled interval, never redraw the current deadline', () => {
  const s = advanceSimulation(idle(), 1, () => .5)
  s.developers[0].discipline = 100
  const before = advanceSimulation(restore(s), 10, noDraw)
  assert.deepEqual(before.developers[0].idleWorkCheck, eventTime(12))
  const random = sequence([.5]), after = advanceSimulation(before, 1, random.draw)
  assert.equal(random.count(), 1)
  assert.deepEqual(after.developers[0].idleWorkCheck, addEventTime(eventTime(12), 12 / (1 + Math.log1p(10))))
})

test('legacy idle states check once now; restored due/past deadlines fire once without a zero-time loop', () => {
  for (const deadline of [undefined, eventTime(7), eventTime(6)]) {
    const s = idle(); s.simulationTime = 7
    s.developers[0].idleWorkCheck = deadline
    const original = restore(s), random = sequence([.5]), result = advanceSimulation(restore(s), .25, random.draw)
    assert.equal(random.count(), 1)
    assert.deepEqual(result.developers[0].idleWorkCheck, eventTime(19))
    assert.deepEqual(advanceSimulation(restore(result), .25, noDraw).developers, result.developers)
    assert.deepEqual(restore(s), original)
  }
})

test('valid active work cancels stale idle checks and invalidated claims regain an immediate initial chance', () => {
  const s = decisionFixture(); s.developers[0].idleWorkCheck = eventTime(0)
  assert.equal(advanceSimulation(s, .25, noDraw).developers[0].idleWorkCheck, undefined)
  const invalid = idle(); invalid.developers[0].activeTicketID = 'missing'; invalid.developers[0].idleWorkCheck = eventTime(100)
  invalid.tickets.push(ticket())
  const random = sequence([.5]), picked = advanceSimulation(invalid, .25, random.draw)
  assert.equal(picked.developers[0].activeTicketID, 'available')
  assert.equal(picked.developers[0].idleWorkCheck, undefined)
  assert.equal(random.count(), 1)
})

test('low/high uncapped Discipline and guarded RNG endpoints produce positive finite normalized deadlines', () => {
  for (const discipline of [0, 10, 100, 1e100, Number.MAX_VALUE]) for (const uniform of [0, .5, 1]) {
    const d = idle().developers[0]; d.discipline = discipline
    scheduleIdleWorkCheck(d, eventTime(3), () => uniform)
    assert.ok(compareEventTime(d.idleWorkCheck!, eventTime(3)) > 0)
    assert.ok(Number.isFinite(eventInterval(d.idleWorkCheck!, eventTime(3))))
    assert.deepEqual(eventTime(d.idleWorkCheck!.high, d.idleWorkCheck!.low), d.idleWorkCheck)
    assert.deepEqual(restore(d).idleWorkCheck, d.idleWorkCheck)
  }
})

test('invalid deadlines, invalid scheduling draws and unsupported precision reject atomically', () => {
  for (const deadline of [{ high: NaN, low: 0 }, { high: 1, low: Infinity }, { high: 1, low: 1 }]) {
    const s = idle(); s.developers[0].idleWorkCheck = deadline
    const before = structuredClone(s)
    assert.throws(() => advanceSimulation(s, 1, noDraw), /finite normalized event time/)
    assert.deepEqual(s, before)
  }
  for (const uniform of [-1, NaN, Infinity, 1.1]) {
    const s = idle(), before = structuredClone(s)
    assert.throws(() => advanceSimulation(s, 1, () => uniform), RangeError)
    assert.deepEqual(s, before)
  }
  const s = idle(); s.simulationTime = 1e308; s.simulationTimeRemainder = 1e290
  const original = structuredClone(s)
  assert.throws(() => advanceSimulation(s, 1e292, () => .5), /Idle work check has no positive representable time interval/)
  assert.deepEqual(s, original)
  assert.deepEqual(advanceSimulation(s, 0, noDraw), s)
  // The first engineer's seeded deadline fits the low word, but the second's
  // high-Discipline interval does not. Even that partially processed clone is discarded.
  const team = idle(); team.simulationTime = 1e308; team.simulationTimeRemainder = 1e16
  team.developers.push({ ...team.developers[0], id: 'b', discipline: Number.MAX_VALUE })
  const saved = structuredClone(team)
  assert.throws(() => advanceSimulation(team, 1e292), /Idle work check has no positive representable time interval/)
  assert.deepEqual(team, saved)
})

test('empty teams have no scheduling draws; ineligible work remains untouched and idle clocks stay out of the player view', () => {
  const empty = idle(); empty.developers = []
  assert.equal(advanceSimulation(empty, 60, noDraw).simulationTime, 60)
  const s = idle(); s.tickets = [ticket('backlog'), ticket('done')]
  s.tickets[0].actualStatus = 'backlog'; s.tickets[0].reportedStatus = 'todo'
  s.tickets[1].actualStatus = 'done'; s.tickets[1].completedWork = s.tickets[1].requiredWork
  s.tickets[1].reportedStatus = 'done'
  const originalBacklog = structuredClone(s.tickets[0]), c = collectSimulationActivity(s.tickets)
  const result = advanceSimulation(s, 60, () => .5, c.board.observe, c.internal)
  assert.deepEqual(result.tickets[0], originalBacklog)
  assert.equal(result.developers[0].activeTicketID, undefined)
  assert.equal(result.developers[0].lastAssessment, undefined)
  assert.equal(result.workLog, undefined)
  assert.equal(result.tickets[0].estimateHistory!.length, s.tickets[0].estimateHistory!.length)
  assert.equal('idleWorkCheck' in getPlayerView(result).developers[0], false)
  assert.ok(c.diagnostics.every(event => event.kind === 'reported'))
  assert.equal(result.tickets[1].reportedStatus, 'done')
  assert.equal(result.tickets[1].reportedProgress, 100)
})
