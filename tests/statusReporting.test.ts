import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { reportStatus, reportProbability } from '../src/game/discipline.ts'
import { addEventTime, eventTime } from '../src/game/eventTime.ts'
import { projectWork } from '../src/game/completionTime.ts'
import { workAmount } from '../src/game/work.ts'
import { close, expectedWork } from './helpers/flowExpectation.ts'
import { nextRandom } from '../src/game/random.ts'
import { collectSimulationActivity } from '../src/game/simulationActivity.ts'
import { reorderTodo } from '../src/game/rank.ts'
import { reconsiderPriorities } from '../src/game/workDecisions.ts'
import { simulationReducer } from '../src/store/simulationControls.ts'
import { decisionFixture, setPublishedEstimate } from './helpers/decisionFixture.ts'

const restore = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const noDraw = () => { throw Error('No status opportunity or scheduling draw expected') }
function sequence(values: number[]) {
  let used = 0
  return { draw: () => { assert.ok(used < values.length, 'Unexpected RNG draw'); return values[used++] }, count: () => used }
}
function fixture(idle = false) {
  const s = decisionFixture(), d = s.developers[0], t = s.tickets[0]
  d.focus = 0; d.discipline = 0; d.competencies.frontend = 5
  t.assignedDeveloperId = d.id; setPublishedEstimate(t, d.id)
  if (idle) { delete d.activeTicketID; delete d.estimateReview }
  return s
}
function stale() {
  const s = fixture(true), t = s.tickets[0]
  t.actualStatus = 'done'; t.completedWork = 100; t.reportedProgress = 100
  return s
}

test('status uses existing Discipline probability, strict threshold and no draw for unchanged reports', () => {
  for (const discipline of [0, 10, 100, Number.MAX_VALUE]) {
    const s = fixture(), d = s.developers[0], t = s.tickets[0]
    d.discipline = discipline
    const p = reportProbability(discipline)
    t.reportedStatus = 'todo'
    assert.equal(reportStatus(t, d, 'in_progress', () => 0), true)
    assert.equal(reportStatus(t, d, 'in_progress', noDraw), false)
    if (p < 1) {
      t.reportedStatus = 'todo'
      assert.equal(reportStatus(t, d, 'in_progress', () => p), false)
      assert.equal(t.reportedStatus, 'todo')
    }
  }
  for (const value of [-1, 1, Infinity, NaN]) {
    const s = fixture(); s.tickets[0].reportedStatus = 'todo'
    assert.throws(() => reportStatus(s.tickets[0], s.developers[0], 'in_progress', () => value), /Status report RNG/)
    assert.equal(s.tickets[0].reportedStatus, 'todo')
  }
})

test('genuine pickup separately attempts In Progress status; success/failure does not change execution', () => {
  for (const [uniform, status] of [[0, 'in_progress'], [.5, 'todo']] as const) {
    const s = fixture(true), t = s.tickets[0]
    t.actualStatus = 'todo'; t.reportedStatus = 'todo'
    const c = collectSimulationActivity(s.tickets), rng = sequence([.5, uniform])
    const result = advanceSimulation(s, 1, rng.draw, c.board.observe, c.internal)
    assert.equal(rng.count(), 2) // Existing active review schedule, then independent status attempt.
    assert.equal(result.tickets[0].actualStatus, 'in_progress')
    assert.equal(result.tickets[0].reportedStatus, status)
    close(result.tickets[0].completedWork, expectedWork(1, 1, 0))
    assert.equal(result.developers[0].flowStreak!.duration, 1)
    assert.equal(result.tickets[0].reportedProgress, 0)
    assert.equal(c.board.events.filter(e => e.kind === 'status').length, uniform === 0 ? 1 : 0)
    assert.deepEqual(advanceSimulation(restore(result), 1, noDraw).tickets[0].reportedStatus, status)
  }
})

