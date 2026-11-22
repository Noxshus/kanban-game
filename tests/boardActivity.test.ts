import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectBoardActivity, observeBoard } from '../src/game/boardActivity.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { projectWork } from '../src/game/completionTime.ts'
import { workAmount } from '../src/game/work.ts'
import { boardReducer, createBoardSession } from '../src/store/boardSession.ts'
import { simulationReducer } from '../src/store/simulationControls.ts'
import { decisionFixture, setPublishedEstimate } from './helpers/decisionFixture.ts'
import { exampleGameState } from '../src/data/exampleGameState.ts'

const noDraw = () => { throw Error('No RNG expected') }
function sequence(values: number[]) {
  let count = 0
  return { draw: () => { assert.ok(count < values.length, 'Unexpected RNG draw'); return values[count++] }, count: () => count }
}
function chain() {
  const s = decisionFixture(), d = s.developers[0], t = s.tickets[0]
  d.focus = 0; d.competencies.frontend = 5
  t.requiredWork = .1; t.reportedStatus = 'todo'
  setPublishedEstimate(t, d.id)
  s.tickets.push({ ...t, id: 'second', title: 'Second', rank: 2, actualStatus: 'todo', assignedDeveloperId: undefined })
  return s
}

test('collector is initially silent, deduplicates reports and exposes only public changes', () => {
  const s = decisionFixture(), t = s.tickets[0], c = collectBoardActivity(s.tickets)
  observeBoard(c.observe, t, { high: 0, low: 0 })
  assert.deepEqual(c.events, [])
  t.completedWork = 10; t.reportedProgress = 10; t.actualStatus = 'done'
  t.lastEstimateEvaluation = { developerId: 'secret-author', reason: 'discovery', candidate: 654321, personalWork: 999999, published: false }
  observeBoard(c.observe, t, { high: 1, low: 0 })
  assert.deepEqual(c.events, [])
  t.reportedStatus = 'done'; t.reportedEffortEstimate = 123; t.assignedDeveloperId = 'owner'
  observeBoard(c.observe, t, { high: 2, low: 1e-17 })
  observeBoard(c.observe, t, { high: 2, low: 1e-17 })
  assert.deepEqual(c.events.map(e => e.kind), ['status', 'estimate', 'assignment'])
  assert.ok(c.events.every(e => e.at.high === 2 && e.at.low === 1e-17))
  for (const hidden of ['actualStatus', 'completedWork', 'secret-author', '654321', '999999', 'lastEstimateEvaluation']) assert.ok(!JSON.stringify(c.events).includes(hidden))
  assert.deepEqual(JSON.parse(JSON.stringify(c.events)), c.events)
})

test('a successful Unknown pickup publishes exactly one visible estimate with unchanged RNG consumption', () => {
  const s = decisionFixture(), t = s.tickets[0], d = s.developers[0]
  t.assignedDeveloperId = d.id
  delete t.reportedEffortEstimate; delete t.initialEffortEstimate; delete t.estimateHistory; delete d.estimateReview
  const c = collectBoardActivity(s.tickets), observedDraws = sequence([.5, 0, .5, .999999])
  const result = advanceSimulation(s, .01, observedDraws.draw, c.observe)
  const directDraws = sequence([.5, 0, .5, .999999])
  assert.deepEqual(result, advanceSimulation(s, .01, directDraws.draw))
  assert.equal(observedDraws.count(), directDraws.count())
  assert.equal(c.events.length, 1)
  assert.deepEqual(c.events[0], { id: 1, ticketId: t.id, ticketTitle: t.title, at: { high: 0, low: 0 }, kind: 'estimate', from: null, to: result.tickets[0].reportedEffortEstimate })
})

test('failed pickup and discovery reporting create no estimate activity or private insight notices', () => {
  const unknown = decisionFixture(), t = unknown.tickets[0], d = unknown.developers[0]
  t.assignedDeveloperId = d.id
  delete t.reportedEffortEstimate; delete t.initialEffortEstimate; delete t.estimateHistory; delete d.estimateReview
  const c = collectBoardActivity(unknown.tickets)
  const missed = advanceSimulation(unknown, .01, sequence([.5, .99, .5]).draw, c.observe)
  assert.equal(missed.tickets[0].lastEstimateEvaluation!.published, false)
  assert.equal(c.events.length, 0)
  const known = decisionFixture(), a = known.developers[0], ticket = known.tickets[0]
  ticket.assignedDeveloperId = a.id
  setPublishedEstimate(ticket, a.id, 20)
  a.estimateDiscovery = { ticketId: ticket.id, boardEstimate: 20, baseline: 20, requiredWork: 100, judgement: 0, productive: true, target: workAmount(1) }
  const failed = collectBoardActivity(known.tickets)
  const due = projectWork(a, ticket, workAmount(1)).seconds!
  const result = advanceSimulation(known, due, sequence([.99, .99, .999999]).draw, failed.observe) // effort, progress, threshold
  assert.equal(result.tickets[0].lastEstimateEvaluation!.improved, true)
  assert.equal(result.tickets[0].lastEstimateEvaluation!.published, false)
  assert.equal(failed.events.length, 0)
})

