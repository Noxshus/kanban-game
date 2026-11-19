import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { discoveryResponsiveness, nextDiscoveryTarget, revisedEffort, evaluateEstimate } from '../src/game/reestimation.ts'
import { addWorkAmounts, effortNumber } from '../src/game/workLog.ts'
import { workAmount } from '../src/game/work.ts'
import { projectWork } from '../src/game/completionTime.ts'
import { nextRandom } from '../src/game/random.ts'
import { eventInterval } from '../src/game/eventTime.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { getDiagnosticsView } from '../src/store/diagnosticsView.ts'
import { encounterEstimate, publishEstimate } from '../src/game/estimateHistory.ts'
import type { GameState } from '../src/game/types.ts'
import { close } from './helpers/flowExpectation.ts'

function fixture(total = 100, estimate = 20): GameState {
  const state = structuredClone(exampleGameState)
  state.developers = [{ ...state.developers[0], productivity: 1, competencies: { frontend: 5, backend: 0 },
    judgement: 10, focus: 0, discipline: 1000, estimateReview: { ticketId: 'ticket-1', dueTime: { high: 1e308, low: 0 } }, assessmentClock: { elapsed: 0, remaining: 10000 } }]
  state.tickets = [{ ...state.tickets[0], requiredWork: total, completedWork: 0, reportedProgress: 0,
    actualStatus: 'in_progress', reportedStatus: 'in_progress', initialEffortEstimate: { developerId: 'original', totalWork: estimate },
    reportedEffortEstimate: estimate }]
  return state
}

test('independent formulas determine error-aware discovery rate and conditional work thresholds', () => {
  for (const [j, board] of [[0, 20], [10, 80], [100, 95]]) {
    const r = (100 - board) / 100
    const expected = 0.8 * (1 + Math.log1p(j / 10)) * (2 * r / (r + 0.2))
    close(discoveryResponsiveness(100, board, j), expected)
    const u = 0.05, w = 7, baseline = 20
    const actual = nextDiscoveryTarget(100, board, baseline, workAmount(w), j, workAmount(100), u)!
    close(effortNumber(actual)!, w + (baseline + w) * Math.expm1(-Math.log1p(-u) / expected))
  }
  assert.equal(discoveryResponsiveness(100, 100, 100), 0)
})

test('Judgement and residual error affect discovery; additional personal work steadily reduces per-unit responsiveness', () => {
  const target = (j: number, board: number, w: number) => effortNumber(nextDiscoveryTarget(100, board, 20,
    workAmount(w), j, workAmount(100), 0.1)!)!
  assert.ok(target(100, 20, 0) < target(0, 20, 0))
  assert.ok(target(10, 95, 0) > target(10, 20, 0))
  let previousRate = Infinity, previousInterval = 0
  for (const w of [0, 20, 40, 80]) {
    const rate = discoveryResponsiveness(100, 20, 10) / (20 + w)
    const interval = target(10, 20, w) - w
    assert.ok(rate < previousRate)
    assert.ok(interval > previousInterval)
    previousRate = rate; previousInterval = interval
  }
})

test('accuracy is evaluated from original E0 and cumulative personal work, with no Focus input', () => {
  for (const [w, j, c] of [[0, 0, 0], [10, 10, 5], [10, 50, 10], [50, 100, 100]]) {
    const a = 0.3 * (1 + Math.log1p(j / 10) + Math.log1p(c / 10))
    close(revisedEffort(60, 20, workAmount(w), j, c), 60 - 40 * (1 + w / 20) ** -a)
  }
  const basic = revisedEffort(60, 20, workAmount(10), 0, 0)
  assert.ok(revisedEffort(60, 20, workAmount(20), 0, 0) > basic)
  assert.ok(revisedEffort(60, 20, workAmount(10), 10, 0) > basic)
  assert.ok(revisedEffort(60, 20, workAmount(10), 0, 10) > basic)
})

test('first and repeated discoveries publish upward only at genuine work events', () => {
  const initial = fixture(), original = structuredClone(initial)
  let draws = 0
  let state = advanceSimulation(initial, 0.0625, () => { draws++; return 0.1 })
  assert.equal(draws, 1)
  assert.equal(state.tickets[0].reportedEffortEstimate, 20)
  let discoveries = 0
  for (let i = 0; i < 1000 && discoveries < 3; i++) {
    const before = state.tickets[0].reportedEffortEstimate!
    state = advanceSimulation(state, 0.0625, () => { draws++; return 0.1 })
    if (state.tickets[0].reportedEffortEstimate === before) continue
    discoveries++
    assert.equal(state.tickets[0].lastEstimateEvaluation!.reason, 'discovery')
    assert.ok(state.tickets[0].reportedEffortEstimate! > before)
    assert.equal(state.tickets[0].lastEstimateEvaluation!.published, true)
  }
  assert.equal(discoveries, 3)
  assert.equal(draws, 7) // three reporting rolls plus four discovery targets
  assert.deepEqual(state.tickets[0].initialEffortEstimate, original.tickets[0].initialEffortEstimate)
  assert.deepEqual(initial, original)
})

