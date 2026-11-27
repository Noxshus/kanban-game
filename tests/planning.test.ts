import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { collectiveMedian, estimationCapacity, ESTIMATION_COSTS, ESTIMATION_CAPACITY_NORMALIZATION, getCommand, resolveEstimation } from '../src/game/planning.ts'
import { firstPublishedEstimate, migrateEstimateHistory, encounterEstimate, validateEstimateHistory } from '../src/game/estimateHistory.ts'
import { beginEstimateReporting, evaluateEstimate, prepareDiscovery } from '../src/game/reestimation.ts'
import { eventTime } from '../src/game/eventTime.ts'
import { nextRandom } from '../src/game/random.ts'
import { workAmount } from '../src/game/work.ts'
import { boardReducer, createDevelopmentBoardSession } from '../src/store/boardSession.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { getPlanningView } from '../src/store/planningView.ts'
import { getDiagnosticsView } from '../src/store/diagnosticsView.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { reportEffort } from '../src/game/discipline.ts'
import { setPublishedEstimate } from './helpers/decisionFixture.ts'
import type { GameState, TicketComplexity } from '../src/game/types'
import type { BoardSession } from '../src/store/boardSession'

const restore = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) <= Math.max(Number.MIN_VALUE, Math.abs(expected) * 2e-15), `${actual} != ${expected}`)
function fixture(complexities: TicketComplexity[] = ['M']): GameState {
  const state = structuredClone(exampleGameState)
  state.developers.forEach(developer => {
    delete developer.activeTicketID
    developer.judgement = 0; developer.focus = 0
    developer.competencies = { frontend: 0, backend: 0 }
  })
  state.tickets = complexities.map((complexity, i) => ({ id: `t-${i + 1}`, title: `Ticket ${i + 1}`, rank: i + 1, workDomain: i % 2 ? 'backend' : 'frontend',
    complexity, requiredWork: 100, completedWork: 0, actualStatus: 'backlog', reportedStatus: 'backlog', reportedProgress: 0 }))
  return state
}
function session(game = fixture()): BoardSession {
  return { ...createDevelopmentBoardSession(), simulation: { game, isPaused: true } }
}
function queue(input: BoardSession, ids: string[]) {
  return ids.reduce((state, ticketId) => boardReducer(state, { type: 'addEstimation', ticketId }), input)
}

test('starter capacity is exactly six M units in every engineer order, with centralized complexity costs', () => {
  assert.equal(estimationCapacity(exampleGameState), 6)
  assert.deepEqual(ESTIMATION_COSTS, { S: .5, M: 1, L: 2, XL: 3, XXL: 5 })
  const state = fixture()
  for (const order of [[0, 1, 2], [2, 1, 0], [1, 2, 0], [1, 0, 2]]) {
    assert.equal(estimationCapacity({ ...state, developers: order.map(i => state.developers[i]) }), 6)
  }
  assert.equal(ESTIMATION_CAPACITY_NORMALIZATION, 6 / (3 + Math.log(2) + Math.log(1.5)))
})

test('capacity follows the approved Command/Discipline equation without using Judgement, competency or Focus', () => {
  for (const command of [0, 10, 100, Number.MAX_VALUE]) for (const values of [[0], [10, 50], [100, 1000, Number.MAX_VALUE]]) {
    const state = fixture()
    state.manager = { command }
    state.developers = values.map((discipline, i) => ({ ...state.developers[i % 3], id: `d-${i}`, discipline }))
    const expected = 6 / (3 + Math.log(2) + Math.log(1.5)) * (1 + Math.log1p(command / 10))
      * values.reduce((sum, value) => sum + 1 + Math.log1p(value / 10), 0)
    close(estimationCapacity(state), expected)
    const before = estimationCapacity(state)
    state.developers.forEach(d => { d.judgement = 100; d.focus = 100; d.competencies.frontend = 100 })
    assert.equal(estimationCapacity(state), before)
    assert.ok(Number.isFinite(before))
  }
})

