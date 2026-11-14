import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { getPlayerView } from '../src/store/playerView.ts'

test('player view exposes only reported ticket information and public developer attributes', () => {
  const state = structuredClone(exampleGameState)
  state.tickets[0].reportedProgress = 15
  state.tickets[0].completedWork = 9
  state.tickets[0].actualStatus = 'done'
  const view = getPlayerView(state)
  assert.deepEqual(view.tickets[0], {
    id: 'ticket-1',
    title: 'Build the navigation menu',
    reportedStatus: 'in_progress',
    reportedProgress: 15,
    assignedDeveloperId: 'developer-1',
  })
  for (const ticket of view.tickets) {
    assert.equal('actualStatus' in ticket, false)
    assert.equal('completedWork' in ticket, false)
    assert.equal('requiredWork' in ticket, false)
  }
  assert.deepEqual(view.developers[0], { id: 'developer-1', name: 'Alex', productivity: 1 })
  assert.equal(view.simulationTime, state.simulationTime)
  state.tickets[0].completedWork = 0
  state.tickets[0].actualStatus = 'todo'
  assert.deepEqual(getPlayerView(state), view)
})

test('player view bounds reported percentages without mutating the state', () => {
  for (const [value, expected] of [[-1, 0], [101, 100], [NaN, 0]]) {
    const state = structuredClone(exampleGameState)
    state.tickets[0].reportedProgress = value
    assert.equal(getPlayerView(state).tickets[0].reportedProgress, expected)
    assert.ok(Object.is(state.tickets[0].reportedProgress, value))
  }
})

test('example backlog autonomously moves through player-visible columns to completion', async () => {
  const { advanceSimulation } = await import('../src/game/advanceSimulation.ts')
  let state = structuredClone(exampleGameState)
  const original = structuredClone(state)
  state = advanceSimulation(state, 1)
  const started = getPlayerView(state)
  assert.equal(started.tickets.find(t => t.id === 'ticket-2')?.reportedStatus, 'in_progress')
  assert.equal(started.tickets.find(t => t.id === 'ticket-3')?.reportedStatus, 'in_progress')
  assert.equal(started.tickets.find(t => t.id === 'ticket-3')?.assignedDeveloperId, 'developer-3')
  for (let second = 1; second < 30; second++) state = advanceSimulation(state, 1)
  for (const ticket of state.tickets) {
    assert.equal(ticket.actualStatus, 'done')
    assert.equal(ticket.completedWork, ticket.requiredWork)
  }
  for (const ticket of getPlayerView(state).tickets) {
    assert.equal(ticket.reportedStatus, 'done')
    assert.equal(ticket.reportedProgress, 100)
    assert.equal('actualStatus' in ticket, false)
  }
  assert.ok(state.developers.every(d => d.activeTicketID === undefined))
  assert.ok(state.tickets.every(t =>
    state.developers.some(d => d.id === t.assignedDeveloperId),
  ))
  const later = advanceSimulation(state, 10)
  assert.deepEqual(later.tickets, state.tickets)
  assert.deepEqual(exampleGameState, original)
})
