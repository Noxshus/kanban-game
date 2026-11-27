import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createProgressProjections, collectProgressProjections, projectedProgress } from '../src/store/progressProjection.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { boardReducer, createBoardSession } from '../src/store/boardSession.ts'
import { collectBoardActivity } from '../src/game/boardActivity.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { projectWork } from '../src/game/completionTime.ts'
import { workAmount } from '../src/game/work.ts'
import { decisionFixture, setPublishedEstimate } from './helpers/decisionFixture.ts'
import { close } from './helpers/flowExpectation.ts'

const at = (high: number) => ({ high, low: 0 })
function fixture() {
  const s = decisionFixture(), t = s.tickets[0]
  t.assignedDeveloperId = 'a'; t.reportedProgress = 20
  t.progressReport = { at: at(0), estimate: 100 }
  const view = getPlayerView(s)
  return { s, t, view, c: collectProgressProjections(createProgressProjections(view.tickets, view.developers), view.developers) }
}

test('forecast advances from public base rate while the latest engineer marker remains stationary', () => {
  const { t, c } = fixture()
  close(projectedProgress(c.projections[0], at(10)).percentage!, 30)
  assert.equal(c.projections[0].report!.percentage, 20)
  t.reportedProgress = 5; t.progressReport = { at: at(10), estimate: 100 }; c.observe(t, at(10))
  close(projectedProgress(c.projections[0], at(10)).percentage!, 5)
  close(projectedProgress(c.projections[0], at(20)).percentage!, 15)
  assert.equal(c.projections[0].report!.percentage, 5)
  assert.equal(t.reportedProgress, 5)
})

test('estimate-only publications rescale the forecast without rewriting the last engineer report', () => {
  const { t, c } = fixture()
  t.reportedEffortEstimate = 200; c.observe(t, at(10))
  close(projectedProgress(c.projections[0], at(10)).percentage!, 15)
  close(projectedProgress(c.projections[0], at(20)).percentage!, 20)
  assert.equal(c.projections[0].report!.percentage, 20)
  assert.equal(c.projections[0].report!.estimate, 100)
  assert.deepEqual(c.projections[0].report!.at, at(0))
  t.reportedProgress = 0; t.progressReport = { at: at(20), estimate: 200 }; c.observe(t, at(20))
  assert.equal(projectedProgress(c.projections[0], at(20)).percentage, 0)
  assert.equal(c.projections[0].report!.percentage, 0)
})

test('public assignment/status boundaries change the rate prospectively, not hidden active claims', () => {
  const { t, view } = fixture()
  view.developers.push({ id: 'b', name: 'B', productivity: 3 })
  const c = collectProgressProjections(createProgressProjections(view.tickets, view.developers), view.developers)
  t.assignedDeveloperId = 'b'; c.observe(t, at(10))
  close(projectedProgress(c.projections[0], at(20)).percentage!, 60) // 20 + 10*1 + 10*3
  t.reportedStatus = 'todo'; c.observe(t, at(20))
  close(projectedProgress(c.projections[0], at(40)).percentage!, 60)
  t.reportedStatus = 'in_progress'; t.assignedDeveloperId = 'missing'; c.observe(t, at(40))
  close(projectedProgress(c.projections[0], at(50)).percentage!, 60)
  t.assignedDeveloperId = 'a'; c.observe(t, at(50))
  close(projectedProgress(c.projections[0], at(60)).percentage!, 70)
  view.developers[0].productivity = 2 // A newly public base rate applies only from this observation.
  c.observe(t, at(60))
  close(projectedProgress(c.projections[0], at(70)).percentage!, 90)
})

