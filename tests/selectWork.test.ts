import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectWork } from '../src/game/selectWork.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { nextRandom } from '../src/game/random.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { getDiagnosticsView } from '../src/store/diagnosticsView.ts'

function scenario() {
  const state = structuredClone(exampleGameState)
  state.developers = [{ ...state.developers[0], activeTicketID: undefined, judgement: 8, discipline: 2 }]
  const ticket = state.tickets[0]
  state.tickets = [
    { ...ticket, id: 'backlog', rank: 1, actualStatus: 'backlog' as const, reportedProgress: 100 },
    { ...ticket, id: 'manager', rank: 2, actualStatus: 'todo' as const, reportedProgress: 10, completedWork: 0 },
    { ...ticket, id: 'done', rank: 3, actualStatus: 'done' as const, reportedProgress: 100 },
    { ...ticket, id: 'opportunity', rank: 4, reportedStatus: 'todo' as const, reportedProgress: 90, completedWork: 0 },
  ]
  return state
}

test('Judgement, Discipline and opportunity strength affect the sigmoid independently', () => {
  const state = scenario()
  const developer = state.developers[0]
  const candidates = [state.tickets[1], state.tickets[3]]
  const highJudgement = selectWork(candidates, developer, () => 0.5)!
  assert.equal(highJudgement.selectedId, 'opportunity')
  assert.ok(Math.abs(highJudgement.overrideProbability - 1 / (1 + Math.exp(-2.8))) < 1e-14)
  developer.judgement = 2; developer.discipline = 8
  const disciplined = selectWork(candidates, developer, () => 0.5)!
  assert.equal(disciplined.selectedId, 'manager')
  assert.ok(disciplined.overrideProbability < highJudgement.overrideProbability)
  candidates[1].reportedProgress = 11
  const marginal = selectWork(candidates, developer, () => 0.5)!
  assert.ok(marginal.overrideProbability < disciplined.overrideProbability)
})

test('conflicts consume exactly one draw and use strict less-than at the probability boundary', () => {
  const state = scenario()
  const candidates = [state.tickets[1], state.tickets[3]]
  // Independently force score = 0: 0.35*(0-0) + 4*(75-12.5)/100 - 2.5.
  state.developers[0].judgement = 0
  state.developers[0].discipline = 0
  candidates[0].reportedProgress = 12.5
  candidates[1].reportedProgress = 75
  const p = 0.5
  for (const [draw, id] of [[0, 'opportunity'], [p - Number.EPSILON, 'opportunity'], [p, 'manager'], [0.999999, 'manager']] as const) {
    let calls = 0
    const decision = selectWork(candidates, state.developers[0], () => { calls++; return draw })!
    assert.equal(decision.selectedId, id)
    assert.equal(decision.draw, draw)
    assert.equal(decision.overrideProbability, p)
    assert.equal(calls, 1)
  }
})

test('independent calibration scores verify all attribute/gap combinations and diagnostic outcomes', () => {
  // Scores calculated from the issue specification, independently of selectWork.
  for (const [judgement, discipline, managerProgress, opportunityProgress, expectedScore] of [
    [8, 2, 10, 90, 2.8], [8, 8, 10, 90, 0.7], [2, 8, 10, 90, -1.4],
    [8, 2, 50, 51, -0.36], [8, 8, 50, 51, -2.46], [2, 8, 50, 51, -4.56],
  ]) {
    const expectedProbability = 1 / (1 + Math.exp(-expectedScore))
    for (const [draw, selectedId] of [[expectedProbability / 2, 'opportunity'], [(1 + expectedProbability) / 2, 'manager']] as const) {
      const state = scenario()
      Object.assign(state.developers[0], { judgement, discipline })
      state.tickets[1].reportedProgress = managerProgress
      state.tickets[3].reportedProgress = opportunityProgress
      let calls = 0
      const result = advanceSimulation(state, 1, () => { calls++; return draw })
      assert.equal(calls, 1)
      const decision = getDiagnosticsView(result).developers[0].lastSelection!
      assert.ok(Math.abs(decision.overrideProbability - expectedProbability) < 1e-14)
      assert.equal(decision.draw, draw)
      assert.equal(decision.selectedId, selectedId)
      assert.equal(result.developers[0].activeTicketID, selectedId)
      assert.deepEqual(decision.managerChoice, { id: 'manager', rank: 2, reportedProgress: managerProgress })
      assert.deepEqual(decision.opportunity, { id: 'opportunity', rank: 4, reportedProgress: opportunityProgress })
    }
  }
})

test('switch replacements use the same independently calculated probability after a separate switch draw', () => {
  for (const draw of [0.1, 0.99]) {
    const state = scenario()
    Object.assign(state.tickets[0], { actualStatus: 'in_progress', reportedProgress: 100 })
    state.developers[0].activeTicketID = 'backlog'
    const values = [0.009, draw]
    let calls = 0
    const result = advanceSimulation(state, 1, () => values[calls++])
    const expectedProbability = 1 / (1 + Math.exp(-2.8))
    const expectedId = draw < expectedProbability ? 'opportunity' : 'manager'
    const decision = result.developers[0].lastSelection!
    assert.equal(calls, 2)
    assert.ok(Math.abs(decision.overrideProbability - expectedProbability) < 1e-14)
    assert.equal(decision.draw, draw)
    assert.equal(decision.selectedId, expectedId)
    assert.equal(result.developers[0].activeTicketID, expectedId)
    assert.equal(result.tickets[0].completedWork, state.tickets[0].completedWork)
  }
})

