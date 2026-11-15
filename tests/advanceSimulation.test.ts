import { close, expectedWork } from './helpers/focusExpectation.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import type { GameState } from '../src/game/types.ts'
import { nextRandom } from '../src/game/random.ts'

function createState(): GameState {
  return {
    randomState: 1,
    simulationTime: 10,
    developers: [
      { id: 'dev-1', name: 'Alex', activeTicketID: 'ticket-1', productivity: 2, competencies: { frontend: 5, backend: 5 }, judgement: 5, discipline: 5 },
    ],
    tickets: [
      {
        id: 'ticket-1',
        title: 'Example task', rank: 10,
        workDomain: 'frontend',
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
  close(result.tickets[0].completedWork, 1 + expectedWork(2, 1.5))
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
    close(result.tickets[0].completedWork, 1 + expectedWork(2, 1))
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
    id: 'dev-2', name: 'Sam', activeTicketID: 'ticket-1', productivity: 1, competencies: { frontend: 5, backend: 5 }, judgement: 5, discipline: 5,
  })
  const result = advanceSimulation(state, 2)
  close(result.tickets[0].completedWork, 1 + expectedWork(2, 2))
  assert.equal(result.developers[1].activeTicketID, undefined)
})

test('automatically reports progress and lifecycle column changes', () => {
  const state = createState()
  const result = advanceSimulation(state, 1.5)
  close(result.tickets[0].reportedProgress, (1 + expectedWork(2, 1.5)) * 10)
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
  state.developers.unshift({ id: 'idle', name: 'Idle', productivity: 1, competencies: { frontend: 5, backend: 5 }, judgement: 5, discipline: 5 })
  const result = advanceSimulation(state, 1)
  assert.equal(result.developers[0].activeTicketID, 'ticket-2')
  assert.equal(result.developers[1].activeTicketID, 'ticket-1')
  close(result.tickets[0].completedWork, 1 + expectedWork(2, 1))
  close(result.tickets[1].completedWork, 1 + expectedWork(1, 1))
  assert.equal(result.tickets[1].assignedDeveloperId, 'idle')
})

