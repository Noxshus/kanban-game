import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BoardReport } from '../src/game/boardActivity'
import { collectBoardActivity } from '../src/game/boardActivity.ts'
import { collectPlayerObservations, createPlayerObservations, getPlayerObservations, getTicketObservation } from '../src/store/playerObservations.ts'
import { eventTime } from '../src/game/eventTime.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { projectWork } from '../src/game/completionTime.ts'
import { workAmount } from '../src/game/work.ts'
import { boardReducer, createBoardSession, createDevelopmentBoardSession } from '../src/store/boardSession.ts'
import { simulationReducer } from '../src/store/simulationControls.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { decisionFixture, setPublishedEstimate } from './helpers/decisionFixture.ts'

const at = eventTime
const report = (changes: Partial<BoardReport & { reportedProgress: number }> = {}): BoardReport & { reportedProgress: number } => ({ id: 'ticket', title: 'Public title',
  reportedStatus: 'todo', reportedProgress: 0, ...changes })
const seededObservations = (game: ReturnType<typeof decisionFixture>) => createPlayerObservations(
  getPlayerView(game).tickets)

test('initial observations preserve Unknown or a known starting value without manufacturing earlier publications', () => {
  for (const value of [undefined, 0, 10, 1e-200, 1e200]) {
    const initial = createPlayerObservations([report({ reportedEffortEstimate: value })])
    assert.equal(initial[0].estimate, value ?? null)
    assert.deepEqual(initial[0].publications, [])
    assert.equal(getTicketObservation(initial[0]).revisionCount, 0)
  }
})

test('Unknown publication is context, one revision is quiet, and two real changes create the repeated-revision fact', () => {
  const initial = createPlayerObservations([report()]), c = collectPlayerObservations(initial)
  c.observe(report({ reportedEffortEstimate: 10 }), at(1))
  assert.equal(getTicketObservation(c.observations[0]).revisionCount, 0)
  c.observe(report({ reportedEffortEstimate: 10 }), at(2))
  c.observe(report({ reportedEffortEstimate: 11 }), at(3))
  assert.equal(getTicketObservation(c.observations[0]).revisionCount, 1)
  c.observe(report({ reportedEffortEstimate: 12 }), at(4, 1e-17))
  const view = getTicketObservation(c.observations[0])
  assert.equal(view.revisionCount, 2)
  assert.deepEqual(view.publications, [
    { from: null, to: 10, at: at(1) }, { from: 10, to: 11, at: at(3) }, { from: 11, to: 12, at: at(4, 1e-17) },
  ])
  assert.deepEqual(initial[0].publications, []) // Local collection never mutates a previous session.
  assert.deepEqual(JSON.parse(JSON.stringify(c.observations)), c.observations)
})

test('evidence retains all public changes even inside one collection exceeding the 100-entry ticker limit', () => {
  const first = report({ reportedEffortEstimate: 1 }), evidence = collectPlayerObservations(createPlayerObservations([first]))
  const ticker = collectBoardActivity([first])
  for (let i = 2; i <= 150; i++) {
    const next = report({ reportedEffortEstimate: i })
    ticker.observe(next, at(i)); evidence.observe(next, at(i))
  }
  assert.equal(ticker.events.length, 100)
  assert.equal(getTicketObservation(evidence.observations[0]).revisionCount, 149)
  assert.deepEqual(evidence.observations[0].publications[0], { from: 1, to: 2, at: at(2) })
  assert.deepEqual(evidence.observations[0].publications.at(-1), { from: 149, to: 150, at: at(150) })
})

