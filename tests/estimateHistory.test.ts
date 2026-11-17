import { decideNow } from './helpers/decisionFixture.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Developer, GameState } from '../src/game/types.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { encounterEstimate, pauseDiscovery, resumeDiscovery, personalEstimate, validateEstimateHistory } from '../src/game/estimateHistory.ts'
import { estimateInitialEffort } from '../src/game/effortEstimate.ts'
import { evaluateEstimate, prepareDiscovery, revisedEffort } from '../src/game/reestimation.ts'
import { workAmount } from '../src/game/work.ts'
import { effortNumber } from '../src/game/workLog.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { getDiagnosticsView } from '../src/store/diagnosticsView.ts'
import { nextRandom } from '../src/game/random.ts'
import { projectWork } from '../src/game/completionTime.ts'
import { close } from './helpers/flowExpectation.ts'

const at = { high: 0, low: 0 }
const noDraw = () => { throw Error('No fresh estimation/discovery draw expected') }
function engineer(id: string): Developer {
  return { id, name: id, productivity: 1, judgement: 0, focus: 0, competencies: { frontend: 0, backend: 0 },
    assessmentClock: { elapsed: 0, remaining: 1e9 } }
}
function fixture(): GameState {
  return { randomState: 1, simulationTime: 0, developers: [engineer('a'), engineer('b')], tickets: [
    { id: 'ticket', title: 'Ticket', rank: 1, workDomain: 'frontend', actualStatus: 'todo', reportedStatus: 'todo',
      reportedProgress: 0, requiredWork: 100, completedWork: 0 },
  ] }
}

test('independent first encounters replace upward/downward; returns remember beliefs without rerolls', () => {
  const s = fixture(), t = s.tickets[0], [a, b] = s.developers
  encounterEstimate(t, a, at, () => 0.8)
  const original = structuredClone(t.initialEffortEstimate)
  close(t.reportedEffortEstimate!, 20)
  encounterEstimate(t, b, at, () => 0.2)
  close(t.reportedEffortEstimate!, 80)
  encounterEstimate(t, a, at, noDraw)
  close(t.reportedEffortEstimate!, 20)
  assert.deepEqual(t.initialEffortEstimate, original)
  assert.deepEqual(t.estimateHistory!.map(e => e.kind), ['assessment', 'publication', 'assessment', 'publication', 'publication'])
  const publications = t.estimateHistory!.filter(e => e.kind === 'publication')
  assert.deepEqual(publications.map(e => [e.reason, e.sourceAssessmentIndex]), [['initial', 0], ['takeover', 2], ['return', 0]])
  assert.equal(publications[2].replacedDeveloperId, 'b')
  close(publications[2].replacedTotalWork!, 80)
  // The predecessor's amount has no statistical input to a first encounter.
  const other = fixture().tickets[0]
  other.reportedEffortEstimate = 5
  encounterEstimate(other, b, at, () => 0.2)
  assert.equal(other.reportedEffortEstimate, publications[1].totalWork)
  validateEstimateHistory(t)
})

test('same-value reports preserve provenance and order without fictitious return assessments', () => {
  const s = fixture(), t = s.tickets[0], [a, b] = s.developers
  encounterEstimate(t, a, at, () => 0.5)
  encounterEstimate(t, b, at, () => 0.5)
  encounterEstimate(t, a, at, noDraw)
  const h = t.estimateHistory!
  assert.equal(h.filter(e => e.kind === 'assessment').length, 2)
  assert.equal(h.filter(e => e.kind === 'publication').length, 3)
  assert.deepEqual(h.filter(e => e.kind === 'publication').map(e => e.replacedDeveloperId), [undefined, 'a', 'b'])
  assert.ok(h.every(e => e.totalWork === 50))
  assert.ok(h.every(e => e.at?.high === 0 && e.at.low === 0))
})

