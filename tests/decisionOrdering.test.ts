import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { projectCompletion } from '../src/game/completionTime.ts'
import { remainingWorkNumber } from '../src/game/work.ts'
import { close } from './helpers/flowExpectation.ts'

function coincident(reverse = false) {
  const state = structuredClone(exampleGameState)
  const base = { ...state.developers[0], productivity: 1, focus: 0, competencies: { frontend: 5, backend: 5 } }
  state.developers = [
    { ...base, id: 'finishing', activeTicketID: 'finishing-work', assessmentClock: { elapsed: 0, remaining: 1000 } },
    { ...base, id: 'reconsidering', activeTicketID: 'ongoing', assessmentClock: { elapsed: 0, remaining: 1000 } },
  ]
  const ticket = state.tickets[0]
  state.tickets = [
    { ...ticket, id: 'finishing-work', rank: 3, requiredWork: 1, completedWork: 0 },
    { ...ticket, id: 'ongoing', rank: 2, requiredWork: 1000, completedWork: 0 },
    { ...ticket, id: 'contested', rank: 1, requiredWork: 100, completedWork: 0, actualStatus: 'todo', reportedStatus: 'todo' },
  ]
  const due = projectCompletion(state.developers[0], state.tickets[0], true).seconds!
  assert.ok(due > 0)
  state.developers[1].assessmentClock!.remaining = due
  if (reverse) state.developers.reverse()
  return { state, due }
}

test('positive-time completion and reassessment share one engineer-ordered decision pass', () => {
  const { state, due } = coincident()
  let calls = 0
  const result = advanceSimulation(state, due + 0.25, () => { calls++; return 0.99 })
  assert.equal(result.tickets[0].actualStatus, 'done')
  assert.equal(result.developers[0].activeTicketID, 'contested')
  assert.equal(result.developers[0].lastAssessment?.kind, 'pickup')
  assert.equal(result.developers[1].activeTicketID, 'ongoing')
  assert.equal(result.developers[1].lastAssessment?.kind, 'reconsideration')
  assert.equal(result.developers[1].lastAssessment?.alternative, null)
  assert.equal(calls, 2) // pickup schedule, then no-alternative reassessment schedule
})

test('reverse engineer order gives the earlier reassessment first claim, not a pickup priority', () => {
  const { state, due } = coincident(true)
  let calls = 0
  const result = advanceSimulation(state, due + 0.25, () => { calls++; return 0.99 })
  assert.equal(result.developers[0].activeTicketID, 'contested')
  assert.equal(result.developers[0].lastAssessment?.kind, 'reconsideration')
  assert.equal(result.developers[1].activeTicketID, 'ongoing')
  const claims = result.developers.map(developer => developer.activeTicketID)
  assert.equal(new Set(claims).size, claims.length)
  assert.equal(calls, 3) // error, reassessment schedule, then pickup schedule
})

test('partitioning across decisions and completions preserves claims, RNG and numerical work', () => {
  for (const reverse of [false, true]) {
    const { state, due } = coincident(reverse)
    const whole = advanceSimulation(state, due + 0.25)
    const first = advanceSimulation(state, due / 2)
    const split = advanceSimulation(advanceSimulation(first, due / 2), 0.25)
    assert.equal(whole.randomState, split.randomState)
    assert.deepEqual(whole.developers.map(d => d.activeTicketID), split.developers.map(d => d.activeTicketID))
    assert.deepEqual(whole.tickets.map(t => t.actualStatus), split.tickets.map(t => t.actualStatus))
    for (let i = 0; i < whole.tickets.length; i++) close(remainingWorkNumber(whole.tickets[i])!, remainingWorkNumber(split.tickets[i])!)
  }
})

