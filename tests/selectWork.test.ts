import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectWork, RANK_PREFERENCE } from '../src/game/selectWork.ts'
import { projectWork } from '../src/game/completionTime.ts'
import { workAmount } from '../src/game/work.ts'
import { getDiagnosticsView } from '../src/store/diagnosticsView.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { estimateInitialEffort } from '../src/game/effortEstimate.ts'
import { nextRandom } from '../src/game/random.ts'
import { decisionFixture, setPublishedEstimate } from './helpers/decisionFixture.ts'
import { close } from './helpers/flowExpectation.ts'
const noDraw = () => { throw Error('No decision RNG for published work') }

test('direct scores independently match perceived-work projection plus one soft Rank contribution', () => {
  const s = decisionFixture(), d = s.developers[0]
  s.tickets.push({ ...s.tickets[0], id: 'other', rank: 2, requiredWork: 200, reportedProgress: 25, estimateHistory: [] })
  setPublishedEstimate(s.tickets[1], d.id, 80)
  const result = selectWork(s.tickets, d, noDraw)!
  for (const option of result.considered) {
    const remaining = option.estimatedTotal * (1 - option.reportedProgress / 100)
    const t = s.tickets.find(t => t.id === option.id)!
    const expected = projectWork(d, t, workAmount(remaining), 0, true)
    close(option.score!, -expected.logSeconds + 0.25 * option.rankScore)
    close(option.perceivedRemaining!, remaining)
  }
  assert.equal(result.selectedId, 'other')
  assert.equal(RANK_PREFERENCE, 0.25)
})

test('reported progress and shared board estimates drive appraisal, not actual completed work or gross experience', () => {
  const s = decisionFixture(), d = s.developers[0]
  s.tickets[0].reportedProgress = 90
  const first = selectWork(s.tickets, d, noDraw)!
  s.tickets[0].completedWork = 99
  s.tickets[0].requiredWork = 1e20
  s.workLog = [{developerId:d.id,ticketId:'current',effort:workAmount(1e100)}]
  assert.deepEqual(selectWork(s.tickets, d, noDraw), first)
  s.tickets[0].reportedProgress = 10
  assert.equal(selectWork(s.tickets,d,noDraw)!.considered[0].perceivedRemaining,90)
})

test('retained Flow favours staying, while soft Rank permits only a modest efficiency sacrifice', () => {
  for (const [remaining, flow, selected] of [[28,40,'current'],[32,0,'other'],[300,0,'current']] as const) {
    const s=decisionFixture(),d=s.developers[0]
    s.tickets[0].rank=2; s.tickets[0].reportedProgress=70 // current perceived R=30
    s.tickets.push({...s.tickets[0],id:'other',rank:1,requiredWork:remaining,reportedProgress:0,estimateHistory:[]})
    setPublishedEstimate(s.tickets[1],d.id)
    d.flowStreak={ticketId:'current',duration:flow}
    const decision=selectWork(s.tickets,d,noDraw,'priority',{high:0,low:0},s.tickets[0])!
    assert.equal(decision.selectedId,selected)
  }
})

test('unfamiliar appraisals can rationally choose objectively worse work without a second Judgement roll', () => {
  const s=decisionFixture(),d=s.developers[0]
  delete d.activeTicketID; d.judgement=0;d.competencies.frontend=0
  s.tickets=[{...s.tickets[0],id:'small',rank:1,requiredWork:30,estimateHistory:undefined,initialEffortEstimate:undefined,reportedEffortEstimate:undefined},
    {...s.tickets[0],id:'large',rank:2,requiredWork:1000,estimateHistory:undefined,initialEffortEstimate:undefined,reportedEffortEstimate:undefined}]
  const before=structuredClone(s),draws=[0.5,0.99];let calls=0
  const decision=selectWork(s.tickets,d,()=>{assert.ok(calls<2);return draws[calls++]})!
  assert.equal(calls,2); assert.equal(decision.selectedId,'large')
  close(decision.considered[1].estimatedTotal,10)
  assert.deepEqual(s,before)
  assert.ok(!('draw' in decision) && !('nomination' in decision))
})

