import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GameState, TicketComplexity } from '../src/game/types.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { applySwitchLoss, beginWorkStint, switchLossFraction } from '../src/game/workLoss.ts'
import { accumulateWork, remainingWork, remainingWorkNumber, workAmount } from '../src/game/work.ts'
import { addWorkAmounts, effortNumber, subtractWorkAmounts } from '../src/game/workLog.ts'
import { getAverageFlowMultiplier, getFlowDuration } from '../src/game/flow.ts'
import { projectCompletion, projectWork } from '../src/game/completionTime.ts'
import { personalEffort, revisedEffort } from '../src/game/reestimation.ts'
import { selectWork } from '../src/game/selectWork.ts'
import { simulationReducer } from '../src/store/simulationControls.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { decisionFixture, decideNow, setPublishedEstimate } from './helpers/decisionFixture.ts'
import { estimatedFixture } from './helpers/estimatedFixture.ts'
import { close } from './helpers/flowExpectation.ts'
import { nextRandom } from '../src/game/random.ts'
import { exampleGameState } from '../src/data/exampleGameState.ts'

const noDraw = () => { throw Error('Switch loss must consume no RNG') }
const sizes = ['S', 'M', 'L', 'XL', 'XXL'] as const
const factors = [1, 1.5, 2, 3, 5]

function fixture(complexity: TicketComplexity = 'XL', competency = 10): GameState {
  const s = decisionFixture(), d = s.developers[0], t = s.tickets[0]
  d.focus = 0; d.competencies.frontend = competency
  t.complexity = complexity; t.requiredWork = 1000; t.completedWork = 40
  s.tickets.push(...['left', 'right'].map((id, i) => ({ ...t, id, rank: i + 2, complexity: 'S' as const,
    actualStatus: 'todo' as const, reportedStatus: 'todo' as const, completedWork: 0, reportedProgress: 99.9 })))
  return estimatedFixture(s)
}

function addWork(s: GameState, quantity: number) {
  const d = s.developers[0], t = s.tickets.find(t => t.id === d.activeTicketID)!
  return advanceSimulation(s, projectWork(d, t, workAmount(quantity), getFlowDuration(d, t.id)).seconds!, noDraw)
}

function choose(s: GameState, ticketId: string) {
  const prepared = structuredClone(s)
  // Controlled reports force a deterministic event decision, without changing its scoring.
  prepared.tickets.forEach(t => { t.reportedProgress = t.id === ticketId ? 100 : 0 })
  // Reporting/review scheduling has its own controlled draws; isolate the saved
  // next review from the work-loss arithmetic being measured here.
  const result = decideNow(prepared, () => .5)
  for (const d of result.developers) if(d.activeTicketID) d.estimateReview={ticketId:d.activeTicketID,dueTime:{high:1e308,low:0}}
  return result
}

function gross(s: GameState, ticketId = 'current', developerId = 'a') {
  return effortNumber(s.workLog!.find(e => e.ticketId === ticketId && e.developerId === developerId)!.effort)!
}

test('every complexity and uncapped domain competency use exactly the approved loss fraction', () => {
  for (const [i, complexity] of sizes.entries()) for (const c of [0, 5, 10, 100, 1e6, Number.MAX_VALUE]) {
    const s = fixture(complexity, c), d = s.developers[0], t = s.tickets[0]
    assert.equal(switchLossFraction(d, t), (1 - 1 / factors[i]) / (1 + c / 5))
    assert.ok(switchLossFraction(d, t) >= 0 && switchLossFraction(d, t) < 1)
    if (c > 0 && complexity !== 'S') assert.ok(switchLossFraction(d, t) < switchLossFraction({ ...d, competencies: { ...d.competencies, frontend: 0 } }, t))
    t.workDomain = 'backend'
    assert.equal(switchLossFraction(d, t), (1 - 1 / factors[i]) / 3)
  }
})

