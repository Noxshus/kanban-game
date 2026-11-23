import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GameState, TicketComplexity } from '../src/game/types.ts'
import { COMPLEXITY_MULTIPLIERS, getComplexityMultiplier, getTicketComplexity } from '../src/game/complexity.ts'
import { getDomainModifier, getEffectiveProductivity, getWorkCompleted } from '../src/game/productivity.ts'
import { integratedWork, validWorkSession, workAmount } from '../src/game/work.ts'
import { projectCompletion, projectWork } from '../src/game/completionTime.ts'
import { getAverageFlowMultiplier } from '../src/game/flow.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { selectWork } from '../src/game/selectWork.ts'
import { effortNumber } from '../src/game/workLog.ts'
import { getDiagnosticsView } from '../src/store/diagnosticsView.ts'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { decisionFixture } from './helpers/decisionFixture.ts'
import { estimatedFixture } from './helpers/estimatedFixture.ts'
import { close } from './helpers/flowExpectation.ts'

const sizes = ['S', 'M', 'L', 'XL', 'XXL'] as const
const multipliers = [1, 1.5, 2, 3, 5]
const noDraw = () => { throw Error('Complexity must not consume RNG') }
function oneIdleSchedule() {
  let count = 0
  return { draw: () => { assert.equal(++count, 1, 'Only the new post-completion idle deadline may draw'); return .5 }, count: () => count }
}

// Equal base effort and seed; change technical difficulty or expertise independently.
function scenario(complexity: TicketComplexity = 'S', competency = 0, productivity = 1): GameState {
  const state = decisionFixture()
  Object.assign(state.developers[0], { productivity, focus: 0, competencies: { frontend: competency, backend: 100 } })
  state.tickets[0].complexity = complexity
  return estimatedFixture(state)
}

function compareOutcomes(a: GameState, b: GameState) {
  assert.equal(a.randomState, b.randomState)
  assert.deepEqual(a.developers.map(d => [d.id, d.activeTicketID, d.lastAssessment]), b.developers.map(d => [d.id, d.activeTicketID, d.lastAssessment]))
  assert.deepEqual(a.tickets.map(t => [t.id, t.actualStatus, t.assignedDeveloperId, t.estimateHistory]), b.tickets.map(t => [t.id, t.actualStatus, t.assignedDeveloperId, t.estimateHistory]))
  assert.deepEqual(a.workLog?.map(e => [e.developerId, e.ticketId]), b.workLog?.map(e => [e.developerId, e.ticketId]))
  a.tickets.forEach((t, i) => close(t.completedWork, b.tickets[i].completedWork))
  a.workLog?.forEach((e, i) => close(effortNumber(e.effort)!, effortNumber(b.workLog![i].effort)!))
}

test('complexity has exactly the approved five multipliers; missing means S and invalid labels fail explicitly', () => {
  assert.deepEqual(Object.keys(COMPLEXITY_MULTIPLIERS), sizes)
  sizes.forEach((complexity, i) => assert.equal(getComplexityMultiplier({ complexity }), multipliers[i]))
  assert.equal(getTicketComplexity({}), 'S')
  for (const value of ['XS', 's', '', 'toString', null, 2]) {
    const ticket = JSON.parse(JSON.stringify({ complexity: value }))
    assert.throws(() => getComplexityMultiplier(ticket), /Ticket complexity/)
  }
})

test('one unified rate covers novice through uncapped expertise and uses the relevant domain', () => {
  for (const complexity of sizes) for (const competency of [0, 0.1, 5, 10, 100, 1e6, Number.MAX_VALUE]) {
    const s = scenario(complexity, competency, 2), d = s.developers[0], t = s.tickets[0]
    const expected = 2 * (competency / 10 + 0.5 / multipliers[sizes.indexOf(complexity)])
    assert.equal(getEffectiveProductivity(d, t), expected)
    assert.ok(Number.isFinite(expected) && expected > 0)
    const backend = { ...t, workDomain: 'backend' as const }
    assert.equal(getDomainModifier(d, backend), 100 / 10 + 0.5 / getComplexityMultiplier(t))
    assert.equal(getWorkCompleted(d, t, 0.25), expected * 0.25)
  }
})

test('S and missing complexity exactly preserve the former modifier; competency mitigates the relative penalty', () => {
  for (const competency of [0, 5, 10, 100, 1e6, Number.MAX_VALUE]) {
    const s = scenario('S', competency), d = s.developers[0], t = s.tickets[0]
    assert.equal(getDomainModifier(d, t), 0.5 + competency / 10)
    delete t.complexity
    assert.equal(getDomainModifier(d, t), 0.5 + competency / 10)
  }
  for (const complexity of sizes.slice(1)) {
    const penalties = [0, 1, 5, 10, 100, 1e6].map(c => {
      const s = scenario(complexity, c), d = s.developers[0], t = s.tickets[0]
      return getDomainModifier(d, { ...t, complexity: 'S' }) / getDomainModifier(d, t)
    })
    close(penalties[0], getComplexityMultiplier({ complexity }))
    assert.ok(penalties.every((p, i) => i === 0 || p < penalties[i - 1]))
    assert.ok(penalties.at(-1)! < 1.00001)
  }
})