test('genuine published revision records board values at the discovery instant', () => {
  const s = decisionFixture(), d = s.developers[0], t = s.tickets[0]
  t.assignedDeveloperId = d.id
  setPublishedEstimate(t, d.id, 20)
  d.estimateDiscovery = { ticketId: t.id, boardEstimate: 20, baseline: 20, requiredWork: 100, judgement: 0, productive: true, target: workAmount(1) }
  const c = collectBoardActivity(s.tickets), due = projectWork(d, t, workAmount(1)).seconds!
  const result = advanceSimulation(s, due, sequence([0, .99, .999999]).draw, c.observe)
  assert.equal(c.events.length, 1)
  assert.equal(c.events[0].kind, 'estimate')
  assert.deepEqual(c.events[0].at, result.tickets[0].estimateHistory!.at(-1)!.at)
  assert.equal(c.events[0].kind === 'estimate' && c.events[0].from, 20)
  assert.equal(c.events[0].kind === 'estimate' && c.events[0].to, result.tickets[0].reportedEffortEstimate)
})

test('one second retains intermediate reported movement, completion, next pickup and ownership', () => {
  const s = chain(), c = collectBoardActivity(s.tickets), before = structuredClone(s)
  const result = advanceSimulation(s, 1, () => .5, c.observe)
  assert.equal(result.tickets[1].reportedStatus, 'done')
  const second = c.events.filter(e => e.ticketId === 'second')
  assert.deepEqual(second.map(e => [e.kind, 'to' in e ? e.to : null]), [['status', 'in_progress'], ['assignment', 'a'], ['status', 'done']])
  assert.ok(second[0].at.high > 0 && second[0].at.high < second[2].at.high)
  assert.deepEqual(result, advanceSimulation(s, 1, () => .5))
  assert.deepEqual(s, before)
})

test('multiple publications within a single Step retain every intermediate reported value', () => {
  const s = decisionFixture(), d = s.developers[0], t = s.tickets[0]
  d.productivity = 100; d.focus = 0
  t.requiredWork = 10; setPublishedEstimate(t, d.id, 1)
  d.estimateReview = { ticketId: t.id, dueTime: { high: .01, low: 0 } }
  const c = collectBoardActivity(s.tickets)
  const result = advanceSimulation(s, 1, () => .1, c.observe)
  const estimates = c.events.filter(e => e.kind === 'estimate')
  assert.ok(estimates.length > 1)
  assert.equal(estimates[0].from, 1)
  for (let i = 1; i < estimates.length; i++) assert.equal(estimates[i].from, estimates[i - 1].to)
  assert.equal(estimates.at(-1)!.to, result.tickets[0].reportedEffortEstimate)
  assert.deepEqual(result, advanceSimulation(s, 1, () => .1))
})

test('seeded observation preserves partitioned events, chronological ties and JSON restoration', () => {
  for (const reverse of [false, true]) {
    const s = chain()
    s.tickets.push({ ...s.tickets[0], id: 'parallel', rank: 3 })
    s.developers.push({ ...s.developers[0], id: 'b', activeTicketID: 'parallel', estimateReview: { ticketId: 'parallel', dueTime: { high: 1e308, low: 0 } } })
    if (reverse) s.developers.reverse()
    const wholeEvents = collectBoardActivity(s.tickets)
    const whole = advanceSimulation(s, 1, undefined, wholeEvents.observe)
    const splitEvents = collectBoardActivity(s.tickets)
    let split = s
    for (const dt of [.03, .03, .04, .2, .3, .4]) split = JSON.parse(JSON.stringify(advanceSimulation(split, dt, undefined, splitEvents.observe)))
    assert.deepEqual(splitEvents.events, wholeEvents.events)
    assert.equal(split.randomState, whole.randomState)
    assert.deepEqual(split.developers.map(d => [d.id, d.activeTicketID, d.lastAssessment]), whole.developers.map(d => [d.id, d.activeTicketID, d.lastAssessment]))
    assert.deepEqual(split.tickets.map(t => [t.id, t.completedWork, t.reportedStatus, t.assignedDeveloperId]), whole.tickets.map(t => [t.id, t.completedWork, t.reportedStatus, t.assignedDeveloperId]))
    assert.deepEqual(advanceSimulation(s, 1), whole)
  }
})