test('an actual switch loses only current-stint progress, preserves earlier work and resets Flow independently', () => {
  for (const [i, complexity] of sizes.entries()) for (const c of [0, 5, 10, 100, 1e6]) {
    const before = addWork(fixture(complexity, c), 30), original = structuredClone(before)
    const switched = choose(before, 'right')
    const expected = 40 + 30 * (1 - (1 - 1 / factors[i]) / (1 + c / 5))
    close(switched.tickets[0].completedWork, expected)
    assert.ok(switched.tickets[0].completedWork >= 40)
    close(gross(switched), 30)
    assert.deepEqual(switched.workLog, before.workLog)
    assert.deepEqual(switched.tickets[0].estimateHistory, before.tickets[0].estimateHistory)
    assert.equal(switched.developers[0].activeTicketID, 'right')
    assert.equal(switched.developers[0].flowStreak!.duration, 0)
    assert.equal(switched.developers[0].workStint!.ticketId, 'right')
    assert.deepEqual(before, original)
    if (complexity === 'S') assert.equal(switched.tickets[0].completedWork, before.tickets[0].completedWork)
  }
})

test('Option B selects with the unchanged perceived-time score and applies the consequence afterward only', () => {
  const before = addWork(fixture(), 30)
  before.tickets.forEach(t => { t.reportedProgress = t.id === 'right' ? 100 : 0 })
  const d = before.developers[0]
  const decision = selectWork(before.tickets, d, noDraw, 'priority', { high: before.simulationTime, low: before.simulationTimeRemainder ?? 0 }, before.tickets[0])
  const result = decideNow(before, () => .5)
  assert.deepEqual(result.developers[0].lastAssessment, decision)
  assert.equal(decision!.selectedId, 'right')
  close(result.tickets[0].completedWork, 40 + 30 * 7 / 9)
  assert.equal(result.tickets[0].reportedProgress, 0)
  assert.equal(result.tickets[0].reportedEffortEstimate, before.tickets[0].reportedEffortEstimate)
  assert.equal(result.tickets[0].assignedDeveloperId, before.tickets[0].assignedDeveloperId)
  assert.equal(result.tickets[0].actualStatus, 'in_progress')
  assert.equal(result.randomState, before.randomState)
})

test('returns start a new vulnerable stint and cannot erase retained contributions from earlier stints', () => {
  let s = addWork(fixture('XXL', 0), 30)
  s = choose(s, 'right')
  close(s.tickets[0].completedWork, 46)
  for (let i = 0; i < 3; i++) {
    s = choose(s, 'current')
    close(effortNumber(s.developers[0].workStint!.effortOrigin)!, 30 + 5 * i)
    const protectedProgress = s.tickets[0].completedWork
    s = addWork(s, 5)
    s = choose(s, 'right')
    close(s.tickets[0].completedWork, protectedProgress + 1)
    close(gross(s), 35 + 5 * i)
  }
  assert.ok(s.tickets[0].completedWork >= 46)
})

test('a handoff protects the first engineer contributions, while ownership and active claims remain distinct', () => {
  let s = addWork(fixture('XXL', 0), 30)
  s = choose(s, 'right')
  const a = s.developers[0]
  s.developers = [{ ...a, id: 'b', activeTicketID: undefined, flowStreak: undefined, workSession: undefined, workStint: undefined }]
  for (const t of s.tickets) {
    setPublishedEstimate(t, 'b')
    t.estimateHistory!.at(-1)!.at = { high: s.simulationTime, low: s.simulationTimeRemainder ?? 0 }
  }
  s = choose(s, 'current')
  assert.equal(s.tickets[0].assignedDeveloperId, 'b')
  s = addWork(s, 10)
  s.tickets[0].assignedDeveloperId = 'owner-without-active-work'
  s = choose(s, 'left')
  close(s.tickets[0].completedWork, 48)
  close(gross(s, 'current', 'a'), 30)
  close(gross(s, 'current', 'b'), 10)
  assert.equal(s.tickets[0].assignedDeveloperId, 'owner-without-active-work')
})

test('numerical cache refreshes and rate changes never restart the gameplay stint or apply loss', () => {
  for (const edit of ['refresh', 'productivity', 'focus', 'competency', 'complexity'] as const) {
    let s = addWork(fixture(), 30)
    const origin = structuredClone(s.developers[0].workStint), before = s.tickets[0].completedWork
    if (edit === 'refresh') delete s.developers[0].workSession
    if (edit === 'productivity') s.developers[0].productivity = 2
    if (edit === 'focus') s.developers[0].focus = 100
    if (edit === 'competency') s.developers[0].competencies.frontend = 5
    if (edit === 'complexity') s.tickets[0].complexity = 'M'
    s = addWork(s, 2)
    assert.deepEqual(s.developers[0].workStint, origin)
    close(s.tickets[0].completedWork, before + 2)
    const fraction = switchLossFraction(s.developers[0], s.tickets[0])
    const result = choose(s, 'right')
    close(result.tickets[0].completedWork, 40 + 32 * (1 - fraction))
    close(gross(result), 32)
  }
})