test('evaluating the same personal exposure does not compound learning and may leave the board unchanged', () => {
  const state = fixture(100, 20)
  state.tickets[0].reportedEffortEstimate = 90
  state.workLog = [{ developerId: 'developer-1', ticketId: 'ticket-1', effort: workAmount(10) }]
  state.developers[0].workSession = { ticketId: 'ticket-1', requiredWork: 100, productivity: 1, competency: 5,
    focus: 0, initialFlowDuration: 0, elapsed: 0, completionSeconds: null, initialCompletedWork: 0, lastCompletedWork: 0 }
  evaluateEstimate(state, state.developers[0], state.tickets[0], 'discovery',()=>0)
  const candidate = state.tickets[0].lastEstimateEvaluation!.candidate
  assert.ok(candidate < 90)
  assert.equal(state.tickets[0].lastEstimateEvaluation!.published, false)
  assert.equal(state.tickets[0].reportedEffortEstimate, 90)
  evaluateEstimate(state, state.developers[0], state.tickets[0], 'discovery',()=>0)
  assert.equal(state.tickets[0].lastEstimateEvaluation!.candidate, candidate)
  assert.equal(state.tickets[0].reportedEffortEstimate, 90)
})

test('any representable upward estimate publishes, while equal or lower candidates do not', () => {
  const state = advanceSimulation(fixture(), 0.001, () => 0.999)
  state.workLog = [{ developerId: 'developer-1', ticketId: 'ticket-1', effort: workAmount(10) }]
  const candidate = revisedEffort(100, 20, workAmount(10), 10, 5)
  const adjacent = (offset: bigint) => {
    const bits = new DataView(new ArrayBuffer(8))
    bits.setFloat64(0, candidate)
    bits.setBigUint64(0, bits.getBigUint64(0) + offset)
    return bits.getFloat64(0)
  }
  const justBelow = adjacent(-1n), justAbove = adjacent(1n)
  assert.ok(justBelow < candidate && justAbove > candidate)
  // Adjacent floats exercise the smallest representable increase, not a tolerance.
  for (const [board, published] of [[justBelow, true], [candidate / 1.0005, true],
    [candidate, false], [justAbove, false]] as const) {
    const input = structuredClone(state)
    publishEstimate(input.tickets[0], input.developers[0].id, board, 'revision', { high: input.simulationTime, low: 0 })
    evaluateEstimate(input, input.developers[0], input.tickets[0], 'discovery',()=>0)
    assert.equal(input.tickets[0].lastEstimateEvaluation!.candidate, candidate)
    assert.equal(input.tickets[0].lastEstimateEvaluation!.published, published)
    assert.equal(input.tickets[0].reportedEffortEstimate, published ? candidate : board)
    assert.deepEqual(input.tickets[0].initialEffortEstimate, state.tickets[0].initialEffortEstimate)
    assert.equal(input.randomState, state.randomState)
    assert.equal(input.simulationTime, state.simulationTime)
    evaluateEstimate(input, input.developers[0], input.tickets[0], 'discovery',()=>0)
    assert.equal(input.tickets[0].lastEstimateEvaluation!.published, false)
    assert.equal(input.tickets[0].reportedEffortEstimate, published ? candidate : board)
  }
})

test('reaching a board estimate triggers one evaluation, not a mandatory correction or work floor', () => {
  const state = fixture(100, 1)
  state.developers[0].judgement = 0
  state.developers[0].competencies.frontend = 0
  state.tickets[0].reportedEffortEstimate = 20
  state.tickets[0].completedWork = 19
  let draws = 0
  const first = advanceSimulation(state, 0.01, () => 0.999)
  const boundary = first.developers[0].workSession!.estimateEvents!.overrun!
  assert.equal(boundary.low, 0) // exact boundary can be requested directly from time zero
  const result = advanceSimulation(state, boundary.high, () => { draws++; return 0.999 })
  assert.equal(result.tickets[0].lastEstimateEvaluation!.reason, 'overrun')
  assert.equal(result.tickets[0].lastEstimateEvaluation!.published, false)
  assert.equal(result.tickets[0].reportedEffortEstimate, 20)
  assert.equal(result.tickets[0].overrunEvaluationConsumed, true)
  close(result.tickets[0].completedWork, 20)
  assert.equal(draws, 2) // one initial threshold and one renewal, no accuracy RNG
  const later = advanceSimulation(result, 0.1, () => { throw Error('Overrun must not repeat at every tick') })
  assert.equal(later.tickets[0].reportedEffortEstimate, 20)
  assert.ok(later.tickets[0].completedWork > 20)
})