test('integrated Flow, execution, completion projection and DEV rates use the same complexity-adjusted rate', () => {
  for (const complexity of sizes) for (const focus of [0, 10, 100]) {
    const s = scenario(complexity, 5), d = s.developers[0], t = s.tickets[0]
    d.focus = focus
    d.flowStreak = { ticketId: t.id, duration: 18 }
    const original = structuredClone(s)
    const expected = (0.5 + 0.5 / getComplexityMultiplier(t)) * 2 * getAverageFlowMultiplier(18, 2, focus)
    close(effortNumber(integratedWork(d, t, 2, 18))!, expected)
    const progressed = advanceSimulation(s, 2, noDraw)
    close(progressed.tickets[0].completedWork, expected)
    close(effortNumber(progressed.workLog![0].effort)!, expected)
    const diagnostic = getDiagnosticsView(s)
    close(diagnostic.developers[0].workRate!, getEffectiveProductivity(d, t)! * diagnostic.developers[0].flowMultiplier)
    assert.equal(diagnostic.tickets[0].workRate, diagnostic.developers[0].workRate)
    const projection = projectCompletion(d, t, true)
    close(effortNumber(integratedWork(d, t, projection.seconds!, 18))!, t.requiredWork)
    const idle = oneIdleSchedule(), done = advanceSimulation(s, projection.seconds!, idle.draw)
    assert.equal(idle.count(), 1)
    assert.equal(done.tickets[0].actualStatus, 'done')
    assert.equal(done.tickets[0].completedWork, 100)
    assert.equal(effortNumber(done.workLog![0].effort), 100)
    assert.equal(done.developers[0].activeTicketID, undefined)
    assert.equal(done.developers[0].flowStreak, undefined)
    assert.deepEqual(done.tickets[0].estimateHistory, s.tickets[0].estimateHistory)
    assert.deepEqual(s, original)
  }
})

test('perceived decision times and actual completion economics agree when the report is accurate', () => {
  for (const complexity of sizes) {
    const s = scenario(complexity, 10), d = s.developers[0], t = s.tickets[0]
    t.completedWork = 40; t.reportedProgress = 40
    d.flowStreak = { ticketId: t.id, duration: 100 }
    const decision = selectWork(s.tickets, d, noDraw, 'priority', { high: 0, low: 0 }, t)!
    const actual = projectCompletion(d, t, true)
    assert.equal(decision.considered[0].perceivedRemaining, 60)
    close(decision.considered[0].completionSeconds!, actual.seconds!)
    const idle = oneIdleSchedule()
    assert.equal(advanceSimulation(s, actual.seconds!, idle.draw).tickets[0].actualStatus, 'done')
    assert.equal(idle.count(), 1)
  }
})

test('complexity influences work choice through time alone, and uncapped competency can make Rank decisive again', () => {
  const s = scenario('XXL'), d = s.developers[0]
  delete d.activeTicketID
  s.tickets[0].actualStatus = 'todo'
  s.tickets.push({ ...s.tickets[0], id: 'simple', rank: 2, complexity: 'S' })
  assert.equal(selectWork(s.tickets, d, noDraw)!.selectedId, 'simple')
  assert.equal(advanceSimulation(s, 0.1, () => .5).developers[0].activeTicketID, 'simple')
  d.competencies.frontend = 1e6
  assert.equal(selectWork(s.tickets, d, noDraw)!.selectedId, 'current')
})