test('stays, no-op ranking, pause/resume and zero time preserve useful progress, Flow and the stint', () => {
  const s = addWork(fixture(), 30), stayed = choose(s, 'current')
  assert.equal(stayed.developers[0].lastAssessment!.outcome, 'stay')
  assert.deepEqual(stayed.developers[0].workStint, s.developers[0].workStint)
  assert.deepEqual(stayed.developers[0].flowStreak, s.developers[0].flowStreak)
  assert.equal(stayed.tickets[0].completedWork, s.tickets[0].completedWork)
  const session = { game: s, isPaused: true }
  assert.strictEqual(simulationReducer(session, { type: 'reorderTodo', ticketId: 'left', targetId: 'right' }), session)
  assert.deepEqual(simulationReducer(session, { type: 'togglePause' }).game, s)
  assert.deepEqual(advanceSimulation(s, 0, noDraw), s)
})

test('paused Rank edits defer loss until Resume or Step, and apply it once before productive work', () => {
  const s = addWork(fixture(), 30), initial = { game: s, isPaused: true }
  const pending = simulationReducer(initial, { type: 'reorderTodo', ticketId: 'right', targetId: 'left' })
  assert.equal(pending.game.tickets[0].completedWork, s.tickets[0].completedWork)
  assert.deepEqual(pending.game.developers, s.developers)
  assert.deepEqual(pending.game.workLog, s.workLog)
  const resumed = simulationReducer(JSON.parse(JSON.stringify(pending)), { type: 'togglePause' })
  assert.equal(resumed.game.developers[0].activeTicketID, 'right')
  close(resumed.game.tickets[0].completedWork, 40 + 30 * 7 / 9)
  close(resumed.game.tickets[0].reportedProgress, 100 * gross(s) / s.tickets[0].reportedEffortEstimate!) // Departure successfully reports gross effort, before loss.
  assert.equal(resumed.game.simulationTime, s.simulationTime)
  assert.deepEqual(resumed.game.workLog, s.workLog)
  const stepped = simulationReducer(pending, { type: 'step' })
  assert.deepEqual(stepped.game, advanceSimulation(resumed.game, 1))
  assert.equal(stepped.game.tickets[0].completedWork, resumed.game.tickets[0].completedWork)
  const paused = simulationReducer(resumed, { type: 'togglePause' })
  assert.deepEqual(simulationReducer(paused, { type: 'togglePause' }).game, resumed.game)
})

test('seed-1 XL manual QA switches Alex only on Step, preserving gross contribution with an independent departure report', () => {
  const game = structuredClone(exampleGameState)
  game.tickets[0].complexity = 'XL'
  estimatedFixture(game) // isolate loss from the new fallible estimate reporting stream
  const first = simulationReducer({ game, isPaused: true }, { type: 'step' })
  assert.equal(first.game.developers[0].activeTicketID, 'ticket-1')
  const pending = simulationReducer(first, { type: 'reorderTodo', ticketId: 'ticket-4', targetId: 'ticket-3' })
  assert.equal(pending.game.tickets[0].completedWork, first.game.tickets[0].completedWork)
  const result = simulationReducer(pending, { type: 'step' })
  assert.equal(result.game.developers[0].activeTicketID, 'ticket-3')
  const contribution = gross(first.game, 'ticket-1', 'developer-1')
  close(result.game.tickets[0].completedWork, 4 + contribution * 7 / 9)
  close(result.game.tickets[0].reportedProgress, 100 * contribution / first.game.tickets[0].reportedEffortEstimate!)
  assert.deepEqual(result.game.workLog!.find(e => e.ticketId === 'ticket-1'), first.game.workLog!.find(e => e.ticketId === 'ticket-1'))
  assert.equal(result.game.simulationTime, 2)
})