test('genuine learning uses personal baseline/experience; no-change evaluations never grow history', () => {
  const s = fixture(), t = s.tickets[0], [a, b] = s.developers
  encounterEstimate(t, a, at, () => 0.2)
  encounterEstimate(t, b, at, () => 0.8)
  const baseline = personalEstimate(t, b.id)!.baseline
  s.workLog = [{ developerId: a.id, ticketId: t.id, effort: workAmount(70) },
    { developerId: b.id, ticketId: t.id, effort: workAmount(10) }]
  evaluateEstimate(s, b, t, 'discovery')
  const expected = 100 - (100 - baseline) * (1 + 10 / baseline) ** -0.3
  close(t.reportedEffortEstimate!, expected)
  assert.notEqual(t.reportedEffortEstimate, revisedEffort(100, t.initialEffortEstimate!.totalWork, workAmount(10), 0, 0))
  const history = structuredClone(t.estimateHistory), work = structuredClone(s.workLog)
  evaluateEstimate(s, b, t, 'discovery')
  assert.equal(t.lastEstimateEvaluation!.published, false)
  assert.deepEqual(t.estimateHistory, history)
  encounterEstimate(t, a, at, noDraw)
  close(t.reportedEffortEstimate!, 80)
  encounterEstimate(t, b, at, noDraw)
  close(t.reportedEffortEstimate!, expected)
  assert.deepEqual(s.workLog, work)
})

test('rapid switching parks and restores each pending target, including censored targets, without fresh chances', () => {
  for (const uniform of [0.1, 0.999999]) {
    const s = fixture(), [a] = s.developers, one = s.tickets[0]
    const two = { ...one, id: 'other', rank: 2 }
    s.tickets.push(two)
    encounterEstimate(one, a, at, () => 0.5)
    prepareDiscovery(s, a, one, () => uniform)
    const pending = structuredClone(a.estimateDiscovery)
    pauseDiscovery(a)
    encounterEstimate(two, a, at, () => 0.5)
    prepareDiscovery(s, a, two, () => uniform)
    for (let i = 0; i < 30; i++) {
      for (const t of [one, two]) {
        pauseDiscovery(a)
        encounterEstimate(t, a, at, noDraw)
        resumeDiscovery(a, t.id)
        prepareDiscovery(s, a, t, noDraw)
        assert.equal(a.pausedEstimateDiscoveries!.length, 1)
      }
    }
    pauseDiscovery(a); resumeDiscovery(a, one.id)
    assert.deepEqual(a.estimateDiscovery, pending)
    assert.equal(s.workLog, undefined)
    assert.equal(one.estimateHistory!.filter(e => e.kind === 'assessment').length, 1)
    const json = JSON.parse(JSON.stringify(s)) as GameState
    assert.deepEqual(json.developers[0].pausedEstimateDiscoveries, a.pausedEstimateDiscoveries)
    assert.equal(json.randomState, 1)
  }
})

