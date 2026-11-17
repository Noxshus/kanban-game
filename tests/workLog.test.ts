import { decideNow } from './helpers/decisionFixture.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { compareWork, integratedWork, workAmount } from '../src/game/work.ts'
import type { WorkAmount } from '../src/game/work.ts'
import { effortNumber, recordProductiveEffort } from '../src/game/workLog.ts'
import { getAverageFlowMultiplier } from '../src/game/flow.ts'
import { getDiagnosticsView } from '../src/store/diagnosticsView.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { simulationReducer } from '../src/store/simulationControls.ts'
import type { GameState } from '../src/game/types.ts'
import { estimatedFixture } from './helpers/estimatedFixture.ts'
import { close, expectedWork } from './helpers/flowExpectation.ts'

const expectedEffort = (rate: number, seconds: number) => expectedWork(rate, seconds, 0)

function fixture(requiredWork = 1e6, completedWork = 0): GameState {
  const state = structuredClone(exampleGameState)
  state.developers = [{ ...state.developers[0], productivity: 1, focus: 0,
    competencies: { frontend: 5, backend: 5 }, assessmentClock: { elapsed: 0, remaining: 1000 } }]
  state.tickets = [{ ...state.tickets[0], requiredWork, completedWork }]
  return estimatedFixture(state)
}

function effort(state: GameState, developerId = 'developer-1', ticketId = 'ticket-1') {
  const record = state.workLog?.find(entry => entry.developerId === developerId && entry.ticketId === ticketId)
  return record ? effortNumber(record.effort) : 0
}

function handoff(state: GameState, developerId: string) {
  for (const developer of state.developers) {
    delete developer.activeTicketID
    delete developer.workSession
    delete developer.flowStreak
    delete developer.assessmentClock
    if (developer.id === developerId) {
      developer.activeTicketID = 'ticket-1'
      developer.assessmentClock = { elapsed: 0, remaining: 1000 }
    }
  }
}

test('cumulative effort reuses the integral baseline, rather than adding cumulative totals twice', () => {
  const state = fixture(), original = structuredClone(state)
  const one = advanceSimulation(state, 1)
  const three = advanceSimulation(one, 2)
  const six = advanceSimulation(three, 3)
  close(effort(one)!, expectedEffort(1, 1))
  close(effort(three)!, expectedEffort(1, 3))
  close(effort(six)!, expectedEffort(1, 6))
  assert.deepEqual(six.workLog, advanceSimulation(state, 6).workLog)
  assert.equal(six.workLog!.length, 1)
  assert.deepEqual(state, original)
})

test('handoffs and returning preserve all contributors independently of ownership', () => {
  let state = fixture()
  state.developers.push({ ...state.developers[0], id: 'engineer-B', name: 'Blair', activeTicketID: undefined })
  state.tickets[0].assignedDeveloperId = 'engineer-B'
  state = advanceSimulation(state, 1)
  assert.equal(effort(state, 'engineer-B'), 0)
  handoff(state, 'engineer-B')
  state = advanceSimulation(state, 2)
  close(effort(state)!, expectedEffort(1, 1))
  close(effort(state, 'engineer-B')!, expectedEffort(1, 2))
  handoff(state, 'developer-1')
  state = advanceSimulation(state, 1)
  close(effort(state)!, 2 * expectedEffort(1, 1))
  close(effort(state, 'engineer-B')!, expectedEffort(1, 2))
  assert.equal(state.workLog!.length, 2)
  assert.equal(state.tickets[0].assignedDeveloperId, 'developer-1')
})

test('a replacement completes the remaining work without claiming its predecessor or unknown history', () => {
  let state = fixture(103, 100)
  state.developers.push({ ...state.developers[0], id: 'engineer-B', activeTicketID: undefined })
  state = advanceSimulation(state, 1)
  const first = effort(state)!
  handoff(state, 'engineer-B')
  state = advanceSimulation(state, 10)
  assert.equal(state.tickets[0].actualStatus, 'done')
  assert.equal(state.tickets[0].completedWork, 103)
  assert.equal(effort(state), first)
  close(effort(state, 'engineer-B')!, 3 - first)
  assert.equal(state.workLog!.length, 2)
})

