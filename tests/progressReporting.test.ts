import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assessProgress, reportProgress } from '../src/game/progressReporting.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { evaluateEstimate } from '../src/game/reestimation.ts'
import { workAmount } from '../src/game/work.ts'
import { projectWork } from '../src/game/completionTime.ts'
import { collectBoardActivity } from '../src/game/boardActivity.ts'
import { decisionFixture, setPublishedEstimate } from './helpers/decisionFixture.ts'
import { close } from './helpers/flowExpectation.ts'
import { applySwitchLoss, beginWorkStint } from '../src/game/workLoss.ts'
import { addWorkAmounts } from '../src/game/workLog.ts'

const noDraw = () => { throw Error('Unexpected RNG') }
function sequence(values: number[]) {
  let used = 0
  return { draw: () => { assert.ok(used < values.length, 'Unexpected RNG'); return values[used++] }, count: () => used }
}

test('progress appraises gross effort of all contributors, never retained truth or unknown provenance', () => {
  const s = decisionFixture(), t = s.tickets[0]
  setPublishedEstimate(t, 'a', 80)
  s.workLog = [{ developerId: 'a', ticketId: t.id, effort: workAmount(10) },
    { developerId: 'b', ticketId: t.id, effort: workAmount(30) },
    { developerId: 'a', ticketId: 'other', effort: workAmount(100) }]
  t.completedWork = 99
  assert.equal(assessProgress(s, t), 50)
  t.completedWork = 0; t.requiredWork = 1000
  assert.equal(assessProgress(s, t), 50)
  delete s.workLog
  assert.equal(assessProgress(s, t), 0)
  delete t.reportedEffortEstimate
  assert.equal(assessProgress(s, t), null)
})

test('context-switch useful-work loss leaves the gross progress assessment unchanged', () => {
  const s = decisionFixture(), d = s.developers[0], t = s.tickets[0]
  t.complexity = 'XXL'; d.competencies.frontend = 0; t.completedWork = 40
  setPublishedEstimate(t, d.id, 80)
  s.workLog = [{ developerId: 'earlier', ticketId: t.id, effort: workAmount(40) }]
  beginWorkStint(s, d, t)
  s.workLog.push({ developerId: d.id, ticketId: t.id, effort: workAmount(30) }); t.completedWork = 70
  const before = structuredClone(s.workLog), percentage = assessProgress(s, t)
  applySwitchLoss(s, d, t)
  assert.equal(t.completedWork, 46)
  assert.equal(percentage, 87.5); assert.equal(assessProgress(s, t), percentage)
  assert.deepEqual(s.workLog, before)
})

test('a genuine second contributor reports both engineers effort, not only their new stint', () => {
  const s = decisionFixture(), t = s.tickets[0], a = s.developers[0]
  t.assignedDeveloperId = a.id
  const first = advanceSimulation(s, 1, noDraw)
  const previous = first.tickets[0].completedWork
  const next = JSON.parse(JSON.stringify(first)) as typeof first
  next.developers[0].id = 'b'
  delete next.developers[0].workSession; delete next.developers[0].flowStreak; delete next.developers[0].workStint
  next.developers[0].estimateReview = { ticketId: t.id, dueTime: { high: 2, low: 0 } }
  const second = advanceSimulation(next, 1, () => .5)
  const contributions = second.workLog!.filter(entry => entry.ticketId === t.id)
  assert.deepEqual(contributions.map(entry => entry.developerId), ['a', 'b'])
  assert.equal(second.tickets[0].progressReport!.at.high, 2)
  close(second.tickets[0].reportedProgress, second.tickets[0].completedWork)
  assert.ok(second.tickets[0].reportedProgress > previous)
  assert.deepEqual(contributions[0], first.workLog![0])
})

test('progress has its own Discipline draw, equality fails, and unchanged reports consume none', () => {
  for (const discipline of [0, 10, 100]) for (const [uniform, published] of [[0, true], [(1 + discipline / 10) / (2 + discipline / 10), false], [.99, false]] as const) {
    const s = decisionFixture(), t = s.tickets[0], d = s.developers[0]
    d.discipline = discipline
    s.workLog = [{ developerId: d.id, ticketId: t.id, effort: workAmount(25) }]
    const random = sequence([uniform])
    assert.equal(reportProgress(s, t, d, { high: 3, low: 0 }, random.draw), published)
    assert.equal(random.count(), 1)
    assert.equal(t.reportedProgress, published ? 25 : 0)
    assert.equal(t.progressReport?.at.high, published ? 3 : undefined)
    if (published) assert.equal(reportProgress(s, t, d, { high: 4, low: 0 }, noDraw), false)
  }
  const s = decisionFixture()
  assert.equal(reportProgress(s, s.tickets[0], s.developers[0], { high: 0, low: 0 }, noDraw), false)
  // A proactive confirmation distinguishes an explicit 0% report from a legacy snapshot.
  assert.equal(reportProgress(s, s.tickets[0], s.developers[0], { high: 2, low: 0 }, noDraw, true), true)
  assert.equal(s.tickets[0].reportedProgress, 0)
  assert.deepEqual(s.tickets[0].progressReport, { at: { high: 2, low: 0 }, estimate: 100 })
})