test('subsequent overrun-driven evaluations use positive work and the same accuracy curve', () => {
  const state = fixture(100, 1)
  state.developers[0].judgement = 0
  state.developers[0].competencies.frontend = 0
  state.tickets[0].reportedEffortEstimate = 20
  state.tickets[0].completedWork = 19
  let first = advanceSimulation(state, 0.01, () => 0.999)
  const due = first.developers[0].workSession!.estimateEvents!.overrun!
  let draws = 0
  first = advanceSimulation(state, due.high, () => ++draws === 1 ? 0.999 : 0.01)
  assert.equal(first.tickets[0].lastEstimateEvaluation!.reason, 'overrun')
  const previousWork = first.tickets[0].lastEstimateEvaluation!.personalWork!
  let next = first
  for (let step = 0; step < 100 && next.tickets[0].lastEstimateEvaluation!.reason === 'overrun'; step++) {
    next = advanceSimulation(next, 0.01, () => 0.01)
  }
  assert.equal(next.tickets[0].lastEstimateEvaluation!.reason, 'discovery')
  assert.ok(next.tickets[0].lastEstimateEvaluation!.personalWork! > previousWork)
  assert.equal(next.tickets[0].reportedEffortEstimate, 20) // allowed to remain wrong
})

test('a lifetime alarm cannot re-arm after its publication, ordinary discovery, JSON restore, handoff or return', () => {
  const state = fixture()
  let current = advanceSimulation(state, 0.01, () => 0.999)
  const due = current.developers[0].workSession!.estimateEvents!.overrun!
  let eventDraw=0
  current = advanceSimulation(state, due.high, () => ++eventDraw===2?0:.999)
  const crossing = structuredClone(current.tickets[0].lastEstimateEvaluation!)
  const board = current.tickets[0].reportedEffortEstimate!
  assert.equal(crossing.reason, 'overrun')
  assert.ok(board > current.tickets[0].completedWork)
  assert.equal(current.tickets[0].overrunEvaluationConsumed, true)
  // Pass the freshly published target with no discoveries or new RNG draws.
  const atWork = (work: number) => projectWork(current.developers[0], current.tickets[0], workAmount(work)).seconds!
  current = advanceSimulation(current, atWork(board + 1) - current.simulationTime, () => { throw Error('No second alarm') })
  assert.deepEqual(current.tickets[0].lastEstimateEvaluation, crossing)
  assert.equal(current.developers[0].workSession!.estimateEvents!.overrun, null)

  // Schedule one genuine positive-work discovery using the existing target state.
  current.developers[0].estimateDiscovery!.target = addWorkAmounts(current.workLog![0].effort, workAmount(0.5))
  delete current.developers[0].workSession!.estimateEvents
  let revisionDraw=0
  current = advanceSimulation(current, 1, () => revisionDraw++===0?0:.999)
  const discovery = structuredClone(current.tickets[0].lastEstimateEvaluation!)
  assert.equal(discovery.reason, 'discovery')
  assert.equal(discovery.published, true)
  const revised = current.tickets[0].reportedEffortEstimate!
  assert.ok(revised > current.tickets[0].completedWork)
  assert.equal(current.tickets[0].overrunEvaluationConsumed, true)
  assert.deepEqual(advanceSimulation(JSON.parse(JSON.stringify(current)), 0.1), advanceSimulation(current, 0.1))

  const handoff = (id: string) => {
    const replacement = { ...state.developers[0], id, activeTicketID: 'ticket-1' }
    current.developers = [replacement]
    current = JSON.parse(JSON.stringify(advanceSimulation(current, 0.01, () => 0.999)))
    assert.deepEqual(current.tickets[0].lastEstimateEvaluation, discovery)
    assert.equal(current.developers[0].workSession!.estimateEvents!.overrun, null)
  }
  const originalEffort = structuredClone(current.workLog![0].effort)
  handoff('replacement')
  assert.deepEqual(current.workLog![0].effort, originalEffort)
  handoff('developer-1')
  assert.ok(effortNumber(current.workLog![0].effort)! > effortNumber(originalEffort)!)
  current = advanceSimulation(current, 30, () => 0.999)
  assert.ok(current.tickets[0].completedWork > revised)
  assert.deepEqual(current.tickets[0].lastEstimateEvaluation, discovery)
  assert.equal(current.tickets[0].overrunEvaluationConsumed, true)
  assert.deepEqual(current.tickets[0].initialEffortEstimate, state.tickets[0].initialEffortEstimate)
})