test('changing complexity invalidates rate/deadline caches while retaining work, Flow, contributions and seeded discovery targets', () => {
  const state = scenario('S')
  state.tickets[0].initialEffortEstimate!.totalWork = 40
  state.tickets[0].reportedEffortEstimate = 40
  state.tickets[0].estimateHistory![0].totalWork = 40
  state.tickets[0].overrunEvaluationConsumed = false
  state.developers[0].estimateDiscovery = { ticketId: 'current', boardEstimate: 40, requiredWork: 100,
    judgement: 0, productive: true, baseline: 40, target: workAmount(5) }
  const first = advanceSimulation(state, 1, noDraw), d = first.developers[0], t = first.tickets[0]
  const original = structuredClone(first)
  const oldDeadline = projectCompletion(d, t, true).seconds!
  t.complexity = 'XXL'
  assert.equal(validWorkSession(d, t), undefined)
  assert.ok(projectCompletion(d, t, true).seconds! > oldDeadline)
  const fresh = structuredClone(first)
  delete fresh.developers[0].workSession
  const next = advanceSimulation(first, 0.3, noDraw)
  assert.deepEqual(next, advanceSimulation(fresh, 0.3, noDraw))
  assert.equal(next.developers[0].workSession!.complexity, 'XXL')
  assert.equal(next.developers[0].workSession!.initialFlowDuration, 1)
  close(next.developers[0].flowStreak!.duration, 1.3)
  const delta = effortNumber(integratedWork(d, t, 0.3, 1))!
  close(next.tickets[0].completedWork, original.tickets[0].completedWork + delta)
  close(effortNumber(next.workLog![0].effort)!, effortNumber(original.workLog![0].effort)! + delta)
  assert.deepEqual(next.developers[0].estimateDiscovery, original.developers[0].estimateDiscovery)
  assert.ok(next.developers[0].workSession!.estimateEvents!.discovery!.high > original.developers[0].workSession!.estimateEvents!.discovery!.high)
})

test('legacy S sessions retain their integration origin, cached deadlines and RNG through JSON restoration', () => {
  const s = advanceSimulation(scenario(), 0.3, noDraw)
  const legacy = structuredClone(s)
  delete legacy.tickets[0].complexity
  delete legacy.developers[0].workSession!.complexity
  const original = structuredClone(legacy)
  assert.ok(validWorkSession(legacy.developers[0], legacy.tickets[0]))
  const next = advanceSimulation(JSON.parse(JSON.stringify(legacy)), 0.7, noDraw)
  assert.deepEqual(next.developers[0].workSession!.originTime, legacy.developers[0].workSession!.originTime)
  assert.equal(next.developers[0].workSession!.elapsed, 1)
  const current = advanceSimulation(s, 0.7, noDraw)
  delete current.tickets[0].complexity
  delete current.developers[0].workSession!.complexity
  assert.deepEqual(next, current)
  assert.deepEqual(legacy, original)
})

test('complexity reprojects discovery and lifetime overrun deadlines without changing base-work learning or adding events', () => {
  for (const reason of ['discovery', 'overrun'] as const) for (const complexity of sizes) {
    const s = scenario(complexity), d = s.developers[0], t = s.tickets[0]
    t.initialEffortEstimate!.totalWork = 40
    t.reportedEffortEstimate = 40
    t.estimateHistory![0].totalWork = 40
    t.overrunEvaluationConsumed = reason === 'discovery'
    d.estimateDiscovery = { ticketId: t.id, boardEstimate: 40, requiredWork: 100, baseline: 40,
      judgement: 0, productive: true, target: reason === 'discovery' ? workAmount(5) : null }
    const due = projectWork(d, t, workAmount(reason === 'discovery' ? 5 : 40)).seconds!
    const boundary = advanceSimulation(s, due)
    assert.equal(boundary.tickets[0].lastEstimateEvaluation!.reason, reason)
    assert.deepEqual(boundary.tickets[0].estimateHistory!.at(-1)!.at, { high: due, low: 0 })
    assert.equal(boundary.tickets[0].estimateHistory!.filter(e => e.kind === 'assessment').length, 0)
    assert.equal(boundary.tickets[0].estimateHistory!.filter(e => e.kind === 'publication').length, 2)
    close(boundary.tickets[0].lastEstimateEvaluation!.personalWork!, reason === 'discovery' ? 5 : 40)
    close(boundary.tickets[0].reportedEffortEstimate!, 100 - 60 * (1 + (reason === 'discovery' ? 5 : 40) / 40) ** -0.3)
    const whole = advanceSimulation(s, due + 0.25)
    let split = s
    for (const dt of [0.3, 0.3, 0.3]) split = JSON.parse(JSON.stringify(advanceSimulation(split, dt)))
    split = advanceSimulation(split, due + 0.25 - 0.9)
    compareOutcomes(split, whole)
    assert.deepEqual(advanceSimulation(JSON.parse(JSON.stringify(boundary)), 0.01), advanceSimulation(boundary, 0.01))
  }
})

test('new and legacy tickets sample the same initial base-effort distribution, with no complexity draw', () => {
  let reference: GameState | undefined
  for (const complexity of sizes) {
    const s = decisionFixture()
    s.tickets[0].complexity = complexity
    delete s.tickets[0].estimateHistory
    delete s.tickets[0].initialEffortEstimate
    delete s.tickets[0].reportedEffortEstimate
    const result = advanceSimulation(s, 1e-6)
    reference ??= result
    assert.equal(result.randomState, reference.randomState)
    assert.deepEqual(result.tickets[0].initialEffortEstimate, reference.tickets[0].initialEffortEstimate)
    assert.deepEqual(result.tickets[0].estimateHistory, reference.tickets[0].estimateHistory)
    assert.equal(result.tickets[0].requiredWork, 100)
    assert.deepEqual(result.developers[0].estimateDiscovery, reference.developers[0].estimateDiscovery)
  }
})