test('restored active To Do reports work-start at the same instant across JSON-restored partitions', () => {
  const s = decisionFixture(), ticket = s.tickets[0]
  ticket.actualStatus = 'todo'; ticket.reportedStatus = 'todo'; ticket.assignedDeveloperId = 'a'
  const original = structuredClone(s), wholeEvents = collectBoardActivity(s.tickets)
  const whole = advanceSimulation(s, 1, undefined, wholeEvents.observe)
  const splitEvents = collectBoardActivity(s.tickets)
  let split = s
  for (const dt of [.3, .3, .4]) split = JSON.parse(JSON.stringify(advanceSimulation(split, dt, undefined, splitEvents.observe)))
  assert.deepEqual(splitEvents.events, wholeEvents.events)
  assert.deepEqual(wholeEvents.events, [{ id: 1, ticketId: ticket.id, ticketTitle: ticket.title,
    kind: 'status', from: 'todo', to: 'in_progress', at: { high: 0, low: 0 } }])
  assert.deepEqual(split, whole)
  assert.equal(split.randomState, s.randomState)
  assert.deepEqual(whole, advanceSimulation(s, 1))
  const zero = collectBoardActivity(s.tickets)
  assert.deepEqual(advanceSimulation(s, 0, noDraw, zero.observe), s)
  assert.deepEqual(zero.events, [])
  assert.deepEqual(s, original)
})

test('restored To Do work-start precedes completion even when both fall within the first advance', () => {
  for (const total of [.1, 1]) {
    const s = decisionFixture(), ticket = s.tickets[0]
    ticket.actualStatus = 'todo'; ticket.reportedStatus = 'todo'; ticket.assignedDeveloperId = 'a'
    ticket.requiredWork = total; setPublishedEstimate(ticket, 'a', total)
    const wholeEvents = collectBoardActivity(s.tickets), whole = advanceSimulation(s, 1, undefined, wholeEvents.observe)
    const splitEvents = collectBoardActivity(s.tickets)
    let split = s
    for (const dt of [.3, .3, .4]) split = JSON.parse(JSON.stringify(advanceSimulation(split, dt, undefined, splitEvents.observe)))
    assert.deepEqual(splitEvents.events, wholeEvents.events)
    assert.deepEqual(wholeEvents.events.map(event => [event.id, event.kind, event.to]), [[1, 'status', 'in_progress'], [2, 'status', 'done']])
    assert.equal(wholeEvents.events[0].at.high, 0)
    assert.ok(wholeEvents.events[1].at.high > 0)
    assert.deepEqual(split, whole)
    assert.deepEqual(whole, advanceSimulation(s, 1))
  }
})

test('session collection is bounded, repeatable under StrictMode, and does not fabricate mount events', () => {
  const initial = createBoardSession(), before = structuredClone(initial)
  assert.equal(initial.activity.length, 0)
  const first = boardReducer(initial, { type: 'step' })
  assert.deepEqual(boardReducer(initial, { type: 'step' }), first)
  assert.deepEqual(first.simulation, simulationReducer(initial.simulation, { type: 'step' }))
  assert.deepEqual(initial, before)
  const c = collectBoardActivity(initial.simulation.game.tickets), t = structuredClone(initial.simulation.game.tickets[0])
  for (let i = 0; i < 105; i++) { t.reportedStatus = i % 2 ? 'todo' : 'done'; c.observe(t, { high: i, low: 0 }) }
  assert.equal(c.events.length, 100); assert.equal(c.events[0].id, 6); assert.equal(c.nextId, 106)
  const full = { ...initial, activity: c.events, nextActivityId: c.nextId }
  const next = boardReducer(full, { type: 'step' })
  assert.equal(next.activity.length, 100)
  assert.ok(next.activity[0].id > full.activity[0].id)
  assert.ok(next.activity.at(-1)!.id >= 106)
  assert.deepEqual(next.activity.slice(0, -first.activity.length), full.activity.slice(first.activity.length))
  assert.equal(full.activity[0].id, 6) // Eviction must not mutate an earlier session.
})

test('real seeded team publications and completion events replay across fractional saves with identical RNG', () => {
  for (const seed of [1, 42, 999]) for (const reverse of [false, true]) {
    const s = structuredClone(exampleGameState); s.randomState = seed
    if (reverse) s.developers.reverse()
    const c = collectBoardActivity(s.tickets), whole = advanceSimulation(s, 15, undefined, c.observe)
    const splitEvents = collectBoardActivity(s.tickets)
    let split = s
    for (let i = 0; i < 15; i++) for (const dt of [.3, .3, .4]) split = JSON.parse(JSON.stringify(advanceSimulation(split, dt, undefined, splitEvents.observe)))
    assert.deepEqual(splitEvents.events, c.events)
    assert.equal(splitEvents.nextId, c.nextId)
    assert.equal(split.randomState, whole.randomState)
    assert.deepEqual(whole, advanceSimulation(s, 15))
    assert.deepEqual(split.developers.map(d => [d.id, d.activeTicketID, d.lastAssessment]), whole.developers.map(d => [d.id, d.activeTicketID, d.lastAssessment]))
  }
})