test('legacy missing Command/Discipline default to zero; invalid attributes reject and an empty team has zero capacity', () => {
  const state = fixture()
  delete state.manager
  state.developers = [state.developers[0]]
  delete state.developers[0].discipline
  assert.equal(getCommand(state), 0)
  const legacy = structuredClone(state)
  assert.deepEqual(getPlayerView(state).manager, { command: 0 })
  assert.deepEqual(state, legacy)
  close(estimationCapacity(state), 6 / (3 + Math.log(2) + Math.log(1.5)))
  assert.equal(estimationCapacity({ ...state, developers: [] }), 0)
  for (const value of [-1, NaN, Infinity]) {
    assert.throws(() => estimationCapacity({ ...state, manager: { command: value } }), RangeError)
    assert.throws(() => estimationCapacity({ ...state, developers: [{ ...state.developers[0], discipline: value }] }), RangeError)
  }
})

test('the exact sixth M assessment completes; the seventh is untouched and consumes no draws', () => {
  const state = fixture(Array(7).fill('M')), before = structuredClone(state)
  const result = resolveEstimation(state, state.tickets.map(t => t.id))
  assert.deepEqual(result.planning.stage, 'estimated')
  if (result.planning.stage !== 'estimated') return assert.fail()
  assert.deepEqual(result.planning.outcomes.map(o => o.result), [...Array(6).fill('published'), 'not_estimated'])
  let seed = state.randomState
  for (let i = 0; i < 18; i++) seed = nextRandom(seed).state
  assert.equal(result.game.randomState, seed)
  assert.deepEqual(result.game.tickets[6], state.tickets[6])
  assert.deepEqual(state, before)
})

test('half-unit and mixed cost boundaries spend only full requests, never skipping a blocked request', () => {
  for (const costs of [Array(13).fill('S'), ['XXL', 'M', 'S']] as TicketComplexity[][]) {
    const state = fixture(costs), result = resolveEstimation(state, state.tickets.map(t => t.id), undefined, () => .5)
    const completed = costs[0] === 'S' ? 12 : 2
    assert.ok(result.game.tickets.slice(0, completed).every(t => t.reportedEffortEstimate === 50))
    assert.equal(result.game.tickets[completed].reportedEffortEstimate, undefined)
  }
  const state = fixture(['XL', 'XXL', 'S'])
  setPublishedEstimate(state.tickets[1], 'original', 30)
  let draws = 0
  const result = resolveEstimation(state, ['t-1', 't-2', 't-3'], undefined, () => { draws++; return .5 })
  assert.equal(draws, 3)
  assert.equal(result.game.tickets[0].reportedEffortEstimate, 50)
  assert.deepEqual(result.game.tickets.slice(1), state.tickets.slice(1)) // Three spare units cannot skip the five-unit request.
})

test('empty teams do not estimate or draw; an empty submission still completes the planning stage', () => {
  const state = fixture(); state.developers = []
  const resolved = resolveEstimation(state, ['t-1'], undefined, () => { throw Error('No estimator') })
  assert.deepEqual(resolved.game, state)
  assert.equal(resolved.planning.stage === 'estimated' && resolved.planning.outcomes[0].result, 'not_estimated')
  const empty = boardReducer(session(), { type: 'resolveEstimation' })
  assert.equal(empty.sprint.planning!.stage, 'estimated')
  assert.deepEqual(empty.activity, [])
  assert.equal(empty.simulation.game.randomState, 1)
})

test('collective medians are unweighted, average even teams, and preserve tiny/large finite quantities', () => {
  assert.equal(collectiveMedian([90, 10, 50]), 50)
  assert.equal(collectiveMedian([10, 90, 30, 70]), 50)
  assert.equal(collectiveMedian([Number.MAX_VALUE, Number.MAX_VALUE]), Number.MAX_VALUE)
  assert.equal(collectiveMedian([Number.MIN_VALUE, Number.MIN_VALUE]), Number.MIN_VALUE)
  assert.equal(collectiveMedian([Number.MIN_VALUE, 2 * Number.MIN_VALUE]), 2 * Number.MIN_VALUE)
  for (const values of [[], [-1], [NaN], [Infinity]]) assert.throws(() => collectiveMedian(values), RangeError)
  for (const uniforms of [[.9, .1, .5], [.8, .2]]) {
    const state = fixture(); state.developers = state.developers.slice(0, uniforms.length)
    let draws = 0
    const result = resolveEstimation(state, ['t-1'], undefined, () => uniforms[draws++])
    close(result.game.tickets[0].reportedEffortEstimate!, 50)
    assert.equal(draws, uniforms.length)
  }
})