test('gross experience, published estimates, lifetime alarm and parked discovery targets survive rollback and return', () => {
  let s = fixture('XXL', 0), t = s.tickets[0], d = s.developers[0]
  t.initialEffortEstimate!.totalWork = 100; t.reportedEffortEstimate = 100; t.estimateHistory![0].totalWork = 100
  t.overrunEvaluationConsumed = true
  d.estimateDiscovery = { ticketId: t.id, requiredWork: 1000, boardEstimate: 100, judgement: 0,
    productive: true, baseline: 100, target: workAmount(100) }
  s = addWork(s, 30)
  const target = structuredClone(s.developers[0].estimateDiscovery), publications = structuredClone(s.tickets[0].estimateHistory)
  const experienced = structuredClone(personalEffort(s, s.developers[0], s.tickets[0]))
  const candidate = revisedEffort(1000, 100, experienced, 0, 0)
  s = choose(s, 'right')
  assert.deepEqual(s.developers[0].pausedEstimateDiscoveries!.find(p => p.ticketId === 'current'), target)
  assert.equal(revisedEffort(1000, 100, personalEffort(s, s.developers[0], s.tickets[0]), 0, 0), candidate)
  s = choose(JSON.parse(JSON.stringify(s)), 'current')
  assert.deepEqual(s.developers[0].estimateDiscovery, target)
  assert.deepEqual(s.tickets[0].estimateHistory, publications)
  assert.deepEqual(personalEffort(s, s.developers[0], s.tickets[0]), experienced)
  assert.equal(s.tickets[0].overrunEvaluationConsumed, true)
  assert.equal(s.tickets[0].estimateHistory!.at(-1)!.kind, 'publication')
})

test('completion and natural next-work pickup never roll back completed useful work', () => {
  const s = fixture('XXL', 0), d = s.developers[0], t = s.tickets[0]
  const due = projectCompletion(d, t, true).seconds!
  const half = advanceSimulation(s, due / 2, noDraw)
  const result = advanceSimulation(half, due / 2, () => .5)
  assert.equal(result.tickets[0].completedWork, 1000)
  assert.equal(result.tickets[0].actualStatus, 'done')
  close(gross(result), 960)
  assert.notEqual(result.developers[0].activeTicketID, 'current')
  assert.equal(result.developers[0].flowStreak!.duration, 0)
  assert.equal(result.developers[0].workStint!.ticketId, result.developers[0].activeTicketID)
})

test('legacy active saves protect all unknown prior-stint work and start tracking from restoration', () => {
  const s = addWork(fixture('XXL', 0), 30)
  delete s.developers[0].workStint
  const immediate = choose(s, 'right')
  assert.equal(immediate.tickets[0].completedWork, s.tickets[0].completedWork)
  const continued = addWork(JSON.parse(JSON.stringify(s)), 10)
  const result = choose(continued, 'right')
  close(result.tickets[0].completedWork, s.tickets[0].completedWork + 2)
  close(gross(result), 40)
  assert.ok(!('workStint' in getPlayerView(result).developers[0]))
})

function revisionScenario() {
  const s = fixture('XXL', 0), d = s.developers[0], t = s.tickets[0]
  t.initialEffortEstimate!.totalWork = 40; t.reportedEffortEstimate = 40; t.estimateHistory![0].totalWork = 40
  t.overrunEvaluationConsumed = true
  d.estimateDiscovery = { ticketId: t.id, requiredWork: 1000, boardEstimate: 40, judgement: 0,
    productive: true, baseline: 40, target: workAmount(10) }
  return s
}

