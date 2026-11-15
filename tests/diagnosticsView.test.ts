import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { getDiagnosticsView } from '../src/store/diagnosticsView.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'

test('derives authoritative ticket, developer and team metrics without mutation', () => {
  const state = structuredClone(exampleGameState)
  const original = structuredClone(state)
  const view = getDiagnosticsView(state)
  assert.deepEqual(view.tickets[0], {
    id: 'ticket-1', comparison: view.tickets[0].comparison, rank: 1, workDomain: 'frontend', requiredWork: 10, completedWork: 4, remainingWork: 6,
    activeDeveloperName: 'Alex', workRate: 1.5, estimatedSeconds: 4,
  })
  assert.equal(view.tickets[1].estimatedSeconds, 10)
  assert.deepEqual(view.team, {
    completedTickets: 0, totalTickets: 7, activeDevelopers: 2, totalDevelopers: 3,
    completedWork: 6, requiredWork: 48, workRate: 2.1,
  })
  assert.equal(view.developers[0].assignedTicketCount, 1)
  assert.deepEqual(view.developers[0].activeTicket, { id: 'ticket-1', title: 'Build the navigation menu' })
  assert.equal(view.developers[2].activeTicket, null)
  assert.equal(view.tickets[2].estimatedSeconds, null)
  assert.deepEqual(state, original)
})

test('ownership counts are independent of active work, including completed owned tickets', () => {
  const state = structuredClone(exampleGameState)
  state.tickets[0].assignedDeveloperId = 'developer-3'
  state.tickets[4].assignedDeveloperId = 'developer-3'
  state.tickets[4].actualStatus = 'done'
  state.tickets[4].completedWork = 3
  const view = getDiagnosticsView(state)
  assert.equal(view.developers[0].assignedTicketCount, 0)
  assert.equal(view.developers[2].assignedTicketCount, 2)
  assert.equal(view.developers[2].activeTicket, null)
  assert.equal(view.tickets[0].activeDeveloperName, 'Alex')
  assert.equal(view.team.completedTickets, 1)
})

test('zero-sized and completed tickets have zero ETA and no active work rate', () => {
  const state = structuredClone(exampleGameState)
  state.tickets[0].requiredWork = 0
  state.tickets[0].completedWork = 0
  state.tickets[1].actualStatus = 'done'
  state.tickets[1].completedWork = 8
  const view = getDiagnosticsView(state)
  for (const ticket of view.tickets.slice(0, 2)) {
    assert.equal(ticket.estimatedSeconds, 0)
    assert.equal(ticket.workRate, 0)
    assert.equal(ticket.remainingWork, 0)
  }
  assert.equal(view.team.activeDevelopers, 0)
  assert.equal(view.team.workRate, 0)
})

test('zero productivity, idle and stale references do not yield misleading ETAs', () => {
  const state = structuredClone(exampleGameState)
  state.developers[0].productivity = 0
  state.developers[1].activeTicketID = 'missing'
  const view = getDiagnosticsView(state)
  assert.equal(view.tickets[0].estimatedSeconds, null)
  assert.equal(view.tickets[1].estimatedSeconds, null)
  assert.equal(view.team.activeDevelopers, 1)
  assert.equal(view.team.workRate, 0)
  assert.equal(view.developers[1].activeTicket, null)
})

test('duplicate active references do not inflate team rates', () => {
  const state = structuredClone(exampleGameState)
  state.developers[1].activeTicketID = 'ticket-1'
  const view = getDiagnosticsView(state)
  assert.equal(view.team.activeDevelopers, 1)
  assert.equal(view.team.workRate, 1.5)
  assert.equal(view.developers[1].activeTicket, null)
})

test('empty team and backlog yield finite zero totals', () => {
  const view = getDiagnosticsView({ tickets: [], developers: [], simulationTime: 0, randomState: 1 })
  assert.deepEqual(view.team, {
    completedTickets: 0, totalTickets: 0, activeDevelopers: 0, totalDevelopers: 0,
    completedWork: 0, requiredWork: 0, workRate: 0,
  })
})