test('restored active To Do starts at time zero once, with identical reports/RNG across JSON partitions', () => {
  for (const seed of [1, 1000]) {
    const s = fixture(); s.randomState = seed
    s.tickets[0].actualStatus = 'todo'; s.tickets[0].reportedStatus = 'todo'
    const a = collectSimulationActivity(s.tickets), b = collectSimulationActivity(s.tickets)
    const whole = advanceSimulation(s, 1, undefined, a.board.observe)
    let split = s
    for (const dt of [.3, .3, .4]) split = restore(advanceSimulation(split, dt, undefined, b.board.observe))
    assert.deepEqual(split, whole); assert.deepEqual(a.board.events, b.board.events)
    assert.equal(whole.randomState, nextRandom(seed).state)
    assert.ok(a.board.events.every(e => e.at.high === 0 && e.at.low === 0))
    const silent = collectSimulationActivity(s.tickets)
    assert.deepEqual(advanceSimulation(s, 0, noDraw, silent.board.observe), s)
    assert.deepEqual(silent.board.events, [])
  }
})

test('physical completion reports terminal progress independently of fallible Done status', () => {
  for (const [uniform, status] of [[0, 'done'], [.5, 'in_progress']] as const) {
    const s = fixture(); s.tickets[0].requiredWork = 1; setPublishedEstimate(s.tickets[0], 'a', 1)
    const due = projectWork(s.developers[0], s.tickets[0], workAmount(1)).seconds!
    s.developers[0].estimateReview!.dueTime = eventTime(due)
    const rng = sequence([uniform, .5]), c = collectSimulationActivity(s.tickets)
    const done = advanceSimulation(s, due, rng.draw, c.board.observe)
    assert.equal(rng.count(), 2) // Completion status, idle check; coincident review is cancelled.
    assert.equal(done.tickets[0].actualStatus, 'done')
    assert.equal(done.tickets[0].reportedStatus, status)
    assert.equal(done.tickets[0].reportedProgress, 100)
    assert.deepEqual(done.tickets[0].progressReport!.at, eventTime(due))
    assert.equal(done.developers[0].activeTicketID, undefined)
    assert.equal(done.developers[0].flowStreak, undefined)
    assert.deepEqual(done.developers[0].idleWorkCheck, addEventTime(eventTime(due), 12))
    assert.deepEqual(advanceSimulation(restore(done), 1, noDraw).tickets, done.tickets)
    assert.deepEqual(c.board.events.filter(e => e.kind === 'status').map(e => e.at), uniform === 0 ? [eventTime(due)] : [])
  }
})

test('failed starts stay stale through work slices; existing proactive review repairs own status without a new timer', () => {
  const s = fixture(true); s.tickets[0].reportedStatus = 'todo'; s.tickets[0].actualStatus = 'todo'
  const first = advanceSimulation(s, 1, sequence([.5, .9]).draw)
  const before = advanceSimulation(restore(first), 10, noDraw)
  assert.equal(before.tickets[0].reportedStatus, 'todo')
  const c = collectSimulationActivity(before.tickets), rng = sequence([.5])
  const reviewed = advanceSimulation(before, 1, rng.draw, c.board.observe)
  assert.equal(rng.count(), 1) // Next review schedule only; proactive follow-through is reliable.
  assert.equal(reviewed.tickets[0].reportedStatus, 'in_progress')
  assert.equal(reviewed.developers[0].flowStreak!.duration, 12)
  assert.deepEqual(c.board.events.filter(e => e.kind === 'status').map(e => e.at), [eventTime(12)])
})

test('stale completion encounter performs no work, Flow, assignment, estimate or learning publication', () => {
  const s = stale(), original = structuredClone(s), rng = sequence([.9, .5])
  const r = advanceSimulation(s, 1, rng.draw)
  assert.equal(rng.count(), 2)
  assert.equal(r.tickets[0].reportedStatus, 'in_progress')
  assert.equal(r.developers[0].activeTicketID, undefined)
  assert.equal(r.developers[0].flowStreak, undefined)
  assert.equal(r.developers[0].estimateReview, undefined)
  assert.equal(r.developers[0].estimateDiscovery, undefined)
  assert.equal(r.workLog, undefined)
  assert.deepEqual(r.tickets, original.tickets)
  assert.deepEqual(r.developers[0].idleWorkCheck, eventTime(12))
  assert.deepEqual(s, original)
})