test('a real revision switches at its event boundary, preserving publications, RNG and attribution across partitions', () => {
  const s = revisionScenario(), original = structuredClone(s)
  const due = projectWork(s.developers[0], s.tickets[0], workAmount(10)).seconds!
  const boundary = advanceSimulation(s, due)
  assert.equal(boundary.developers[0].lastAssessment!.trigger, 'estimate_revision')
  assert.notEqual(boundary.developers[0].activeTicketID, 'current')
  close(boundary.tickets[0].completedWork, 42)
  close(gross(boundary), 10)
  close(boundary.tickets[0].reportedProgress, 100 * gross(boundary) / boundary.tickets[0].reportedEffortEstimate!)
  assert.equal(boundary.workLog!.length, 1)
  const whole = advanceSimulation(s, due + 0.25)
  let split = s
  for (const dt of [0.3, 0.3, 0.3]) split = JSON.parse(JSON.stringify(advanceSimulation(split, dt)))
  split = advanceSimulation(split, due + 0.25 - 0.9)
  assert.equal(split.randomState, whole.randomState)
  assert.deepEqual(split.developers.map(d => [d.activeTicketID, d.lastAssessment, d.workStint]), whole.developers.map(d => [d.activeTicketID, d.lastAssessment, d.workStint]))
  assert.deepEqual(split.tickets.map(t => [t.actualStatus, t.estimateHistory]), whole.tickets.map(t => [t.actualStatus, t.estimateHistory]))
  split.tickets.forEach((t, i) => close(t.completedWork, whole.tickets[i].completedWork))
  split.workLog!.forEach((e, i) => close(effortNumber(e.effort)!, effortNumber(whole.workLog![i].effort)!))
  assert.deepEqual(whole, advanceSimulation(s, due + 0.25))
  assert.deepEqual(advanceSimulation(JSON.parse(JSON.stringify(boundary)), 1), advanceSimulation(boundary, 1))
  assert.deepEqual(s, original)
})

test('simultaneous completion and loss-producing revision preserve engineer order and exclusive new claims', () => {
  for (const reverse of [false, true]) {
    const s = revisionScenario(), d = s.developers[0]
    s.developers.push({ ...d, id: 'finishing', activeTicketID: 'finish', estimateDiscovery: undefined, estimateReview:{ticketId:'finish',dueTime:{high:1e308,low:0}} })
    s.tickets.push({ ...s.tickets[0], id: 'finish', rank: 4, requiredWork: 10, completedWork: 0,
      reportedEffortEstimate: 10, initialEffortEstimate: { developerId: 'finishing', totalWork: 10 }, estimateHistory: [],
      overrunEvaluationConsumed: false })
    setPublishedEstimate(s.tickets[3], 'finishing', 10)
    if (reverse) s.developers.reverse()
    const due = projectWork(d, s.tickets[0], workAmount(10)).seconds!
    const r = advanceSimulation(s, due, () => .5)
    assert.deepEqual(r.developers.map(e => e.activeTicketID), ['left', 'right'])
    assert.equal(new Set(r.developers.map(e => e.activeTicketID)).size, 2)
    close(r.tickets[0].completedWork, 42)
    assert.equal(r.tickets[3].completedWork, 10)
    assert.equal(r.tickets[3].actualStatus, 'done')
    assert.equal(r.tickets[3].lastEstimateEvaluation!.reason, 'completion')
    assert.equal(r.tickets[3].lastEstimateEvaluation!.published, false)
    assert.equal(r.workLog!.length, 2)
    close(gross(r), 10)
    close(gross(r, 'finish', 'finishing'), 10)
    const whole = advanceSimulation(s, due + 0.25, () => .5)
    let split = s
    for (const dt of [0.3, 0.3, 0.4]) split = JSON.parse(JSON.stringify(advanceSimulation(split, dt, () => .5)))
    split = advanceSimulation(split, due + 0.25 - 1, () => .5)
    assert.deepEqual(split.developers.map(e => [e.activeTicketID, e.lastAssessment, e.workStint]), whole.developers.map(e => [e.activeTicketID, e.lastAssessment, e.workStint]))
    assert.equal(split.randomState, whole.randomState)
  }
})