test('domain competency and integrated Flow determine effort using the unchanged production rate', () => {
  const state = fixture()
  state.tickets[0].workDomain = 'backend'
  state.developers[0].productivity = 2
  state.developers[0].competencies.backend = 10
  state.developers[0].focus = 10
  const result = advanceSimulation(state, 2)
  close(effort(result)!, expectedWork(3, 2, 10))
  close(effort(result)!, result.tickets[0].completedWork)
  assert.equal(result.developers[0].focus, 10)
})

test('simultaneous active work is attributed by active engineer/ticket IDs, never ownership or array position', () => {
  const state = fixture()
  state.developers.unshift({ ...state.developers[0], id: 'idle', activeTicketID: undefined })
  state.developers.push({ ...state.developers[1], id: 'engineer-B', productivity: 2, activeTicketID: 'second' })
  state.tickets.push({ ...state.tickets[0], id: 'second', rank: 2, assignedDeveloperId: 'developer-1' })
  state.tickets[0].assignedDeveloperId = 'engineer-B'
  const result = advanceSimulation(state, 2)
  close(effort(result)!, expectedEffort(1, 2))
  close(effort(result, 'engineer-B', 'second')!, expectedEffort(2, 2))
  assert.equal(effort(result, 'engineer-B'), 0)
  assert.equal(effort(result, 'idle'), 0)
  assert.equal(result.workLog!.length, 2)
})

test('decision events credit each ticket only productive intervals and preserve returning experience', () => {
  let s=advanceSimulation(fixture(),1.5)
  s.tickets.push({...fixture().tickets[0],id:'alternative',rank:2,completedWork:0,actualStatus:'todo',reportedProgress:99.999})
  s=advanceSimulation(decideNow(s),.5)
  assert.equal(s.developers[0].activeTicketID,'alternative')
  close(effort(s)!,expectedEffort(1,1.5))
  close(effort(s,'developer-1','alternative')!,expectedEffort(1,.5))
  s.tickets[0].reportedProgress=99.9999;s.tickets[1].reportedProgress=0
  s=advanceSimulation(decideNow(s),.25)
  assert.equal(s.developers[0].activeTicketID,'ticket-1')
  close(effort(s)!,expectedEffort(1,1.5)+expectedEffort(1,.25))
  close(effort(s,'developer-1','alternative')!,expectedEffort(1,.5))
})
test('completion caps credited productive work, chains tickets and retains finished contributions', () => {
  const state = fixture(1)
  state.tickets.push({ ...state.tickets[0], id: 'next', rank: 2, requiredWork: 2, actualStatus: 'todo' })
  estimatedFixture(state)
  const whole = advanceSimulation(state, 10)
  let split = state
  for (let i = 0; i < 40; i++) split = advanceSimulation(split, 0.25)
  assert.equal(effort(whole), 1)
  assert.equal(effort(whole, 'developer-1', 'next'), 2)
  assert.deepEqual(whole.workLog, split.workLog)
  assert.equal(whole.randomState, split.randomState)
  assert.ok(whole.tickets.every(ticket => ticket.actualStatus === 'done'))
  const later = advanceSimulation(whole, 100, () => { throw Error('Idle work cannot draw') })
  assert.deepEqual(later.workLog, whole.workLog)
})

test('gross effort survives a reduction in retained ticket progress without implementing a loss mechanic', () => {
  let state = advanceSimulation(fixture(), 3)
  const previous = effort(state)!
  // An external edit stands in for future #61; it must not erase contribution history.
  state.tickets[0].completedWork = 0
  delete state.tickets[0].workRemainder
  state = advanceSimulation(state, 1)
  assert.ok(effort(state)! > previous)
  assert.ok(effort(state)! > state.tickets[0].completedWork)
  close(effort(state)!, previous + state.tickets[0].completedWork)
})

