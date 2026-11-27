import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { commitScope, validateCommittedScope } from '../src/game/commitment.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { eventTime } from '../src/game/eventTime.ts'
import { workAmount } from '../src/game/work.ts'
import { workTransitions } from '../src/game/workDecisions.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { getPlanningView } from '../src/store/planningView.ts'
import { boardReducer, createBoardSession } from '../src/store/boardSession.ts'
import { decideNow, decisionFixture, setPublishedEstimate } from './helpers/decisionFixture.ts'
import type { Ticket } from '../src/game/types'
import type { BoardSession } from '../src/store/boardSession'

const restore = <T>(value: T): T => JSON.parse(JSON.stringify(value))
function session(game = structuredClone(exampleGameState)): BoardSession {
  const value = createBoardSession()
  return { ...value, simulation: { game, isPaused: true } }
}
function draft(input: BoardSession, ids: string[]) {
  let next = boardReducer(input, { type: 'resolveEstimation' }) // No requests, no draws.
  for (const ticketId of ids) next = boardReducer(next, { type: 'addCommitment', ticketId })
  return next
}
const noDraw = () => { throw Error('No simulation/estimation draw at commitment') }

test('commitment follows estimation, edits independently, accepts known/Unknown/unassessed work and prevents duplicates', () => {
  let initial = session()
  assert.strictEqual(boardReducer(initial, { type: 'addCommitment', ticketId: 'ticket-7' }), initial)
  assert.strictEqual(boardReducer(initial, { type: 'commitSprint' }), initial)
  initial = boardReducer(initial, { type: 'addEstimation', ticketId: 'ticket-2' })
  initial = boardReducer(initial, { type: 'resolveEstimation' })
  const frozen = structuredClone(initial.simulation)
  const estimatedIds = [...initial.sprint.planning!.ticketIds]
  let selected = initial
  for (const ticketId of ['ticket-7', 'ticket-2', 'ticket-6']) selected = boardReducer(selected, { type: 'addCommitment', ticketId })
  assert.strictEqual(boardReducer(selected, { type: 'addCommitment', ticketId: 'ticket-7' }), selected)
  assert.strictEqual(boardReducer(selected, { type: 'addCommitment', ticketId: 'missing' }), selected)
  selected = boardReducer(selected, { type: 'moveCommitment', ticketId: 'ticket-6', direction: 'up' })
  selected = boardReducer(selected, { type: 'removeCommitment', ticketId: 'ticket-2' })
  const plan = selected.sprint.planning!
  assert.equal(plan.stage, 'estimated')
  if (plan.stage !== 'estimated') return assert.fail()
  assert.deepEqual(plan.commitmentIds, ['ticket-7', 'ticket-6'])
  assert.deepEqual(plan.ticketIds, estimatedIds)
  assert.deepEqual(selected.simulation, frozen)
  assert.deepEqual(getPlanningView(getPlayerView(selected.simulation.game), selected.sprint).commitment.map(t => t.id), ['ticket-7', 'ticket-6'])
})

test('commitment availability depends only on reported status, including stale unfinished completion', () => {
  const state = structuredClone(exampleGameState)
  state.tickets[0].actualStatus = 'done'; state.tickets[0].completedWork = state.tickets[0].requiredWork
  state.tickets[0].reportedStatus = 'todo'
  state.tickets[1].reportedStatus = 'done' // Still physically unfinished.
  const initial = draft(session(state), ['ticket-1', 'ticket-2'])
  assert.deepEqual(initial.sprint.planning!.stage === 'estimated' && initial.sprint.planning!.commitmentIds, ['ticket-1'])
  const other = structuredClone(state)
  other.tickets[0].actualStatus = 'in_progress'; other.tickets[0].completedWork = 0
  assert.deepEqual(getPlanningView(getPlayerView(state), initial.sprint), getPlanningView(getPlayerView(other), initial.sprint))
  const committed = boardReducer(initial, { type: 'commitSprint' })
  assert.equal(committed.simulation.game.tickets[0].actualStatus, 'done')
  assert.equal(committed.simulation.game.tickets[0].reportedStatus, 'todo')
  assert.throws(() => commitScope(state, ['ticket-2']), /available/)
})