test('pickup above a legacy report does not consume the first crossing; a later discovery can establish its target', () => {
  const state = fixture()
  state.tickets[0].completedWork = 25
  state.tickets[0].evaluatedOverrunEstimate = 20 // old pickup suppression, with no evaluation snapshot
  state.workLog = [{ developerId: 'developer-1', ticketId: 'ticket-1', effort: workAmount(50) }]
  delete state.tickets[0].initialEffortEstimate
  let current = advanceSimulation(state, 0.01, () => 0.999)
  assert.equal(current.tickets[0].lastEstimateEvaluation, undefined)
  assert.equal(current.tickets[0].overrunEvaluationConsumed, false)
  assert.equal(current.developers[0].workSession!.estimateEvents!.overrun, null)
  current.developers[0].estimateDiscovery!.target = addWorkAmounts(current.workLog![0].effort, workAmount(0.5))
  delete current.developers[0].workSession!.estimateEvents
  let reportingDraw=0
  current = advanceSimulation(current, 1, () => reportingDraw++===0?0:.999)
  const board = current.tickets[0].reportedEffortEstimate!
  assert.equal(current.tickets[0].lastEstimateEvaluation!.reason, 'discovery')
  assert.ok(board > current.tickets[0].completedWork)
  assert.equal(current.tickets[0].overrunEvaluationConsumed, false)
  assert.ok(current.developers[0].workSession!.estimateEvents!.overrun)
  current = advanceSimulation(JSON.parse(JSON.stringify(current)), 35, () => 0.999)
  assert.equal(current.tickets[0].lastEstimateEvaluation!.reason, 'overrun')
  assert.equal(current.tickets[0].overrunEvaluationConsumed, true)
  assert.equal(current.tickets[0].initialEffortEstimate, undefined)
  assert.equal(current.tickets[0].learningBaseline, 20)
})

test('legacy migration preserves provably unused crossings and conservatively closes ambiguous or consumed alarms', () => {
  for (const source of ['original', 'learning', 'missing'] as const) {
    for (const reason of ['overrun', 'discovery'] as const) {
      for (const completedWork of [19, 20, 21]) {
        for (const marker of [undefined, 20]) {
          const initial = fixture()
          initial.tickets[0].completedWork = completedWork
          initial.tickets[0].reportedEffortEstimate = 40
          let state = advanceSimulation(initial, 0.01, () => 0.5)
          const ticket = state.tickets[0], developer = state.developers[0]
          delete ticket.overrunEvaluationConsumed // restore the released #58/#67 schema
          assert.ok(developer.workSession!.estimateEvents!.overrun)
          // Include exact saved equality, not work already advanced past E0.
          const originalBaseline = completedWork === 20 ? ticket.completedWork : 20
          ticket.initialEffortEstimate!.totalWork = originalBaseline
          if (source !== 'original') delete ticket.initialEffortEstimate
          if (source === 'learning') ticket.learningBaseline = originalBaseline
          ticket.evaluatedOverrunEstimate = marker
          ticket.lastEstimateEvaluation = { developerId: developer.id, reason, personalWork: 0,
            candidate: 40, published: true }
          delete developer.estimateDiscovery!.baseline // released #58 schema predates personal baselines
          const savedTarget = structuredClone(developer.estimateDiscovery!.target)
          const savedRandom = state.randomState
          const consumed = reason === 'overrun' || source === 'missing' || completedWork >= 20
          state = advanceSimulation(JSON.parse(JSON.stringify(state)), 0.01, () => { throw Error('Restore must retain its seeded target') })
          assert.deepEqual(state.developers[0].estimateDiscovery!.target, savedTarget)
          assert.equal(state.randomState, savedRandom)
          assert.equal(state.developers[0].workSession!.estimateEvents!.overrun === null, consumed)
          assert.equal(state.tickets[0].overrunEvaluationConsumed, consumed)
          assert.equal(state.tickets[0].evaluatedOverrunEstimate, undefined)
        }
      }
    }
  }
})