test('seeded mixed-complexity team runs preserve loss, decisions, histories and gross effort across fractional saves', () => {
  for (const seed of [1, 27, 42, 454327756]) {
    const s = structuredClone(exampleGameState)
    s.randomState = seed
    s.tickets.forEach((t, i) => { t.complexity = sizes[(i + 2) % sizes.length] })
    const before = structuredClone(s), whole = advanceSimulation(s, 100)
    let split = s
    for (let second = 0; second < 100; second++) {
      for (const dt of [0.3, 0.3, 0.4]) split = JSON.parse(JSON.stringify(advanceSimulation(split, dt)))
      const claims = split.developers.flatMap(d => d.activeTicketID ? [d.activeTicketID] : [])
      assert.equal(new Set(claims).size, claims.length)
      assert.ok(split.tickets.every(t => Number.isFinite(t.completedWork) && t.completedWork >= 0))
    }
    assert.equal(split.randomState, whole.randomState)
    assert.deepEqual(split.developers.map(d => [d.activeTicketID, d.lastAssessment, d.workStint]), whole.developers.map(d => [d.activeTicketID, d.lastAssessment, d.workStint]))
    assert.deepEqual(split.tickets.map(t => [t.actualStatus, t.estimateHistory, t.reportedEffortEstimate]), whole.tickets.map(t => [t.actualStatus, t.estimateHistory, t.reportedEffortEstimate]))
    split.tickets.forEach((t, i) => close(t.completedWork, whole.tickets[i].completedWork))
    assert.deepEqual(split.workLog!.map(e => [e.developerId, e.ticketId]), whole.workLog!.map(e => [e.developerId, e.ticketId]))
    split.workLog!.forEach((e, i) => close(effortNumber(e.effort)!, effortNumber(whole.workLog![i].effort)!))
    assert.deepEqual(s, before)
  }
})

test('scaled rollback retains work hidden by a large displayed total; unsupported precision fails explicitly', () => {
  const s = fixture('XXL', 0), d = s.developers[0], t = s.tickets[0]
  t.requiredWork = 1e20; t.completedWork = 1e20 - 16384
  estimatedFixture(s); d.productivity = 1000
  const progressed = advanceSimulation(s, 1, noDraw)
  assert.equal(progressed.tickets[0].completedWork, t.completedWork)
  const produced = gross(progressed), before = remainingWorkNumber(progressed.tickets[0])!
  const switched = choose(progressed, 'right')
  close(remainingWorkNumber(switched.tickets[0])!, before + produced * 0.8)
  assert.deepEqual(switched.workLog, progressed.workLog)
  const extreme = addWork(fixture('XXL'), 30)
  extreme.developers[0].competencies.frontend = Number.MAX_VALUE
  const original = structuredClone(extreme)
  assert.throws(() => choose(extreme, 'right'), /numeric (precision|resolution)/)
  assert.deepEqual(extreme, original)
})

test('unrepresentable subnormal compensation fails explicitly across equivalent partitions and JSON saves', () => {
  const s = fixture('XXL', 0), d = s.developers[0], t = s.tickets[0]
  t.requiredWork = Number.MIN_VALUE; t.completedWork = 0; d.productivity = Number.MIN_VALUE
  s.tickets = [t]; estimatedFixture(s)
  const first = advanceSimulation(s, 1, noDraw)
  const original = structuredClone(first)
  let split = s
  for (const dt of [0.3, 0.3, 0.4]) split = JSON.parse(JSON.stringify(advanceSimulation(split, dt, noDraw)))
  assert.deepEqual(split, first)
  assert.ok(first.workLog![0].effort.exponent < -1074)
  for (const state of [first, split, JSON.parse(JSON.stringify(first))]) {
    assert.throws(() => { const cloned = structuredClone(state); applySwitchLoss(cloned, cloned.developers[0], cloned.tickets[0]) }, /compensation range/)
  }
  assert.deepEqual(first, original)
  const invalid = fixture()
  beginWorkStint(invalid, invalid.developers[0], invalid.tickets[0])
  invalid.developers[0].workStint!.effortOrigin.mantissa = NaN
  assert.throws(() => advanceSimulation(invalid, 1), RangeError)
  assert.ok(remainingWork(t).mantissa > 0)
})

test('ordinary normalization boundaries and large finite base work roll back without a balancing cap', () => {
  for (const size of ['M', 'L', 'XL', 'XXL'] as const) for (const quantity of [0.24999999999999997, 1 - Number.EPSILON / 2, 1e-12]) {
    const s = addWork(fixture(size, 0), quantity)
    const r = choose(s, 'right')
    const expected = 40 + gross(s) * (1 - switchLossFraction(s.developers[0], s.tickets[0]))
    close(r.tickets[0].completedWork, expected)
    assert.ok(r.tickets[0].completedWork >= 40)
    assert.deepEqual(r.workLog, s.workLog)
  }
  const s = fixture('XXL', 0)
  s.tickets[0].requiredWork = 1e308; s.tickets[0].completedWork = 4e307
  estimatedFixture(s); s.developers[0].productivity = 1e307
  const first = advanceSimulation(s, 1, noDraw), switched = choose(first, 'right')
  const expected = 4e307 + gross(first) * 0.2
  assert.ok(Math.abs(switched.tickets[0].completedWork / expected - 1) < 1e-14)
  assert.ok(Number.isFinite(switched.tickets[0].completedWork))
  assert.deepEqual(switched.workLog, first.workLog)
})