test('a real mid-advance handoff uses the former public owner rate only up to the assignment event', () => {
  const s = decisionFixture(), t = s.tickets[0], a = s.developers[0]
  t.requiredWork = 1; t.reportedProgress = 0; t.assignedDeveloperId = 'a'; setPublishedEstimate(t, 'a', 1)
  const next = { ...t, id: 'next', title: 'Next', rank: 2, requiredWork: 100, assignedDeveloperId: 'b' }
  setPublishedEstimate(next, 'b', 100)
  const busy = { ...next, id: 'busy', rank: 3, requiredWork: 1e6 }; setPublishedEstimate(busy, 'b', 1e6)
  s.tickets.push(next, busy)
  s.developers.push({ ...a, id: 'b', productivity: 3, activeTicketID: 'busy', estimateReview: { ticketId: 'busy', dueTime: at(1e308) } })
  const view = getPlayerView(s), c = collectProgressProjections(createProgressProjections(view.tickets, view.developers), view.developers)
  const due = projectWork(a, t, workAmount(1)).seconds!
  const result = advanceSimulation(s, 1, () => .9, c.observe)
  assert.equal(result.tickets[1].assignedDeveloperId, 'a')
  close(projectedProgress(c.projections.find(item => item.ticketId === 'next')!, at(1)).percentage!, 3 * due + (1 - due))
  assert.equal(result.tickets[1].reportedProgress, 0)
})

test('identical public data with contradictory hidden truth gives identical forecasts and player selectors', () => {
  const { s, view } = fixture(), other = structuredClone(s)
  other.tickets[0].completedWork = 99; other.tickets[0].requiredWork = 1e300; other.tickets[0].actualStatus = 'backlog'
  other.developers[0].competencies = { frontend: 1e100, backend: 0 }; other.developers[0].activeTicketID = 'elsewhere'
  other.developers[0].flowStreak = { ticketId: 'current', duration: 1e100 }
  other.workLog = [{ developerId: 'secret', ticketId: 'current', effort: { mantissa: 1, exponent: 500, correction: 0 } }]
  const publicOther = getPlayerView(other)
  assert.deepEqual(publicOther, view)
  assert.deepEqual(createProgressProjections(publicOther.tickets, publicOther.developers), createProgressProjections(view.tickets, view.developers))
  assert.deepEqual(projectedProgress(createProgressProjections(view.tickets, view.developers)[0], at(200)),
    projectedProgress(createProgressProjections(publicOther.tickets, publicOther.developers)[0], at(200)))
})

test('forecast beyond 100 is not completion or the physical overrun alarm, and Done stops movement', () => {
  const { s, t, c } = fixture()
  close(projectedProgress(c.projections[0], at(200)).percentage!, 220)
  assert.equal(s.tickets[0].actualStatus, 'in_progress')
  assert.equal(s.tickets[0].overrunEvaluationConsumed, undefined)
  assert.equal(s.randomState, 1)
  t.reportedStatus = 'done'; c.observe(t, at(200))
  assert.equal(projectedProgress(c.projections[0], at(1e6)).percentage, 100)
})

test('legacy/Unknown/zero snapshots establish no invented progress-publication timestamp', () => {
  const { s, t, view } = fixture()
  delete t.progressReport
  const legacy = createProgressProjections([t], view.developers, at(50))[0]
  assert.equal(legacy.report, undefined)
  close(projectedProgress(legacy, at(60)).percentage!, 30)
  delete t.reportedEffortEstimate
  const c = collectProgressProjections(createProgressProjections([t], view.developers, at(50)), view.developers)
  assert.equal(projectedProgress(c.projections[0], at(60)).percentage, null)
  t.reportedEffortEstimate = 100; c.observe(t, at(60))
  close(projectedProgress(c.projections[0], at(60)).percentage!, 20)
  assert.equal(c.projections[0].report, undefined)
  t.reportedEffortEstimate = 0; c.observe(t, at(61))
  assert.equal(projectedProgress(c.projections[0], at(61)).percentage, null)
  t.reportedStatus = 'done'; c.observe(t, at(62))
  assert.equal(projectedProgress(c.projections[0], at(62)).percentage, 100)
  assert.deepEqual(s.randomState, 1)
})