test('zero time, pausing, idle and holding work at zero productivity add no contributions', () => {
  const state = fixture()
  assert.deepEqual(advanceSimulation(state, 0), state)
  assert.equal(advanceSimulation(state, 0).workLog, undefined)
  const paused = { game: state, isPaused: true }
  assert.strictEqual(simulationReducer(paused, { type: 'tick' }), paused)
  state.developers[0].productivity = 0
  const held = advanceSimulation(state, 1)
  assert.equal(held.workLog, undefined)
  assert.equal(held.tickets[0].completedWork, 0)
  assert.equal(held.developers[0].activeTicketID, 'ticket-1')
  state.developers = []
  assert.equal(advanceSimulation(state, 5).workLog, undefined)
  const completed = fixture(1, 1)
  assert.equal(advanceSimulation(completed, 1).workLog, undefined)
})

test('stale Backlog and duplicate active claims never produce ledger records', () => {
  const state = fixture()
  state.tickets.push({ ...state.tickets[0], id: 'backlog', rank: 2, actualStatus: 'backlog', reportedStatus: 'todo' })
  state.developers.push({ ...state.developers[0], id: 'duplicate' },
    { ...state.developers[0], id: 'stale', activeTicketID: 'backlog' })
  const result = advanceSimulation(state, 1)
  assert.equal(result.workLog!.length, 1)
  assert.equal(result.workLog![0].developerId, 'developer-1')
  assert.equal(result.workLog![0].ticketId, 'ticket-1')
  assert.deepEqual(result.tickets[1], state.tickets[1])
})

test('legacy states and mid-session upgrades never fabricate historical engineer effort', () => {
  const state = fixture(1e6, 100)
  const first = advanceSimulation(state, 1)
  close(effort(first)!, expectedEffort(1, 1))
  assert.ok(effort(first)! < first.tickets[0].completedWork)
  const legacy = advanceSimulation(state, 6)
  delete legacy.workLog
  delete legacy.developers[0].workSession!.effortOrigin
  const original = structuredClone(legacy)
  const updated = advanceSimulation(legacy, 1)
  close(effort(updated)!, expectedEffort(1, 7) - expectedEffort(1, 6))
  const again = advanceSimulation(updated, 1)
  close(effort(again)!, expectedEffort(1, 8) - expectedEffort(1, 6))
  assert.deepEqual(legacy, original)
  assert.deepEqual(advanceSimulation(JSON.parse(JSON.stringify(updated)), 1), again)
})

test('cloning, freezing, JSON restore and repeated transitions preserve the durable ledger', () => {
  const first = advanceSimulation(fixture(), 2), original = structuredClone(first)
  Object.freeze(first.workLog![0].effort)
  Object.freeze(first.workLog![0])
  Object.freeze(first.workLog)
  const next = advanceSimulation(first, 3)
  assert.deepEqual(next, advanceSimulation(JSON.parse(JSON.stringify(first)), 3))
  assert.deepEqual(next, advanceSimulation(first, 3))
  assert.deepEqual(first, original)
  assert.notStrictEqual(next.workLog![0].effort, first.workLog![0].effort)
})

test('nonbinary partitions with repeated reassessments preserve ledger, seeded RNG and Flow', () => {
  const state = fixture()
  state.developers[0].assessmentClock!.remaining = 0.3
  const whole = advanceSimulation(state, 60)
  let split = state
  for (let i = 0; i < 3; i++) split = JSON.parse(JSON.stringify(advanceSimulation(split, 0.3)))
  split = advanceSimulation(split, 59.1)
  close(effort(whole)!, expectedEffort(1, 60))
  close(effort(split)!, effort(whole)!)
  assert.equal(split.randomState, whole.randomState)
  assert.deepEqual(split.developers.map(d => [d.activeTicketID, d.lastAssessment]), whole.developers.map(d => [d.activeTicketID, d.lastAssessment]))
  close(split.developers[0].flowStreak!.duration, whole.developers[0].flowStreak!.duration)
})