test('each engineer appraises with their Judgement and the relevant domain competency, using exactly one draw', () => {
  const state = fixture()
  state.tickets[0].workDomain = 'backend'
  state.developers.forEach((d, i) => { d.judgement = i * 10; d.competencies = { frontend: 999, backend: (2 - i) * 20 } })
  const uniforms = [.8, .4, .2]
  const expected = state.developers.map((d, i) => 100 * Math.exp(Math.log1p(-uniforms[i]) / (1 + .09 * d.judgement + .09 * d.competencies.backend))).sort((a, b) => a - b)[1]
  let draws = 0
  const result = resolveEstimation(state, ['t-1'], undefined, () => uniforms[draws++])
  assert.equal(result.game.tickets[0].reportedEffortEstimate, expected)
  assert.equal(draws, 3)
  assert.deepEqual(result.game.developers, state.developers)
})

test('first publication has collective E0 provenance and no private assessments or fabricated engineer author', () => {
  const input = fixture()
  const result = resolveEstimation(input, ['t-1'], undefined, () => .5), t = result.game.tickets[0]
  assert.deepEqual(t.initialEffortEstimate, { source: 'collective', totalWork: 50 })
  assert.deepEqual(t.estimateHistory, [{ kind: 'publication', source: 'collective', totalWork: 50, reason: 'initial', at: eventTime(0) }])
  assert.equal(t.lastEstimateEvaluation, undefined)
  validateEstimateHistory(t)
  const history = structuredClone(t.estimateHistory)
  for (let i = 0; i < 3; i++) { migrateEstimateHistory(t); assert.equal(firstPublishedEstimate(restore(t)), 50); assert.deepEqual(t.estimateHistory, history) }
  assert.deepEqual(result.game.developers, input.developers)
  assert.equal('initialEffortEstimate' in getPlayerView(result.game).tickets[0], false)
  assert.equal(getDiagnosticsView(result.game).tickets[0].initialEffortEstimate?.source, 'collective')
  const revised = resolveEstimation(result.game, ['t-1'], undefined, () => .1).game.tickets[0]
  assert.equal(revised.reportedEffortEstimate, 90)
  assert.deepEqual(revised.initialEffortEstimate, t.initialEffortEstimate)
  assert.deepEqual(revised.estimateHistory![0], history![0])
  assert.equal(firstPublishedEstimate(restore(revised)), 50)
})

test('re-estimation spends the same capacity, retains a better board value and never resets individual E0', () => {
  const input = fixture(['XXL', 'M', 'S'])
  for (const t of input.tickets) { setPublishedEstimate(t, 'original', 20); t.reportedEffortEstimate = 60 }
  const unchanged = resolveEstimation(input, input.tickets.map(t => t.id), undefined, () => .5)
  assert.ok(unchanged.game.tickets.every(t => t.reportedEffortEstimate === 60))
  assert.deepEqual(unchanged.game.tickets[2], input.tickets[2])
  assert.equal(unchanged.planning.stage === 'estimated' && unchanged.planning.outcomes[2].result, 'not_estimated')
  const improved = resolveEstimation(input, ['t-1'], undefined, () => .1)
  assert.equal(improved.game.tickets[0].reportedEffortEstimate, 90)
  assert.deepEqual(improved.game.tickets[0].initialEffortEstimate, input.tickets[0].initialEffortEstimate)
  assert.equal(improved.game.tickets[0].estimateHistory!.at(-1)!.kind, 'publication')
  assert.equal(firstPublishedEstimate(improved.game.tickets[0]), 20)
})

test('collective E0 feeds ordinary work-based learning; later individual reports preserve its source', () => {
  const state = resolveEstimation(fixture(), ['t-1'], undefined, () => .5).game
  const t = state.tickets[0], d = state.developers[0]
  t.actualStatus = 'in_progress'; t.reportedStatus = 'in_progress'
  d.activeTicketID = t.id
  state.workLog = [{ developerId: d.id, ticketId: t.id, effort: workAmount(10) }]
  const evaluation = evaluateEstimate(state, d, t, 'review', () => { throw Error('Proactive known estimate uses no estimate/report draw') })
  close(evaluation.candidate, 52.661375950046306)
  assert.ok(evaluation.published)
  assert.deepEqual(t.initialEffortEstimate, { source: 'collective', totalWork: 50 })
  const latest = t.estimateHistory!.at(-1)!
  assert.equal(latest.kind === 'publication' && latest.replacedSource, 'collective')
  prepareDiscovery(state, d, t, () => .5)
  assert.equal(d.estimateDiscovery!.baseline, 50)
  encounterEstimate(t, state.developers[1], eventTime(1), () => { throw Error('No handoff appraisal') })
  assert.equal(firstPublishedEstimate(restore(t)), 50)
})