test('holding a ticket without productive work creates no vulnerable effort', () => {
  const s = fixture('XXL', 0)
  s.developers[0].productivity = 0
  const held = advanceSimulation(s, 100, noDraw)
  assert.equal(held.workLog, undefined)
  assert.equal(choose(held, 'right').tickets[0].completedWork, 40)
})

for (const protectedWork of [40, 100]) {
  test(`review regression: 1e18 required work with ${protectedWork} protected units loses exactly 24 of 30 stint units`, () => {
    const s = fixture('XXL', 0)
    s.tickets[0].requiredWork = 1e18
    s.tickets[0].completedWork = protectedWork
    estimatedFixture(s)
    const progressed = addWork(s, 30)
    assert.equal(progressed.tickets[0].completedWork, protectedWork + 30)
    for (const restored of [progressed, JSON.parse(JSON.stringify(progressed))]) {
      const session = { game: restored, isPaused: false }
      const result = simulationReducer(session, { type: 'reorderTodo', ticketId: 'right', targetId: 'left' }).game
      assert.equal(result.developers[0].activeTicketID, 'right')
      assert.equal(result.tickets[0].completedWork, protectedWork + 6)
      assert.ok(result.tickets[0].completedWork <= restored.tickets[0].completedWork)
      assert.equal(result.tickets[0].requiredWork, 1e18)
      assert.deepEqual(remainingWork(result.tickets[0]), addWorkAmounts(remainingWork(restored.tickets[0]), workAmount(24)))
      assert.equal(result.randomState, nextRandom(nextRandom(nextRandom(restored.randomState).state).state).state) // departure/pickup progress, new-ticket review
      assert.deepEqual(result.workLog, restored.workLog)
      assert.deepEqual(result.tickets[0].estimateHistory, restored.tickets[0].estimateHistory)
      assert.deepEqual(result.developers[0].pausedEstimateDiscoveries!.find(e => e.ticketId === 'current'), restored.developers[0].estimateDiscovery)
      assert.deepEqual(advanceSimulation(result, 0, noDraw), JSON.parse(JSON.stringify(result)))
      const returned = choose(result, 'current')
      const continued = addWork(returned, 4)
      assert.equal(continued.tickets[0].completedWork, protectedWork + 10)
      close(gross(continued), 34)
      close(effortNumber(subtractWorkAmounts(remainingWork(returned.tickets[0]), remainingWork(continued.tickets[0])))!, 4)
      assert.deepEqual(continued.tickets[0].estimateHistory, returned.tickets[0].estimateHistory)
      assert.deepEqual(advanceSimulation(JSON.parse(JSON.stringify(continued)), 1, noDraw), advanceSimulation(continued, 1, noDraw))
    }
  })
}

test('review large-requirement running Rank switches match fractional partitions and saved compensated progress', () => {
  for (const protectedWork of [40, 100]) {
    const s = fixture('XXL', 0)
    s.tickets[0].requiredWork = 1e18; s.tickets[0].completedWork = protectedWork
    estimatedFixture(s)
    // An exactly shared action timestamp matters for external Rank decisions.
    // Produce 30 units at t=200; 0.3+0.3+0.4+199 reaches that SAME compensated instant.
    const due = 200
    s.developers[0].productivity = 30 / (0.1 * due * getAverageFlowMultiplier(0, due, 0))
    const whole = advanceSimulation(s, due, noDraw)
    let split = s
    for (const dt of [0.3, 0.3, 0.4]) split = JSON.parse(JSON.stringify(advanceSimulation(split, dt, noDraw)))
    split = advanceSimulation(split, due - 1, noDraw)
    const action = { type: 'reorderTodo', ticketId: 'right', targetId: 'left' } as const
    const a = simulationReducer({ game: whole, isPaused: false }, action).game
    const b = simulationReducer({ game: split, isPaused: false }, action).game
    assert.equal(a.tickets[0].completedWork, protectedWork + 6)
    assert.equal(b.tickets[0].completedWork, protectedWork + 6)
    assert.deepEqual(b.tickets.map(t => [t.completedWork, t.workRemainder, t.estimateHistory]), a.tickets.map(t => [t.completedWork, t.workRemainder, t.estimateHistory]))
    assert.deepEqual(b.developers.map(d => [d.activeTicketID, d.lastAssessment, d.workStint]), a.developers.map(d => [d.activeTicketID, d.lastAssessment, d.workStint]))
    assert.deepEqual(b.workLog, a.workLog)
    assert.equal(b.randomState, a.randomState)
  }
})