test('effort records actual work even when adding it to a large ticket total rounds away', () => {
  const state = fixture(1e20, 1e20 - 16384)
  state.developers[0].productivity = 1000
  const first = advanceSimulation(state, 1)
  assert.equal(first.tickets[0].completedWork, state.tickets[0].completedWork)
  close(effort(first)!, expectedEffort(1000, 1))
  const whole = advanceSimulation(state, 20)
  let split = state
  for (let i = 0; i < 20; i++) split = advanceSimulation(split, 1)
  assert.equal(effort(whole), 16384)
  assert.deepEqual(split.workLog, whole.workLog)
})

test('subnormal fractional effort is retained before any scalar work total can represent it', () => {
  const state = fixture(Number.MIN_VALUE)
  state.developers[0].productivity = Number.MIN_VALUE
  state.developers[0].competencies.frontend = 0
  const first = advanceSimulation(state, 1)
  assert.equal(first.tickets[0].completedWork, 0)
  assert.equal(effort(first), null)
  assert.ok(first.workLog![0].effort.exponent < -1074)
  assert.ok(compareWork(first.workLog![0].effort, workAmount(0)) > 0)
  const whole = advanceSimulation(state, 3)
  const split = advanceSimulation(advanceSimulation(first, 1), 1)
  assert.equal(effort(whole), Number.MIN_VALUE)
  assert.deepEqual(split.workLog, whole.workLog)
  assert.deepEqual(advanceSimulation(JSON.parse(JSON.stringify(first)), 1), advanceSimulation(first, 1))
})

test('compensated ledger sums retain small contributions across separate integration sessions', () => {
  let state = fixture()
  state.workLog = [{ developerId: 'developer-1', ticketId: 'ticket-1', effort: workAmount(1e20) }]
  state = advanceSimulation(state, 1)
  delete state.developers[0].workSession // a new numerical origin with uninterrupted Flow
  state = advanceSimulation(state, 1)
  const amount = state.workLog![0].effort
  assert.ok(compareWork(amount, workAmount(1e20)) > 0)
  close(-amount.correction * 2 ** amount.exponent, expectedEffort(1, 2))
})

test('invalid, overflowing or unsupported-precision ledger values fail without mutating input', () => {
  for (const bad of [
    { mantissa: -1, exponent: 0, correction: 0 },
    { mantissa: Infinity, exponent: 0, correction: 0 },
    { mantissa: 1, exponent: NaN, correction: 0 },
    { mantissa: 1, exponent: 0, correction: NaN },
    workAmount(Number.MAX_VALUE),
  ]) {
    const state = fixture()
    state.workLog = [{ developerId: 'developer-1', ticketId: 'ticket-1', effort: bad }]
    const original = structuredClone(state)
    assert.throws(() => advanceSimulation(state, 1), RangeError)
    assert.deepEqual(state, original)
  }
  const tiny = fixture(Number.MIN_VALUE)
  tiny.developers[0].productivity = Number.MIN_VALUE
  tiny.workLog = [{ developerId: 'developer-1', ticketId: 'ticket-1', effort: workAmount(1e300) }]
  const original = structuredClone(tiny)
  assert.throws(() => advanceSimulation(tiny, 1), /Work-log increment is below numeric resolution/)
  assert.deepEqual(tiny, original)
  const duplicate = fixture()
  duplicate.workLog = [0, 0].map(() => ({ developerId: 'developer-1', ticketId: 'ticket-1', effort: workAmount(1) }))
  assert.throws(() => advanceSimulation(duplicate, 1), /Duplicate/)
})