test('reported status/progress observations cannot create a freshness claim or progress ticker noise', () => {
  const s = decisionFixture(), d = s.developers[0], t = s.tickets[0]
  d.productivity = 0
  t.actualStatus = 'todo'; t.reportedStatus = 'todo'; t.assignedDeveloperId = d.id
  const original = structuredClone(s)
  const whole = collectPlayerObservations(seededObservations(s)), ticker = collectBoardActivity(s.tickets)
  const noDraw = () => { throw Error('No additional RNG expected') }
  assert.deepEqual(advanceSimulation(s, 0, noDraw, whole.observe), s)
  assert.deepEqual(whole.observations, seededObservations(s))
  let wholeDraws = 0, splitDraws = 0
  const start = () => { assert.equal(++wholeDraws, 1); return 0 }
  const splitStart = () => { assert.equal(++splitDraws, 1); return 0 }
  const done = advanceSimulation(s, 20, start, (r, time) => { whole.observe(r, time); ticker.observe(r, time) })
  let split = s, evidence = seededObservations(s)
  for (const seconds of [.3, .3, .4, 19]) {
    const c = collectPlayerObservations(JSON.parse(JSON.stringify(evidence)))
    split = JSON.parse(JSON.stringify(advanceSimulation(split, seconds, splitStart, c.observe)))
    evidence = c.observations
  }
  assert.deepEqual(evidence, whole.observations)
  assert.deepEqual(getTicketObservation(evidence[0]), { revisionCount: 0, publications: [] })
  assert.deepEqual(ticker.events.map(event => [event.kind, event.at]), [['status', at(0)]])
  assert.deepEqual(split, done)
  assert.equal(wholeDraws, 1); assert.equal(splitDraws, 1) // One real start-status publication in either partition.
  assert.deepEqual(s, original)
})

test('review regression: 100s versus JSON-restored 100 x 1s preserves all player observations on rounded progress plateaus', () => {
  const s = decisionFixture(), developer = s.developers[0], ticket = s.tickets[0]
  developer.productivity = 1; developer.focus = 0
  ticket.requiredWork = 2e18; ticket.completedWork = 1e18; ticket.reportedProgress = 50
  setPublishedEstimate(ticket, developer.id, 2e18)
  const original = structuredClone(s)
  const wholeEvidence = collectPlayerObservations(seededObservations(s)), wholeTicker = collectBoardActivity(s.tickets)
  const whole = advanceSimulation(s, 100, undefined, (r, time) => { wholeEvidence.observe(r, time); wholeTicker.observe(r, time) })
  let split = s, observations = seededObservations(s)
  const splitTicker = collectBoardActivity(s.tickets)
  for (let i = 0; i < 100; i++) {
    const c = collectPlayerObservations(JSON.parse(JSON.stringify(observations)))
    split = JSON.parse(JSON.stringify(advanceSimulation(split, 1, undefined, (r, time) => { c.observe(r, time); splitTicker.observe(r, time) })))
    observations = c.observations
  }
  assert.deepEqual(split, whole)
  assert.deepEqual(whole, advanceSimulation(s, 100))
  assert.equal(split.randomState, s.randomState)
  assert.deepEqual(getPlayerView(split), getPlayerView(whole))
  assert.equal(getPlayerView(whole).tickets[0].reportedProgress, 50) // No report event: legacy percentage stays fixed.
  assert.deepEqual(observations, wholeEvidence.observations)
  assert.deepEqual(getPlayerObservations(observations), [{ ticketId: 'current', revisionCount: 0, publications: [] }])
  assert.deepEqual(getPlayerObservations(observations), getPlayerObservations(wholeEvidence.observations))
  assert.deepEqual(splitTicker.events, wholeTicker.events)
  const zero = collectPlayerObservations(observations), noDraw = () => { throw Error('Zero time must not consume RNG') }
  assert.deepEqual(advanceSimulation(split, 0, noDraw, zero.observe), split)
  assert.deepEqual(zero.observations, observations)
  assert.deepEqual(s, original)
})