test('an Unknown stale-completed appraisal stays transient and is never promoted into estimate history', () => {
  const s = stale(), t = s.tickets[0]
  delete t.reportedEffortEstimate; delete t.initialEffortEstimate; delete t.estimateHistory
  const rng = sequence([.5, .9, .5]), r = advanceSimulation(s, 1, rng.draw)
  assert.equal(rng.count(), 3) // Selection appraisal, failed Done report, future idle deadline.
  close(r.developers[0].lastAssessment!.considered[0].estimatedTotal, 100 * Math.exp(Math.log1p(-.5) / (1 + .09 * 5)))
  assert.equal(r.tickets[0].reportedEffortEstimate, undefined)
  assert.equal(r.tickets[0].initialEffortEstimate, undefined)
  assert.equal(r.tickets[0].estimateHistory, undefined)
  assert.equal(r.tickets[0].lastEstimateEvaluation, undefined)
  assert.equal(r.workLog, undefined)
})

test('both failed start and failed completion reports can leave To Do with terminal 100% progress', () => {
  const s = fixture(true), t = s.tickets[0]
  t.actualStatus = 'todo'; t.reportedStatus = 'todo'; t.requiredWork = 1
  setPublishedEstimate(t, 'a', 1)
  const rng = sequence([.5, .9, .9, .5]), c = collectSimulationActivity(s.tickets)
  const done = advanceSimulation(s, 1, rng.draw, c.board.observe)
  assert.equal(rng.count(), 4)
  assert.equal(done.tickets[0].actualStatus, 'done')
  assert.equal(done.tickets[0].reportedStatus, 'todo')
  assert.equal(done.tickets[0].reportedProgress, 100)
  assert.equal(done.developers[0].activeTicketID, undefined)
  assert.deepEqual(c.board.events, []) // Neither hidden transition fabricated a public movement.
})

test('same engineer rediscovers the only stale ticket at later idle checks, with no enduring knowledge or instant loop', () => {
  const s = stale(), rng = sequence([.9, .5, .9, .5, 0, .5])
  const first = advanceSimulation(s, 1, rng.draw)
  const second = advanceSimulation(restore(first), 11, rng.draw)
  assert.equal(rng.count(), 4)
  assert.equal(second.developers[0].lastAssessment!.at.high, 12)
  assert.equal(second.tickets[0].reportedStatus, 'in_progress')
  assert.deepEqual(second.developers[0].idleWorkCheck, eventTime(24))
  const third = advanceSimulation(restore(second), 12, rng.draw)
  assert.equal(rng.count(), 6)
  assert.equal(third.tickets[0].reportedStatus, 'done')
  assert.deepEqual(third.developers[0].idleWorkCheck, eventTime(36))
  assert.equal(third.workLog, undefined)
  assert.equal(third.tickets[0].lastEstimateEvaluation, undefined)
  assert.deepEqual(third.tickets[0].estimateHistory, s.tickets[0].estimateHistory)
  assert.ok(Object.keys(third.developers[0]).every(key => key in s.developers[0] || key === 'lastAssessment' || key === 'idleWorkCheck'))
})

test('different engineers can encounter the same completed ticket in engineer order without duplicate active claims', () => {
  for (const reverse of [false, true]) {
    const s = stale(); s.developers.push({ ...s.developers[0], id: 'b' })
    if (reverse) s.developers.reverse()
    const rng = sequence([.9, .5, 0, .5]), c = collectSimulationActivity(s.tickets)
    const result = advanceSimulation(s, 1, rng.draw, c.board.observe, c.internal)
    assert.equal(rng.count(), 4)
    assert.ok(result.developers.every(d => d.activeTicketID === undefined && d.idleWorkCheck!.high === 12))
    assert.deepEqual(c.diagnostics.filter(e => e.kind === 'decision').map(e => e.developerId), s.developers.map(d => d.id))
    assert.equal(result.tickets[0].reportedStatus, 'done')
    assert.equal(result.workLog, undefined)
  }
})