test('logging consumes no RNG and does not expose history in player information', () => {
  const state = fixture()
  state.developers[0].assessmentClock!.remaining = 0.5
  const result = advanceSimulation(state, 1)
  assert.equal(result.randomState, state.randomState) // the existing reschedule only
  assert.equal(result.tickets[0].reportedEffortEstimate, state.tickets[0].reportedEffortEstimate)
  assert.deepEqual(result.tickets[0].initialEffortEstimate, state.tickets[0].initialEffortEstimate)
  assert.equal(result.tickets[0].rank, state.tickets[0].rank)
  assert.equal(result.developers[0].flowStreak!.duration, 1)
  const view = getPlayerView(result)
  assert.equal('workLog' in view, false)
  assert.ok(view.tickets.every(t => !('contributions' in t) && !('workSession' in t)))
  const withoutLog = structuredClone(result)
  delete withoutLog.workLog
  assert.deepEqual(getPlayerView(withoutLog), view)
  const diagnostics = getDiagnosticsView(result)
  close(diagnostics.tickets[0].contributions[0].effort!, expectedEffort(1, 1))
  const original = structuredClone(result)
  diagnostics.tickets[0].contributions[0].effort = 0
  assert.deepEqual(result, original)
  const removed = structuredClone(result)
  removed.developers = []
  assert.equal(getDiagnosticsView(removed).tickets[0].contributions[0].developerName, 'developer-1')
  assert.deepEqual(advanceSimulation(removed, 1).workLog, result.workLog)
})

test('legacy completion normalizes 0.24999999999999997 without attributing unknown prior effort', () => {
  const initial = fixture(1)
  const multiplier = getAverageFlowMultiplier(0, 1, 0)
  initial.developers[0].productivity = 2 ** -55 / multiplier
  let legacy = advanceSimulation(initial, 1)
  delete legacy.developers[0].workSession
  delete legacy.developers[0].flowStreak
  legacy.developers[0].productivity = 0.75 / multiplier
  legacy = advanceSimulation(legacy, 1)
  delete legacy.workLog
  delete legacy.developers[0].workSession!.effortOrigin
  const original = structuredClone(legacy)
  const expected = 0.24999999999999997
  assert.equal(1 - 2 ** -55 - 0.75, 0.25) // ordinary scalar subtraction loses the tiny earlier work
  for (const parts of [[1], [0.5, 0.5], [0.25, 0.25, 0.5], [0.1, 0.2, 0.3, 0.4]]) {
    let result = JSON.parse(JSON.stringify(legacy)) as GameState
    for (const seconds of parts) result = JSON.parse(JSON.stringify(advanceSimulation(result, seconds)))
    assert.equal(result.tickets[0].actualStatus, 'done')
    assert.equal(result.tickets[0].completedWork, 1)
    assert.equal(effort(result), expected)
    assert.equal(result.workLog!.length, 1)
    assert.equal(result.randomState, legacy.randomState)
    assert.ok(result.workLog![0].effort.mantissa >= 1 && result.workLog![0].effort.mantissa < 2)
  }
  assert.deepEqual(legacy, original)
})

// Direct ledger arithmetic harness: use an existing integration session, but
// start its integral at zero with ample capacity and an explicit known total.
function recordingState(total: WorkAmount) {
  const state = advanceSimulation(fixture(), 1)
  state.tickets[0].requiredWork = Number.MAX_VALUE
  state.developers[0].workSession!.elapsed = 0
  delete state.developers[0].workSession!.effortOrigin
  state.workLog = [{ developerId: 'developer-1', ticketId: 'ticket-1', effort: { ...total } }]
  return state
}

test('ledger normalization stays in [1, 2) around powers of two at small and large scales', () => {
  for (const exponent of [-900, -20, -2, 0, 10, 900]) {
    for (const addition of [
      { mantissa: 1.9999999999999996, exponent: exponent - 2, correction: 0 },
      { mantissa: 1, exponent: exponent - 1, correction: 0 },
      { mantissa: 1.0000000000000004, exponent: exponent - 1, correction: 0 },
    ]) {
      const baseline = 2 ** (exponent - 1)
      const state = recordingState(workAmount(baseline))
      recordProductiveEffort(state, state.developers[0], state.tickets[0], addition)
      const amount = state.workLog![0].effort
      assert.ok(amount.mantissa >= 1 && amount.mantissa < 2)
      assert.equal(effortNumber(amount), baseline + addition.mantissa * 2 ** addition.exponent)
      assert.deepEqual(JSON.parse(JSON.stringify(state.workLog)), state.workLog)
    }
  }
})

