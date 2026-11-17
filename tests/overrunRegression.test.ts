import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { nextRandom } from '../src/game/random.ts'
import { effortNumber } from '../src/game/workLog.ts'
import type { GameState } from '../src/game/types.ts'
import { close } from './helpers/flowExpectation.ts'
import legacySeed1 from './fixtures/issue68-legacy-seed1.json' with { type: 'json' }

function equivalent(actual: GameState, expected: GameState) {
  assert.equal(actual.randomState, expected.randomState)
  assert.deepEqual(actual.tickets.map(t => [t.id, t.actualStatus, t.reportedStatus, t.assignedDeveloperId,
    t.initialEffortEstimate, t.reportedEffortEstimate, t.overrunEvaluationConsumed, t.lastEstimateEvaluation]),
  expected.tickets.map(t => [t.id, t.actualStatus, t.reportedStatus, t.assignedDeveloperId,
    t.initialEffortEstimate, t.reportedEffortEstimate, t.overrunEvaluationConsumed, t.lastEstimateEvaluation]))
  assert.deepEqual(actual.developers.map(d => [d.id, d.activeTicketID, d.lastAssessment, d.estimateDiscovery]),
    expected.developers.map(d => [d.id, d.activeTicketID, d.lastAssessment, d.estimateDiscovery]))
  assert.deepEqual(actual.workLog?.map(e => [e.developerId, e.ticketId]), expected.workLog?.map(e => [e.developerId, e.ticketId]))
  actual.tickets.forEach((t, i) => close(t.completedWork, expected.tickets[i].completedWork))
  actual.workLog?.forEach((e, i) => close(effortNumber(e.effort)!, effortNumber(expected.workLog![i].effort)!))
  const active = actual.developers.flatMap(d => d.activeTicketID ? [d.activeTicketID] : [])
  assert.equal(new Set(active).size, active.length)
}

test('#68 ordinary seed 454327756 completes 500 seconds in one shot and one-second calls', () => {
  const state = structuredClone(exampleGameState)
  state.randomState = 454327756
  const original = structuredClone(state)
  const whole = advanceSimulation(state, 500)
  let split = state
  for (let i = 0; i < 500; i++) split = advanceSimulation(split, 1)
  assert.deepEqual(split, whole)
  assert.deepEqual(advanceSimulation(state, 500), whole)
  assert.deepEqual(state, original)
  assert.ok(whole.tickets.filter(t => t.actualStatus !== 'backlog').every(t => t.actualStatus === 'done'))
})

test('#68 restores the real pre-crossing legacy seed 1 save without consuming its first alarm', () => {
  // Captured with c097aae26c554a3bcb8b4da0bb54710c407bc426:
  // JSON.parse(JSON.stringify(advanceSimulation(exampleGameState, 1))).
  const saved: GameState = JSON.parse(JSON.stringify(legacySeed1))
  const ticket = saved.tickets.find(t => t.id === 'ticket-2')!
  assert.equal(ticket.completedWork, 2.6180004433156925)
  assert.equal(ticket.initialEffortEstimate!.totalWork, 4.41411834256028)
  assert.equal(ticket.lastEstimateEvaluation!.reason, 'discovery')
  assert.equal(ticket.overrunEvaluationConsumed, undefined)
  const original = structuredClone(saved)
  const control = structuredClone(saved)
  control.tickets.find(t => t.id === ticket.id)!.overrunEvaluationConsumed = false
  const noDraw = () => { throw Error('Migration must retain seeded discovery targets') }
  let current = advanceSimulation(saved, 0.01, noDraw)
  assert.deepEqual(current, advanceSimulation(control, 0.01, noDraw))
  assert.equal(current.randomState, saved.randomState)
  assert.deepEqual(current.developers.map(d => d.estimateDiscovery), saved.developers.map(d => d.estimateDiscovery))
  assert.deepEqual(saved, original)
  assert.equal(current.tickets.find(t => t.id === ticket.id)!.overrunEvaluationConsumed, false)
  assert.deepEqual(current.developers.find(d => d.activeTicketID === ticket.id)!.workSession!.estimateEvents!.overrun,
    saved.developers.find(d => d.activeTicketID === ticket.id)!.workSession!.estimateEvents!.overrun)

  // Follow ordinary seeded play until the first actual crossing, through saves.
  let crossingBoard = ticket.reportedEffortEstimate!
  for (let step = 0; step < 1000 && !current.tickets.find(t => t.id === ticket.id)!.overrunEvaluationConsumed; step++) {
    crossingBoard = current.tickets.find(t => t.id === ticket.id)!.reportedEffortEstimate!
    current = JSON.parse(JSON.stringify(advanceSimulation(current, 0.01)))
  }
  const crossed = current.tickets.find(t => t.id === ticket.id)!
  assert.equal(crossed.overrunEvaluationConsumed, true)
  assert.equal(crossed.lastEstimateEvaluation!.reason, 'overrun')
  assert.ok(crossed.completedWork >= crossingBoard)
  const crossing = structuredClone(crossed.lastEstimateEvaluation)
  for (let step = 0; step < 500; step++) {
    current = advanceSimulation(current, 0.1)
    const later = current.tickets.find(t => t.id === ticket.id)!
    assert.equal(later.overrunEvaluationConsumed, true)
    if (later.lastEstimateEvaluation!.reason === 'overrun') assert.deepEqual(later.lastEstimateEvaluation, crossing)
    assert.ok(current.developers.filter(d => d.activeTicketID === ticket.id)
      .every(d => d.workSession?.estimateEvents?.overrun === null))
  }
})

test('#68 seeded multi-engineer cohorts preserve decisions, publications, claims and RNG across partitions and saves', () => {
  let seed = 1
  const seeds = [454327756, 1, 42, 58]
  for (let i = 0; i < 12; i++) { seed = nextRandom(seed).state; seeds.push(seed) }
  for (const randomState of seeds) {
    for (const reverse of [false, true]) {
      const initial = structuredClone(exampleGameState)
      initial.randomState = randomState
      if (reverse) initial.developers.reverse()
      // Also exercise starts with no retained progress, without changing any rates.
      if (reverse) for (const ticket of initial.tickets) { ticket.completedWork = 0; ticket.reportedProgress = 0 }
      let seconds = initial, fractions = initial
      for (let second = 1; second <= 30; second++) {
        seconds = advanceSimulation(seconds, 1)
        for (let tenth = 0; tenth < 10; tenth++) {
          fractions = JSON.parse(JSON.stringify(advanceSimulation(fractions, 0.1)))
        }
        const whole = advanceSimulation(initial, second)
        equivalent(seconds, whole)
        equivalent(fractions, whole)
      }
      assert.deepEqual(advanceSimulation(seconds, 470), advanceSimulation(initial, 500))
      assert.deepEqual(advanceSimulation(JSON.parse(JSON.stringify(seconds)), 1), advanceSimulation(seconds, 1))
    }
  }
})