test('original worker can rediscover its own completion after one missed completion report, never twice at the completion instant', () => {
  const s = fixture(); s.tickets[0].requiredWork = 1; setPublishedEstimate(s.tickets[0], 'a', 1)
  const rng = sequence([.9, .5, 0, .5])
  const done = advanceSimulation(s, 1, rng.draw)
  assert.equal(rng.count(), 2)
  assert.equal(done.developers[0].lastAssessment, undefined)
  const retried = advanceSimulation(restore(done), 12, rng.draw)
  assert.equal(rng.count(), 4)
  assert.deepEqual(retried.developers[0].lastAssessment!.at, done.developers[0].idleWorkCheck)
  assert.equal(retried.tickets[0].reportedStatus, 'done')
  assert.deepEqual(retried.workLog, done.workLog)
})

test('reported unfinished eligibility excludes either Backlog boundary and reported Done, not physical completion or 100% reports', () => {
  const s = stale(), t = s.tickets[0]
  s.tickets = [
    { ...t, id: 'uncommitted', rank: 1, actualStatus: 'backlog', reportedStatus: 'todo' },
    { ...t, id: 'hidden', rank: 2, actualStatus: 'todo', completedWork: 0, reportedStatus: 'done' },
    { ...t, id: 'reported-backlog', rank: 3, actualStatus: 'todo', completedWork: 0, reportedStatus: 'backlog' },
    { ...t, rank: 4 },
  ]
  const r = advanceSimulation(s, 1, sequence([.9, .5]).draw)
  assert.equal(r.developers[0].lastAssessment!.selectedId, t.id)
  assert.deepEqual(r.developers[0].lastAssessment!.considered.map(t => t.id), [t.id])
  const unfinished = fixture(true); unfinished.tickets[0].reportedProgress = 100
  const working = advanceSimulation(unfinished, 1, sequence([.9, .5]).draw)
  assert.equal(working.developers[0].activeTicketID, 'current')
  close(working.tickets[0].completedWork, expectedWork(1, 1, 0))
})

test('priority decisions include stale-completed alternatives, leave no active claim, and schedule a future check', () => {
  const s = fixture(), current = s.tickets[0]
  current.reportedStatus = 'todo'; current.rank = 1
  s.tickets.push({ ...current, id: 'stale', rank: 2, actualStatus: 'done', completedWork: 100 })
  // Equal forecasts make Rank decisive; stale completion must not disappear during relevance filtering.
  const reordered = reorderTodo(s, 'stale', 'current')
  const r = reconsiderPriorities(s, reordered)
  assert.equal(r.developers[0].lastAssessment!.selectedId, 'stale')
  assert.equal(r.developers[0].activeTicketID, undefined)
  assert.ok(r.developers[0].idleWorkCheck)
  assert.equal(r.developers[0].flowStreak, undefined)
  assert.equal(r.simulationTime, 0)
  assert.equal(r.workLog, undefined)
  const waiting = advanceSimulation(restore(r), .0001, noDraw)
  assert.deepEqual(waiting.developers, r.developers)
  assert.equal(waiting.randomState, r.randomState)
})

test('all-idle stale encounters replay exactly across fractional/one-second saves with no observer-dependent draws', () => {
  for (const seed of [1, 35, 87, 1000]) {
    const s = stale(); s.randomState = seed
    s.developers.push({ ...s.developers[0], id: 'b' })
    const a = collectSimulationActivity(s.tickets), b = collectSimulationActivity(s.tickets)
    const whole = advanceSimulation(s, 60, undefined, a.board.observe, a.internal)
    let split = s
    for (let i = 0; i < 60; i++) for (const dt of [.3, .3, .4]) split = restore(advanceSimulation(split, dt, undefined, b.board.observe, b.internal))
    assert.deepEqual(split, whole)
    assert.deepEqual(a.board.events, b.board.events)
    assert.deepEqual(a.diagnostics, b.diagnostics)
    assert.deepEqual(advanceSimulation(s, 60), whole)
  }
})