test('reviewed subnormal contribution cannot silently become two MIN_VALUE units during alignment', () => {
  const initial = fixture(2)
  initial.developers[0].productivity = 1.5 / getAverageFlowMultiplier(0, 1, 0)
  const state = advanceSimulation(initial, 1)
  assert.equal(effort(state), 1.5)
  state.developers[0].productivity = Number.MIN_VALUE
  state.developers[0].competencies.frontend = 10
  const contribution = { mantissa: 1.5522925138799557, exponent: -1074, correction: 0 }
  assert.deepEqual(integratedWork(state.developers[0], state.tickets[0], 1, 1), contribution)
  // This is the bad intermediate value from the review, not the actual effort.
  assert.equal(contribution.mantissa * 2 ** contribution.exponent, 2 * Number.MIN_VALUE)
  const original = structuredClone(state)
  assert.throws(() => advanceSimulation(state, 1), /Work-log exponent alignment loses numeric precision/)
  for (const parts of [[1], [0.5, 0.5], [0.25, 0.25, 0.5], [0.1, 0.2, 0.3, 0.4]]) {
    const restored = JSON.parse(JSON.stringify(state)) as GameState
    const before = structuredClone(restored)
    assert.throws(() => {
      let result = restored
      for (const seconds of parts) result = advanceSimulation(result, seconds)
    }, RangeError)
    assert.deepEqual(restored, before)
  }
  assert.deepEqual(state, original)
})

test('exact subnormal alignments remain supported across cumulative and separate contributions', () => {
  const whole = recordingState(workAmount(1.5))
  const contribution = { mantissa: 1.5, exponent: -1073, correction: 0 } // exactly three MIN_VALUE units
  recordProductiveEffort(whole, whole.developers[0], whole.tickets[0], contribution)
  assert.deepEqual(whole.workLog![0].effort, { mantissa: 1.5, exponent: 0, correction: -3 * Number.MIN_VALUE })
  let split = recordingState(workAmount(1.5))
  for (const cumulative of [workAmount(Number.MIN_VALUE), contribution]) {
    recordProductiveEffort(split, split.developers[0], split.tickets[0], cumulative)
    const restored = JSON.parse(JSON.stringify(split)) as GameState
    assert.deepEqual(restored.workLog, split.workLog)
    split = restored
  }
  assert.deepEqual(split.workLog, whole.workLog)
  let sessions = recordingState(workAmount(1.5))
  for (const units of [1, 2]) {
    recordProductiveEffort(sessions, sessions.developers[0], sessions.tickets[0], workAmount(units * Number.MIN_VALUE))
    sessions = recordingState(JSON.parse(JSON.stringify(sessions.workLog![0].effort)))
  }
  assert.deepEqual(sessions.workLog, whole.workLog)
  const separate = recordingState(whole.workLog![0].effort)
  recordProductiveEffort(separate, separate.developers[0], separate.tickets[0], workAmount(Number.MIN_VALUE))
  assert.equal(separate.workLog![0].effort.correction, -4 * Number.MIN_VALUE)
})

test('alignment checks correction words and normalization without rejecting exact rescaling', () => {
  const correctionLoss = recordingState(workAmount(1.5))
  assert.throws(() => recordProductiveEffort(correctionLoss, correctionLoss.developers[0], correctionLoss.tickets[0],
    { mantissa: 1, exponent: -1022, correction: Number.MIN_VALUE }), /alignment loses numeric precision/)
  const normalizationLoss = recordingState({ mantissa: 1.5, exponent: 0, correction: -Number.MIN_VALUE })
  assert.throws(() => recordProductiveEffort(normalizationLoss, normalizationLoss.developers[0], normalizationLoss.tickets[0],
    workAmount(1.5)), /normalization loses numeric precision/)
  const exact = recordingState({ mantissa: 1.5, exponent: 0, correction: -2 * Number.MIN_VALUE })
  recordProductiveEffort(exact, exact.developers[0], exact.tickets[0], workAmount(1.5))
  assert.deepEqual(exact.workLog![0].effort, { mantissa: 1.5, exponent: 1, correction: -Number.MIN_VALUE })
})
