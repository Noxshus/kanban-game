import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import type { GameState } from '../src/game/types.ts'

function createState(): GameState {
  return {
    simulationTime: 10,
    developers: [
      { id: 'dev-1', name: 'Alex', activeTicketID: 'ticket-1', productivity: 2 },
    ],
    tickets: [
      {
        id: 'ticket-1',
        title: 'Example task',
        actualStatus: 'todo',
        reportedStatus: 'todo',
        requiredWork: 10,
        completedWork: 1,
        reportedProgress: 10,
      },
    ],
  }
}

test('advances time and work using productivity, including fractional seconds', () => {
  const result = advanceSimulation(createState(), 1.5)
  assert.equal(result.simulationTime, 11.5)
  assert.equal(result.tickets[0].completedWork, 4)
  assert.equal(result.tickets[0].actualStatus, 'in_progress')
})

test('caps work and completes a ticket at or beyond the required work', () => {
  for (const seconds of [4.5, 100]) {
    const result = advanceSimulation(createState(), seconds)
    assert.equal(result.tickets[0].completedWork, 10)
    assert.equal(result.tickets[0].actualStatus, 'done')
    assert.equal(result.developers[0].activeTicketID, undefined)
  }
})

test('temporarily synchronizes reported status during progression and completion', () => {
  for (const seconds of [1, 100]) {
    const state = createState()
    state.tickets[0].reportedStatus = 'done'
    assert.equal(advanceSimulation(state, seconds).tickets[0].reportedStatus, seconds === 1 ? 'in_progress' : 'done')
    state.tickets[0].reportedStatus = 'todo'
    assert.equal(advanceSimulation(state, seconds).tickets[0].reportedStatus, seconds === 1 ? 'in_progress' : 'done')
  }
})

test('idle developers and missing active references select available work', () => {
  for (const activeTicketID of [undefined, 'missing']) {
    const state = createState()
    state.developers[0].activeTicketID = activeTicketID
    state.tickets[0].assignedDeveloperId = 'dev-1'
    const result = advanceSimulation(state, 1)
    assert.equal(result.tickets[0].completedWork, 3)
    assert.equal(result.developers[0].activeTicketID, 'ticket-1')
    assert.equal(result.tickets[0].assignedDeveloperId, 'dev-1')
  }
})

test('completed tickets do not accumulate work', () => {
  const state = createState()
  state.tickets[0].actualStatus = 'done'
  state.tickets[0].reportedStatus = 'done'
  state.tickets[0].completedWork = 10
  state.tickets[0].reportedProgress = 100
  assert.deepEqual(advanceSimulation(state, 100).tickets, state.tickets)
})

test('rejects negative and non-finite elapsed time without mutation', () => {
  const state = createState()
  const original = structuredClone(state)
  for (const seconds of [-1, NaN, Infinity, -Infinity]) {
    assert.throws(() => advanceSimulation(state, seconds), RangeError)
    assert.deepEqual(state, original)
  }
})

test('zero elapsed time leaves ticket state unchanged', () => {
  const state = createState()
  const result = advanceSimulation(state, 0)
  assert.deepEqual(result, state)
  assert.notStrictEqual(result, state)
})

test('does not mutate input, including nested objects', () => {
  const state = createState()
  const original = structuredClone(state)
  state.tickets.forEach(Object.freeze)
  state.developers.forEach(Object.freeze)
  Object.freeze(state.tickets)
  Object.freeze(state.developers)
  Object.freeze(state)

  const result = advanceSimulation(state, 2)
  assert.deepEqual(state, original)
  result.tickets[0].title = 'Changed output'
  result.developers[0].name = 'Changed output'
  assert.deepEqual(state, original)
})

test('prevents duplicate active work when collaboration is disabled', () => {
  const state = createState()
  state.developers.push({
    id: 'dev-2', name: 'Sam', activeTicketID: 'ticket-1', productivity: 1,
  })
  const result = advanceSimulation(state, 2)
  assert.equal(result.tickets[0].completedWork, 5)
  assert.equal(result.developers[1].activeTicketID, undefined)
})

test('automatically reports progress and lifecycle column changes', () => {
  const state = createState()
  const result = advanceSimulation(state, 1.5)
  assert.equal(result.tickets[0].reportedProgress, 40)
  assert.equal(result.tickets[0].reportedStatus, 'in_progress')
  const completed = advanceSimulation(result, 100)
  assert.equal(completed.tickets[0].reportedProgress, 100)
  assert.equal(completed.tickets[0].reportedStatus, 'done')
  assert.equal(state.tickets[0].reportedProgress, 10)
})

test('clamps reported progress even for idle tickets', () => {
  for (const [value, expected] of [[-10, 0], [150, 100], [NaN, 0], [Infinity, 100], [-Infinity, 0]]) {
    const state = createState()
    state.developers = []
    state.tickets[0].reportedProgress = value
    assert.equal(advanceSimulation(state, 1).tickets[0].reportedProgress, expected)
  }
})

test('zero-work tickets finish without dividing by zero', () => {
  const state = createState()
  state.tickets[0].requiredWork = 0
  state.tickets[0].completedWork = 0
  const result = advanceSimulation(state, 1)
  assert.equal(result.tickets[0].reportedProgress, 100)
  assert.equal(result.tickets[0].actualStatus, 'done')
})

test('reserves existing active work before idle developers select in ticket order', () => {
  const state = createState()
  const originalTicket = state.tickets[0]
  state.tickets.push({ ...originalTicket, id: 'ticket-2', assignedDeveloperId: 'someone-else' })
  state.developers.unshift({ id: 'idle', name: 'Idle', productivity: 1 })
  const result = advanceSimulation(state, 1)
  assert.equal(result.developers[0].activeTicketID, 'ticket-2')
  assert.equal(result.developers[1].activeTicketID, 'ticket-1')
  assert.equal(result.tickets[0].completedWork, 3)
  assert.equal(result.tickets[1].completedWork, 2)
  assert.equal(result.tickets[1].assignedDeveloperId, 'someone-else')
})

test('completion releases active work and subsequent calls select the next ticket', () => {
  const state = createState()
  state.tickets.push({ ...state.tickets[0], id: 'ticket-2', completedWork: 0, reportedProgress: 0 })
  const completed = advanceSimulation(state, 100)
  assert.equal(completed.developers[0].activeTicketID, undefined)
  assert.equal(completed.tickets[1].completedWork, 0)
  const next = advanceSimulation(completed, 1)
  assert.equal(next.developers[0].activeTicketID, 'ticket-2')
  assert.equal(next.tickets[1].completedWork, 2)
})

test('empty queues leave developers idle and still advance time', () => {
  const state = createState()
  state.tickets = []
  const result = advanceSimulation(state, 2)
  assert.equal(result.developers[0].activeTicketID, undefined)
  assert.equal(result.simulationTime, 12)
})

test('completed references are cleared and completed tickets are never selected again', () => {
  const state = createState()
  state.tickets[0].actualStatus = 'done'
  state.tickets[0].completedWork = 10
  const result = advanceSimulation(state, 1)
  assert.equal(result.developers[0].activeTicketID, undefined)
  assert.equal(result.tickets[0].completedWork, 10)
  assert.equal(result.tickets[0].reportedStatus, 'done')
  assert.equal(advanceSimulation(result, 100).developers[0].activeTicketID, undefined)
})