test('event decisions retain discovery targets and returns do not draw new initial estimates',()=>{
 let s=fixture();s.developers=[s.developers[0]];s.tickets[0].requiredWork=1e6
 s=advanceSimulation(s,.1,()=>.5)
 const pending=structuredClone(s.developers[0].estimateDiscovery)
 s.tickets.push({...fixture().tickets[0],id:'other',rank:2,requiredWork:1e6,reportedProgress:99.999})
 let draws=0;s=decideNow(s,()=>{draws++;return .5})
 assert.equal(draws,1);assert.equal(s.developers[0].activeTicketID,'other')
 assert.deepEqual(s.developers[0].pausedEstimateDiscoveries![0],pending)
 s=advanceSimulation(s,.1,()=>.5)
 const work=structuredClone(s.workLog!.find(e=>e.ticketId==='ticket')!.effort)
 s.tickets[0].reportedProgress=99.9999;s.tickets[1].reportedProgress=0
 s=decideNow(JSON.parse(JSON.stringify(s)),noDraw)
 assert.equal(s.developers[0].activeTicketID,'ticket')
 assert.deepEqual(s.developers[0].estimateDiscovery,pending)
 s=advanceSimulation(s,.1,noDraw)
 assert.ok(effortNumber(s.workLog!.find(e=>e.ticketId==='ticket')!.effort)!>effortNumber(work)!)
})
test('B hands-on revision and A changed attributes preserve remembered belief and refresh only affected discovery inputs',()=>{
 for(const attribute of ['judgement','competency'] as const){
  let s=fixture();encounterEstimate(s.tickets[0],s.developers[0],at,()=>.5);s.developers[0].activeTicketID='ticket'
  s=advanceSimulation(s,2,()=>.5)
  const opinion=structuredClone(personalEstimate(s.tickets[0],'a')!),original=structuredClone(s.tickets[0].initialEffortEstimate)
  const work=structuredClone(s.workLog!.find(e=>e.developerId==='a')!.effort),parked=structuredClone(s.developers[0].estimateDiscovery!)
  const alarm=s.tickets[0].overrunEvaluationConsumed
  s.tickets.push({...fixture().tickets[0],id:'other',rank:2,reportedProgress:99.999})
  const previews=[.5,.8];let draws=0
  s=decideNow(s,()=>{assert.ok(draws<2);return previews[draws++]})
  assert.equal(draws,2);assert.equal(s.developers[0].activeTicketID,'other');assert.equal(s.developers[1].activeTicketID,'ticket')
  const workDraws=[.999999,.05,.999999];draws=0
  s=advanceSimulation(s,2,()=>{assert.ok(draws<3);return workDraws[draws++]})
  assert.equal(draws,3)
  const a=s.developers[0],b=s.developers[1],t=s.tickets[0]
  assert.deepEqual(a.pausedEstimateDiscoveries!.find(p=>p.ticketId==='ticket'),parked)
  assert.deepEqual(s.workLog!.find(e=>e.developerId==='a'&&e.ticketId==='ticket')!.effort,work)
  const evaluation=t.lastEstimateEvaluation!
  assert.equal(evaluation.developerId,'b');assert.equal(evaluation.reason,'discovery');assert.equal(evaluation.published,true)
  const baseline=personalEstimate(t,'b')!.baseline
  close(t.reportedEffortEstimate!,100-(100-baseline)*(1+evaluation.personalWork!/baseline)**-.3)
  const history=structuredClone(t.estimateHistory!),board=t.reportedEffortEstimate
  if(attribute==='judgement')a.judgement=10;else a.competencies.frontend=10
  s.tickets.push({...fixture().tickets[0],id:'third',rank:3,reportedProgress:99.999})
  s.developers=[b,a];draws=0
  s=decideNow(JSON.parse(JSON.stringify(s)),()=>{draws++;assert.equal(draws,1);return .5})
  assert.equal(draws,1) // B's new preview only; no final decision roll or A initial roll
  const returned=s.developers.find(d=>d.id==='a')!,current=s.tickets[0]
  assert.equal(returned.activeTicketID,'ticket');assert.deepEqual(personalEstimate(current,'a'),opinion)
  assert.deepEqual(current.initialEffortEstimate,original);assert.equal(current.reportedEffortEstimate,opinion.totalWork)
  assert.deepEqual(current.estimateHistory!.slice(0,-1),history)
  const publication=current.estimateHistory!.at(-1)!
  assert.ok(publication.kind==='publication');assert.equal(publication.reason,'return')
  assert.equal(publication.sourceAssessmentIndex,opinion.index);assert.equal(publication.replacedDeveloperId,'b');assert.equal(publication.replacedTotalWork,board)
  assert.deepEqual(publication.at,{high:4,low:0})
  assert.deepEqual(s.workLog!.find(e=>e.developerId==='a'&&e.ticketId==='ticket')!.effort,work)
  draws=0;prepareDiscovery(s,returned,current,()=>{draws++;return .25})
  assert.equal(draws,attribute==='judgement'?1:0)
  const pending=structuredClone(returned.estimateDiscovery!)
  if(attribute==='judgement'){
   const r=(100-opinion.totalWork)/100,rate=.8*(1+Math.log1p(1))*2*r/(r+.2)
   close(effortNumber(pending.target!)!,effortNumber(work)!+(opinion.baseline+effortNumber(work)!)*Math.expm1(-Math.log1p(-.25)/rate))
   assert.notDeepEqual(pending.target,parked.target)
  }else assert.deepEqual(pending,parked)
  for(let i=0;i<3;i++){
   pauseDiscovery(returned);encounterEstimate(current,b,{high:4,low:0},noDraw);encounterEstimate(current,returned,{high:4,low:0},noDraw)
   resumeDiscovery(returned,'ticket');prepareDiscovery(s,returned,current,noDraw)
   assert.deepEqual(returned.estimateDiscovery,pending);assert.deepEqual(personalEstimate(current,'a'),opinion)
   assert.equal(current.overrunEvaluationConsumed,alarm)
  }
  validateEstimateHistory(current)
 }
})
test('a returning target beyond remaining capacity stays censored instead of rerolling', () => {
  const s = fixture(), t = s.tickets[0], [a, b] = s.developers
  encounterEstimate(t, a, at, () => 0.5)
  prepareDiscovery(s, a, t, () => 0.3)
  assert.ok(a.estimateDiscovery!.target)
  const target = structuredClone(a.estimateDiscovery!.target)
  pauseDiscovery(a)
  encounterEstimate(t, b, at, () => 0.5)
  t.completedWork = 99.9
  encounterEstimate(t, a, at, noDraw); resumeDiscovery(a, t.id)
  a.activeTicketID = t.id
  s.developers = [a]
  const result = advanceSimulation(s, 0.01, noDraw)
  assert.deepEqual(result.developers[0].estimateDiscovery!.target, target)
  assert.equal(result.developers[0].workSession!.estimateEvents!.discovery, null)
})