test('effort and progress publications are independent and use the denominator actually published first', () => {
  for (const [estimateRoll, progressRoll] of [[.9, 0], [0, .9]]) {
    const s = decisionFixture(), t = s.tickets[0], d = s.developers[0]
    setPublishedEstimate(t, d.id, 20)
    t.reportedProgress = 10
    t.progressReport = { at: { high: 0, low: 0 }, estimate: 20 }
    s.workLog = [{ developerId: d.id, ticketId: t.id, effort: workAmount(10) }]
    const random = sequence([estimateRoll, progressRoll])
    const result = evaluateEstimate(s, d, t, 'discovery', random.draw, { high: 5, low: 0 })
    assert.equal(random.count(), 2)
    assert.equal(result.published, estimateRoll === 0)
    if (progressRoll === 0) { assert.equal(t.reportedProgress, 50); assert.equal(t.progressReport!.estimate, 20) }
    else { assert.equal(t.reportedProgress, 10); assert.deepEqual(t.progressReport, { at: { high: 0, low: 0 }, estimate: 20 }); assert.ok(t.reportedEffortEstimate! > 20) }
  }
})

test('proactive review updates progress reliably, without interrupting work or resetting Flow', () => {
  const s = decisionFixture(), d = s.developers[0], t = s.tickets[0]
  t.assignedDeveloperId = d.id
  d.estimateReview!.dueTime = { high: 1, low: 0 }
  const activity = collectBoardActivity(s.tickets)
  const random = sequence([.5]), result = advanceSimulation(s, 1, random.draw, activity.observe)
  assert.equal(random.count(), 1) // only the next existing review deadline
  close(result.tickets[0].reportedProgress, result.tickets[0].completedWork)
  assert.equal(result.tickets[0].progressReport!.at.high, 1)
  assert.equal(result.developers[0].flowStreak!.duration, 1)
  assert.equal(result.developers[0].lastAssessment, undefined)
  assert.deepEqual(activity.events, []) // Progress publications do not add ticker rows.
})

test('no per-tick publication or RNG; Unknown work and legacy snapshots remain untimed until a real report', () => {
  const s = decisionFixture(), t = s.tickets[0]
  t.reportedProgress = 40
  const result = advanceSimulation(s, 1, noDraw)
  assert.ok(result.tickets[0].completedWork > 0)
  assert.equal(result.tickets[0].reportedProgress, 40); assert.equal(result.tickets[0].progressReport, undefined)
  assert.deepEqual(advanceSimulation(s, 0, noDraw), s)
  delete t.reportedEffortEstimate; delete t.initialEffortEstimate; delete t.estimateHistory
  const unknown = advanceSimulation(s, 1, noDraw)
  assert.equal(unknown.tickets[0].reportedProgress, 40); assert.equal(unknown.tickets[0].progressReport, undefined)
})

test('completion wins coincident reviews, forces terminal 100%, and does not invent old Done publication times', () => {
  const s = decisionFixture(), d = s.developers[0], t = s.tickets[0]
  t.requiredWork = 1; setPublishedEstimate(t, d.id, 1)
  const due = projectWork(d, t, workAmount(1)).seconds!
  d.estimateReview!.dueTime = { high: due, low: 0 }
  const idle = sequence([0,.5]), done = advanceSimulation(s, due, idle.draw)
  assert.equal(idle.count(), 2) // Completion progress is forced; independent Done status and idle deadline draw.
  assert.equal(done.tickets[0].reportedProgress, 100)
  assert.equal(done.tickets[0].reportedStatus, 'done')
  assert.deepEqual(done.tickets[0].progressReport, { at: { high: due, low: 0 }, estimate: 1 })
  assert.deepEqual(advanceSimulation(done, 1, noDraw).tickets, done.tickets)
  delete done.tickets[0].progressReport
  assert.equal(advanceSimulation(done, 1, noDraw).tickets[0].progressReport, undefined)
  t.requiredWork = 0; t.reportedEffortEstimate = 0; delete t.initialEffortEstimate; delete t.estimateHistory
  const zeroIdle = sequence([0,.5])
  assert.equal(advanceSimulation(s, 1, zeroIdle.draw).tickets[0].reportedProgress, 100)
  assert.equal(zeroIdle.count(), 2)
})