test('completion releases active work and subsequent calls select the next ticket', () => {
  const state = createState()
  state.tickets[0].completedWork = 9
  state.tickets.push({ ...state.tickets[0], id: 'ticket-2', completedWork: 0, reportedProgress: 0 })
  const completed = advanceSimulation(state, 1, () => 0.99)
  assert.equal(completed.developers[0].activeTicketID, undefined)
  assert.equal(completed.tickets[1].completedWork, 0)
  const next = advanceSimulation(completed, 1)
  assert.equal(next.developers[0].activeTicketID, 'ticket-2')
  close(next.tickets[1].completedWork, expectedWork(2, 1))
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

test('prototype assignment follows pickup and existing active work without mutating input', () => {
  for (const activeTicketID of [undefined, 'ticket-1']) {
    for (const assignedDeveloperId of [undefined, 'someone-else']) {
      const state = createState()
      state.developers[0].activeTicketID = activeTicketID
      state.tickets[0].assignedDeveloperId = assignedDeveloperId
      const result = advanceSimulation(state, 1)
      assert.equal(result.tickets[0].assignedDeveloperId, 'dev-1')
      assert.equal(result.developers[0].activeTicketID, 'ticket-1')
      assert.equal(state.tickets[0].assignedDeveloperId, assignedDeveloperId)
    }
  }
})

test('completion retains the last assignee after active work is released and on later ticks', () => {
  const state = createState()
  state.tickets[0].assignedDeveloperId = 'someone-else'
  const completed = advanceSimulation(state, 100)
  assert.equal(completed.tickets[0].assignedDeveloperId, 'dev-1')
  assert.equal(completed.developers[0].activeTicketID, undefined)
  assert.equal(advanceSimulation(completed, 1).tickets[0].assignedDeveloperId, 'dev-1')
})

test('unclaimed backlog remains unassigned and makes no progress', () => {
  const state = createState()
  state.tickets.push({ ...state.tickets[0], id: 'waiting', completedWork: 0, reportedProgress: 0 })
  const result = advanceSimulation(state, 1)
  assert.equal(result.tickets[1].assignedDeveloperId, undefined)
  assert.equal(result.tickets[1].completedWork, 0)
  assert.equal(result.tickets[1].reportedStatus, 'todo')
})

test('selection uses actual To Do and never touches actual Backlog, even with a stale active reference', () => {
  const state = createState()
  state.tickets[0].actualStatus = 'backlog'
  state.tickets[0].reportedStatus = 'todo'
  const backlog = structuredClone(state.tickets[0])
  state.tickets.push({ ...backlog, id: 'ready', actualStatus: 'todo', reportedStatus: 'backlog' })
  const result = advanceSimulation(state, 1)
  assert.deepEqual(result.tickets[0], backlog)
  assert.equal(result.developers[0].activeTicketID, 'ready')
  assert.equal(result.tickets[1].reportedStatus, 'in_progress')
  const finished = advanceSimulation(advanceSimulation(result, 100), 1)
  assert.deepEqual(finished.tickets[0], backlog)
  assert.equal(finished.developers[0].activeTicketID, undefined)
})


function createSelectionState(): GameState {
  const state = createState()
  delete state.developers[0].activeTicketID
  state.tickets.push(
    { ...state.tickets[0], id: 'todo-2' },
    { ...state.tickets[0], id: 'resume-1', actualStatus: 'in_progress', reportedStatus: 'backlog' },
    { ...state.tickets[0], id: 'resume-2', actualStatus: 'in_progress' },
  )
  state.tickets.forEach((ticket, index) => { ticket.rank = index + 1 })
  state.tickets[2].reportedProgress = 90
  return state
}

const noRoll = () => { throw new Error('Unexpected random roll') }

test('a single eligible ticket is selected without rolling', () => {
  for (const status of ['todo', 'in_progress'] as const) {
    const state = createSelectionState()
    state.tickets = state.tickets.filter(t => t.actualStatus === status).slice(0, 1)
    const result = advanceSimulation(state, 1, noRoll)
    assert.equal(result.developers[0].activeTicketID, state.tickets[0].id)
  }
})

test('no eligible work and zero elapsed time never roll', () => {
  const state = createSelectionState()
  assert.deepEqual(advanceSimulation(state, 0, noRoll), state)
  state.tickets = state.tickets.map((t, i) => ({ ...t, actualStatus: i % 2 ? 'backlog' : 'done' }))
  assert.equal(advanceSimulation(state, 1, noRoll).developers[0].activeTicketID, undefined)
})

test('resuming work reserves active tickets and prevents duplicate claims', () => {
  const state = createSelectionState()
  state.developers.unshift({ id: 'busy', name: 'Busy', activeTicketID: 'resume-1', productivity: 1, competencies: { frontend: 5, backend: 5 }, judgement: 5, discipline: 5 })
  state.developers.push({ id: 'other', name: 'Other', productivity: 1, competencies: { frontend: 5, backend: 5 }, judgement: 5, discipline: 5 })
  let calls = 0
  const result = advanceSimulation(state, 1, () => { calls++; return 0.9 })
  assert.equal(result.developers[0].activeTicketID, 'resume-1')
  assert.equal(result.developers[1].activeTicketID, 'ticket-1')
  assert.equal(result.developers[2].activeTicketID, 'todo-2')
  assert.equal(calls, 1)
})

test('seeded state replays identical transitions and serialized continuation', () => {
  const state = createSelectionState()
  state.randomState = 12345
  const original = structuredClone(state)
  const first = advanceSimulation(state, 1)
  assert.deepEqual(advanceSimulation(state, 1), first)
  assert.deepEqual(state, original)
  assert.notEqual(first.randomState, state.randomState)
  let replay = JSON.parse(JSON.stringify(first)) as GameState
  let continued = first
  for (let i = 0; i < 15; i++) {
    replay = advanceSimulation(replay, 1)
    continued = advanceSimulation(continued, 1)
    assert.deepEqual(replay, continued)
  }
  assert.equal(advanceSimulation(first, 1).randomState, nextRandom(first.randomState).state)
  assert.equal(advanceSimulation(state, 0).randomState, state.randomState)
})

function switchingState(): GameState {
  const state = createState()
  state.tickets[0].actualStatus = 'in_progress'
  state.tickets[0].reportedStatus = 'in_progress'
  state.tickets[0].assignedDeveloperId = 'dev-1'
  state.tickets[0].requiredWork = 100
  state.tickets.push({ ...state.tickets[0], id: 'alternative', actualStatus: 'todo', reportedStatus: 'todo', completedWork: 0 })
  return state
}

test('one-percent switching boundary applies work only to the final ticket', () => {
  for (const roll of [0, 0.009999, 0.01, 0.999999]) {
    const state = switchingState()
    const original = structuredClone(state)
    let calls = 0
    const result = advanceSimulation(state, 1, () => { calls++; return roll })
    assert.equal(calls, 1)
    const switched = roll < 0.01
    assert.equal(result.developers[0].activeTicketID, switched ? 'alternative' : 'ticket-1')
    close(result.tickets[0].completedWork, switched ? 1 : 1 + expectedWork(2, 1))
    close(result.tickets[1].completedWork, switched ? expectedWork(2, 1) : 0)
    assert.equal(result.tickets[0].actualStatus, 'in_progress')
    assert.equal(result.tickets[0].assignedDeveloperId, 'dev-1')
    assert.equal(result.tickets[0].reportedStatus, 'in_progress')
    assert.deepEqual(state, original)
  }
})

test('successful switch roll without alternatives retains active work', () => {
  const state = switchingState()
  state.tickets[1].actualStatus = 'backlog'
  state.tickets.push({ ...state.tickets[1], id: 'done', actualStatus: 'done', completedWork: 100 })
  let calls = 0
  const result = advanceSimulation(state, 1, () => { calls++; return 0 })
  assert.equal(calls, 1)
  assert.equal(result.developers[0].activeTicketID, 'ticket-1')
  close(result.tickets[0].completedWork, 1 + expectedWork(2, 1))
  assert.deepEqual(result.tickets[1], state.tickets[1])
})

test('multiple switches resolve in developer order without duplicate claims or double work', () => {
  const state = switchingState()
  state.tickets.push({ ...state.tickets[0], id: 'other-active', completedWork: 5 })
  state.developers.push({ id: 'dev-2', name: 'Sam', productivity: 1, activeTicketID: 'other-active', competencies: { frontend: 5, backend: 5 }, judgement: 5, discipline: 5 })
  const result = advanceSimulation(state, 1, () => 0)
  assert.equal(result.developers[0].activeTicketID, 'alternative')
  assert.equal(result.developers[1].activeTicketID, 'ticket-1')
  close(result.tickets[0].completedWork, 1 + expectedWork(1, 1))
  close(result.tickets[1].completedWork, expectedWork(2, 1))
  assert.equal(result.tickets[2].completedWork, 5)
  assert.equal(result.tickets[2].actualStatus, 'in_progress')
})

test('switch replacements reuse the reported-progress contest', () => {
  const state = switchingState()
  state.tickets.push(
    { ...state.tickets[0], id: 'resume-a' },
    { ...state.tickets[0], id: 'resume-b' },
  )
  state.tickets[3].reportedProgress = 90
  const values = [0, 0]
  let calls = 0
  const result = advanceSimulation(state, 1, () => values[calls++])
  assert.equal(calls, 2)
  assert.equal(result.developers[0].activeTicketID, 'resume-b')
  assert.equal(result.tickets[0].completedWork, 1)
})

test('switch RNG state advances exactly once for a check and replay remains pure', () => {
  const state = switchingState()
  // Seed 1972 yields a first draw below 1%; replacement is the sole To Do ticket.
  let seed = 0
  while (nextRandom(seed).value >= 0.01) seed++
  state.randomState = seed
  const original = structuredClone(state)
  const first = advanceSimulation(state, 1)
  assert.equal(first.developers[0].activeTicketID, 'alternative')
  assert.equal(first.randomState, nextRandom(seed).state)
  assert.deepEqual(advanceSimulation(state, 1), first)
  assert.deepEqual(state, original)
  assert.deepEqual(advanceSimulation(JSON.parse(JSON.stringify(first)), 1), advanceSimulation(first, 1))
})

test('large durations process independent one-second ticks; fractional probability scales with time', () => {
  const state = switchingState()
  assert.deepEqual(advanceSimulation(state, 10),
    Array.from({ length: 10 }).reduce<GameState>(s => advanceSimulation(s, 1), state))
  // A half-second has ~0.5013% chance, rather than the full 1% per call.
  assert.equal(advanceSimulation(state, 0.5, () => 0.006).developers[0].activeTicketID, 'ticket-1')
  const switched = advanceSimulation(state, 0.5, () => 0.004)
  assert.equal(switched.developers[0].activeTicketID, 'alternative')
  close(switched.tickets[1].completedWork, expectedWork(2, 0.5))
})