test('obsolete local freshness state is discarded through JSON restoration without losing public publication evidence', () => {
  const old = [{ ticketId: 'ticket', estimate: 12, reportedStatus: 'in_progress', reportedProgress: 50,
    progressUnchangedSince: at(35), publications: [{ from: 10, to: 11, at: at(1) }, { from: 11, to: 12, at: at(2) }] }]
  const restored = collectPlayerObservations(JSON.parse(JSON.stringify(old)))
  assert.deepEqual(restored.observations, [{ ticketId: 'ticket', estimate: 12, publications: old[0].publications }])
  assert.equal(getTicketObservation(restored.observations[0]).revisionCount, 2)
  restored.observe(report({ reportedStatus: 'in_progress', reportedProgress: 50, reportedEffortEstimate: 12 }), at(100))
  assert.deepEqual(restored.observations, collectPlayerObservations(JSON.parse(JSON.stringify(restored.observations))).observations)
  assert.ok(!JSON.stringify(getPlayerObservations(restored.observations)).includes('unchanged'))
})

test('failed publication is not an observed revision, while a successful work-boundary publication is retained', () => {
  for (const succeeds of [false, true]) {
    const s = decisionFixture(), d = s.developers[0], t = s.tickets[0]
    t.assignedDeveloperId = d.id
    setPublishedEstimate(t, d.id, 20)
    d.estimateDiscovery = { ticketId: t.id, boardEstimate: 20, baseline: 20, requiredWork: 100, judgement: 0, productive: true, target: workAmount(1) }
    const c = collectPlayerObservations(seededObservations(s)), due = projectWork(d, t, workAmount(1)).seconds!
    const draws = [succeeds ? 0 : .99, .99, .999999] // effort, independent missed progress, discovery target
    const result = advanceSimulation(s, due, () => { assert.ok(draws.length); return draws.shift()! }, c.observe)
    assert.equal(result.tickets[0].lastEstimateEvaluation!.improved, true)
    assert.equal(result.tickets[0].lastEstimateEvaluation!.published, succeeds)
    assert.equal(getTicketObservation(c.observations[0]).revisionCount, succeeds ? 1 : 0)
    assert.equal(c.observations[0].publications.length, succeeds ? 1 : 0)
    if (succeeds) assert.deepEqual(c.observations[0].publications[0].at, result.tickets[0].estimateHistory!.at(-1)!.at)
  }
})

test('pause and paused priority edits preserve observations; restart clears evidence independently of ticker history', () => {
  const session = createBoardSession(), s = decisionFixture()
  s.developers[0].productivity = 0
  session.simulation.game = s
  session.observations = seededObservations(s)
  let next = session
  for (let i = 0; i < 20; i++) next = boardReducer(next, { type: 'step' })
  assert.deepEqual(next.observations, session.observations)
  assert.strictEqual(boardReducer(next, { type: 'tick' }), next)
  assert.deepEqual(boardReducer(next, { type: 'reorderTodo', ticketId: 'missing', targetId: 'current' }).observations, next.observations)
  const resumed = boardReducer(next, { type: 'togglePause' })
  const paused = boardReducer(resumed, { type: 'togglePause' })
  assert.deepEqual(paused.observations, next.observations)
  assert.equal(paused.simulation.game.simulationTime, 20)
  assert.deepEqual(boardReducer(paused, { type: 'restart' }), createBoardSession())
  const ranked = createBoardSession(), before = structuredClone(ranked)
  const reordered = boardReducer(ranked, { type: 'reorderTodo', ticketId: 'ticket-5', targetId: 'ticket-2' })
  assert.deepEqual(reordered.observations, ranked.observations)
  assert.deepEqual(ranked, before)
})