test('pause retains history, restart clears it, and restoring session JSON does not duplicate events', () => {
  const first = boardReducer(createBoardSession(), { type: 'step' })
  assert.ok(first.activity.length > 0)
  const resumed = boardReducer(first, { type: 'togglePause' })
  assert.strictEqual(resumed.activity, first.activity)
  const paused = boardReducer(resumed, { type: 'togglePause' })
  assert.deepEqual(paused.activity, first.activity)
  assert.strictEqual(boardReducer(paused, { type: 'tick' }), paused)
  const saved = JSON.parse(JSON.stringify(first))
  assert.deepEqual(boardReducer(saved, { type: 'step' }), boardReducer(first, { type: 'step' }))
  const restart = boardReducer(resumed, { type: 'restart' })
  assert.deepEqual(restart, createBoardSession())
  assert.deepEqual(restart.simulation.game, exampleGameState)
})

test('paused Rank edits are silent; Resume and Step capture their public changes once at time zero', () => {
  const initial = createBoardSession()
  const staged = boardReducer(initial, { type: 'reorderTodo', ticketId: 'ticket-5', targetId: 'ticket-2' })
  assert.deepEqual(staged.activity, [])
  for (const type of ['togglePause', 'step'] as const) {
    const result = boardReducer(staged, { type })
    assert.ok(result.activity.some(e => e.ticketId === 'ticket-5' && e.kind === 'assignment' && e.at.high === 0))
    assert.deepEqual(result.simulation, simulationReducer(staged.simulation, { type }))
  }
})

test('running priorities collect immediate changes without time advancement or a second Resume flush', () => {
  const initial = boardReducer(createBoardSession(), { type: 'togglePause' })
  const action = { type: 'reorderTodo', ticketId: 'ticket-5', targetId: 'ticket-2' } as const
  const reordered = boardReducer(initial, action)
  assert.deepEqual(reordered.simulation, simulationReducer(initial.simulation, action))
  assert.equal(reordered.simulation.game.simulationTime, 0)
  assert.ok(reordered.activity.some(event => event.kind === 'assignment' && event.ticketId === 'ticket-5'))
  const paused = boardReducer(reordered, { type: 'togglePause' })
  assert.deepEqual(boardReducer(paused, { type: 'togglePause' }).activity, reordered.activity)
})

test('zero time is silent and observer snapshots cannot mutate simulation or expose hidden state', () => {
  const s = chain(), c = collectBoardActivity(s.tickets)
  assert.deepEqual(advanceSimulation(s, 0, noDraw, c.observe), s)
  assert.deepEqual(c.events, [])
  const reports: unknown[] = []
  const mutated = advanceSimulation(s, 1, () => .5, (report, at) => {
    reports.push({ ...report })
    Object.assign(report, { assignedDeveloperId: 'fake', reportedStatus: 'backlog' })
    Object.assign(at, { high: 1e200 })
  })
  assert.deepEqual(mutated, advanceSimulation(s, 1, () => .5))
  assert.ok(reports.every(r => Object.keys(r as object).every(key => ['id', 'title', 'reportedStatus', 'reportedEffortEstimate', 'assignedDeveloperId', 'reportedProgress', 'progressReport'].includes(key))))
})

test('a throwing observed transition leaves original session, history and RNG untouched', () => {
  const session = createBoardSession(), game = session.simulation.game
  game.randomState = 2 // A publishes, then B's estimate underflows with the new progress-report draw included.
  game.tickets = game.tickets.slice(0, 2).map((ticket, i) => ({ ...ticket, requiredWork: i ? Number.MIN_VALUE : 100, completedWork: 0 }))
  game.developers = game.developers.slice(0, 2).map(d => ({ ...d, judgement: 0, discipline: 0, competencies: { frontend: 0, backend: 0 } }))
  const invalid = structuredClone(session)
  // The seeded stream first publishes successfully for A; B's later initial estimate
  // underflows. The partially collected event buffer must never reach the UI.
  assert.throws(() => boardReducer(session, { type: 'step' }), /positive numeric range/)
  assert.deepEqual(session, invalid)
  assert.deepEqual(session.activity, [])
  assert.equal(session.simulation.game.randomState, 2)
})