test('coincident completion/review/idle checks release claims first and retain engineer order across partitions', () => {
  for (const reverse of [false, true]) {
    const s = fixture(), a = s.developers[0], t = s.tickets[0]
    t.requiredWork = 1; setPublishedEstimate(t, a.id, 1)
    const due = projectWork(a, t, workAmount(1)).seconds!
    a.estimateReview!.dueTime = eventTime(due)
    s.developers.push({ ...a, id: 'b', activeTicketID: undefined, estimateReview: undefined, idleWorkCheck: eventTime(due) })
    if (reverse) s.developers.reverse()
    const c = collectSimulationActivity(s.tickets), rng = sequence([.9, .5, .9, .5])
    const r = advanceSimulation(s, due, rng.draw, c.board.observe, c.internal)
    assert.equal(rng.count(), 4) // Two failed status reports, each followed by one idle schedule.
    assert.equal(r.developers.find(d => d.id === 'b')!.lastAssessment?.selectedId, 'current')
    assert.equal(r.tickets[0].reportedStatus, 'in_progress')
    assert.equal(r.tickets[0].reportedProgress, 100)
    assert.ok(r.developers.every(d => !d.activeTicketID && !d.flowStreak))
    const decisions = c.diagnostics.filter(e => e.kind === 'decision')
    assert.equal(decisions.length, 1)
    const whole = advanceSimulation(s, 1.25)
    let split = s
    for (const dt of [.3, .3, .4, .25]) split = restore(advanceSimulation(split, dt))
    assert.deepEqual(split, whole)
  }
})

test('restored completed active claim reports once, without manufacturing estimate or progress history', () => {
  const s = stale(); s.developers[0].activeTicketID = 'current'
  const rng = sequence([.9, .5]), r = advanceSimulation(s, 1, rng.draw)
  assert.equal(rng.count(), 2)
  assert.equal(r.developers[0].lastAssessment, undefined)
  assert.equal(r.tickets[0].lastEstimateEvaluation, undefined)
  assert.equal(r.tickets[0].progressReport, undefined)
  assert.equal(r.tickets[0].reportedStatus, 'in_progress')
  assert.deepEqual(advanceSimulation(restore(r), 1, noDraw).tickets, r.tickets)
})

test('a completion/idle tie can divert the idle engineer into a stale encounter while the finisher claims useful work', () => {
  for (const reverse of [false, true]) {
    const s = fixture(), d = s.developers[0], t = s.tickets[0]
    t.requiredWork = 1; setPublishedEstimate(t, d.id, 1)
    const due = projectWork(d, t, workAmount(1)).seconds!
    d.estimateReview!.dueTime = eventTime(due)
    const alternative = { ...t, id: 'available', rank: 2, actualStatus: 'todo' as const,
      requiredWork: 100, completedWork: 0, assignedDeveloperId: undefined }
    setPublishedEstimate(alternative, 'previous-author', 100)
    s.tickets.push(alternative)
    s.developers.push({ ...d, id: 'idle', activeTicketID: undefined, estimateReview: undefined, idleWorkCheck: eventTime(due) })
    if (reverse) s.developers.reverse()
    const rng = sequence([.9, .9, .9, .9]), c = collectSimulationActivity(s.tickets)
    const result = advanceSimulation(s, due, rng.draw, c.board.observe, c.internal)
    assert.equal(rng.count(), 4) // Two failed Done attempts, new active review and idle check.
    assert.equal(result.developers.find(d => d.id === 'a')!.activeTicketID, 'available')
    assert.equal(result.developers.find(d => d.id === 'idle')!.activeTicketID, undefined)
    assert.equal(result.developers.find(d => d.id === 'idle')!.lastAssessment!.selectedId, t.id)
    assert.deepEqual(c.diagnostics.filter(e => e.kind === 'decision').map(e => e.developerId), s.developers.map(d => d.id))
    assert.equal(result.tickets[0].reportedStatus, 'in_progress')
    assert.equal(result.tickets[1].completedWork, 0)
    assert.equal(result.workLog!.length, 1)
    assert.equal(result.workLog![0].developerId, 'a')
    assert.equal(result.workLog![0].ticketId, t.id)
  }
})

test('atomic failure in a new status-report draw cannot partially mutate work, histories or seeded state', () => {
  const s = fixture(true); s.tickets[0].reportedStatus = 'todo'
  const original = structuredClone(s)
  assert.throws(() => advanceSimulation(s, 1, () => 1), /Status report RNG/)
  assert.deepEqual(s, original)
})