test('start atomically records scope, promotes only true Backlog and permutes only selected global Rank slots', () => {
  const state = structuredClone(exampleGameState)
  state.tickets[1].reportedStatus = 'backlog' // Previously started; preserve this inaccurate report.
  setPublishedEstimate(state.tickets[1], 'historical', 7)
  state.tickets[1].overrunEvaluationConsumed = true
  state.workLog = [{ developerId: state.developers[1].id, ticketId: 'ticket-2', effort: workAmount(3) }]
  const initial = draft(session(state), ['ticket-7', 'ticket-2', 'ticket-6'])
  initial.simulation.pausedPriorityOrder = state.tickets.map(ticket => ticket.id)
  const original = structuredClone(initial)
  const committed = boardReducer(restore(initial), { type: 'commitSprint' })
  assert.equal(committed.sprint.phase, 'execution'); assert.equal(committed.simulation.isPaused, true)
  assert.deepEqual(committed.sprint.deadline, eventTime(240))
  assert.equal(committed.simulation.game.simulationTime, 0)
  assert.equal(committed.simulation.game.randomState, initial.simulation.game.randomState)
  assert.equal(committed.simulation.pausedPriorityOrder, undefined)
  assert.deepEqual(boardReducer(committed, { type: 'togglePause' }).simulation.game, committed.simulation.game)
  assert.deepEqual(committed.simulation.game.committedTicketIds, ['ticket-7', 'ticket-2', 'ticket-6'])
  assert.deepEqual(committed.simulation.game.developers, state.developers)
  assert.deepEqual(committed.simulation.game.workLog, state.workLog)
  const byId = new Map(committed.simulation.game.tickets.map(t => [t.id, t]))
  assert.equal(byId.get('ticket-7')!.rank, 2); assert.equal(byId.get('ticket-2')!.rank, 6); assert.equal(byId.get('ticket-6')!.rank, 7)
  for (const ticket of state.tickets) if (!['ticket-7', 'ticket-2', 'ticket-6'].includes(ticket.id)) assert.deepEqual(byId.get(ticket.id), ticket)
  assert.deepEqual({ ...byId.get('ticket-2'), rank: 2 }, state.tickets[1])
  for (const id of ['ticket-6', 'ticket-7']) assert.equal(byId.get(id)!.actualStatus, 'todo')
  assert.deepEqual(committed.activity.map(event => [event.ticketId, event.kind, event.at]), ['ticket-7', 'ticket-6'].map(id => [id, 'status', eventTime(0)]))
  assert.deepEqual(initial, original)
  assert.deepEqual(restore(committed).simulation.game.committedTicketIds, ['ticket-7', 'ticket-2', 'ticket-6'])
})

test('no scope cap, empty scopes, repeated submissions and execution scope edits cannot create more opportunities', () => {
  const initial = session(), ids = initial.simulation.game.tickets.map(t => t.id)
  const ready = draft(initial, ids), all = boardReducer(ready, { type: 'commitSprint' })
  assert.deepEqual(all.simulation.game.committedTicketIds, ids)
  for (const value of [all, restore(all)]) for (const action of [
    { type: 'commitSprint' }, { type: 'addCommitment', ticketId: 'ticket-1' },
    { type: 'removeCommitment', ticketId: 'ticket-2' }, { type: 'moveCommitment', ticketId: 'ticket-2', direction: 'up' },
    { type: 'resolveEstimation' }, { type: 'startSprint' },
  ] as const) assert.strictEqual(boardReducer(value, action), value)
  const empty = boardReducer(draft(initial, []), { type: 'commitSprint' })
  assert.deepEqual(empty.simulation.game.committedTicketIds, [])
  const advanced = advanceSimulation(empty.simulation.game, 60)
  assert.deepEqual(advanced.tickets, empty.simulation.game.tickets)
  assert.equal(advanced.workLog, undefined)
  assert.ok(advanced.developers.every(d => d.activeTicketID === undefined && d.idleWorkCheck))
})

test('only committed work is executable, including restored active claims, completion pickup and all event paths', () => {
  const state = decisionFixture(), ticket = state.tickets[0]
  const selected: Ticket = { ...ticket, id: 'selected', rank: 2, actualStatus: 'todo', reportedStatus: 'todo', requiredWork: 10, completedWork: 0 }
  setPublishedEstimate(selected, 'board', 10)
  state.tickets.push(selected)
  state.committedTicketIds = ['selected']
  state.workLog = [{ developerId: 'a', ticketId: ticket.id, effort: workAmount(12) }]
  const original = structuredClone(state)
  const advanced = advanceSimulation(state, 30, () => .1)
  assert.deepEqual(advanced.tickets[0], original.tickets[0])
  assert.equal(advanced.tickets[1].actualStatus, 'done')
  assert.deepEqual(advanced.workLog!.find(entry => entry.ticketId === ticket.id), original.workLog[0])
  assert.ok(advanced.developers[0].lastAssessment!.considered.every(option => option.id === selected.id))
  assert.deepEqual(state, original)
})

test('scoped priority reconsideration cannot appraise or claim a tempting uncommitted ticket', () => {
  const state = decisionFixture(), ticket = state.tickets[0]
  state.committedTicketIds = [ticket.id]
  state.tickets.push({ ...ticket, id: 'tempting', rank: 2, reportedEffortEstimate: undefined, reportedProgress: 100 })
  assert.equal(decideNow(state, noDraw).developers[0].activeTicketID, ticket.id)
  const transitions = workTransitions(structuredClone(state), eventTime(0), noDraw)
  assert.deepEqual(transitions.context(state.developers[0]).map(t => t.id), [ticket.id])
})