test('downward takeover below actual progress never re-arms or immediately consumes the lifetime alarm', () => {
  for (const consumed of [false, true]) {
    const s = fixture(), t = s.tickets[0], [a, b] = s.developers
    encounterEstimate(t, a, at, () => 0.1)
    t.completedWork = 60
    t.overrunEvaluationConsumed = consumed
    encounterEstimate(t, b, at, () => 0.9)
    assert.ok(t.reportedEffortEstimate! < t.completedWork)
    b.activeTicketID = t.id
    s.developers = [b]
    let result = advanceSimulation(s, 0.01, () => 0.999999)
    assert.equal(result.tickets[0].lastEstimateEvaluation, undefined)
    assert.equal(result.tickets[0].overrunEvaluationConsumed, consumed)
    assert.equal(result.developers[0].workSession!.estimateEvents!.overrun, null)
    const count = result.tickets[0].estimateHistory!.length
    result = advanceSimulation(JSON.parse(JSON.stringify(result)), 0.01, noDraw)
    assert.equal(result.tickets[0].estimateHistory!.length, count)
    assert.equal(result.tickets[0].overrunEvaluationConsumed, consumed)
  }
})

test('history-free legacy saves import evidence once without fabricated authors, dates or fresh draws', () => {
  for (const source of ['original', 'board', 'private', 'revision'] as const) {
    const s = fixture(), t = s.tickets[0], a = s.developers[0]
    s.developers = [a]; a.activeTicketID = t.id
    if (source !== 'board') t.initialEffortEstimate = { developerId: 'original-author', totalWork: 20 }
    if (source !== 'private') t.reportedEffortEstimate = 100
    if (source === 'revision') t.lastEstimateEvaluation = { developerId: 'known-reviser', reason: 'discovery', personalWork: 10, candidate: 100, published: true }
    const original = structuredClone(s)
    const first = advanceSimulation(s, 0.01, source === 'private' ? () => 0.999999 : noDraw)
    const ticket = first.tickets[0]
    assert.deepEqual(s, original)
    assert.deepEqual(ticket.initialEffortEstimate, t.initialEffortEstimate)
    assert.equal(ticket.reportedEffortEstimate, t.reportedEffortEstimate)
    const pub = ticket.estimateHistory!.find(e => e.kind === 'legacy_publication')
    if (source === 'board') assert.equal(pub?.developerId, undefined)
    if (source === 'revision') assert.equal(pub?.developerId, 'known-reviser')
    assert.ok(ticket.estimateHistory!.every(e => e.kind.startsWith('legacy_')))
    assert.ok(ticket.estimateHistory!.filter(e => e.kind === 'legacy_assessment' && e.evidence !== 'active_fallback').every(e => e.at === null))
    const next = advanceSimulation(JSON.parse(JSON.stringify(first)), 0.01, noDraw)
    assert.deepEqual(next.tickets[0].estimateHistory, ticket.estimateHistory)
    assert.equal(next.randomState, s.randomState)
  }
})