test('rollback preserves positive and negative completed-work carry without increasing its displayed total', () => {
  for (const quantity of [100, 10000]) {
    const s = fixture('XXL', 0), initial = 1e20 - 32768
    s.tickets[0].requiredWork = 1e20; s.tickets[0].completedWork = initial
    estimatedFixture(s)
    const before = addWork(s, quantity)
    assert.equal(Math.sign(before.tickets[0].workRemainder!.roundingError), quantity === 100 ? -1 : 1)
    const after = choose(before, 'right')
    assert.ok(after.tickets[0].completedWork <= before.tickets[0].completedWork)
    const expectedRemaining = 32768 - gross(before) * 0.2
    close(remainingWorkNumber(after.tickets[0])!, expectedRemaining)
    const actualCompleted = after.tickets[0].completedWork - after.tickets[0].workRemainder!.roundingError
    const expectedCompleted = initial + gross(before) * 0.2
    assert.equal(actualCompleted, expectedCompleted)
    assert.deepEqual(after.workLog, before.workLog)
    const returned = choose(after, 'current'), continued = addWork(returned, 10)
    close(remainingWorkNumber(continued.tickets[0])!, expectedRemaining - 10)
  }
})

test('supported subnormal loss remains compensated through JSON, subsequent accumulation and completion', () => {
  const s = fixture('L', 0), unit = Number.MIN_VALUE
  s.tickets[0].requiredWork = 32 * unit; s.tickets[0].completedWork = 8 * unit
  estimatedFixture(s)
  s.workLog = [{ developerId: 'a', ticketId: 'current', effort: workAmount(2 * unit) }]
  s.developers[0].workStint = { ticketId: 'current', effortOrigin: workAmount(0) }
  const after = choose(JSON.parse(JSON.stringify(s)), 'right')
  assert.equal(after.tickets[0].completedWork, 7 * unit)
  assert.equal(remainingWorkNumber(after.tickets[0]), 25 * unit)
  assert.deepEqual(after.workLog, s.workLog)
  const accumulated = structuredClone(after.tickets[0])
  accumulateWork(accumulated, workAmount(unit))
  assert.equal(accumulated.completedWork, 8 * unit)
  assert.equal(remainingWorkNumber(accumulated), 24 * unit)
  const returned = choose(after, 'current')
  const due = projectCompletion(returned.developers[0], returned.tickets[0], true).seconds!
  const done = advanceSimulation(returned, due, () => .5)
  assert.equal(done.tickets[0].completedWork, 32 * unit)
  assert.equal(done.tickets[0].actualStatus, 'done')
  assert.equal(gross(done), 27 * unit)
})

test('unsupported rollback precision fails atomically even after temporary appraisal RNG draws', () => {
  const s = addWork(fixture('XXL'), 30)
  s.developers[0].competencies.frontend = Number.MAX_VALUE
  for (const t of s.tickets.slice(1)) {
    delete t.estimateHistory; delete t.initialEffortEstimate; delete t.reportedEffortEstimate
  }
  const original = structuredClone(s)
  for (const state of [s, JSON.parse(JSON.stringify(s))]) {
    assert.throws(() => simulationReducer({ game: state, isPaused: false }, {
      type: 'reorderTodo', ticketId: 'right', targetId: 'left',
    }), /numeric (precision|resolution)/)
    assert.deepEqual(state, original)
  }
})