test('intermediate publications survive seeded partitions and JSON restoration', () => {
  for (const seed of [1, 42]) for (const reverse of [false, true]) {
    const s = structuredClone(exampleGameState); s.randomState = seed
    if (reverse) s.developers.reverse()
    const wholeEvidence = collectPlayerObservations(seededObservations(s)), wholeTicker = collectBoardActivity(s.tickets)
    const whole = advanceSimulation(s, 30, undefined, (r, t) => { wholeEvidence.observe(r, t); wholeTicker.observe(r, t) })
    let split = s, observations = seededObservations(s)
    const ticker = collectBoardActivity(s.tickets)
    for (let i = 0; i < 30; i++) for (const dt of [.3, .3, .4]) {
      const c = collectPlayerObservations(JSON.parse(JSON.stringify(observations)))
      split = JSON.parse(JSON.stringify(advanceSimulation(JSON.parse(JSON.stringify(split)), dt, undefined, (r, t) => { c.observe(r, t); ticker.observe(r, t) })))
      observations = c.observations
    }
    assert.deepEqual(observations, wholeEvidence.observations)
    assert.deepEqual(ticker.events, wholeTicker.events)
    assert.deepEqual(getPlayerObservations(observations), getPlayerObservations(wholeEvidence.observations))
    assert.equal(split.randomState, whole.randomState)
    assert.deepEqual(whole, advanceSimulation(s, 30))
    assert.deepEqual(split.developers.map(d => [d.id, d.activeTicketID, d.lastAssessment]), whole.developers.map(d => [d.id, d.activeTicketID, d.lastAssessment]))
  }
})

test('an intermediate estimate chain in one advance cannot disappear into a final snapshot', () => {
  const s = decisionFixture(), d = s.developers[0], t = s.tickets[0]
  d.productivity = 100; d.focus = 0
  t.requiredWork = 10; setPublishedEstimate(t, d.id, 1)
  d.estimateReview = { ticketId: t.id, dueTime: { high: .01, low: 0 } }
  const c = collectPlayerObservations(seededObservations(s))
  const result = advanceSimulation(s, 1, () => .1, c.observe)
  assert.ok(c.observations[0].publications.length >= 2)
  assert.equal(getTicketObservation(c.observations[0]).revisionCount, result.tickets[0].estimateHistory!.length - 1)
  assert.equal(c.observations[0].publications.at(-1)!.to, result.tickets[0].reportedEffortEstimate)
})

test('player and DEV sessions observe the same facts without changing gameplay, RNG or public activity IDs', () => {
  let player = createBoardSession(), dev = createDevelopmentBoardSession()
  const initial = structuredClone(player)
  const actions = [{ type: 'reorderTodo', ticketId: 'ticket-5', targetId: 'ticket-2' }, { type: 'step' },
    { type: 'togglePause' }, { type: 'tick' }, { type: 'tick' }, { type: 'togglePause' }, { type: 'step' }] as const
  for (const action of actions) {
    const direct = simulationReducer(player.simulation, action)
    player = boardReducer(player, action); dev = boardReducer(dev, action)
    assert.deepEqual(player.simulation, direct)
    assert.deepEqual(player.simulation, dev.simulation)
    assert.deepEqual(player.observations, dev.observations)
    assert.deepEqual(player.activity, dev.activity)
  }
  assert.deepEqual(initial, createBoardSession())
  const saved = JSON.parse(JSON.stringify(player))
  assert.deepEqual(boardReducer(saved, { type: 'step' }), boardReducer(player, { type: 'step' }))
  const serialized = JSON.stringify(player.observations)
  for (const hidden of ['actualStatus', 'completedWork', 'requiredWork', 'activeTicketID', 'candidate', 'discipline', 'workLog', 'lastAssessment']) assert.ok(!serialized.includes(hidden))
})

test('legacy sessions start at the current public estimate without replaying hidden publication audit history', () => {
  const session = createBoardSession()
  session.simulation.game.simulationTime = 500
  const ticket = session.simulation.game.tickets[0]
  ticket.reportedStatus = 'in_progress'; ticket.reportedProgress = 0; ticket.reportedEffortEstimate = 50
  setPublishedEstimate(ticket, 'hidden-author', 50)
  ticket.estimateHistory!.push({ kind: 'publication', developerId: 'another-hidden-author', totalWork: 50, reason: 'discovery', at: at(10) })
  delete session.observations
  const restored = boardReducer(session, { type: 'applySeed', seed: 2 })
  assert.deepEqual(restored.observations![0].publications, [])
  assert.equal(restored.observations![0].estimate, 50)
  assert.equal(restored.simulation.game.randomState, 2)
  assert.equal(restored.simulation.game.simulationTime, 500)
  assert.ok(!JSON.stringify(restored.observations).includes('hidden-author'))
})