test('committing ongoing work preserves its Flow, integrated work and gross effort rather than restarting its stint', () => {
  const state = decisionFixture(), ticket = state.tickets[0]
  ticket.completedWork = 10
  state.developers[0].flowStreak = { ticketId: ticket.id, duration: 100 }
  state.workLog = [{ developerId: 'a', ticketId: ticket.id, effort: workAmount(20) }]
  const committed = commitScope(state, [ticket.id])
  assert.deepEqual(committed.developers, state.developers)
  const actual = advanceSimulation(committed, 1, () => .5)
  const expected = advanceSimulation(state, 1, () => .5)
  delete actual.committedTicketIds
  assert.deepEqual(actual, expected)
  assert.equal(actual.developers[0].flowStreak!.duration, 101)
})

test('committed stale completion uses normal fallible encounters, never hidden filtering, and excludes other stale work', () => {
  const state = decisionFixture(), ticket = state.tickets[0]
  delete state.developers[0].activeTicketID; delete state.developers[0].estimateReview
  ticket.actualStatus = 'done'; ticket.completedWork = ticket.requiredWork; ticket.reportedStatus = 'todo'
  state.tickets.push({ ...ticket, id: 'outside', rank: 2 })
  state.committedTicketIds = [ticket.id]
  const result = advanceSimulation(state, .1, () => .1)
  assert.equal(result.tickets[0].reportedStatus, 'done')
  assert.equal(result.tickets[1].reportedStatus, 'todo')
  assert.equal(result.developers[0].activeTicketID, undefined)
  assert.equal(result.workLog, undefined)
  assert.deepEqual(result.developers[0].lastAssessment!.considered.map(t => t.id), [ticket.id])
})

test('invalid scope/Rank fails without original state or RNG mutation; legacy engines remain unscoped', () => {
  const state = decisionFixture(), before = structuredClone(state)
  for (const ids of [['missing'], [state.tickets[0].id, state.tickets[0].id]]) {
    assert.throws(() => commitScope(state, ids), RangeError)
    assert.throws(() => validateCommittedScope({ ...state, committedTicketIds: ids }), RangeError)
    assert.throws(() => advanceSimulation({ ...state, committedTicketIds: ids }, 1), RangeError)
  }
  const invalid = structuredClone(state); invalid.tickets[0].rank = 2
  assert.throws(() => commitScope(invalid, [invalid.tickets[0].id]), /Rank/)
  assert.deepEqual(state, before)
  assert.ok(advanceSimulation(state, 1, () => .5).tickets[0].completedWork > 0)
})

test('seeded committed runs preserve exact events, scope, claims and RNG through partitions and JSON; deadline freezes first-sprint state', () => {
  for (const seed of [1, 42]) {
    let initial = draft(session(), ['ticket-6', 'ticket-2', 'ticket-5'])
    initial.simulation.game.randomState = seed
    initial = boardReducer(boardReducer(initial, { type: 'commitSprint' }), { type: 'togglePause' })
    const whole = boardReducer(initial, { type: 'tick', elapsedRealMilliseconds: eventTime(60000) })
    let split = restore(initial)
    for (let i = 0; i < 60; i++) for (const ms of [300, 300, 400]) split = restore(boardReducer(split, { type: 'tick', elapsedRealMilliseconds: eventTime(ms) }))
    assert.deepEqual(split, whole)
    const claims = whole.simulation.game.developers.flatMap(d => d.activeTicketID ? [d.activeTicketID] : [])
    assert.equal(new Set(claims).size, claims.length)
    assert.ok(claims.every(id => initial.simulation.game.committedTicketIds!.includes(id)))
    const end = boardReducer(initial, { type: 'tick', elapsedRealMilliseconds: eventTime(240000) })
    assert.equal(end.sprint.phase, 'planning'); assert.equal(end.simulation.isPaused, true)
    assert.deepEqual(end.simulation.game.committedTicketIds, initial.simulation.game.committedTicketIds)
    assert.equal(getPlanningView(getPlayerView(end.simulation.game), end.sprint).prototypeComplete, true)
    for (const type of ['startSprint', 'commitSprint', 'resolveEstimation', 'togglePause', 'step'] as const) assert.strictEqual(boardReducer(end, { type }), end)
    const restarted = boardReducer(end, { type: 'restart' })
    assert.equal(restarted.simulation.game.committedTicketIds, undefined)
    assert.equal(restarted.sprint.phase, 'planning')
  }
})

test('operational To Do ranking remains available without changing committed membership', () => {
  const initial = draft(session(), ['ticket-2', 'ticket-5', 'ticket-6'])
  const started = boardReducer(initial, { type: 'commitSprint' })
  const changed = boardReducer(started, { type: 'reorderTodo', ticketId: 'ticket-6', targetId: 'ticket-2' })
  assert.notDeepEqual(changed.simulation.game.tickets.map(t => t.rank), started.simulation.game.tickets.map(t => t.rank))
  assert.deepEqual(changed.simulation.game.committedTicketIds, started.simulation.game.committedTicketIds)
  assert.equal(changed.simulation.game.randomState, started.simulation.game.randomState)
})