test('diagnostics update live through completion and remain separate from player reports', () => {
  let state = structuredClone(exampleGameState)
  state.tickets[0].reportedProgress = 5
  state.tickets[0].reportedStatus = 'todo'
  const player = getPlayerView(state)
  assert.equal(getDiagnosticsView(state).tickets[0].completedWork, 4)
  assert.equal(player.tickets[0].reportedProgress, 5)
  assert.equal(player.tickets[0].reportedStatus, 'todo')
  assert.deepEqual(Object.keys(player).sort(), ['developers', 'simulationTime', 'tickets'])
  assert.deepEqual(Object.keys(player.tickets[0]).sort(),
    ['assignedDeveloperId', 'id', 'rank', 'reportedProgress', 'reportedStatus', 'title', 'workDomain'])
  assert.deepEqual(Object.keys(player.developers[0]).sort(), ['id', 'name', 'productivity'])
  getDiagnosticsView(state)
  assert.deepEqual(getPlayerView(state), player)
  // These reporting assertions expect uninterrupted work, independent of the example seed.
  state = advanceSimulation(state, 1, () => 0.99)
  assert.equal(getDiagnosticsView(state).tickets[0].completedWork, 5.5)
  assert.equal(getDiagnosticsView(state).team.activeDevelopers, 3)
  for (let i = 0; i < 30; i++) state = advanceSimulation(state, 1, () => 0.99)
  const finished = getDiagnosticsView(state)
  assert.equal(finished.team.completedTickets, 5)
  assert.equal(finished.team.completedWork, 38)
  assert.equal(finished.team.requiredWork, 48)
  assert.equal(finished.team.workRate, 0)
  assert.equal(finished.team.activeDevelopers, 0)
  assert.ok(finished.tickets.slice(0, 5).every(ticket => ticket.estimatedSeconds === 0))
  assert.ok(finished.tickets.slice(5).every(ticket => ticket.estimatedSeconds === null))
})

test('untouched zero-sized Backlog does not count as completed or receive a zero-second ETA', () => {
  const state = structuredClone(exampleGameState)
  state.tickets = [{ ...state.tickets[5], requiredWork: 0, completedWork: 0 }]
  const original = structuredClone(state)
  const view = getDiagnosticsView(state)
  assert.equal(view.team.completedTickets, 0)
  assert.equal(view.team.totalTickets, 1)
  assert.equal(view.tickets[0].remainingWork, 0)
  assert.equal(view.tickets[0].estimatedSeconds, null)
  assert.deepEqual(state, original)
})

test('diagnostics ignore stale active-ticket references to Backlog', () => {
  const state = structuredClone(exampleGameState)
  state.tickets = [state.tickets[5]]
  state.developers[0].activeTicketID = state.tickets[0].id
  const original = structuredClone(state)
  const view = getDiagnosticsView(state)
  assert.equal(view.developers[0].activeTicket, null)
  assert.equal(view.developers[0].workRate, 0)
  assert.equal(view.team.activeDevelopers, 0)
  assert.equal(view.team.workRate, 0)
  assert.equal(view.tickets[0].activeDeveloperName, null)
  assert.equal(view.tickets[0].workRate, 0)
  assert.equal(view.tickets[0].estimatedSeconds, null)
  assert.deepEqual(state, original)
})

test('diagnostics reflect managerial rank immediately after reorder', async () => {
  const { reorderTodo } = await import('../src/game/rank.ts')
  const state = structuredClone(exampleGameState)
  const result = reorderTodo(state, 'ticket-2', 'ticket-5', true)
  const before = getDiagnosticsView(state).tickets.find(t => t.id === 'ticket-2')!
  const after = getDiagnosticsView(result).tickets.find(t => t.id === 'ticket-2')!
  assert.notEqual(after.rank, before.rank)
  assert.equal(after.rank, result.tickets.find(t => t.id === 'ticket-2')!.rank)
})