test('explicit lifetime flags remain authoritative even below the original estimate', () => {
  for (const consumed of [false, true]) {
    let state = advanceSimulation(fixture(), 0.01, () => 0.5)
    state.tickets[0].overrunEvaluationConsumed = consumed
    state = advanceSimulation(JSON.parse(JSON.stringify(state)), 0.01, () => { throw Error('No resampling') })
    assert.equal(state.tickets[0].overrunEvaluationConsumed, consumed)
    assert.equal(state.developers[0].workSession!.estimateEvents!.overrun === null, consumed)
  }
})

test('a legacy pickup marker alone is not a consumed alarm and does not grant a pickup evaluation', () => {
  const state = fixture()
  state.tickets[0].completedWork = 25
  state.tickets[0].evaluatedOverrunEstimate = 20
  let current = advanceSimulation(JSON.parse(JSON.stringify(state)), 0.01, () => 0.999)
  assert.equal(current.tickets[0].overrunEvaluationConsumed, false)
  assert.equal(current.tickets[0].evaluatedOverrunEstimate, undefined)
  assert.equal(current.tickets[0].lastEstimateEvaluation, undefined)
  assert.equal(current.developers[0].workSession!.estimateEvents!.overrun, null)
  current = advanceSimulation(JSON.parse(JSON.stringify(current)), 0.01, () => { throw Error('No resampling') })
  assert.equal(current.tickets[0].overrunEvaluationConsumed, false)
})

test('retained ticket disparity no longer changes a freshly sampled discovery target', () => {
  const fresh = fixture(), overrun = fixture()
  overrun.tickets[0].completedWork = 80
  const a = advanceSimulation(fresh, 0.01, () => 0.1)
  const b = advanceSimulation(overrun, 0.01, () => 0.1)
  assert.deepEqual(a.developers[0].estimateDiscovery!.target, b.developers[0].estimateDiscovery!.target)
  assert.equal(b.tickets[0].overrunEvaluationConsumed, false)
})

test('handoff and return share the board estimate without altering retained work experience', () => {
  const state = fixture(100, 20)
  state.developers.push({ ...state.developers[0], id: 'engineer-B', name: 'Blair', activeTicketID: undefined })
  state.workLog = [
    { developerId: 'developer-1', ticketId: 'ticket-1', effort: workAmount(10) },
    { developerId: 'engineer-B', ticketId: 'ticket-1', effort: workAmount(30) },
  ]
  state.tickets[0].reportedEffortEstimate = 60
  let first = advanceSimulation(state, 0.01, () => 0.999)
  assert.equal(first.tickets[0].reportedEffortEstimate, 60)
  assert.equal(first.tickets[0].lastEstimateEvaluation, undefined)
  const work = structuredClone(first.workLog)
  const [a, b] = first.developers, ticket = first.tickets[0]
  const at = { high: first.simulationTime, low: 0 }
  encounterEstimate(ticket, b, at, () => 0.999)
  assert.equal(ticket.reportedEffortEstimate, 60)
  encounterEstimate(ticket, a, at, () => { throw Error('Returning estimate must not reroll') })
  assert.equal(ticket.reportedEffortEstimate, 60)
  assert.deepEqual(first.workLog, work)
  assert.deepEqual(first.tickets[0].initialEffortEstimate, state.tickets[0].initialEffortEstimate)
})

test('a replacement learns from ticket E0; returning work cannot overwrite a better shared estimate', () => {
  const state = fixture()
  state.tickets[0].reportedEffortEstimate = 60
  state.developers[0].activeTicketID = undefined
  state.developers.push({ ...state.developers[0], id: 'engineer-B', activeTicketID: 'ticket-1',
    judgement: 100, competencies: { frontend: 100, backend: 0 } })
  state.workLog = [
    { developerId: 'developer-1', ticketId: 'ticket-1', effort: workAmount(10) },
    { developerId: 'engineer-B', ticketId: 'ticket-1', effort: workAmount(30) },
  ]
  encounterEstimate(state.tickets[0], state.developers[0], { high: 0, low: 0 }, () => { throw Error('Legacy restore') })
  encounterEstimate(state.tickets[0], state.developers[1], { high: 0, low: 0 }, () => 0.9)
  const baseline = state.tickets[0].initialEffortEstimate!.totalWork
  const learned = advanceSimulation(state, 1, () => 0.01)
  const improved = learned.tickets[0].reportedEffortEstimate!
  assert.ok(improved > 60)
  assert.equal(learned.tickets[0].lastEstimateEvaluation!.developerId, 'engineer-B')
  close(improved, revisedEffort(100, baseline, workAmount(learned.tickets[0].lastEstimateEvaluation!.personalWork!), 100, 100))
  assert.equal(effortNumber(learned.workLog![0].effort), 10)
  delete learned.developers[1].activeTicketID
  delete learned.developers[1].workSession
  learned.developers[0].activeTicketID = 'ticket-1'
  encounterEstimate(learned.tickets[0], learned.developers[0], { high: learned.simulationTime, low: 0 }, () => { throw Error('Read the shared report') })
  const returned = advanceSimulation(learned, 0.001, () => 0.01)
  assert.equal(returned.tickets[0].reportedEffortEstimate, improved)
  const evaluated = advanceSimulation(returned, 1, () => 0.01)
  const snapshot = evaluated.tickets[0].lastEstimateEvaluation!
  assert.equal(snapshot.developerId, 'developer-1')
  close(snapshot.candidate, revisedEffort(100, 20, workAmount(snapshot.personalWork!), 10, 5))
  assert.equal(evaluated.tickets[0].reportedEffortEstimate, improved)
})