test('legacy no-op snapshot cannot identify the author of an earlier published revision', () => {
  const legacy = fixture(), ticket = legacy.tickets[0], evaluator = legacy.developers[1]
  legacy.simulationTime = 100
  legacy.developers = [evaluator]
  evaluator.activeTicketID = ticket.id
  evaluator.estimateDiscovery = { ticketId: ticket.id, boardEstimate: 60, requiredWork: 100,
    judgement: 0, productive: true, target: null } // already sampled and censored in the legacy save
  ticket.initialEffortEstimate = { developerId: 'a', totalWork: 20 }
  ticket.reportedEffortEstimate = 60
  ticket.actualStatus = 'in_progress'
  ticket.completedWork = 30
  legacy.workLog = [{ developerId: evaluator.id, ticketId: ticket.id, effort: workAmount(5) }]
  ticket.lastEstimateEvaluation = { developerId: evaluator.id, reason: 'discovery', personalWork: 5,
    candidate: revisedEffort(100, 20, workAmount(5), 0, 0), published: false }
  const saved = JSON.parse(JSON.stringify(legacy)) as GameState
  const original = structuredClone(saved)
  let restored = advanceSimulation(saved, 0.01, noDraw)
  const history = structuredClone(restored.tickets[0].estimateHistory!)
  assert.deepEqual(history, [
    { kind: 'legacy_assessment', developerId: 'a', totalWork: 20, baseline: 20, evidence: 'original', at: null },
    { kind: 'legacy_publication', totalWork: 60, at: null },
    // A present-day compatibility observation, explicitly not B authoring the old report.
    { kind: 'legacy_assessment', developerId: 'b', totalWork: 60, baseline: 20, evidence: 'active_fallback', at: { high: 100, low: 0 } },
  ])
  assert.ok(history.every(e => e.kind !== 'assessment' && e.kind !== 'publication'))
  assert.ok(!history.some(e => e.totalWork === ticket.lastEstimateEvaluation!.candidate))
  assert.equal(history[1].developerId, undefined)
  assert.equal('sourceAssessmentIndex' in history[1], false)
  assert.deepEqual(restored.tickets[0].initialEffortEstimate, ticket.initialEffortEstimate)
  assert.deepEqual(restored.tickets[0].lastEstimateEvaluation, ticket.lastEstimateEvaluation)
  for (let i = 0; i < 5; i++) {
    restored = advanceSimulation(JSON.parse(JSON.stringify(restored)), 0.01, noDraw)
    assert.deepEqual(restored.tickets[0].estimateHistory, history)
    assert.equal(restored.tickets[0].reportedEffortEstimate, 60)
    assert.equal(restored.randomState, saved.randomState)
  }
  assert.deepEqual(saved, original)
})

test('ordinary stays, repeated advances and zero time never manufacture assessment/publication history', () => {
  let s = fixture(); s.developers = [s.developers[0]]
  encounterEstimate(s.tickets[0], s.developers[0], at, () => 0)
  s.developers[0].activeTicketID = 'ticket'
  const original = structuredClone(s)
  assert.deepEqual(advanceSimulation(s, 0, noDraw), s)
  s = advanceSimulation(s, 1, noDraw)
  const history = structuredClone(s.tickets[0].estimateHistory)
  s.developers[0].assessmentClock = { elapsed: 0, remaining: 0 }
  let draws = 0
  s = advanceSimulation(s, 1, () => { draws++; return 0.5 })
  assert.equal(draws, 0) // periodic reassessment removed
  assert.deepEqual(s.tickets[0].estimateHistory, history)
  assert.equal(original.tickets[0].completedWork, 0)
})

