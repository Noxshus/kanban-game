import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getAverageFlowMultiplier, getFlowBonus } from '../src/game/flow.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { getDiagnosticsView } from '../src/store/diagnosticsView.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { simulationReducer } from '../src/store/simulationControls.ts'
import { close, expectedWork } from './helpers/flowExpectation.ts'
import { nextRandom } from '../src/game/random.ts'

function scenario(focus = 0) {
  const state = structuredClone(exampleGameState)
  state.developers = [{ ...state.developers[0], focus, productivity: 2, competencies: { frontend: 5, backend: 10 } }]
  state.tickets = [{ ...state.tickets[0], completedWork: 0, requiredWork: 1e6 }]
  return state
}

test('baseline Focus accumulates Flow, higher Focus builds faster, with no cap', () => {
  close(getFlowBonus(10, 0), 0.25 * Math.log(2))
  close(getFlowBonus(10, 5), 0.25 * Math.log(3))
  assert.ok(getFlowBonus(10, 20) > getFlowBonus(10, 5))
  assert.ok(getFlowBonus(1e200, 0) > 100)
  assert.ok(getFlowBonus(1e300, 0) > getFlowBonus(1e200, 0))
  assert.ok(getFlowBonus(20, 0) - getFlowBonus(10, 0) > getFlowBonus(30, 0) - getFlowBonus(20, 0))
  const result = advanceSimulation(scenario(), 1, () => 0.99)
  assert.equal(result.developers[0].flowStreak?.duration, 1)
  close(result.tickets[0].completedWork, expectedWork(2, 1, 0))
})

test('integrated bonus matches an independent antiderivative and preserves work under partitioning', () => {
  for (const focus of [0, 5, 100]) {
    const state = scenario(focus)
    const whole = advanceSimulation(state, 10, () => 0.99)
    let split = state
    for (let i = 0; i < 40; i++) split = advanceSimulation(split, 0.25, () => 0.99)
    close(whole.tickets[0].completedWork, expectedWork(2, 10, focus))
    close(split.tickets[0].completedWork, whole.tickets[0].completedWork)
    assert.equal(split.developers[0].flowStreak?.duration, 10)
    // Instantaneous end rate is intentionally higher than the interval mean.
    assert.ok(getAverageFlowMultiplier(0, 10, focus) < 1 + getFlowBonus(10, focus))
  }
})

test('Flow multiplies domain work independently and diagnostic rates are instantaneous', () => {
  const state = scenario(5)
  state.tickets[0].workDomain = 'backend'
  const result = advanceSimulation(state, 2, () => 0.99)
  close(result.tickets[0].completedWork, expectedWork(3, 2))
  const view = getDiagnosticsView(result)
  close(view.developers[0].flowBonus, 0.25 * Math.log(1.4))
  close(view.developers[0].workRate!, 3 * (1 + 0.25 * Math.log(1.4)))
  close(view.team.workRate!, view.developers[0].workRate!)
  close(view.tickets[0].estimatedSeconds!, (1e6 - result.tickets[0].completedWork) / view.team.workRate!)
  assert.deepEqual(getDiagnosticsView(result), view)
  assert.deepEqual(Object.keys(getPlayerView(result).developers[0]).sort(), ['id', 'name', 'productivity'])
})

test('switching fully resets Flow, abandoned work is preserved, and returning starts fresh', () => {
  let state = advanceSimulation(scenario(5), 10, () => 0.99)
  state.tickets.push({ ...state.tickets[0], id: 'alternative', rank: 2, completedWork: 0, actualStatus: 'todo' })
  state.developers[0].assessmentClock = { elapsed: 10, remaining: 0 }
  const before = structuredClone(state)
  const switched = advanceSimulation(state, 1, (() => { let calls=0; return () => calls++ === 0 ? 0.999 : 0.5 })())
  assert.equal(switched.developers[0].activeTicketID, 'alternative')
  assert.equal(switched.developers[0].flowStreak?.duration, 1)
  close(switched.tickets[1].completedWork, expectedWork(2, 1))
  assert.equal(switched.tickets[0].completedWork, before.tickets[0].completedWork)
  switched.developers[0].assessmentClock!.remaining = 0
  const returned = advanceSimulation(switched, 1, (() => { let calls=0; return () => calls++ === 0 ? 0.999 : 0.5 })())
  assert.equal(returned.developers[0].activeTicketID, 'ticket-1')
  assert.equal(returned.developers[0].flowStreak?.duration, 1)
  close(returned.tickets[0].completedWork - before.tickets[0].completedWork, expectedWork(2, 1))
  assert.deepEqual(state, before)
})

