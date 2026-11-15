import { close, expectedWork } from './helpers/focusExpectation.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { getEffectiveProductivity, getWorkCompleted } from '../src/game/productivity.ts'
import { getDiagnosticsView } from '../src/store/diagnosticsView.ts'
import type { GameState, WorkDomain } from '../src/game/types.ts'

// Curated #37 comparison: identical effort/base/seed, varying only domain fit.
function domainScenario(workDomain: WorkDomain, frontend: number, backend: number, productivity = 2): GameState {
  return {
    randomState: 1,
    simulationTime: 0,
    developers: [{ id: 'engineer', name: 'Engineer', activeTicketID: 'work', productivity,
      competencies: { frontend, backend }, judgement: 5, discipline: 5 }],
    tickets: [{ id: 'work', title: 'Domain work', rank: 1, workDomain,
      actualStatus: 'in_progress', reportedStatus: 'todo', reportedProgress: 0,
      assignedDeveloperId: 'engineer', completedWork: 0, requiredWork: 100 }],
  }
}

test('overflowing intermediate rate still produces approximately 10.5 work over tiny elapsed time', () => {
  const state = domainScenario('frontend', 100, 0, 1e308)
  const original = structuredClone(state)
  const result = advanceSimulation(state, 1e-308)
  assert.ok(Math.abs(result.tickets[0].completedWork - 10.5) < 1e-12)
  assert.equal(result.tickets[0].actualStatus, 'in_progress')
  assert.equal(result.developers[0].activeTicketID, 'work')
  assert.deepEqual(state, original)
  assert.deepEqual(result, advanceSimulation(state, 1e-308))
  const view = getDiagnosticsView(state)
  assert.equal(view.developers[0].workRate, null)
  assert.equal(view.tickets[0].workRate, null)
  assert.equal(view.team.workRate, null)
  assert.equal(view.tickets[0].estimatedSeconds, null)
})

test('actual work overflow is explicit and leaves the input unchanged; zero time stays safe', () => {
  const state = domainScenario('frontend', 100, 0, 1e308)
  const original = structuredClone(state)
  assert.throws(() => advanceSimulation(state, 1), /Work over elapsed time exceeds/)
  assert.deepEqual(state, original)
  assert.equal(getWorkCompleted(state.developers[0], state.tickets[0], 0), 0)
  assert.deepEqual(advanceSimulation(state, 0), original)
  // A representable rate can also overflow over a long duration.
  state.developers[0].competencies.frontend = 5
  assert.throws(() => getWorkCompleted(state.developers[0], state.tickets[0], 10), RangeError)
})

test('large finite work completes safely without overflowing the completed-work addition', () => {
  const state = domainScenario('backend', 0, 5, 1e308)
  state.tickets[0].requiredWork = Number.MAX_VALUE
  state.tickets[0].completedWork = 1e308
  const result = advanceSimulation(state, 1)
  assert.equal(result.tickets[0].completedWork, Number.MAX_VALUE)
  assert.equal(result.tickets[0].actualStatus, 'done')
})

test('diagnostics flag aggregate-rate and ETA overflow instead of showing Infinity', () => {
  const state = domainScenario('frontend', 5, 5, 1e308)
  state.tickets.push({ ...state.tickets[0], id: 'second', rank: 2 })
  state.developers.push({ ...state.developers[0], id: 'second', activeTicketID: 'second' })
  assert.equal(getDiagnosticsView(state).team.workRate, null)
  state.developers[0].productivity = Number.MIN_VALUE
  state.tickets[0].requiredWork = Number.MAX_VALUE
  assert.equal(getDiagnosticsView(state).tickets[0].estimatedSeconds, null)
  for (const invalid of [NaN, Infinity, -Infinity]) {
    state.developers[0].productivity = invalid
    assert.throws(() => getWorkCompleted(state.developers[0], state.tickets[0], 1), RangeError)
  }
})

test('example has one valid domain per ticket, both competencies per engineer and consecutive ranks', () => {
  for (const ticket of exampleGameState.tickets) {
    assert.ok(['frontend', 'backend'].includes(ticket.workDomain))
  }
  for (const developer of exampleGameState.developers) {
    assert.deepEqual(Object.keys(developer.competencies).sort(), ['backend', 'frontend'])
    assert.ok(Object.values(developer.competencies).every(value => Number.isFinite(value) && value >= 0))
  }
  assert.deepEqual(exampleGameState.tickets.map(t => t.rank).sort((a, b) => a - b),
    exampleGameState.tickets.map((_, index) => index + 1))
})

test('0, 5 and 10 competency give 0.5x, 1x and 1.5x for either domain', () => {
  for (const domain of ['frontend', 'backend'] as const) {
    for (const competency of [0, 5, 10]) {
      const state = domainScenario(domain, domain === 'frontend' ? competency : 10,
        domain === 'backend' ? competency : 10)
      assert.equal(getEffectiveProductivity(state.developers[0], state.tickets[0]), 2 * (0.5 + competency / 10))
    }
  }
})

