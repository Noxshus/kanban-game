import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectSimulationActivity, filterDiagnosticActivity } from '../src/game/simulationActivity.ts'
import type { InternalActivity } from '../src/game/simulationActivity'
import { collectBoardActivity } from '../src/game/boardActivity.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { projectWork } from '../src/game/completionTime.ts'
import { workAmount } from '../src/game/work.ts'
import { boardReducer, createBoardSession, createDevelopmentBoardSession } from '../src/store/boardSession.ts'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { decisionFixture, setPublishedEstimate } from './helpers/decisionFixture.ts'

const defaults = { assessments: true, decisions: true, noopReviews: false }
function fixture(unknown = false) {
  const s = decisionFixture(), d = s.developers[0], t = s.tickets[0]
  d.focus = 0; d.competencies.frontend = 0; d.discipline = 0
  t.assignedDeveloperId = d.id
  setPublishedEstimate(t, d.id, 20)
  d.estimateDiscovery = { ticketId: t.id, requiredWork: 100, boardEstimate: 20, baseline: 20, judgement: 0, productive: true, target: workAmount(1) }
  if (unknown) {
    delete t.reportedEffortEstimate; delete t.initialEffortEstimate; delete t.estimateHistory
    delete d.estimateReview; delete d.estimateDiscovery
  }
  return s
}
function sequence(values: number[]) {
  let count = 0
  return { draw: () => { assert.ok(count < values.length, 'Unexpected RNG draw'); return values[count++] }, count: () => count }
}

test('failed reporting emits a DEV assessment and no player event, with no extra random draws', () => {
  const s = fixture(true), c = collectSimulationActivity(s.tickets)
  const random = sequence([.5, .9, .5]), direct = sequence([.5, .9, .5])
  const result = advanceSimulation(s, .01, random.draw, c.board.observe, c.internal)
  assert.deepEqual(result, advanceSimulation(s, .01, direct.draw))
  assert.equal(random.count(), direct.count())
  assert.deepEqual(c.board.events, [])
  assert.equal(c.diagnostics.length, 1)
  const event = c.diagnostics[0]
  assert.equal(event.kind, 'assessment')
  if (event.kind !== 'assessment') return assert.fail('Missing assessment')
  assert.deepEqual(event.at, { high: 0, low: 0 })
  assert.equal(event.developerId, 'a'); assert.equal(event.ticketId, 'current')
  assert.equal(event.reason, 'pickup'); assert.equal(event.candidate, 50)
  assert.equal(event.improved, true); assert.equal(event.published, false)
  assert.equal(event.probability, .5); assert.equal(event.draw, .9)
  assert.equal(event.boardBefore, null); assert.equal(event.boardAfter, null)
  assert.equal(result.tickets[0].initialEffortEstimate, undefined)
})

test('unpublished discovery precedes its actual stay/switch decision at the exact event instant', () => {
  for (const switches of [false, true]) {
    const s = fixture(), d = s.developers[0], t = s.tickets[0]
    if (switches) {
      const alternative = { ...t, id: 'other', title: 'Other', rank: 2, requiredWork: 1, actualStatus: 'todo' as const }
      setPublishedEstimate(alternative, 'earlier-author', 1); s.tickets.push(alternative)
    }
    const c = collectSimulationActivity(s.tickets), due = projectWork(d, t, workAmount(1)).seconds!
    const random = sequence(switches ? [.9, .9, .5] : [.9, .9, .999999]) // independent progress chance at discovery
    const result = advanceSimulation(s, due, random.draw, c.board.observe, c.internal)
    const internal = c.diagnostics.filter(e => e.kind !== 'reported')
    assert.deepEqual(internal.map(e => e.kind), ['assessment', 'decision'])
    const assessment = internal[0], decision = internal[1]
    assert.equal(assessment.kind === 'assessment' && assessment.reason, 'discovery')
    assert.equal(assessment.kind === 'assessment' && assessment.published, false)
    assert.equal(decision.kind === 'decision' && decision.decision.outcome, switches ? 'switch' : 'stay')
    assert.deepEqual(assessment.at, { high: due, low: 0 }); assert.deepEqual(decision.at, assessment.at)
    assert.equal(decision.ticketId, result.developers[0].activeTicketID)
    assert.ok(c.board.events.every(event => event.kind !== 'estimate'))
    assert.equal(result.tickets[0].reportedEffortEstimate, 20)
    assert.ok(assessment.id < decision.id)
    const withoutDecisions = filterDiagnosticActivity(c.diagnostics, { ...defaults, decisions: false })
    assert.ok(withoutDecisions.every(event => event.kind !== 'decision'))
    assert.ok(filterDiagnosticActivity(c.diagnostics, { ...defaults, assessments: false }).every(event => event.kind !== 'assessment'))
  }
})