test('seeded idle and switch outcomes match independently advanced LCG draws and sigmoid', () => {
  const step = (seed: number) => (1664525 * seed + 1013904223) >>> 0
  for (const switching of [false, true]) {
    const state = scenario()
    state.randomState = switching ? 1972 : 1
    const first = step(state.randomState)
    if (switching) {
      assert.ok(first / 2 ** 32 < 0.01)
      state.tickets[0].actualStatus = 'in_progress'
      state.developers[0].activeTicketID = 'backlog'
    }
    const expectedSeed = switching ? step(first) : first
    const expectedDraw = expectedSeed / 2 ** 32
    const expectedId = expectedDraw < 1 / (1 + Math.exp(-2.8)) ? 'opportunity' : 'manager'
    const result = advanceSimulation(state, 1)
    assert.equal(result.randomState, expectedSeed)
    assert.equal(result.developers[0].lastSelection?.draw, expectedDraw)
    assert.equal(result.developers[0].lastSelection?.selectedId, expectedId)
    assert.deepEqual(result, advanceSimulation(structuredClone(state), 1))
  }
})

test('empty, single, tied-progress and agreeing candidates need no override draw', () => {
  const state = scenario()
  const noRoll = () => { throw new Error('Unexpected draw') }
  const developer = state.developers[0]
  assert.equal(selectWork([], developer, noRoll), undefined)
  const manager = state.tickets[1]
  const other = { ...state.tickets[3], reportedProgress: manager.reportedProgress }
  for (const candidates of [[manager], [other, manager], [{ ...manager, reportedProgress: 100 }, other]]) {
    const decision = selectWork(candidates, developer, noRoll)!
    assert.equal(decision.selectedId, 'manager')
    assert.equal(decision.draw, null)
    assert.equal(decision.overrideProbability, 0)
  }
})

test('global Rank governs either workflow stage regardless of storage and reported column', () => {
  for (const managerStatus of ['todo', 'in_progress'] as const) {
    const state = scenario()
    state.tickets[1].actualStatus = managerStatus
    state.tickets[1].reportedStatus = 'backlog'
    state.tickets[3].actualStatus = managerStatus === 'todo' ? 'in_progress' : 'todo'
    state.tickets.reverse()
    const result = advanceSimulation(state, 1, () => 0.99)
    assert.equal(result.developers[0].lastSelection?.managerChoice.id, 'manager')
    assert.equal(result.developers[0].activeTicketID, 'manager')
  }
})

test('large finite attributes remain stable and invalid values are rejected', () => {
  const state = scenario()
  const candidates = [state.tickets[1], state.tickets[3]]
  for (const [judgement, discipline, expected] of [[Number.MAX_VALUE, 0, 1], [0, Number.MAX_VALUE, 0], [Number.MAX_VALUE, Number.MAX_VALUE, 1 / (1 + Math.exp(-0.7))]]) {
    const decision = selectWork(candidates, { ...state.developers[0], judgement, discipline }, () => 0.5)!
    assert.ok(Math.abs(decision.overrideProbability - expected) < 1e-14)
  }
  for (const key of ['judgement', 'discipline'] as const) {
    for (const value of [-1, NaN, Infinity, -Infinity]) {
      state.developers[0][key] = value
      assert.throws(() => advanceSimulation(state, 1), RangeError)
    }
    state.developers[0][key] = 5
  }
})

test('eligibility is actual-state based across columns, while appraisal uses only normalized reports', () => {
  for (const progress of [90, 150, Infinity]) {
    const state = scenario()
    state.tickets[3].reportedProgress = progress
    state.tickets[3].completedWork = 0
    const before = structuredClone(state)
    const result = advanceSimulation(state, 1, () => 0)
    assert.equal(result.developers[0].activeTicketID, 'opportunity')
    assert.equal(result.developers[0].lastSelection?.managerChoice.rank, 2)
    assert.equal(result.developers[0].lastSelection?.opportunity.reportedProgress, Math.min(progress, 100))
    assert.deepEqual(state, before)
    const actualChanged = structuredClone(state)
    actualChanged.tickets[1].completedWork = 9
    assert.deepEqual(advanceSimulation(actualChanged, 1, () => 0).developers[0].lastSelection,
      result.developers[0].lastSelection)
  }
  const state = scenario()
  state.tickets[3].reportedProgress = NaN
  assert.equal(advanceSimulation(state, 1, () => { throw new Error('Unexpected draw') }).developers[0].activeTicketID, 'manager')
})

test('seeded conflict replay, claims, latest diagnostic snapshot and player exclusions', () => {
  const state = scenario()
  state.developers.push({ ...state.developers[0], id: 'other' })
  const result = advanceSimulation(state, 1)
  assert.equal(result.randomState, nextRandom(state.randomState).state)
  assert.deepEqual(result, advanceSimulation(state, 1))
  assert.notEqual(result.developers[0].activeTicketID, result.developers[1].activeTicketID)
  assert.deepEqual(advanceSimulation(JSON.parse(JSON.stringify(result)), 1), advanceSimulation(result, 1))
  const decision = structuredClone(result.developers[0].lastSelection)
  const continued = advanceSimulation(result, 1, () => 0.99)
  assert.deepEqual(continued.developers[0].lastSelection, decision)
  const diagnostic = getDiagnosticsView(continued)
  assert.deepEqual(diagnostic.developers[0].lastSelection, decision)
  assert.deepEqual(continued.developers[0].lastSelection, decision)
  for (const developer of getPlayerView(continued).developers) {
    for (const key of ['judgement', 'discipline', 'lastSelection']) assert.equal(key in developer, false)
  }
})