test('completion preempts a coincident evaluation, including an exact discovery work target', () => {
  const state = fixture(1, 0.5)
  // Seed an already scheduled target exactly at completion. This must reuse its deadline.
  state.developers[0].estimateDiscovery = { ticketId: 'ticket-1', boardEstimate: 0.5, requiredWork: 1,
    judgement: 10, productive: true, target: workAmount(1) }
  state.tickets[0].overrunEvaluationConsumed = true // isolate the exact completion/discovery tie
  const result = advanceSimulation(state, 10, () => .999) // completion reporting only, no discovery renewal
  assert.equal(result.tickets[0].actualStatus, 'done')
  assert.equal(result.tickets[0].lastEstimateEvaluation!.reason, 'completion')
  assert.equal(result.tickets[0].lastEstimateEvaluation!.published, false)
  assert.equal(result.tickets[0].reportedEffortEstimate, 0.5)
  assert.equal(result.developers[0].estimateDiscovery, undefined)
  const exactBoard = fixture(1, 1)
  const completed = advanceSimulation(exactBoard, 10, () => { throw Error('No error to discover') })
  assert.equal(completed.tickets[0].lastEstimateEvaluation!.reason, 'completion')
  assert.equal(completed.tickets[0].lastEstimateEvaluation!.published, false)
  assert.equal(completed.tickets[0].overrunEvaluationConsumed, false)
})

test('coincident discovery and overrun evaluate once and renew only one seeded target', () => {
  const state = fixture()
  state.developers[0].estimateDiscovery = { ticketId: 'ticket-1', boardEstimate: 20, requiredWork: 100,
    judgement: 10, productive: true, target: workAmount(20) }
  const due = projectWork(state.developers[0], state.tickets[0], workAmount(20)).seconds!
  const result = advanceSimulation(state, due)
  assert.equal(result.tickets[0].lastEstimateEvaluation!.reason, 'overrun')
  assert.equal(result.randomState, nextRandom(nextRandom(state.randomState).state).state) // reporting + threshold
  close(result.tickets[0].lastEstimateEvaluation!.personalWork!, 20)
  assert.ok(result.tickets[0].reportedEffortEstimate! > 20)
  assert.equal(result.tickets[0].overrunEvaluationConsumed, true)
  assert.equal(result.developers[0].activeTicketID, 'ticket-1')
})