test('successful publication has public-safe values and a distinct, ordered DEV report outcome', () => {
  const s = fixture(true), c = collectSimulationActivity(s.tickets)
  advanceSimulation(s, .01, sequence([.5, 0, .5, .999999]).draw, c.board.observe, c.internal)
  assert.deepEqual(c.diagnostics.map(event => event.kind), ['assessment', 'reported'])
  const report = c.board.events[0]
  assert.equal(report.id, 1); assert.equal(report.kind, 'estimate')
  assert.ok(!JSON.stringify(report).includes('candidate'))
  assert.ok(!JSON.stringify(report).includes('probability'))
  const first = c.diagnostics[0]
  assert.equal(first.kind === 'assessment' && first.published, true)
  assert.deepEqual(c.diagnostics[1].at, first.at)
})

test('proactive no-op reviews are captured, filterable and consume no reporting roll', () => {
  const s = fixture(), d = s.developers[0], t = s.tickets[0]
  setPublishedEstimate(t, d.id, 100); d.estimateDiscovery = undefined
  d.productivity = 0; d.estimateReview!.dueTime = { high: .5, low: 0 }
  const c = collectSimulationActivity(s.tickets), random = sequence([.5])
  const result = advanceSimulation(s, .5, random.draw, c.board.observe, c.internal)
  assert.equal(random.count(), 1) // The next review deadline, not a report roll.
  assert.equal(c.diagnostics.length, 1)
  const event = c.diagnostics[0]
  assert.equal(event.kind === 'assessment' && event.reason, 'review')
  assert.equal(event.kind === 'assessment' && event.improved, false)
  assert.equal(event.kind === 'assessment' && event.draw, null)
  assert.deepEqual(filterDiagnosticActivity(c.diagnostics, defaults), [])
  assert.deepEqual(filterDiagnosticActivity(c.diagnostics, { ...defaults, noopReviews: true }), c.diagnostics)
  assert.deepEqual(filterDiagnosticActivity(c.diagnostics, { ...defaults, assessments: false, noopReviews: true }), [])
  assert.equal(result.developers[0].lastAssessment, undefined)
  assert.deepEqual(c.board.events, [])
})

test('multiple evaluations inside one Step are retained instead of inferred from the last snapshot', () => {
  const s = fixture(), d = s.developers[0], t = s.tickets[0]
  d.productivity = 100; t.requiredWork = 10; setPublishedEstimate(t, d.id, 1)
  delete d.estimateDiscovery; d.estimateReview!.dueTime = { high: .01, low: 0 }
  const c = collectSimulationActivity(s.tickets)
  const result = advanceSimulation(s, 1, () => .1, c.board.observe, c.internal)
  const assessments = c.diagnostics.filter(event => event.kind === 'assessment')
  assert.ok(assessments.length > 1)
  assert.ok(assessments.some(event => event.at.high !== result.tickets[0].estimateHistory!.at(-1)!.at?.high))
  assert.equal(assessments.at(-1)!.kind === 'assessment' && assessments.at(-1)!.candidate, result.tickets[0].lastEstimateEvaluation!.candidate)
  assert.equal(assessments.filter(event => event.published).length, c.board.events.filter(event => event.kind === 'estimate').length)
  assert.deepEqual(result, advanceSimulation(s, 1, () => .1))
})