test('first collective publication on previously worked Unknown preserves the future lifetime overrun opportunity', () => {
  const state = fixture(), ticket = state.tickets[0], engineer = state.developers[0]
  state.developers = [engineer]
  ticket.actualStatus = ticket.reportedStatus = 'in_progress'
  ticket.complexity = 'S'
  ticket.completedWork = 60
  ticket.lastEstimateEvaluation = { developerId: engineer.id, reason: 'pickup', candidate: 20, personalWork: 0, improved: true, published: false }
  engineer.activeTicketID = ticket.id
  engineer.estimateReview = { ticketId: ticket.id, dueTime: eventTime(1e308) }
  state.workLog = [{ developerId: engineer.id, ticketId: ticket.id, effort: workAmount(60) }]
  const collective = restore(resolveEstimation(state, [ticket.id], undefined, () => .5).game)
  const individual = restore(state)
  reportEffort(individual.tickets[0], individual.developers[0], 50, 'review', 60, eventTime(0), () => { throw Error('No reporting roll') }, true)
  for (const first of [collective, individual]) {
    assert.equal(first.tickets[0].initialEffortEstimate!.totalWork, 50)
    assert.equal(first.tickets[0].overrunEvaluationConsumed, false)
    prepareDiscovery(first, first.developers[0], first.tickets[0], () => 1 - 2 ** -53)
    assert.equal(first.tickets[0].overrunEvaluationConsumed, false) // The failed old pickup is not legacy overrun evidence.
    const revised = restore(resolveEstimation(first, [ticket.id], undefined, () => .1).game)
    assert.equal(revised.tickets[0].reportedEffortEstimate, 90)
    assert.deepEqual(revised.tickets[0].initialEffortEstimate, first.tickets[0].initialEffortEstimate)
    assert.equal(revised.tickets[0].overrunEvaluationConsumed, false)
    const reasons: string[] = []
    const advanced = advanceSimulation(revised, 55, () => 1 - 2 ** -53, undefined, event => {
      if (event.kind === 'assessment') reasons.push(event.reason)
    })
    assert.ok(advanced.tickets[0].completedWork > 90 && advanced.tickets[0].completedWork < 100)
    assert.deepEqual(reasons, ['overrun'])
    assert.equal(advanced.tickets[0].overrunEvaluationConsumed, true)
    let split = restore(revised)
    for (const seconds of [20.3, 20.3, 55 - 2 * 20.3]) split = restore(advanceSimulation(split, seconds, () => 1 - 2 ** -53))
    assert.deepEqual(split, advanced)
  }
})

test('collective initial publication and re-estimation preserve explicit lifetime history and original provenance', () => {
  for (const consumed of [false, true]) {
    const state = fixture(), ticket = state.tickets[0]
    ticket.completedWork = 60
    ticket.overrunEvaluationConsumed = consumed
    const first = restore(resolveEstimation(state, [ticket.id], undefined, () => .5).game)
    assert.equal(first.tickets[0].overrunEvaluationConsumed, consumed)
    const revised = restore(resolveEstimation(first, [ticket.id], undefined, () => .1).game)
    assert.equal(revised.tickets[0].reportedEffortEstimate, 90)
    assert.equal(revised.tickets[0].overrunEvaluationConsumed, consumed)
    assert.deepEqual(revised.tickets[0].initialEffortEstimate, { source: 'collective', totalWork: 50 })
    assert.deepEqual(revised.tickets[0].estimateHistory![0], first.tickets[0].estimateHistory![0])
  }
})