test('mixed completion/discovery instants preserve engineer-ordered claims and RNG under nonbinary partitions', () => {
  for (const reverse of [false, true]) {
    const state = fixture(), base = state.developers[0], ticket = state.tickets[0]
    state.developers = [
      { ...base, id: 'finishing', activeTicketID: 'finish' },
      { ...base, id: 'learning', activeTicketID: 'ongoing', estimateDiscovery: { ticketId: 'ongoing',
        boardEstimate: 20, requiredWork: 100, judgement: 10, productive: true, target: workAmount(1) } },
    ]
    state.tickets = [
      { ...ticket, id: 'finish', rank: 3, requiredWork: 1, initialEffortEstimate: { developerId: 'original', totalWork: 1 }, reportedEffortEstimate: 1 },
      { ...ticket, id: 'ongoing', rank: 2 },
      { ...ticket, id: 'contested', rank: 1, actualStatus: 'todo', initialEffortEstimate: { developerId: 'original', totalWork: 100 }, reportedEffortEstimate: 100 },
    ]
    state.tickets[2].estimateHistory = state.developers.map(developer => ({ kind: 'assessment', developerId: developer.id,
      totalWork: 100, reason: 'initial', at: { high: 0, low: 0 } }))
    for(const d of state.developers)d.estimateReview={ticketId:d.activeTicketID!,dueTime:{high:1e308,low:0}}
    if (reverse) state.developers.reverse()
    const due = projectWork(base, ticket, workAmount(1)).seconds!
    const whole = advanceSimulation(state, due + 0.25)
    let split = state
    for (let i = 0; i < 3; i++) split = JSON.parse(JSON.stringify(advanceSimulation(split, 0.3)))
    split = advanceSimulation(split, due + 0.25 - 0.9)
    assert.equal(whole.tickets[0].actualStatus, 'done')
    assert.equal(whole.tickets[0].lastEstimateEvaluation!.reason, 'completion')
    assert.equal(whole.tickets[0].lastEstimateEvaluation!.published, false)
    assert.equal(whole.tickets[1].lastEstimateEvaluation!.developerId, 'learning')
    assert.equal(whole.developers.find(d => d.id === 'finishing')!.activeTicketID, 'contested')
    assert.equal(whole.randomState, nextRandom(nextRandom(nextRandom(state.randomState).state).state).state) // new review, report, threshold
    assert.equal(split.randomState, whole.randomState)
    assert.deepEqual(split.developers.map(d => [d.id, d.activeTicketID, d.lastAssessment]), whole.developers.map(d => [d.id, d.activeTicketID, d.lastAssessment]))
    assert.deepEqual(split.tickets.map(t => [t.id, t.reportedEffortEstimate, t.lastEstimateEvaluation]),
      whole.tickets.map(t => [t.id, t.reportedEffortEstimate, t.lastEstimateEvaluation]))
  }
})

test('seeded replay, zero time, fractional partitions and JSON preserve evaluations and claims', () => {
  for (const seed of [1, 42, 58]) {
    const state = fixture(); state.randomState = seed
    const original = structuredClone(state)
    assert.deepEqual(advanceSimulation(state, 0, () => { throw Error('No draw') }), state)
    const whole = advanceSimulation(state, 30)
    let split = state
    for (let i = 0; i < 3; i++) split = JSON.parse(JSON.stringify(advanceSimulation(split, 0.3)))
    split = advanceSimulation(split, 29.1)
    assert.equal(split.randomState, whole.randomState)
    assert.deepEqual(split.developers.map(d => [d.activeTicketID, d.lastAssessment]), whole.developers.map(d => [d.activeTicketID, d.lastAssessment]))
    assert.equal(split.tickets[0].lastEstimateEvaluation!.reason, whole.tickets[0].lastEstimateEvaluation!.reason)
    close(split.tickets[0].reportedEffortEstimate!, whole.tickets[0].reportedEffortEstimate!)
    close(split.tickets[0].completedWork, whole.tickets[0].completedWork)
    assert.deepEqual(advanceSimulation(JSON.parse(JSON.stringify(whole)), 1), advanceSimulation(whole, 1))
    assert.deepEqual(whole, advanceSimulation(state, 30))
    assert.deepEqual(state, original)
  }
})

test('shared work solver accounts for accumulated Flow without resetting its integration origin', () => {
  const state = fixture()
  state.developers[0].flowStreak = { ticketId: 'ticket-1', duration: 100 }
  const first = advanceSimulation(state, 0.01, () => 0.1)
  const session = first.developers[0].workSession!
  const target = first.developers[0].estimateDiscovery!.target!
  const projected = projectWork(state.developers[0], state.tickets[0], target, 100).seconds!
  close(eventInterval(session.estimateEvents!.discovery!, session.originTime!), projected)
  const result = advanceSimulation(first, projected - 0.01, () => 0.1)
  close(result.developers[0].flowStreak!.duration, 100 + projected)
  assert.deepEqual(result.developers[0].workSession!.originTime, session.originTime)
})

test('accurate tickets, idle workers and zero productive work create no discovery draws', () => {
  const exact = fixture(100, 100)
  assert.equal(advanceSimulation(exact, 1, () => { throw Error('No estimation error') }).tickets[0].reportedEffortEstimate, 100)
  const held = fixture(); held.developers[0].productivity = 0
  const first = advanceSimulation(held, 1, () => { throw Error('Holding is not work') })
  assert.equal(first.workLog, undefined)
  first.developers[0].productivity = 1
  let draws = 0
  advanceSimulation(first, 0.1, () => { draws++; return 0.5 })
  assert.equal(draws, 1)
  const zero = fixture(0, 0)
  assert.equal(advanceSimulation(zero, 1, () => { throw Error('Zero work') }).tickets[0].actualStatus, 'done')
})