test('completion, idle/stale references and external ticket changes clear the previous streak', () => {
  const state = scenario()
  state.developers[0].flowStreak = { ticketId: 'ticket-1', duration: 100 }
  state.tickets[0].requiredWork = 1
  const completed = advanceSimulation(state, 1, () => 0.99)
  assert.equal(completed.developers[0].flowStreak, undefined)
  assert.equal(completed.developers[0].activeTicketID, undefined)
  for (const reference of [undefined, 'missing']) {
    const stale = scenario()
    stale.developers[0].flowStreak = { ticketId: 'ticket-1', duration: 100 }
    stale.developers[0].activeTicketID = reference
    assert.equal(advanceSimulation(stale, 1, () => 0.99).developers[0].flowStreak?.duration, 1)
    stale.tickets = []
    assert.equal(advanceSimulation(stale, 1).developers[0].flowStreak, undefined)
  }
  const changed = scenario()
  changed.developers[0].flowStreak = { ticketId: 'previous', duration: 100 }
  close(advanceSimulation(changed, 1, () => 0.99).tickets[0].completedWork, expectedWork(2, 1, 0))
})

test('staying, pause, zero time and rank reorder preserve the streak', () => {
  const game = advanceSimulation(scenario(), 2, () => 0.99)
  const attempted = advanceSimulation(game, 1, () => 0)
  assert.equal(attempted.developers[0].flowStreak?.duration, 3)
  assert.deepEqual(advanceSimulation(game, 0), game)
  const paused = { game, isPaused: true }
  assert.strictEqual(simulationReducer(paused, { type: 'tick' }), paused)
  const resumed = simulationReducer(paused, { type: 'togglePause' })
  assert.deepEqual(resumed.game, game)
  assert.equal(simulationReducer(resumed, { type: 'tick' }).game.developers[0].flowStreak?.duration, 3)
  game.tickets[0].reportedStatus = 'todo'
  game.tickets.push({ ...game.tickets[0], id: 'alternative', rank: 2 })
  for (const isPaused of [true, false]) {
    const reordered = simulationReducer({ game, isPaused }, { type: 'reorderTodo', ticketId: 'ticket-1', targetId: 'alternative', after: true })
    assert.equal(reordered.game.tickets[0].rank, 2)
    assert.deepEqual(reordered.game.developers, game.developers)
  }
})

test('Flow adds no RNG draws and serialized streaks replay without mutating their input', () => {
  const state = scenario(10)
  const first = advanceSimulation(state, 1)
  assert.equal(first.randomState, nextRandom(state.randomState).state)
  const original = structuredClone(first)
  Object.freeze(first.developers[0].flowStreak)
  const continued = advanceSimulation(first, 3)
  assert.deepEqual(continued, advanceSimulation(JSON.parse(JSON.stringify(first)), 3))
  assert.deepEqual(first, original)
})

test('extreme finite inputs remain logarithmic; invalid/unrepresentable values fail explicitly', () => {
  assert.ok(Number.isFinite(getFlowBonus(Number.MAX_VALUE, Number.MAX_VALUE)))
  assert.ok(Number.isFinite(getAverageFlowMultiplier(0, Number.MAX_VALUE, Number.MAX_VALUE)))
  close(getAverageFlowMultiplier(1e200, 1e-200, 5), 1 + getFlowBonus(1e200, 5))
  assert.ok(getAverageFlowMultiplier(0, 1e-308, 0) >= 1)
  for (const bad of [-1, Infinity, NaN]) {
    assert.throws(() => getFlowBonus(bad, 0), RangeError)
    assert.throws(() => getFlowBonus(1, bad), RangeError)
  }
  assert.throws(() => getAverageFlowMultiplier(Number.MAX_VALUE, Number.MAX_VALUE, 5), RangeError)
  const overflow = scenario(5)
  overflow.developers[0].productivity = 1e308
  overflow.developers[0].flowStreak = { ticketId: 'ticket-1', duration: 1e200 }
  const original = structuredClone(overflow)
  assert.equal(advanceSimulation(overflow, 1).tickets[0].completedWork, overflow.tickets[0].requiredWork)
  assert.deepEqual(overflow, original)
  assert.equal(getDiagnosticsView(overflow).developers[0].workRate, null)
})