test('history validates source provenance/order and simulation errors never mutate input or RNG', () => {
  const s = fixture(); s.developers[0].activeTicketID = 'ticket'; s.developers = [s.developers[0]]
  encounterEstimate(s.tickets[0], s.developers[0], at, () => 0.5)
  for (const change of ['source', 'time', 'amount'] as const) {
    const bad = structuredClone(s), history = bad.tickets[0].estimateHistory!
    if (change === 'source' && history[1].kind === 'publication') history[1].sourceAssessmentIndex = 1
    if (change === 'time') history[1].at = { high: -1, low: 0 }
    if (change === 'amount') history[0].totalWork = Infinity
    const before = structuredClone(bad)
    assert.throws(() => advanceSimulation(bad, 1), RangeError)
    assert.deepEqual(bad, before)
  }
  const underflow = fixture()
  underflow.tickets[0].requiredWork = Number.MIN_VALUE
  const before = structuredClone(underflow)
  assert.throws(() => advanceSimulation(underflow, 0.1, () => 0.9), /positive numeric range/)
  assert.deepEqual(underflow, before)
})

test('personal estimates and history support extreme work/attributes while remaining outside player view', () => {
  for (const total of [Number.MIN_VALUE, 1e-300, 1e300, Number.MAX_VALUE]) {
    const s = fixture(), t = s.tickets[0], a = s.developers[0]
    t.requiredWork = total; a.judgement = Number.MAX_VALUE; a.competencies.frontend = Number.MAX_VALUE
    encounterEstimate(t, a, at, () => 0.5)
    assert.equal(t.reportedEffortEstimate, estimateInitialEffort(total, a.judgement, a.competencies.frontend, 0.5))
    validateEstimateHistory(t)
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s)
    assert.equal('estimateHistory' in getPlayerView(s).tickets[0], false)
    assert.equal('pausedEstimateDiscoveries' in getPlayerView(s).developers[0], false)
    const diagnostics = getDiagnosticsView(s)
    assert.deepEqual(diagnostics.tickets[0].estimateHistory, t.estimateHistory)
    diagnostics.tickets[0].estimateHistory[0].totalWork = 0
    assert.ok(t.estimateHistory![0].totalWork > 0)
  }
})

test('seeded mixed-engineer histories, publications and claims match across fractional advances and JSON', () => {
  for (const seed of [1, 42, 58, 454327756]) {
    const s = fixture(); s.randomState = seed
    s.tickets = Array.from({ length: 4 }, (_, i) => ({ ...s.tickets[0], id: 'ticket-' + i, rank: i + 1, requiredWork: 5 + 3 * i }))
    const original = structuredClone(s), whole = advanceSimulation(s, 40)
    let split = s
    for (let i = 0; i < 40; i++) {
      split = advanceSimulation(split, 0.3); split = advanceSimulation(split, 0.3)
      split = JSON.parse(JSON.stringify(advanceSimulation(split, 0.4)))
    }
    assert.deepEqual(split.tickets, whole.tickets)
    assert.deepEqual(split.developers, whole.developers)
    assert.deepEqual(split.workLog, whole.workLog)
    assert.equal(split.randomState, whole.randomState)
    assert.deepEqual(advanceSimulation(s, 40), whole)
    assert.deepEqual(s, original)
    for (const t of whole.tickets) validateEstimateHistory(t)
    assert.equal(new Set(whole.developers.flatMap(d => d.activeTicketID ? [d.activeTicketID] : [])).size,
      whole.developers.filter(d => d.activeTicketID).length)
  }
})

test('a discovery/completion tie never appends a fictitious revision at completion', () => {
  const s = fixture(); s.developers = [s.developers[0]]
  const a = s.developers[0], t = s.tickets[0]
  encounterEstimate(t, a, at, () => 0.5)
  a.activeTicketID = t.id
  t.overrunEvaluationConsumed = true
  a.estimateDiscovery = { ticketId: t.id, boardEstimate: 50, requiredWork: 100, judgement: 0, productive: true, target: workAmount(100) }
  const due = projectWork(a, t, workAmount(100)).seconds!
  const result = advanceSimulation(s, due, noDraw)
  assert.equal(result.tickets[0].actualStatus, 'done')
  assert.equal(result.tickets[0].estimateHistory!.length, 2)
  assert.equal(result.tickets[0].lastEstimateEvaluation, undefined)
  assert.equal(result.randomState, s.randomState)
  assert.equal(nextRandom(1).state, 1015568748) // seeded generator remains unchanged
})