test('winning Unknown preview publishes once on reporting success, without resampling', () => {
  const s=decisionFixture(),d=s.developers[0]
  d.discipline=1000 // isolate successful promotion; #63 also covers missed reports
  delete d.activeTicketID
  s.tickets=[{...s.tickets[0],id:'one',rank:1,estimateHistory:undefined,initialEffortEstimate:undefined,reportedEffortEstimate:undefined},
    {...s.tickets[0],id:'two',rank:2,estimateHistory:undefined,initialEffortEstimate:undefined,reportedEffortEstimate:undefined}]
  const first=nextRandom(1),second=nextRandom(first.state)
  const decision=selectWork(s.tickets,d,(()=>{const v=[first.value,second.value];return()=>v.shift()!})())!
  const result=advanceSimulation(s,0.0001),winner=result.tickets.find(t=>t.id===decision.selectedId)!
  const preview=decision.considered.find(t=>t.id===winner.id)!
  assert.equal(winner.initialEffortEstimate!.totalWork,preview.estimatedTotal)
  assert.equal(winner.reportedEffortEstimate,preview.estimatedTotal)
  assert.deepEqual(winner.estimateHistory!.map(e=>e.kind),['publication'])
  assert.equal(result.tickets.find(t=>t.id!==winner.id)!.estimateHistory,undefined)
  assert.equal(result.randomState,nextRandom(nextRandom(nextRandom(second.state).state).state).state) // two previews, report, review, discovery
})

test('Judgement and relevant competency improve the SAME existing temporary estimate distribution', () => {
  for(const [j,c] of [[0,0],[100,0],[0,100],[100,100]]) {
    const s=decisionFixture(),d=s.developers[0]
    s.tickets[0].estimateHistory=undefined;s.tickets[0].initialEffortEstimate=undefined;s.tickets[0].reportedEffortEstimate=undefined;d.judgement=j;d.competencies.frontend=c
    const e=selectWork(s.tickets,d,()=>0.8)!.considered[0].estimatedTotal
    close(e,100*Math.exp(Math.log1p(-0.8)/(1+.09*j+.09*c)))
    assert.equal(e,estimateInitialEffort(100,j,c,.8))
  }
})

test('event subsets retain full eligible Rank ordinals and stable Rank/ID ties independent of array order', () => {
  const s=decisionFixture(),d=s.developers[0]
  for(const [id,rank] of [['middle',2],['last',3]] as const) {
    const t={...s.tickets[0],id,rank,estimateHistory:[]}; setPublishedEstimate(t,d.id);s.tickets.push(t)
  }
  const ids=new Set(['last'])
  const r=selectWork(s.tickets,d,noDraw,'priority',{high:0,low:0},s.tickets[0],ids)!
  assert.deepEqual(r.considered.map(t=>[t.id,t.rankScore]),[['current',1],['last',1/3]])
  for(const t of s.tickets){t.reportedProgress=100;t.rank=1}
  assert.equal(selectWork([...s.tickets].reverse(),d,noDraw)!.selectedId,'current')
})

test('shared board estimates override private legacy records and DEV snapshots without rerolls or mutation', () => {
  const s=decisionFixture(),t=s.tickets[0],d=s.developers[0]
  t.estimateHistory=[{kind:'assessment',developerId:d.id,totalWork:5,reason:'initial',at:{high:0,low:0}}]
  t.initialEffortEstimate={developerId:d.id,totalWork:20}
  t.reportedEffortEstimate=60
  const before=structuredClone(s)
  const appraisal=selectWork([t],d,noDraw)!.considered[0]
  assert.equal(appraisal.estimateSource,'published')
  assert.equal(appraisal.estimatedTotal,60)
  assert.deepEqual(s,before)
  assert.equal(getDiagnosticsView(s).tickets[0].estimateHistory.length,0)
  t.lastEstimateEvaluation={developerId:d.id,reason:'discovery',personalWork:10,candidate:40,published:true}
  const revised=structuredClone(s)
  assert.equal(selectWork([t],d,noDraw)!.considered[0].estimatedTotal,60)
  assert.deepEqual(s,revised)
})

test('zero/100% reports, impossible rates, tiny fractions and enormous finite scales have explicit JSON-safe outcomes', () => {
  const s=decisionFixture(),d=s.developers[0],t=s.tickets[0]
  d.productivity=0
  assert.equal(selectWork([t],d,noDraw)!.considered[0].timeLimit,'infinite')
  t.reportedProgress=100
  assert.equal(selectWork([t],d,noDraw)!.considered[0].timeLimit,'zero')
  t.reportedProgress=50;d.productivity=1
  t.estimateHistory=[];setPublishedEstimate(t,d.id,Number.MIN_VALUE)
  const tiny=selectWork([t],d,noDraw)!.considered[0]
  assert.equal(tiny.perceivedRemaining,null)
  assert.ok(tiny.logCompletionTime!<Math.log(Number.MIN_VALUE))
  assert.equal(tiny.timeLimit,null)
  for(const [total,rate] of [[1e300,1e-300],[Number.MIN_VALUE,Number.MAX_VALUE]]) {
    t.estimateHistory=[];setPublishedEstimate(t,d.id,total);d.productivity=rate
    const r=selectWork([t],d,noDraw)!
    assert.ok(Number.isFinite(r.considered[0].score))
    assert.deepEqual(JSON.parse(JSON.stringify(r)),r)
  }
})