test('forecast numeric extremes never store Infinity or turn positive public anchors into zero', () => {
  const { t, view } = fixture()
  for (const estimate of [Number.MIN_VALUE, 1e-300, 1e300, Number.MAX_VALUE]) {
    t.reportedEffortEstimate = estimate; t.reportedProgress = 50; delete t.progressReport
    const c = createProgressProjections([t], view.developers)
    close(projectedProgress(c[0], at(0)).percentage!, 50)
    assert.deepEqual(JSON.parse(JSON.stringify(c)), c)
  }
  t.reportedEffortEstimate = Number.MIN_VALUE
  const c = createProgressProjections([t], [{ id: 'a', productivity: Number.MAX_VALUE }])
  assert.deepEqual(projectedProgress(c[0], at(Number.MAX_VALUE)), { percentage: null, overflow: true })
  assert.ok(JSON.stringify(c).includes('logAnchor'))
  t.reportedEffortEstimate = Number.MAX_VALUE; t.reportedProgress = 0
  const tiny = createProgressProjections([t], [{ id: 'a', productivity: Number.MIN_VALUE }])
  assert.deepEqual(projectedProgress(tiny[0], at(1)), { percentage: null, overflow: false, underflow: true })
})

test('unchanged snapshots at arbitrary slice ends do not move forecast anchors or create activity spam', () => {
  const { s, t, c } = fixture(), activity = collectBoardActivity(s.tickets)
  for (let time = 1; time <= 100; time++) { c.observe(t, at(time)); activity.observe(t, at(time)) }
  assert.deepEqual(c.projections, fixture().c.projections)
  close(projectedProgress(c.projections[0], at(100)).percentage!, 120)
  assert.deepEqual(activity.events, [])
})

test('real report/assignment events preserve projection anchors, chronology, RNG and JSON under elapsed partitions', () => {
  for (const reverse of [false, true]) {
    const { s, t, view } = fixture(), d = s.developers[0]
    setPublishedEstimate(t, d.id, 20); t.progressReport!.estimate = 20
    d.estimateReview!.dueTime = at(2)
    s.tickets.push({ ...t, id: 'next', rank: 2, actualStatus: 'todo', reportedStatus: 'todo', assignedDeveloperId: undefined })
    s.developers.push({ ...d, id: 'b', activeTicketID: undefined })
    if (reverse) s.developers.reverse()
    const publicStart = getPlayerView(s)
    const c1 = collectProgressProjections(createProgressProjections(publicStart.tickets, publicStart.developers), publicStart.developers)
    const whole = advanceSimulation(s, 10, undefined, c1.observe)
    let split = s, projections = createProgressProjections(publicStart.tickets, publicStart.developers)
    for (let i = 0; i < 10; i++) for (const seconds of [.3, .3, .4]) {
      const c2 = collectProgressProjections(JSON.parse(JSON.stringify(projections)), publicStart.developers)
      split = JSON.parse(JSON.stringify(advanceSimulation(split, seconds, undefined, c2.observe)))
      projections = c2.projections
    }
    assert.deepEqual(projections, c1.projections)
    assert.equal(split.randomState, whole.randomState)
    assert.deepEqual(split.tickets, whole.tickets)
    assert.deepEqual(projections.map(p => projectedProgress(p, at(10))), c1.projections.map(p => projectedProgress(p, at(10))))
    assert.ok(view.developers.every(d => !('focus' in d)))
  }
})

test('pause freezes projections, Step changes them once, Resume does not add elapsed time and Restart clears anchors', () => {
  const initial = boardReducer(createBoardSession(), { type: 'startSprint' }), before = structuredClone(initial)
  assert.strictEqual(boardReducer(initial, { type: 'tick', elapsedRealMilliseconds: { high: 1000, low: 0 } }), initial)
  const stepped = boardReducer(initial, { type: 'step' })
  const saved = JSON.parse(JSON.stringify(stepped))
  assert.deepEqual(boardReducer(saved, { type: 'step' }), boardReducer(stepped, { type: 'step' }))
  const resumed = boardReducer(stepped, { type: 'togglePause' })
  assert.equal(resumed.simulation.game.simulationTime, stepped.simulation.game.simulationTime)
  assert.deepEqual(resumed.projections, stepped.projections)
  assert.deepEqual(boardReducer(resumed, { type: 'restart' }), createBoardSession())
  assert.deepEqual(initial, before)
})
