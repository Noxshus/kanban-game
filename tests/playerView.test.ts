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
    rank: 1,
    title: 'Build the navigation menu',
    workDomain: 'frontend',
    reportedStatus: 'in_progress',
    reportedProgress: 15,
    assignedDeveloperId: 'developer-1',
  })
  for (const ticket of view.tickets) {
    assert.equal('actualStatus' in ticket, false)
    assert.equal('completedWork' in ticket, false)
    assert.equal('requiredWork' in ticket, false)
    assert.equal(ticket.workDomain, state.tickets.find(source => source.id === ticket.id)?.workDomain)
  }
  assert.deepEqual(view.developers[0], { id: 'developer-1', name: 'Alex', productivity: 1 })
  assert.ok(view.developers.every(developer => !('competencies' in developer)))
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

test('example committed work progresses through player-visible columns while Backlog stays untouched', async () => {
  const { advanceSimulation } = await import('../src/game/advanceSimulation.ts')
  let state = structuredClone(exampleGameState)
  const original = structuredClone(state)
  // Inject a stable sequence to verify the new candidate/pickup path.
  state = advanceSimulation(state, 1, () => 0.99)
  const started = getPlayerView(state)
  assert.equal(started.tickets.find(t => t.id === 'ticket-2')?.reportedStatus, 'in_progress')
  assert.equal(started.tickets.find(t => t.id === 'ticket-5')?.reportedStatus, 'in_progress')
  assert.equal(started.tickets.find(t => t.id === 'ticket-5')?.assignedDeveloperId, 'developer-3')
  for (let second = 1; second < 30; second++) state = advanceSimulation(state, 1, () => 0.99)
  for (const ticket of state.tickets.slice(0, 5)) {
    assert.equal(ticket.actualStatus, 'done')
    assert.equal(ticket.completedWork, ticket.requiredWork)
  }
  for (const ticket of getPlayerView(state).tickets.slice(0, 5)) {
    assert.equal(ticket.reportedStatus, 'done')
    assert.equal(ticket.reportedProgress, 100)
    assert.equal('actualStatus' in ticket, false)
  }
  assert.ok(state.developers.every(d => d.activeTicketID === undefined))
  assert.deepEqual(state.tickets.slice(5), original.tickets.slice(5))
  assert.ok(state.tickets.slice(0, 5).every(t =>
    state.developers.some(d => d.id === t.assignedDeveloperId),
  ))
  const later = advanceSimulation(state, 10)
  assert.deepEqual(later.tickets, state.tickets)
  assert.deepEqual(exampleGameState, original)
})