test('known legacy publications retain their earlier E0 and unknown authors through collective revision and JSON', () => {
  const state = fixture(), t = state.tickets[0]
  t.reportedEffortEstimate = 60
  t.estimateHistory = [{ kind: 'legacy_publication', totalWork: 20, at: null }, { kind: 'legacy_publication', totalWork: 60, at: null }]
  const result = resolveEstimation(state, [t.id], undefined, () => .1).game.tickets[0]
  assert.equal(result.reportedEffortEstimate, 90)
  assert.equal(result.initialEffortEstimate, undefined)
  assert.equal(result.learningBaseline, 20)
  assert.equal(firstPublishedEstimate(restore(result)), 20)
  assert.deepEqual(result.estimateHistory!.slice(0, 2), t.estimateHistory)
})

test('picking up an already planned ticket never appraises or publishes a second initial estimate', () => {
  const state = resolveEstimation(fixture(), ['t-1'], undefined, () => .5).game
  const ticket = state.tickets[0], developer = state.developers[0], history = structuredClone(ticket.estimateHistory)
  let draws = 0
  beginEstimateReporting(state, developer, ticket, eventTime(0), () => { draws++; return .5 })
  assert.equal(draws, 1) // Review scheduling only; progress is already 0 and effort is known.
  beginEstimateReporting(state, developer, ticket, eventTime(0), () => { throw Error('No restore reroll') })
  assert.deepEqual(ticket.estimateHistory, history)
  assert.deepEqual(ticket.initialEffortEstimate, { source: 'collective', totalWork: 50 })
})

test('shortlist editing is immutable, permits over-requesting, rejects duplicates and never alters Rank or engineer state', () => {
  const original = session(fixture(Array(8).fill('M')))
  let selected = queue(original, original.simulation.game.tickets.map(t => t.id))
  assert.strictEqual(boardReducer(selected, { type: 'addEstimation', ticketId: 't-1' }), selected)
  assert.strictEqual(boardReducer(selected, { type: 'addEstimation', ticketId: 'missing' }), selected)
  assert.strictEqual(boardReducer(selected, { type: 'moveEstimation', ticketId: 't-1', direction: 'up' }), selected)
  selected = boardReducer(selected, { type: 'moveEstimation', ticketId: 't-2', direction: 'up' })
  assert.deepEqual(selected.sprint.planning!.ticketIds.slice(0, 2), ['t-2', 't-1'])
  selected = boardReducer(selected, { type: 'removeEstimation', ticketId: 't-1' })
  assert.equal(selected.sprint.planning!.ticketIds.includes('t-1'), false)
  assert.strictEqual(selected.simulation, original.simulation)
  assert.deepEqual(original.sprint.planning!.ticketIds, [])
  assert.equal(getPlanningView(getPlayerView(original.simulation.game), queue(original, original.simulation.game.tickets.map(t => t.id)).sprint).requestedCapacity, 8)
})

test('resolution locks the shortlist once, including across JSON and repeated actions, without advancing work or time', () => {
  const initial = queue(session(fixture(['M', 'M'])), ['t-2', 't-1'])
  initial.simulation.game.simulationTime = .3
  initial.simulation.game.simulationTimeRemainder = 2 ** -56
  const resolved = boardReducer(initial, { type: 'resolveEstimation' })
  assert.equal(resolved.sprint.planning!.stage, 'estimated')
  assert.equal(resolved.simulation.game.simulationTime, .3)
  assert.equal(resolved.simulation.game.simulationTimeRemainder, 2 ** -56)
  assert.deepEqual(resolved.simulation.game.developers, initial.simulation.game.developers)
  assert.ok(resolved.simulation.game.tickets.every(t => t.completedWork === 0 && t.reportedProgress === 0 && t.actualStatus === 'backlog'))
  assert.deepEqual(resolved.activity.map(e => [e.ticketId, e.kind, e.at]), ['t-2', 't-1'].map(id => [id, 'estimate', eventTime(.3, 2 ** -56)]))
  for (const value of [resolved, restore(resolved)]) for (const action of [
    { type: 'resolveEstimation' }, { type: 'addEstimation', ticketId: 't-1' }, { type: 'removeEstimation', ticketId: 't-1' },
    { type: 'moveEstimation', ticketId: 't-2', direction: 'down' },
  ] as const) assert.strictEqual(boardReducer(value, action), value)
})