test('invalid baselines fail purely; board-only legacy saves retain E0 without inventing an author', () => {
  for (const invalid of [0, -1, NaN, Infinity, 101]) {
    const state = fixture(); state.tickets[0].initialEffortEstimate!.totalWork = invalid
    const original = structuredClone(state)
    assert.throws(() => advanceSimulation(state, 1), RangeError)
    assert.deepEqual(state, original)
  }
  for (const invalid of [0, -1, NaN, Infinity, 101]) {
    const state = fixture(); state.tickets[0].reportedEffortEstimate = invalid
    const original = structuredClone(state)
    assert.throws(() => advanceSimulation(state, 1), RangeError)
    assert.deepEqual(state, original)
  }
  const legacy = fixture(); delete legacy.tickets[0].initialEffortEstimate
  const result = advanceSimulation(legacy, 15, () => 0.1)
  assert.equal(result.tickets[0].learningBaseline, 20)
  assert.equal(result.tickets[0].initialEffortEstimate, undefined)
  assert.ok(result.tickets[0].reportedEffortEstimate! > 20)
})

test('large attributes, extreme effort scales and RNG endpoints are explicit and bounded', () => {
  for (const scale of [1e-300, 1, 1e300]) {
    const candidate = revisedEffort(scale, scale / 10, workAmount(scale / 20), Number.MAX_VALUE, Number.MAX_VALUE)
    assert.ok(Number.isFinite(candidate) && candidate >= scale / 10 && candidate <= scale)
    for (const u of [0, 0.5, 1]) {
      const target = nextDiscoveryTarget(scale, scale / 10, scale / 10, workAmount(0), 100, workAmount(scale), u)
      assert.ok(target === null || target.mantissa >= 1 && Number.isFinite(target.mantissa))
    }
  }
  assert.equal(revisedEffort(Number.MIN_VALUE, Number.MIN_VALUE, workAmount(0), 100, 100), Number.MIN_VALUE)
  const huge = discoveryResponsiveness(Number.MAX_VALUE, Number.MIN_VALUE, Number.MAX_VALUE)
  assert.ok(Number.isFinite(huge) && huge > 0)
  assert.throws(() => nextDiscoveryTarget(100, 20, 20, workAmount(0), 10, workAmount(100), NaN), RangeError)
})

test('subnormal discovery work is retained and overrun crossings are not consumed by early scalar rounding', () => {
  const state = fixture(2 * Number.MIN_VALUE, Number.MIN_VALUE)
  state.developers[0].productivity = Number.MIN_VALUE
  const whole = advanceSimulation(state, 3, () => 0.1)
  let split = state
  for (const seconds of [0.25, 0.25, 0.5, 1, 1]) split = JSON.parse(JSON.stringify(advanceSimulation(split, seconds, () => 0.1)))
  assert.equal(whole.tickets[0].actualStatus, 'done')
  assert.deepEqual(split.tickets, whole.tickets)
  assert.deepEqual(split.workLog, whole.workLog)
  assert.equal(split.randomState, whole.randomState)
  assert.ok(whole.tickets[0].reportedEffortEstimate! >= Number.MIN_VALUE && whole.tickets[0].reportedEffortEstimate! <= 2 * Number.MIN_VALUE)
})

test('latest candidate and hidden discovery state remain DEV-only; player sees only the published estimate', () => {
  const state = advanceSimulation(fixture(), 10, () => 0.1)
  assert.ok(state.tickets[0].lastEstimateEvaluation)
  const player = getPlayerView(state), diagnostic = getDiagnosticsView(state)
  assert.equal(player.tickets[0].reportedEffortEstimate, state.tickets[0].reportedEffortEstimate)
  for (const field of ['lastEstimateEvaluation', 'learningBaseline', 'overrunEvaluationConsumed', 'evaluatedOverrunEstimate', 'requiredWork', 'completedWork']) {
    assert.equal(field in player.tickets[0], false)
  }
  assert.ok(player.developers.every(d => !('estimateDiscovery' in d) && !('workSession' in d)))
  assert.deepEqual(diagnostic.tickets[0].lastEstimateEvaluation, state.tickets[0].lastEstimateEvaluation)
  const original = structuredClone(state)
  diagnostic.tickets[0].lastEstimateEvaluation!.candidate = 0
  assert.deepEqual(state, original)
})