test('scaled complexity rates preserve numeric extremes, subnormal productive work and fractional partitions', () => {
  for (const [work, rate] of [[Number.MIN_VALUE, Number.MIN_VALUE], [1e-300, 1e-301], [1e300, 1e299]]) {
    const s = scenario('XXL', 0, rate)
    s.tickets[0].requiredWork = work
    estimatedFixture(s)
    const original = structuredClone(s)
    const end = Math.ceil(projectCompletion(s.developers[0], s.tickets[0], true).seconds!) + 1
    const wholeIdle = oneIdleSchedule(), splitIdle = oneIdleSchedule()
    const whole = advanceSimulation(s, end, wholeIdle.draw)
    let split = s
    for (const dt of [0.3, 0.3, 0.4]) split = JSON.parse(JSON.stringify(advanceSimulation(split, dt, noDraw)))
    for (let i = 1; i < end; i++) split = JSON.parse(JSON.stringify(advanceSimulation(split, 1, splitIdle.draw)))
    assert.equal(wholeIdle.count(), 1); assert.equal(splitIdle.count(), 1)
    compareOutcomes(split, whole)
    assert.equal(whole.tickets[0].actualStatus, 'done')
    assert.equal(whole.tickets[0].completedWork, work)
    assert.equal(effortNumber(whole.workLog![0].effort), work)
    assert.deepEqual(s, original)
  }
  const overflow = scenario('XXL', 100, 1e308)
  assert.equal(getEffectiveProductivity(overflow.developers[0], overflow.tickets[0]), null)
  close(advanceSimulation(overflow, 1e-308, noDraw).tickets[0].completedWork, 10.1)
  const tiny = scenario('XXL', 0, Number.MIN_VALUE)
  tiny.tickets[0].requiredWork = Number.MIN_VALUE
  estimatedFixture(tiny)
  const first = advanceSimulation(tiny, 1, noDraw)
  assert.equal(first.tickets[0].actualStatus, 'in_progress')
  assert.ok(first.workLog![0].effort.exponent < -1074)
  assert.equal(getDiagnosticsView(first).developers[0].workRate, null)
  assert.deepEqual(advanceSimulation(tiny, 0, noDraw), tiny)
})

test('example committed tickets retain seed-1 behaviour and global ranks; legacy saves need no complexity migration', () => {
  const current = structuredClone(exampleGameState), legacy = structuredClone(current)
  legacy.tickets.forEach(t => { delete t.complexity })
  const stripComplexity = (state: GameState) => {
    const result = structuredClone(state)
    result.tickets.forEach(t => { delete t.complexity })
    result.developers.forEach(d => { if (d.workSession) delete d.workSession.complexity })
    return result
  }
  assert.deepEqual(stripComplexity(advanceSimulation(current, 50)), stripComplexity(advanceSimulation(legacy, 50)))
  assert.deepEqual(current.tickets.map(t => t.rank), [1, 2, 3, 4, 5, 6, 7])
  assert.ok(current.tickets.slice(0, 5).every(t => t.complexity === 'S'))
})

test('mixed-complexity multi-engineer runs retain seeded decisions, histories and exclusive claims across fractional saves', () => {
  for (const seed of [1, 42, 454327756]) {
    const state = structuredClone(exampleGameState)
    state.randomState = seed
    state.tickets.forEach((ticket, i) => { ticket.complexity = sizes[i % sizes.length] })
    const original = structuredClone(state)
    const whole = advanceSimulation(state, 100)
    let split = state
    for (let i = 0; i < 100; i++) {
      for (const dt of [0.3, 0.3, 0.4]) split = JSON.parse(JSON.stringify(advanceSimulation(split, dt)))
      const claims = split.developers.flatMap(d => d.activeTicketID ? [d.activeTicketID] : [])
      assert.equal(new Set(claims).size, claims.length)
    }
    compareOutcomes(split, whole)
    assert.deepEqual(state, original)
    assert.deepEqual(whole.tickets.slice(5), state.tickets.slice(5))
    assert.deepEqual(advanceSimulation(whole, 1), advanceSimulation(JSON.parse(JSON.stringify(whole)), 1))
  }
})

test('invalid complexity fails a pure transition without partial work, publications or RNG mutation', () => {
  const state = scenario()
  Object.assign(state.tickets[0], { complexity: 'invalid' })
  const before = structuredClone(state)
  assert.throws(() => advanceSimulation(state, 1, noDraw), /Ticket complexity/)
  assert.deepEqual(state, before)
})