test('planning restores across #95 legacy shapes; only sprint end or Restart opens another cycle', () => {
  const initial = session()
  delete initial.sprint.planning
  const selected = boardReducer(restore(initial), { type: 'addEstimation', ticketId: 't-1' })
  const resolved = boardReducer(selected, { type: 'resolveEstimation' })
  let run = boardReducer(resolved, { type: 'startSprint' })
  assert.strictEqual(boardReducer(run, { type: 'resolveEstimation' }), run)
  run = boardReducer(boardReducer(run, { type: 'togglePause' }), { type: 'tick', elapsedRealMilliseconds: eventTime(240000) })
  assert.equal(run.sprint.phase, 'planning')
  assert.deepEqual(run.sprint.planning, { stage: 'shortlist', ticketIds: [] })
  assert.deepEqual(run.simulation.game.tickets[0].initialEffortEstimate, resolved.simulation.game.tickets[0].initialEffortEstimate)
  assert.equal(boardReducer(resolved, { type: 'restart' }).sprint.planning!.stage, 'shortlist')
})

test('planning failures are atomic for original state, publications and RNG, including a later underflow', () => {
  const state = fixture(['M', 'M']); state.tickets[1].requiredWork = Number.MIN_VALUE
  const original = structuredClone(state)
  assert.throws(() => resolveEstimation(state, ['t-1', 't-2'], undefined, () => 1 - 2 ** -53), /positive numeric range/)
  assert.deepEqual(state, original)
  for (const ids of [['t-1', 't-1'], ['missing']]) assert.throws(() => resolveEstimation(state, ids), RangeError)
  const board = queue(session(state), ['t-1', 't-2'])
  board.simulation.game.developers[1].judgement = -1
  const before = structuredClone(board)
  assert.throws(() => boardReducer(board, { type: 'resolveEstimation' }), /non-negative/)
  assert.deepEqual(board, before)
})

test('zero, tiny and huge base work retain usable underestimation-only collective publications', () => {
  for (const total of [0, Number.MIN_VALUE, 1e-200, 1e200, Number.MAX_VALUE]) {
    const state = fixture(); state.tickets[0].requiredWork = total
    const resolved = resolveEstimation(state, ['t-1'], undefined, () => 0).game.tickets[0]
    assert.equal(resolved.reportedEffortEstimate, total)
    assert.equal(firstPublishedEstimate(restore(resolved)), total)
    validateEstimateHistory(resolved)
  }
})

test('player planning view contains only known Command, public costs and publications; hidden capacity stays absent', () => {
  const state = fixture(), initial = session(state)
  const view = getPlanningView(getPlayerView(state), initial.sprint)
  assert.equal(view.command, 0); assert.equal(view.availableCapacity, null)
  const altered = structuredClone(state)
  altered.developers.forEach(d => { d.discipline = 999; d.judgement = 999; d.competencies.frontend = 999 })
  altered.tickets[0].requiredWork = 1e200; altered.tickets[0].actualStatus = 'done'; altered.tickets[0].completedWork = 1e100
  assert.deepEqual(getPlanningView(getPlayerView(altered), initial.sprint), view)
  assert.deepEqual(getPlayerView(state).manager, { command: 0 })
  assert.ok(!JSON.stringify(view).includes('discipline'))
})

test('seeded planned execution preserves exact state, activity, claims and RNG across fractional partitions and restoration', () => {
  for (const seed of [1, 42, 0xffffffff]) {
    let initial = queue(session(fixture(['M', 'M', 'M'])), ['t-3', 't-1', 't-2'])
    initial.simulation.game.randomState = seed
    initial.simulation.game.tickets.forEach(t => { t.actualStatus = 'todo'; t.reportedStatus = 'todo' })
    const queued = initial
    initial = boardReducer(queued, { type: 'resolveEstimation' })
    assert.deepEqual(boardReducer(restore(queued), { type: 'resolveEstimation' }), initial)
    initial = boardReducer(boardReducer(initial, { type: 'startSprint' }), { type: 'togglePause' })
    const whole = boardReducer(initial, { type: 'tick', elapsedRealMilliseconds: eventTime(10000) })
    let split = restore(initial)
    for (let i = 0; i < 10; i++) for (const ms of [300, 300, 400]) split = restore(boardReducer(split, { type: 'tick', elapsedRealMilliseconds: eventTime(ms) }))
    assert.deepEqual(split, whole)
    const claims = whole.simulation.game.developers.flatMap(d => d.activeTicketID ? [d.activeTicketID] : [])
    assert.equal(new Set(claims).size, claims.length)
  }
})