test('invalid competencies are rejected instead of creating non-positive or non-finite modifiers', () => {
  for (const value of [-1, NaN, Infinity, -Infinity]) {
    const state = domainScenario('frontend', value, 5)
    assert.throws(() => getEffectiveProductivity(state.developers[0], state.tickets[0]), RangeError)
  }
})

test('competencies above 10 increase work rate and diagnostics without a cap', () => {
  for (const [competency, expected] of [[20, 5], [100, 21]] as const) {
    const state = domainScenario('frontend', competency, 0)
    assert.equal(getEffectiveProductivity(state.developers[0], state.tickets[0]), expected)
    close(advanceSimulation(state, 1).tickets[0].completedWork, expectedWork(expected, 1))
    assert.equal(getDiagnosticsView(state).developers[0].competencies.frontend, competency)
    assert.equal(getDiagnosticsView(state).developers[0].workRate, expected)
  }
})

test('matched and mismatched curated scenarios select the relevant competency for actual work', () => {
  const frontend = domainScenario('frontend', 10, 0)
  const backend = domainScenario('backend', 10, 0)
  const matched = advanceSimulation(frontend, 1)
  const mismatched = advanceSimulation(backend, 1)
  close(matched.tickets[0].completedWork, expectedWork(3, 1))
  close(mismatched.tickets[0].completedWork, expectedWork(1, 1))
  assert.equal(matched.randomState, mismatched.randomState)
  const fullStack = domainScenario('backend', 6, 6)
  close(advanceSimulation(fullStack, 0.5).tickets[0].completedWork, expectedWork(2.2, 0.5))
})

test('high base productivity overcomes poor fit without a cap, and zero expertise still completes', () => {
  const fastMismatch = domainScenario('frontend', 0, 10, 100)
  const slowSpecialist = domainScenario('frontend', 10, 0, 1)
  assert.ok(getEffectiveProductivity(fastMismatch.developers[0], fastMismatch.tickets[0])
    > getEffectiveProductivity(slowSpecialist.developers[0], slowSpecialist.tickets[0]))
  const lowSkill = domainScenario('frontend', 0, 10)
  const completed = advanceSimulation(lowSkill, 100)
  assert.equal(completed.tickets[0].completedWork, 100)
  assert.equal(completed.tickets[0].actualStatus, 'done')
  assert.equal(completed.developers[0].activeTicketID, undefined)
})

test('higher-ranked poor fit is still selected ahead of lower-ranked matching work', () => {
  const state = domainScenario('backend', 10, 0)
  delete state.developers[0].activeTicketID
  state.tickets[0].actualStatus = 'todo'
  state.tickets.push({ ...state.tickets[0], id: 'better-fit', rank: 2, workDomain: 'frontend' })
  const result = advanceSimulation(state, 1)
  assert.equal(result.developers[0].activeTicketID, 'work')
  close(result.tickets[0].completedWork, expectedWork(1, 1))
  assert.equal(result.tickets[1].completedWork, 0)
})

test('switching uses the replacement domain rate and never progresses the abandoned ticket', () => {
  const state = domainScenario('frontend', 10, 0)
  state.tickets.push({ ...state.tickets[0], id: 'replacement', rank: 2, workDomain: 'backend',
    actualStatus: 'todo', assignedDeveloperId: undefined })
  const result = advanceSimulation(state, 1, () => 0.009)
  assert.equal(result.developers[0].activeTicketID, 'replacement')
  assert.equal(result.tickets[0].completedWork, 0)
  assert.equal(result.tickets[0].actualStatus, 'in_progress')
  close(result.tickets[1].completedWork, expectedWork(1, 1))
})

test('domain rates feed diagnostics, team totals and ETAs without changing base productivity', () => {
  const state = domainScenario('backend', 10, 0)
  const view = getDiagnosticsView(state)
  assert.equal(view.developers[0].productivity, 2)
  assert.deepEqual(view.developers[0].competencies, { frontend: 10, backend: 0 })
  assert.equal(view.developers[0].workRate, 1)
  assert.equal(view.tickets[0].workDomain, 'backend')
  assert.equal(view.tickets[0].estimatedSeconds, 100)
  assert.equal(view.team.workRate, 1)
  const advanced = advanceSimulation(state, 1)
  close(advanced.tickets[0].completedWork - state.tickets[0].completedWork, expectedWork(view.team.workRate!, 1))
})

test('mixed-domain replay is immutable, survives serialization and never duplicates active claims', () => {
  const initial = structuredClone(exampleGameState)
  const original = structuredClone(initial)
  initial.developers.forEach(developer => Object.freeze(developer.competencies))
  let first = initial
  let replay = JSON.parse(JSON.stringify(initial)) as GameState
  for (const elapsed of [1, 0.5, 1, 3, 1, 20]) {
    first = advanceSimulation(first, elapsed)
    replay = advanceSimulation(replay, elapsed)
    assert.deepEqual(first, replay)
    const claims = first.developers.flatMap(d => d.activeTicketID ? [d.activeTicketID] : [])
    assert.equal(new Set(claims).size, claims.length)
  }
  assert.deepEqual(initial, original)
  assert.deepEqual(first.tickets.slice(5), initial.tickets.slice(5))
})
