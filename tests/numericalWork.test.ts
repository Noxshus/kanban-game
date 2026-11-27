import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { projectCompletion } from '../src/game/completionTime.ts'
import { integratedWork, remainingWorkNumber } from '../src/game/work.ts'
import { getDiagnosticsView } from '../src/store/diagnosticsView.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { estimatedFixture } from './helpers/estimatedFixture.ts'

function scenario(subnormal: boolean) {
  const state = structuredClone(exampleGameState)
  state.developers = [{ ...state.developers[0], productivity: subnormal ? Number.MIN_VALUE : 1000,
    focus: 0, competencies: { frontend: subnormal ? 0 : 5, backend: 5 },
    assessmentClock: { elapsed: 0, remaining: 1000 } }]
  state.tickets = [{ ...state.tickets[0], requiredWork: subnormal ? Number.MIN_VALUE : 1e20,
    completedWork: subnormal ? 0 : 1e20 - 16384 }]
  return estimatedFixture(state)
}

test('large existing totals retain small increments: 20 seconds equals twenty one-second advances', () => {
  const state = scenario(false)
  const original = structuredClone(state)
  const first = advanceSimulation(state, 1)
  assert.equal(first.tickets[0].completedWork, state.tickets[0].completedWork) // total cannot yet round upward
  assert.ok(remainingWorkNumber(first.tickets[0])! < 16384)
  assert.ok(first.tickets[0].workRemainder)
  assert.ok(projectCompletion(first.developers[0], first.tickets[0], true).seconds!
    < projectCompletion(state.developers[0], state.tickets[0], true).seconds!)
  const whole = advanceSimulation(state, 20)
  let split = state
  for (let i = 0; i < 20; i++) split = advanceSimulation(split, 1)
  assert.equal(whole.tickets[0].completedWork, 1e20)
  assert.equal(split.tickets[0].completedWork, 1e20)
  assert.equal(whole.tickets[0].actualStatus, 'done')
  assert.equal(split.tickets[0].actualStatus, 'done')
  assert.deepEqual(state, original)
})

test('subnormal domain work retains fractions: three seconds equals three one-second advances', () => {
  const state = scenario(true)
  const first = advanceSimulation(state, 1)
  assert.equal(first.tickets[0].actualStatus, 'in_progress')
  assert.equal(first.tickets[0].completedWork, 0)
  assert.ok(first.tickets[0].workRemainder!.exponent < -1074)
  // Unrepresentable diagnostic quantities are unavailable, never silently zero.
  assert.equal(getDiagnosticsView(first).tickets[0].remainingWork, null)
  assert.equal(getDiagnosticsView(first).tickets[0].workRate, null)
  const whole = advanceSimulation(state, 3)
  let split = state
  for (let i = 0; i < 3; i++) split = advanceSimulation(split, 1)
  assert.equal(whole.tickets[0].completedWork, Number.MIN_VALUE)
  assert.equal(split.tickets[0].completedWork, Number.MIN_VALUE)
  assert.equal(whole.tickets[0].actualStatus, 'done')
  assert.equal(split.tickets[0].actualStatus, 'done')
  assert.deepEqual(advanceSimulation(JSON.parse(JSON.stringify(first)), 1), advanceSimulation(first, 1))
  assert.equal('workRemainder' in getPlayerView(first).tickets[0], false)
})

test('a projection deadline is not completion: accumulated work determines actual completion', () => {
  const state = scenario(true)
  const duration = projectCompletion(state.developers[0], state.tickets[0], true).seconds!
  const justBefore = advanceSimulation(state, duration * (1 - 1e-8))
  assert.equal(justBefore.tickets[0].actualStatus, 'in_progress')
  assert.ok(justBefore.tickets[0].workRemainder!.mantissa > 0)
  const completed = advanceSimulation(state, duration)
  assert.equal(completed.tickets[0].actualStatus, 'done')
})