test('three 0.3 advances and the remainder preserve the exact coincident-event decisions and RNG', () => {
  for (const reverse of [false, true]) {
    const { state, due } = coincident(reverse)
    state.randomState = 1
    const whole = advanceSimulation(state, due + 0.25)
    let split = state
    for (let i = 0; i < 3; i++) split = advanceSimulation(split, 0.3)
    split = advanceSimulation(split, due + 0.25 - 0.9)
    assert.equal(whole.randomState, reverse ? 2165703038 : 1586005467)
    assert.equal(split.randomState, whole.randomState)
    assert.deepEqual(split.developers.map(d => [d.id, d.activeTicketID, d.lastAssessment?.outcome, d.lastAssessment?.selectedId]),
      whole.developers.map(d => [d.id, d.activeTicketID, d.lastAssessment?.outcome, d.lastAssessment?.selectedId]))
    assert.deepEqual(split.tickets.map(t => [t.id, t.actualStatus, t.assignedDeveloperId]),
      whole.tickets.map(t => [t.id, t.actualStatus, t.assignedDeveloperId]))
  }
})

test('nonbinary partitions and JSON restoration retain mixed-event coincidence in both engineer orders', () => {
  for (const reverse of [false, true]) {
    for (const parts of [[0.1, 0.2, 0.3], [0.13, 0.17, 0.19, 0.23]]) {
      const { state, due } = coincident(reverse)
      const whole = advanceSimulation(state, due + 0.25)
      let split = state
      for (const seconds of parts) split = JSON.parse(JSON.stringify(advanceSimulation(split, seconds)))
      split = advanceSimulation(split, due + 0.25 - parts.reduce((sum, part) => sum + part, 0))
      assert.equal(split.randomState, whole.randomState)
      assert.deepEqual(split.developers.map(d => [d.activeTicketID, d.lastAssessment?.kind, d.lastAssessment?.outcome]),
        whole.developers.map(d => [d.activeTicketID, d.lastAssessment?.kind, d.lastAssessment?.outcome]))
      assert.deepEqual(split.tickets.map(t => t.assignedDeveloperId), whole.tickets.map(t => t.assignedDeveloperId))
    }
  }
})

test('nearby but genuinely different event times are not merged by a tolerance window', () => {
  const { state, due } = coincident()
  state.developers[1].assessmentClock!.remaining = due - 1e-12
  const earlierAssessment = advanceSimulation(state, due + 0.25, () => 0.99)
  assert.equal(earlierAssessment.developers[1].activeTicketID, 'contested')
  assert.equal(earlierAssessment.developers[0].activeTicketID, 'ongoing')
  const later = coincident()
  later.state.developers[1].assessmentClock!.remaining = due + 1e-12
  const earlierCompletion = advanceSimulation(later.state, due + 0.25, () => 0.99)
  assert.equal(earlierCompletion.developers[0].activeTicketID, 'contested')
  assert.equal(earlierCompletion.developers[1].activeTicketID, 'ongoing')
})

test('one-ULP-separated completion and assessment events retain chronological priority', () => {
  for (const direction of [-1n, 1n]) {
    const { state, due } = coincident()
    const bits = new DataView(new ArrayBuffer(8))
    bits.setFloat64(0, due)
    bits.setBigUint64(0, bits.getBigUint64(0) + direction)
    state.developers[1].assessmentClock!.remaining = bits.getFloat64(0)
    const result = advanceSimulation(state, due + 0.25, () => 0.99)
    assert.equal(result.developers[direction < 0n ? 1 : 0].activeTicketID, 'contested')
  }
})

test('an assessment at a call boundary is processed once, with no repeated zero-duration event', () => {
  const { state } = coincident()
  state.tickets[0].requiredWork = 1000
  state.developers[0].assessmentClock!.remaining = 0.3
  let draws = 0
  const random = () => { draws++; return 0.5 }
  const first = advanceSimulation(state, 0.3, random)
  const afterBoundary = draws
  assert.ok(first.developers[0].assessmentClock!.remaining > 0)
  const zero = advanceSimulation(first, 0, random)
  assert.deepEqual(zero, first)
  const second = advanceSimulation(first, 0.1, random)
  assert.equal(draws, afterBoundary)
  assert.ok(second.developers[0].assessmentClock!.remaining > 0)
})