test('bounded reports handle huge team sums and subnormal work without unsafe scalar division', () => {
  for (const estimate of [Number.MIN_VALUE, 1e-300, 1, 1e300, Number.MAX_VALUE]) {
    const s = decisionFixture(), t = s.tickets[0]
    t.reportedEffortEstimate = estimate
    s.workLog = [{ developerId: 'a', ticketId: t.id, effort: workAmount(estimate) }, { developerId: 'b', ticketId: t.id, effort: workAmount(estimate) }]
    assert.equal(assessProgress(s, t), 100)
  }
  const s = decisionFixture(), t = s.tickets[0]; t.reportedEffortEstimate = Number.MAX_VALUE
  s.workLog = [{ developerId: 'a', ticketId: t.id, effort: workAmount(1e308) }, { developerId: 'b', ticketId: t.id, effort: workAmount(1e308) }]
  assert.equal(assessProgress(s, t), 100)
  t.reportedEffortEstimate = 1e-300; s.workLog[0].effort = workAmount(1e-301); s.workLog.length = 1
  close(assessProgress(s, t)!, 10)
  t.reportedEffortEstimate = 1e300
  s.workLog = ['a', 'b'].map(developerId => ({ developerId, ticketId: t.id, effort: workAmount(1e-20) }))
  assert.ok(assessProgress(s, t)! > 0) // Tiny representable percentages do not require denominator subtraction.
  t.reportedEffortEstimate = Number.MAX_VALUE; s.workLog[0].effort = workAmount(Number.MIN_VALUE)
  s.workLog.length = 1
  assert.throws(() => assessProgress(s, t), /numeric resolution/)
  for (const invalid of [-1, Infinity, NaN]) { t.reportedEffortEstimate = invalid; assert.throws(() => assessProgress(s, t), RangeError) }
  t.reportedEffortEstimate = 0; assert.equal(assessProgress(s, t), null)
})

test('real reporting events, report times and RNG replay across fractional JSON advances without ticker spam', () => {
  for (const seed of [1, 42, 87]) {
    const s = decisionFixture(), d = s.developers[0], t = s.tickets[0]
    s.randomState = seed; setPublishedEstimate(t, d.id, 20)
    d.estimateReview!.dueTime = { high: 2, low: 0 }
    s.developers.push({ ...d, id: 'idle', activeTicketID: undefined })
    const before = structuredClone(s), reports: unknown[] = [], events = collectBoardActivity(s.tickets)
    const observe = (report: Parameters<typeof events.observe>[0], at: Parameters<typeof events.observe>[1]) => {
      events.observe(report, at)
      if (report.progressReport && !reports.some(value => JSON.stringify(value) === JSON.stringify([report.id, report.reportedProgress, report.progressReport]))) {
        reports.push([report.id, report.reportedProgress, report.progressReport])
      }
    }
    const whole = advanceSimulation(s, 10, undefined, observe)
    const wholeReports = structuredClone(reports); reports.length = 0
    let split = s
    for (let i = 0; i < 10; i++) for (const seconds of [.3, .3, .4]) split = JSON.parse(JSON.stringify(advanceSimulation(split, seconds, undefined, observe)))
    assert.deepEqual(reports, wholeReports)
    assert.deepEqual(split.tickets, whole.tickets); assert.equal(split.randomState, whole.randomState)
    assert.deepEqual(split.developers, whole.developers)
    assert.ok(events.events.every(event => ['status', 'assignment', 'estimate'].includes(event.kind)))
    assert.deepEqual(advanceSimulation(s, 10), whole); assert.deepEqual(s, before)
    const bad = structuredClone(s); bad.developers[0].estimateReview!.dueTime = { high: 0, low: 0 }
    bad.workLog = [{ developerId: 'old', ticketId: t.id, effort: addWorkAmounts(workAmount(1), workAmount(1)) }]
    const saved = structuredClone(bad)
    assert.throws(() => advanceSimulation(bad, 1, () => NaN), RangeError)
    assert.deepEqual(bad, saved)
  }
})