test('remainder serialization is pure; explicit work edits invalidate old numerical carry', () => {
  const first = advanceSimulation(scenario(false), 1)
  const saved = structuredClone(first)
  Object.freeze(first.tickets[0].workRemainder)
  assert.deepEqual(advanceSimulation(first, 1), advanceSimulation(JSON.parse(JSON.stringify(first)), 1))
  assert.deepEqual(first, saved)
  first.tickets[0].completedWork = first.tickets[0].requiredWork
  assert.equal(remainingWorkNumber(first.tickets[0]), 0)
})

test('precision beyond the finite mantissa/time representation fails explicitly rather than losing work', () => {
  const state = scenario(false)
  state.tickets[0].completedWork = 0
  state.tickets[0].requiredWork = Number.MAX_VALUE
  state.developers[0].productivity = Number.MIN_VALUE
  const original = structuredClone(state)
  assert.throws(() => advanceSimulation(state, 1), /below remaining-work numeric resolution/)
  assert.deepEqual(state, original)
  // Positive time below Number.MIN_VALUE cannot be used as an instantaneous completion.
  state.tickets[0].requiredWork = Number.MIN_VALUE
  state.developers[0].productivity = Number.MAX_VALUE
  state.developers[0].competencies.frontend = Number.MAX_VALUE
  assert.throws(() => projectCompletion(state.developers[0], state.tickets[0]), /below the numeric time range/)
  const work = integratedWork(scenario(true).developers[0], scenario(true).tickets[0], 1, 0)
  assert.ok(work.mantissa > 0)
})

test('a new active engineer resumes retained fractional work without inheriting Flow', () => {
  const first = advanceSimulation(scenario(true), 1)
  first.developers = [{ ...first.developers[0], id: 'replacement', activeTicketID: undefined }]
  const result = advanceSimulation(first, 0.5, () => 0.5)
  assert.equal(result.tickets[0].assignedDeveloperId, 'replacement')
  assert.equal(result.tickets[0].actualStatus, 'in_progress')
  assert.equal(result.developers[0].flowStreak?.duration, 0.5)
  const finished = advanceSimulation(result, 1, () => 0.5)
  assert.equal(finished.tickets[0].completedWork, Number.MIN_VALUE)
  assert.equal(finished.tickets[0].actualStatus, 'done')
})

test('compensated session time retains small advances even when rounded cumulative work stays unchanged', () => {
  const state = scenario(false)
  state.developers[0].productivity = 1
  state.developers[0].focus = 0
  state.developers[0].assessmentClock = { elapsed: 0, remaining: 1e20 }
  state.tickets[0].requiredWork = 93846940987276820
  state.tickets[0].completedWork = 0
  estimatedFixture(state)
  const prefix = advanceSimulation(state, 1e16)
  assert.equal(prefix.developers[0].workSession!.elapsed, 1e16)
  assert.equal(prefix.tickets[0].actualStatus, 'in_progress')
  const original = structuredClone(prefix)
  const supported = advanceSimulation(prefix, 2)
  assert.equal(supported.tickets[0].actualStatus, 'done')
  assert.equal(supported.tickets[0].completedWork, state.tickets[0].requiredWork)
  const first = advanceSimulation(prefix, 1)
  assert.equal(first.simulationTime, 1e16)
  assert.equal(first.simulationTimeRemainder, 1)
  assert.equal(first.developers[0].workSession!.elapsed, 1e16)
  assert.deepEqual(first.tickets, prefix.tickets)
  assert.deepEqual(first.workLog, prefix.workLog)
  assert.equal(first.randomState, prefix.randomState)
  assert.deepEqual(advanceSimulation(JSON.parse(JSON.stringify(first)), 1), supported)
  // This increment is lost by BOTH clock words, not just the rounded integral.
  let draws = 0
  assert.throws(() => advanceSimulation(first, 1e-40, () => { draws++; return .5 }), /numeric resolution/)
  assert.equal(draws, 0)
  assert.deepEqual(prefix, original)
  const restored = JSON.parse(JSON.stringify(prefix))
  assert.deepEqual(advanceSimulation(restored, 1), first)
  assert.deepEqual(advanceSimulation(restored, 2), supported)
  assert.deepEqual(advanceSimulation(prefix, 0), prefix)
})