test('DEV and player sessions have identical gameplay and public IDs, including deferred priority events', () => {
  let player = createBoardSession(), dev = createDevelopmentBoardSession()
  const actions = [
    { type: 'reorderTodo', ticketId: 'ticket-5', targetId: 'ticket-2' },
    { type: 'togglePause' }, { type: 'tick' }, { type: 'tick' }, { type: 'togglePause' }, { type: 'step' },
  ] as const
  for (const action of actions) {
    player = boardReducer(player, action); dev = boardReducer(dev, action)
    assert.deepEqual(player.simulation, dev.simulation)
    assert.deepEqual(player.activity, dev.activity)
    assert.equal(player.nextActivityId, dev.nextActivityId)
    assert.equal(player.diagnosticActivity, undefined)
  }
  assert.ok(dev.diagnosticActivity!.some(event => event.kind === 'decision' && event.decision.trigger === 'priority' && event.at.high === 0))
  const saved = JSON.parse(JSON.stringify(dev))
  assert.deepEqual(boardReducer(saved, { type: 'step' }), boardReducer(dev, { type: 'step' }))
  assert.deepEqual(boardReducer(dev, { type: 'restart' }), createDevelopmentBoardSession())
  assert.deepEqual(boardReducer(player, { type: 'restart' }), createBoardSession())
})

test('seeded internal/public timelines preserve fractional partitions, JSON and engineer tie order', () => {
  for (const reverse of [false, true]) for (const seed of [1, 42, 999]) {
    const s = structuredClone(exampleGameState); s.randomState = seed
    if (reverse) s.developers.reverse()
    const c = collectSimulationActivity(s.tickets), whole = advanceSimulation(s, 15, undefined, c.board.observe, c.internal)
    const splitEvents = collectSimulationActivity(s.tickets)
    let split = s
    for (let i = 0; i < 15; i++) for (const dt of [.3, .3, .4]) split = JSON.parse(JSON.stringify(advanceSimulation(split, dt, undefined, splitEvents.board.observe, splitEvents.internal)))
    assert.deepEqual(splitEvents.diagnostics, c.diagnostics)
    assert.deepEqual(splitEvents.board.events, c.board.events)
    assert.equal(splitEvents.nextDiagnosticId, c.nextDiagnosticId)
    assert.equal(split.randomState, whole.randomState)
    assert.deepEqual(whole, advanceSimulation(s, 15))
    const publicOnly = collectBoardActivity(s.tickets)
    assert.deepEqual(whole, advanceSimulation(s, 15, undefined, publicOnly.observe))
    assert.deepEqual(publicOnly.events, c.board.events)
    assert.deepEqual(JSON.parse(JSON.stringify(c.diagnostics)), c.diagnostics)
  }
})

test('diagnostics are bounded and idle/zero-time/restored work does not invent repeated pickup assessments', () => {
  const s = fixture(true), c = collectSimulationActivity(s.tickets)
  assert.deepEqual(advanceSimulation(s, 0, () => { throw Error('No RNG') }, c.board.observe, c.internal), s)
  assert.deepEqual(c.diagnostics, [])
  const first = advanceSimulation(s, .01, sequence([.5, .9, .5]).draw, c.board.observe, c.internal)
  const resumed = collectSimulationActivity(first.tickets)
  advanceSimulation(JSON.parse(JSON.stringify(first)), .01, () => { throw Error('No repeat report') }, resumed.board.observe, resumed.internal)
  assert.deepEqual(resumed.diagnostics, [])
  const event = c.diagnostics[0] as InternalActivity
  for (let i = 0; i < 105; i++) c.internal(event)
  assert.equal(c.diagnostics.length, 100)
  assert.equal(c.diagnostics[0].id, 7)
  assert.equal(c.nextDiagnosticId, 107)
})

test('diagnostic callbacks receive copies and failed transitions discard internal history atomically', () => {
  const s = fixture(), due = projectWork(s.developers[0], s.tickets[0], workAmount(1)).seconds!
  const observed = advanceSimulation(s, due, () => .9, undefined, event => {
    Object.assign(event.at, { high: 1e200 })
    if (event.kind === 'decision') event.decision.considered.length = 0
  })
  assert.deepEqual(observed, advanceSimulation(s, due, () => .9))
  const session = createDevelopmentBoardSession(), g = session.simulation.game
  g.randomState = 2 // Keep the underflow reproduction after progress reporting adds a draw.
  g.tickets = g.tickets.slice(0, 2).map((t, i) => ({ ...t, completedWork: 0, requiredWork: i ? Number.MIN_VALUE : 100 }))
  g.developers = g.developers.slice(0, 2).map(d => ({ ...d, judgement: 0, discipline: 0, competencies: { frontend: 0, backend: 0 } }))
  const before = structuredClone(session)
  assert.throws(() => boardReducer(session, { type: 'step' }), /positive numeric range/)
  assert.deepEqual(session, before)
})