function pendingCompletionPriority(seed = 1, reverse = false) {
  const s = fixture(), a = s.developers[0], finished = s.tickets[0]
  s.randomState = seed; s.simulationTime = 7.25
  finished.id = 'finished'; finished.rank = 4; finished.actualStatus = 'done'
  finished.reportedStatus = 'todo'; finished.completedWork = 100; finished.reportedProgress = 100
  a.activeTicketID = finished.id
  a.flowStreak = { ticketId: finished.id, duration: 12 }
  a.estimateReview = { ticketId: finished.id, dueTime: eventTime(0) }
  const current = { ...finished, id: 'current', rank: 1, actualStatus: 'in_progress' as const,
    completedWork: 0, assignedDeveloperId: 'b' }
  const first = { ...current, id: 'first', rank: 2, actualStatus: 'todo' as const,
    reportedProgress: 0, assignedDeveloperId: undefined }
  const second = { ...first, id: 'second', rank: 3 }
  s.tickets = [current, first, second, finished]
  s.developers.push({ ...a, id: 'b', name: 'B', activeTicketID: current.id, flowStreak: undefined,
    estimateReview: { ticketId: current.id, dueTime: eventTime(1e308) } })
  if (reverse) s.developers.reverse()
  s.workLog = [{ developerId: a.id, ticketId: finished.id, effort: workAmount(100) }]
  return s
}

test('paused priority reorder/JSON/Resume preserves A completion while B stays; the next tick reports once and picks useful work', () => {
  for (const seed of [1, 1000]) for (const reverse of [false, true]) {
    const s = pendingCompletionPriority(seed, reverse), original = structuredClone(s)
    const collector = collectSimulationActivity(s.tickets)
    const staged = simulationReducer({ game: s, isPaused: true }, { type: 'reorderTodo', ticketId: 'second', targetId: 'first' }, collector.board.observe, collector.internal)
    assert.deepEqual(staged.game.developers, s.developers)
    const resumed = simulationReducer(restore(staged), { type: 'togglePause' }, collector.board.observe, collector.internal)
    const pending = resumed.game.developers.find(d => d.id === 'a')!
    assert.deepEqual(pending, s.developers.find(d => d.id === 'a'))
    assert.equal(resumed.game.developers.find(d => d.id === 'b')!.lastAssessment!.outcome, 'stay')
    assert.equal(resumed.game.randomState, seed)
    assert.equal(resumed.game.simulationTime, s.simulationTime)
    assert.equal(resumed.game.tickets[3].reportedStatus, 'todo')
    assert.deepEqual(collector.board.events, [])

    const result = simulationReducer(restore(resumed), { type: 'tick' }, collector.board.observe, collector.internal).game
    const statusDraw = nextRandom(seed), reviewDraw = nextRandom(statusDraw.state), pickupStatusDraw = nextRandom(reviewDraw.state)
    const published = statusDraw.value < .5
    assert.equal(published, seed === 1) // Independently controlled successful and failed recognition reports.
    assert.equal(result.randomState, pickupStatusDraw.state) // Completion report, new review, pickup status; no rediscovery roll.
    assert.equal(result.developers.find(d => d.id === 'a')!.activeTicketID, 'second')
    assert.equal(result.developers.find(d => d.id === 'a')!.lastAssessment!.outcome, 'pickup')
    assert.ok(result.developers.find(d => d.id === 'a')!.lastAssessment!.considered.every(t => t.id !== 'finished'))
    assert.equal(result.developers.find(d => d.id === 'b')!.activeTicketID, 'current')
    assert.equal(result.developers.find(d => d.id === 'a')!.flowStreak!.duration, 1)
    assert.equal(result.tickets[3].reportedStatus, published ? 'done' : 'todo')
    assert.equal(result.tickets[3].completedWork, 100)
    assert.deepEqual(result.workLog!.find(e => e.ticketId === 'finished'), s.workLog![0])
    assert.equal(result.tickets[3].lastEstimateEvaluation, undefined)
    assert.deepEqual(result.tickets[3].estimateHistory, s.tickets[3].estimateHistory)
    const reports = collector.board.events.filter(e => e.ticketId === 'finished')
    assert.equal(reports.length, published ? 1 : 0)
    if (published) assert.deepEqual(reports[0].at, eventTime(s.simulationTime, s.simulationTimeRemainder))
    assert.deepEqual(collector.diagnostics.filter(e => e.kind === 'decision').map(e => [e.developerId, e.decision.trigger]), [['b', 'priority'], ['a', 'pickup']])
    const later = advanceSimulation(restore(result), .1, noDraw)
    assert.equal(later.tickets[3].reportedStatus, result.tickets[3].reportedStatus)
    assert.deepEqual(later.workLog!.find(e => e.ticketId === 'finished'), s.workLog![0])
    assert.deepEqual(s, original)
  }
})

test('pending restored completion survives repeated running priority stays and irrelevant/no-op changes without extra reports', () => {
  const s = pendingCompletionPriority(1000), collector = collectSimulationActivity(s.tickets)
  let session = { game: s, isPaused: false }
  for (const [ticketId, targetId] of [['second', 'first'], ['first', 'second'], ['second', 'first']]) {
    session = simulationReducer(restore(session), { type: 'reorderTodo', ticketId, targetId }, collector.board.observe, collector.internal)
    assert.deepEqual(session.game.developers.find(d => d.id === 'a'), s.developers[0])
    assert.equal(session.game.randomState, s.randomState)
    assert.equal(session.game.developers[1].lastAssessment!.outcome, 'stay')
  }
  assert.strictEqual(simulationReducer(session, { type: 'reorderTodo', ticketId: 'second', targetId: 'second' }), session)
  assert.deepEqual(collector.board.events, [])
  const r = advanceSimulation(restore(session.game), 1)
  assert.equal(r.developers[0].activeTicketID, 'second')
  assert.equal(r.randomState, nextRandom(nextRandom(nextRandom(s.randomState).state).state).state)
  const irrelevant = pendingCompletionPriority()
  irrelevant.tickets[1].actualStatus = 'backlog'; irrelevant.tickets[2].actualStatus = 'backlog'
  const reordered = reorderTodo(irrelevant, 'second', 'first')
  assert.strictEqual(reconsiderPriorities(irrelevant, reordered), reordered)
  assert.deepEqual(reordered.developers, irrelevant.developers)
})

test('restored completion after priority processing preserves whole/split work, reports and RNG, including coincident review', () => {
  for (const seed of [1, 1000]) for (const reverse of [false, true]) for (const reviewNow of [false, true]) {
    const s = pendingCompletionPriority(seed, reverse)
    if (reviewNow) s.developers.find(d => d.id === 'b')!.estimateReview!.dueTime = eventTime(s.simulationTime)
    const staged = simulationReducer({ game: s, isPaused: true }, { type: 'reorderTodo', ticketId: 'second', targetId: 'first' })
    const resumed = simulationReducer(restore(staged), { type: 'togglePause' })
    const wholeEvents = collectSimulationActivity(resumed.game.tickets), splitEvents = collectSimulationActivity(resumed.game.tickets)
    const whole = advanceSimulation(restore(resumed.game), 1, undefined, wholeEvents.board.observe, wholeEvents.internal)
    let split = restore(resumed.game)
    for (const dt of [.3, .3, .4]) split = restore(advanceSimulation(split, dt, undefined, splitEvents.board.observe, splitEvents.internal))
    assert.deepEqual(split, whole)
    assert.deepEqual(splitEvents.board.events, wholeEvents.board.events)
    assert.deepEqual(splitEvents.diagnostics, wholeEvents.diagnostics)
    const stepped = simulationReducer(restore(staged), { type: 'step' })
    assert.deepEqual(stepped.game, whole)
    assert.equal(whole.developers.find(d => d.id === 'a')!.activeTicketID, 'second')
    let expectedSeed = seed
    for (let i = 0; i < (reviewNow ? 4 : 3); i++) expectedSeed = nextRandom(expectedSeed).state
    assert.equal(whole.randomState, expectedSeed) // Exactly one extra next-review schedule at the tie.
    assert.deepEqual(advanceSimulation(resumed.game, 0, noDraw), resumed.game)
  }
})
