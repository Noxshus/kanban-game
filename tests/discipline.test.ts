import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GameState, Ticket } from '../src/game/types.ts'
import { getDiscipline, reportProbability, reviewDelay, reportEffort } from '../src/game/discipline.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { projectWork } from '../src/game/completionTime.ts'
import { workAmount } from '../src/game/work.ts'
import { evaluateEstimate, personalEffort } from '../src/game/reestimation.ts'
import { effortNumber, subtractWorkAmounts } from '../src/game/workLog.ts'
import { firstPublishedEstimate } from '../src/game/estimateHistory.ts'
import { selectWork } from '../src/game/selectWork.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { getDiagnosticsView } from '../src/store/diagnosticsView.ts'
import { nextRandom } from '../src/game/random.ts'
import { workTransitions } from '../src/game/workDecisions.ts'
import { simulationReducer } from '../src/store/simulationControls.ts'
import { close } from './helpers/flowExpectation.ts'

const noDraw=()=>{throw Error('No RNG expected')}
function sequence(values:number[]) {
  let count=0
  return { draw:()=>{assert.ok(count<values.length,'Unexpected RNG draw');return values[count++]},count:()=>count }
}
function fixture(unknown=false):GameState {
  const t:Ticket={id:'ticket',title:'Ticket',rank:1,workDomain:'frontend',actualStatus:'in_progress',
    reportedStatus:'in_progress',reportedProgress:0,requiredWork:100,completedWork:0}
  if(!unknown){t.initialEffortEstimate={developerId:'original',totalWork:20};t.reportedEffortEstimate=20;t.overrunEvaluationConsumed=false}
  return {randomState:1,simulationTime:0,tickets:[t],developers:[{
    id:'a',name:'A',activeTicketID:'ticket',productivity:1,competencies:{frontend:0,backend:5},judgement:0,focus:0,discipline:0,
    estimateReview:{ticketId:'ticket',dueTime:{high:1000,low:0}},
    ...(!unknown?{estimateDiscovery:{ticketId:'ticket',requiredWork:100,boardEstimate:20,baseline:20,judgement:0,productive:true,target:null}}:{}),
  }]}
}

test('Discipline is independent, finite, uncapped and defaults to zero only when absent',()=>{
  assert.equal(getDiscipline({}),0)
  for(const d of [0,10,100,1000,Number.MAX_VALUE]) {
    const s=1+d/10
    assert.equal(reportProbability(d),s/(1+s))
    close(reviewDelay(d,.5),12/(1+Math.log1p(d/10)))
  }
  assert.equal(reportProbability(0),.5)
  assert.equal(reportProbability(10),2/3)
  assert.ok(reportProbability(100)>reportProbability(10))
  for(const d of [-1,NaN,Infinity,-Infinity,null])assert.throws(()=>getDiscipline({discipline:d as number}),RangeError)
})

test('event reporting uses exactly one seeded draw below the probability, with equality failing',()=>{
  for(const d of [0,10,100])for(const [offset,published] of [[-Number.EPSILON,true],[0,false],[Number.EPSILON,false]] as const) {
    const s=fixture(),t=s.tickets[0],a=s.developers[0];a.discipline=d
    const uniform=reportProbability(d)+offset,random=sequence([uniform])
    const result=reportEffort(t,a,30,'discovery',10,{high:0,low:0},random.draw)
    assert.equal(result.improved,true);assert.equal(result.published,published);assert.equal(random.count(),1)
    assert.equal(t.reportedEffortEstimate,published?30:20)
    assert.equal(t.lastEstimateEvaluation!.reportDraw,uniform)
  }
  const s=fixture(),t=s.tickets[0],a=s.developers[0]
  assert.equal(reportEffort(t,a,20,'departure',0,{high:0,low:0},noDraw).improved,false)
  assert.equal(reportEffort(t,a,19,'completion',0,{high:0,low:0},noDraw).published,false)
})

test('review waiting times invert the approved CDF, including guarded RNG endpoints',()=>{
  for(const d of [0,10,100,Number.MAX_VALUE])for(const u of [.01,.25,.5,.9,.999]) {
    const median=12/(1+Math.log1p(d/10)),t=reviewDelay(d,u)
    close(1-Math.exp(-Math.LN2*(t/median)**2),u)
    assert.ok(Number.isFinite(t)&&t>0)
  }
  for(const u of [0,1])assert.ok(reviewDelay(Number.MAX_VALUE,u)>0)
  for(const u of [-1,NaN,Infinity,1.1])assert.throws(()=>reviewDelay(0,u),RangeError)
})

test('failed Unknown pickup discards the winning preview, and restoring ongoing work never rerolls it',()=>{
  const s=fixture(true);delete s.developers[0].activeTicketID;delete s.developers[0].estimateReview
  const original=structuredClone(s),r=sequence([.5,.9,.5])
  const first=advanceSimulation(s,1,r.draw)
  assert.equal(r.count(),3) // selection preview, publication, first review deadline
  const t=first.tickets[0]
  assert.equal(t.reportedEffortEstimate,undefined);assert.equal(t.initialEffortEstimate,undefined)
  assert.equal(t.learningBaseline,undefined);assert.equal(t.estimateHistory,undefined)
  assert.equal(first.developers[0].estimateDiscovery,undefined)
  assert.equal(first.developers[0].workSession!.estimateEvents,undefined)
  assert.equal(t.lastEstimateEvaluation!.candidate,50)
  assert.equal(t.lastEstimateEvaluation!.published,false)
  assert.ok(t.completedWork>0)
  const continued=advanceSimulation(JSON.parse(JSON.stringify(first)),1,noDraw)
  assert.deepEqual(continued.developers[0].estimateReview,first.developers[0].estimateReview)
  assert.equal(continued.tickets[0].reportedEffortEstimate,undefined)
  assert.deepEqual(s,original)
})

test('a later proactive review of Unknown forms a fresh assessment and establishes first-published E0',()=>{
  const s=fixture(true),a=s.developers[0];delete a.estimateReview
  const pickup=sequence([.5,.9,.5]) // initial 50 is missed; review due exactly at 12
  const first=advanceSimulation(s,1,pickup.draw)
  const checks=sequence([.75,.5,.999999]) // fresh 25, next review, #58 target
  const reviewed=advanceSimulation(JSON.parse(JSON.stringify(first)),11,checks.draw),t=reviewed.tickets[0]
  assert.equal(checks.count(),3)
  close(t.reportedEffortEstimate!,25)
  close(firstPublishedEstimate(t)!,25)
  assert.equal(t.estimateHistory!.length,1)
  assert.equal(t.lastEstimateEvaluation!.reason,'review')
  assert.equal(t.lastEstimateEvaluation!.reportDraw,undefined)
  assert.equal(reviewed.developers[0].lastAssessment,undefined) // housekeeping, no work decision
  assert.equal(reviewed.developers[0].flowStreak!.duration,12)
  assert.ok(reviewed.developers[0].estimateDiscovery)
  assert.ok(advanceSimulation(reviewed,.001,noDraw).developers[0].workSession!.estimateEvents!.overrun)
})

test('failed discovery reporting still supplies same-event insight and switches without a second departure roll',()=>{
  const s=fixture(),a=s.developers[0],t=s.tickets[0]
  a.estimateDiscovery!.target=workAmount(1)
  // Without automatic 1%-of-true-work reporting at this boundary (#87), 17.5
  // lies between the board-only and transient-insight decision scores.
  s.tickets.push({...t,id:'other',title:'Other',rank:2,requiredWork:17.5,reportedEffortEstimate:17.5,
    initialEffortEstimate:{developerId:'other-author',totalWork:17.5},actualStatus:'todo'})
  const due=projectWork(a,t,workAmount(1)).seconds!,random=sequence([.9,.9,.5])
  const r=advanceSimulation(s,due,random.draw),d=r.developers[0]
  assert.equal(random.count(),3) // missed effort and progress reports, new-ticket review; no duplicate departure rolls
  assert.equal(d.activeTicketID,'other')
  assert.equal(r.tickets[0].reportedEffortEstimate,20)
  assert.equal(r.tickets[0].lastEstimateEvaluation!.published,false)
  const insight=d.lastAssessment!.considered.find(o=>o.id==='ticket')!
  close(insight.estimatedTotal,100-80*(1+1/20)**-.3)
  assert.equal(insight.estimateSource,'insight')
  assert.equal(d.lastAssessment!.trigger,'estimate_revision')
  // Same event, reports, Rank and accumulated Flow: only the temporary total
  // changes. The alternative lies between the resulting Rank-adjusted scores.
  const current=r.tickets[0],worker={...a,flowStreak:{ticketId:current.id,duration:due}}
  const boardOnly=selectWork(r.tickets,worker,noDraw,'estimate_revision',d.lastAssessment!.at,current)!
  const withInsight=selectWork(r.tickets,worker,noDraw,'estimate_revision',d.lastAssessment!.at,current,undefined,insight.estimatedTotal)!
  assert.equal(boardOnly.outcome,'stay');assert.equal(boardOnly.selectedId,current.id)
  assert.equal(withInsight.outcome,'switch');assert.equal(withInsight.selectedId,'other')
  assert.ok(boardOnly.considered[0].score!>boardOnly.considered[1].score!)
  assert.ok(withInsight.considered[0].score!<withInsight.considered[1].score!)
  assert.deepEqual(d.lastAssessment,withInsight)
  assert.equal(firstPublishedEstimate(current),20)
  assert.ok(current.estimateHistory!.every(event=>event.totalWork!==insight.estimatedTotal))
  assert.equal(d.flowStreak!.duration,0)
  const next=selectWork(r.tickets,d,noDraw,'priority',{high:due,low:0},r.tickets[1])!
  assert.equal(next.considered.find(o=>o.id==='ticket')!.estimatedTotal,20)
  assert.equal(next.considered.find(o=>o.id==='ticket')!.estimateSource,'published')
})

test('recognised but unreported staying insight is discarded before a later unrelated decision',()=>{
  const s=fixture(),a=s.developers[0],t=s.tickets[0]
  s.workLog=[{developerId:a.id,ticketId:t.id,effort:workAmount(10)}]
  const assessment=evaluateEstimate(s,a,t,'discovery',()=>.9)
  assert.equal(assessment.improved,true);assert.equal(assessment.published,false)
  const same=selectWork([t],a,noDraw,'estimate_revision',{high:0,low:0},t,undefined,assessment.candidate)!
  assert.equal(same.outcome,'stay');assert.equal(same.considered[0].estimateSource,'insight')
  assert.equal(selectWork([t],a,noDraw,'priority',{high:0,low:0},t)!.considered[0].estimatedTotal,20)
})

test('no-op effort discovery consumes only an independent progress chance and the next work threshold',()=>{
  const s=fixture(),a=s.developers[0],t=s.tickets[0]
  t.reportedEffortEstimate=90;t.completedWork=10
  a.estimateDiscovery!.boardEstimate=90;a.estimateDiscovery!.target=workAmount(11)
  s.workLog=[{developerId:a.id,ticketId:t.id,effort:workAmount(10)}]
  const random=sequence([.99,.999999]),r=advanceSimulation(s,projectWork(a,t,workAmount(1)).seconds!,random.draw)
  assert.equal(random.count(),2)
  assert.equal(r.tickets[0].lastEstimateEvaluation!.published,false)
  assert.equal(r.tickets[0].lastEstimateEvaluation!.reportDraw,undefined)
  assert.equal(r.developers[0].lastAssessment,undefined)
})

test('one-lifetime overrun is consumed even when a genuine correction fails to publish',()=>{
  const s=fixture(),a=s.developers[0],t=s.tickets[0]
  t.initialEffortEstimate!.totalWork=.2;t.reportedEffortEstimate=1
  a.estimateDiscovery!.baseline=.2;a.estimateDiscovery!.boardEstimate=1
  const random=sequence([.9,.9,.999999]),due=projectWork(a,t,workAmount(1)).seconds!
  const r=advanceSimulation(s,due,random.draw)
  assert.equal(random.count(),3) // missed effort/progress plus next discovery threshold
  assert.equal(r.tickets[0].overrunEvaluationConsumed,true)
  assert.equal(r.tickets[0].lastEstimateEvaluation!.reason,'overrun')
  assert.equal(r.tickets[0].lastEstimateEvaluation!.published,false)
  assert.equal(r.developers[0].lastAssessment!.trigger,'estimate_revision')
  const next=advanceSimulation(JSON.parse(JSON.stringify(r)),.1,noDraw)
  assert.equal(next.tickets[0].reportedEffortEstimate,1)
  assert.equal(next.tickets[0].overrunEvaluationConsumed,true)
  assert.equal(next.developers[0].workSession!.estimateEvents!.overrun,null)
})

test('coincident review/discovery/overrun is one guaranteed report occasion and one legitimate work decision',()=>{
  const s=fixture(),a=s.developers[0],t=s.tickets[0]
  a.estimateDiscovery!.target=workAmount(20)
  const due=projectWork(a,t,workAmount(20)).seconds!
  a.estimateReview!.dueTime={high:due,low:0}
  const random=sequence([.5,.999999]),r=advanceSimulation(s,due,random.draw)
  assert.equal(random.count(),2) // next review and next discovery, no Bernoulli
  assert.equal(r.tickets[0].estimateHistory!.filter(e=>e.kind==='publication').length,1)
  assert.equal(r.tickets[0].lastEstimateEvaluation!.reason,'overrun')
  assert.equal(r.tickets[0].lastEstimateEvaluation!.published,true)
  assert.equal(r.tickets[0].lastEstimateEvaluation!.reportDraw,undefined)
  assert.equal(r.tickets[0].overrunEvaluationConsumed,true)
  assert.equal(r.developers[0].lastAssessment!.outcome,'stay')
  assert.equal(r.developers[0].flowStreak!.duration,due)
})

test('proactive corrections do not trigger work decisions; repeated no-op reviews preserve targets and Flow',()=>{
  const s=fixture(),a=s.developers[0],t=s.tickets[0]
  a.productivity=0;a.estimateDiscovery!.productive=false;a.estimateReview!.dueTime={high:1,low:0}
  s.workLog=[{developerId:a.id,ticketId:t.id,effort:workAmount(10)}]
  t.completedWork=10
  const first=advanceSimulation(s,1,()=>.5),board=first.tickets[0].reportedEffortEstimate
  assert.ok(board!>20);assert.equal(first.tickets[0].lastEstimateEvaluation!.reason,'review')
  assert.equal(first.developers[0].lastAssessment,undefined)
  const history=structuredClone(first.tickets[0].estimateHistory),pending=structuredClone(first.developers[0].estimateDiscovery)
  const second=advanceSimulation(JSON.parse(JSON.stringify(first)),12,()=>.5)
  assert.deepEqual(second.tickets[0].estimateHistory,history)
  assert.deepEqual(second.developers[0].estimateDiscovery,pending)
  assert.equal(second.developers[0].flowStreak!.duration,13)
  assert.equal(second.tickets[0].completedWork,10)
  assert.deepEqual(second.workLog,s.workLog)
})

test('completion wins a coincident review/discovery and cancels its clock before next-work selection',()=>{
  const s=fixture(),a=s.developers[0],t=s.tickets[0]
  t.reportedEffortEstimate=100;t.initialEffortEstimate!.totalWork=100
  a.estimateDiscovery!.boardEstimate=100;a.estimateDiscovery!.baseline=100;a.estimateDiscovery!.target=workAmount(100)
  const due=projectWork(a,t,workAmount(100)).seconds!;a.estimateReview!.dueTime={high:due,low:0}
  const idle=sequence([0,.5]),r=advanceSimulation(s,due,idle.draw)
  assert.equal(idle.count(),2) // Completion status and idle deadline, no review/discovery draw.
  assert.equal(r.tickets[0].actualStatus,'done')
  assert.equal(r.developers[0].activeTicketID,undefined)
  assert.equal(r.developers[0].estimateReview,undefined)
  assert.equal(r.tickets[0].lastEstimateEvaluation!.reason,'completion')
  assert.equal(r.tickets[0].lastEstimateEvaluation!.published,false)
  assert.equal(r.developers[0].lastAssessment,undefined)
})

test('idle, merely assigned, stale and duplicate claimants never review another engineer work',()=>{
  const s=fixture(),a=s.developers[0],t=s.tickets[0]
  t.assignedDeveloperId='owner'
  s.developers.push({...a,id:'owner',activeTicketID:undefined}, {...a,id:'duplicate'}, {...a,id:'stale',activeTicketID:'missing'})
  const idle=sequence([.5,.5,.5]),r=advanceSimulation(s,1,idle.draw)
  assert.equal(idle.count(),3) // Independent idle-search schedules, never colleagues' report reviews.
  assert.ok(r.developers.slice(1).every(d=>d.estimateReview===undefined))
  assert.equal(r.tickets[0].lastEstimateEvaluation,undefined)
})

test('saved review deadlines and legacy default Discipline survive restoration without extra RNG',()=>{
  const s=fixture();delete s.developers[0].discipline
  const r=advanceSimulation(JSON.parse(JSON.stringify(s)),.3,noDraw)
  assert.deepEqual(r.developers[0].estimateReview,s.developers[0].estimateReview)
  assert.equal(getDiagnosticsView(r).developers[0].discipline,0)
  assert.deepEqual(advanceSimulation(s,0,noDraw),s)
  const paused={game:s,isPaused:true}
  assert.strictEqual(simulationReducer(paused,{type:'tick'}),paused)
})

test('seeded team event ordering, publications, claims and review clocks match fractional partitions and JSON',()=>{
  for(const seed of [1,42,63])for(const reverse of [false,true]) {
    const s=fixture(true);s.randomState=seed;delete s.developers[0].estimateReview
    s.tickets.push({...s.tickets[0],id:'other',rank:2})
    s.developers.push({...s.developers[0],id:'b',activeTicketID:'other',discipline:100})
    if(reverse)s.developers.reverse()
    const before=structuredClone(s),whole=advanceSimulation(s,30)
    let split=s
    for(let i=0;i<30;i++)for(const dt of [.3,.3,.4])split=JSON.parse(JSON.stringify(advanceSimulation(split,dt)))
    assert.equal(split.randomState,whole.randomState)
    assert.deepEqual(split.tickets.map(t=>[t.id,t.actualStatus,t.reportedEffortEstimate,t.estimateHistory]),whole.tickets.map(t=>[t.id,t.actualStatus,t.reportedEffortEstimate,t.estimateHistory]))
    assert.deepEqual(split.developers.map(d=>[d.id,d.activeTicketID,d.estimateReview,d.lastAssessment]),whole.developers.map(d=>[d.id,d.activeTicketID,d.estimateReview,d.lastAssessment]))
    split.tickets.forEach((t,i)=>close(t.completedWork,whole.tickets[i].completedWork))
    assert.deepEqual(advanceSimulation(JSON.parse(JSON.stringify(whole)),1),advanceSimulation(whole,1))
    assert.deepEqual(advanceSimulation(s,30),whole);assert.deepEqual(s,before)
    const claims=whole.developers.flatMap(d=>d.activeTicketID?[d.activeTicketID]:[])
    assert.equal(new Set(claims).size,claims.length)
  }
})

test('reporting consumes exactly the seeded draws, and failures after scheduling never mutate original state',()=>{
  const s=fixture(true);delete s.developers[0].estimateReview
  const expected=nextRandom(nextRandom(nextRandom(nextRandom(1).state).state).state).state
  const r=advanceSimulation(s,.001)
  assert.equal(r.randomState,expected) // assessment, successful reporting, review, discovery target
  const bad=fixture(true);delete bad.developers[0].estimateReview;bad.developers[0].discipline=-1
  const before=structuredClone(bad)
  assert.throws(()=>advanceSimulation(bad,1),RangeError);assert.deepEqual(bad,before)
})

test('reporting and review diagnostics never become normal player information',()=>{
  const s=fixture(),a=s.developers[0]
  s.workLog=[{developerId:a.id,ticketId:'ticket',effort:workAmount(10)}]
  evaluateEstimate(s,a,s.tickets[0],'discovery',()=>.9)
  const player=getPlayerView(s),dev=getDiagnosticsView(s)
  for(const key of ['discipline','estimateReview','lastEstimateEvaluation','lastAssessment'])assert.equal(key in player.developers[0],false)
  for(const key of ['initialEffortEstimate','lastEstimateEvaluation','workLog','learningBaseline'])assert.equal(key in player.tickets[0],false)
  assert.equal(dev.tickets[0].lastEstimateEvaluation!.published,false)
  assert.equal(dev.developers[0].discipline,0)
  assert.equal(dev.developers[0].nextReviewSeconds,1000)
})

test('legacy active known work schedules one first review without a pickup assessment or reporting roll',()=>{
  const s=fixture();delete s.developers[0].discipline;delete s.developers[0].estimateReview
  const random=sequence([.5]),first=advanceSimulation(s,1,random.draw)
  assert.equal(random.count(),1)
  assert.equal(first.tickets[0].lastEstimateEvaluation,undefined)
  assert.deepEqual(first.developers[0].estimateReview,{ticketId:'ticket',dueTime:{high:12,low:0}})
  const continued=advanceSimulation(JSON.parse(JSON.stringify(first)),1,noDraw)
  assert.deepEqual(continued.developers[0].estimateReview,first.developers[0].estimateReview)
})

test('zero-productivity active Unknown work can review and publish without a work-gating checkpoint',()=>{
  const s=fixture(true),a=s.developers[0]
  a.productivity=0;a.estimateReview!.dueTime={high:1,low:0}
  const random=sequence([.5,.5]),first=advanceSimulation(s,1,random.draw)
  assert.equal(random.count(),2) // fresh initial assessment + next review, no report roll or discovery
  assert.equal(first.tickets[0].reportedEffortEstimate,50)
  assert.equal(first.tickets[0].completedWork,0)
  assert.equal(first.workLog,undefined)
  assert.equal(firstPublishedEstimate(first.tickets[0]),50)
  const second=advanceSimulation(first,12,()=>.5)
  assert.equal(second.tickets[0].estimateHistory!.length,1)
  assert.equal(second.tickets[0].lastEstimateEvaluation!.published,false)
})

test('a fresh Rank departure has one reporting opportunity, with no work or time charged',()=>{
  const s=fixture(),a=s.developers[0],t=s.tickets[0]
  s.workLog=[{developerId:a.id,ticketId:t.id,effort:workAmount(10)}];t.completedWork=10
  s.tickets.push({...t,id:'alternative',rank:2,requiredWork:5,completedWork:0,reportedEffortEstimate:5,
    initialEffortEstimate:{developerId:'other-author',totalWork:5},actualStatus:'todo'})
  const before=structuredClone(s.workLog),random=sequence([.9,.9,.5])
  const transitions=workTransitions(s,{high:0,low:0},random.draw)
  transitions.restore(a);transitions.decide(a,'priority')
  assert.equal(random.count(),3) // independent departure effort/progress + new-ticket review
  assert.equal(a.activeTicketID,'alternative')
  assert.equal(t.lastEstimateEvaluation!.reason,'departure')
  assert.equal(t.lastEstimateEvaluation!.reportDraw,.9)
  assert.equal(t.reportedEffortEstimate,20)
  assert.equal(t.completedWork,10);assert.deepEqual(s.workLog,before);assert.equal(s.simulationTime,0)
})

test('Unknown pickup missed report can first publish on a genuine Rank departure, fixing E0 for later discovery',()=>{
  const s=fixture(true),a=s.developers[0]
  delete a.activeTicketID;delete a.estimateReview
  s.tickets[0].actualStatus='todo';s.tickets[0].reportedStatus='todo'
  const pickup=sequence([.5,.9,.5,0]),working=advanceSimulation(s,1,pickup.draw)
  assert.equal(pickup.count(),4) // Estimate/report/review, then independent start-status publication.
  const unknown=working.tickets[0],failedCandidate=unknown.lastEstimateEvaluation!.candidate
  assert.equal(failedCandidate,50)
  assert.equal(unknown.reportedEffortEstimate,undefined)
  assert.equal(unknown.initialEffortEstimate,undefined)
  assert.equal(unknown.estimateHistory,undefined)
  assert.equal(working.developers[0].estimateDiscovery,undefined)
  const historicalWork=structuredClone(personalEffort(working,working.developers[0],unknown))
  const base=fixture(true).tickets[0]
  working.tickets.push(
    {...base,id:'slow',rank:2,actualStatus:'todo',reportedStatus:'todo',reportedEffortEstimate:100,
      initialEffortEstimate:{developerId:'previous-author',totalWork:100}},
    {...base,id:'fast',rank:3,actualStatus:'todo',reportedStatus:'todo',requiredWork:5,reportedEffortEstimate:5,
      initialEffortEstimate:{developerId:'previous-author',totalWork:5}},
  )
  const before=structuredClone(working)
  const appraisalDraw=nextRandom(working.randomState),reportDraw=nextRandom(appraisalDraw.state),progressDraw=nextRandom(reportDraw.state),reviewDraw=nextRandom(progressDraw.state)
  assert.ok(reportDraw.value<.5) // exactly one successful Discipline-0 departure chance
  const e0=100*Math.exp(Math.log1p(-appraisalDraw.value))
  assert.notEqual(e0,failedCandidate)
  const reordered=simulationReducer({game:working,isPaused:false},{type:'reorderTodo',ticketId:'fast',targetId:'slow'}).game
  const t=reordered.tickets[0],d=reordered.developers[0],decision=d.lastAssessment!
  assert.deepEqual(reordered.tickets.map(ticket=>[ticket.id,ticket.rank]),[['ticket',1],['slow',3],['fast',2]])
  assert.equal(decision.trigger,'priority');assert.equal(decision.outcome,'switch');assert.equal(d.activeTicketID,'fast')
  assert.equal(decision.considered.find(option=>option.id==='ticket')!.estimateSource,'temporary')
  close(decision.considered.find(option=>option.id==='ticket')!.estimatedTotal,e0)
  assert.equal(reordered.randomState,nextRandom(reviewDraw.state).state) // appraisal, effort/progress, review, start status; no resampling
  assert.equal(t.lastEstimateEvaluation!.reason,'departure');assert.equal(t.lastEstimateEvaluation!.published,true)
  assert.equal(t.lastEstimateEvaluation!.reportDraw,reportDraw.value)
  close(t.reportedEffortEstimate!,e0);close(firstPublishedEstimate(t)!,e0)
  assert.deepEqual(t.initialEffortEstimate,{developerId:d.id,totalWork:e0})
  assert.deepEqual(t.estimateHistory,[{kind:'publication',developerId:d.id,totalWork:e0,reason:'initial',at:{high:1,low:0}}])
  assert.equal(reordered.simulationTime,1);assert.equal(t.completedWork,unknown.completedWork)
  assert.deepEqual(personalEffort(reordered,d,t),historicalWork)
  assert.deepEqual(working,before)

  // Completion naturally returns the engineer to the original ticket. A saved
  // board reference is reused: progress chance, new review and discovery target.
  const finishTime=projectWork(d,reordered.tickets[2],workAmount(5)).seconds!
  const returnDraws=sequence([0,.9,.5,.001])
  const returned=advanceSimulation(JSON.parse(JSON.stringify(reordered)),finishTime,returnDraws.draw)
  assert.equal(returnDraws.count(),4) // Completion status, then returning progress/review/discovery.
  const returning=returned.developers[0],original=returned.tickets[0],schedule=returning.estimateDiscovery!
  assert.equal(returning.activeTicketID,'ticket')
  assert.equal(schedule.baseline,e0);assert.equal(schedule.boardEstimate,e0)
  assert.deepEqual(original.estimateHistory,t.estimateHistory)
  assert.deepEqual(personalEffort(returned,returning,original),historicalWork)
  const w=effortNumber(historicalWork)!,r=(100-e0)/100,rate=.8*2*r/(r+.2)
  close(effortNumber(schedule.target!)!,w+(e0+w)*Math.expm1(-Math.log1p(-.001)/rate))

  // Reach that actual work threshold and publish a genuine upward revision.
  const exposure=subtractWorkAmounts(schedule.target!,historicalWork)
  const discoveryTime=projectWork(returning,original,exposure).seconds!,revisionDraws=sequence([0,.9,.999999])
  const revised=advanceSimulation(returned,discoveryTime,revisionDraws.draw),learned=revised.tickets[0]
  assert.equal(revisionDraws.count(),3) // effort/progress opportunities, renewed discovery target
  assert.equal(learned.lastEstimateEvaluation!.reason,'discovery');assert.equal(learned.lastEstimateEvaluation!.published,true)
  const cumulative=effortNumber(personalEffort(revised,revised.developers[0],learned))!
  close(learned.reportedEffortEstimate!,100-(100-e0)*(1+cumulative/e0)**-.3)
  assert.ok(learned.reportedEffortEstimate!>e0)
  assert.equal(firstPublishedEstimate(learned),e0)
  assert.equal(revised.developers[0].estimateDiscovery!.baseline,e0)
  assert.deepEqual(learned.initialEffortEstimate,t.initialEffortEstimate)
  assert.equal(learned.estimateHistory!.length,2)
  assert.deepEqual(learned.estimateHistory![0],t.estimateHistory![0])
  assert.ok(learned.estimateHistory!.every(event=>event.kind==='publication'&&event.totalWork!==failedCandidate))
  const restored=advanceSimulation(JSON.parse(JSON.stringify(revised)),.01,noDraw)
  assert.equal(firstPublishedEstimate(restored.tickets[0]),e0)
  assert.deepEqual(restored.tickets[0].estimateHistory,learned.estimateHistory)
})

test('a housekeeping publication with a better alternative available does not trigger reconsideration',()=>{
  const s=fixture(),a=s.developers[0],t=s.tickets[0]
  t.rank=2;t.completedWork=10;s.workLog=[{developerId:a.id,ticketId:t.id,effort:workAmount(10)}]
  s.tickets.push({...t,id:'alternative',rank:1,requiredWork:1,completedWork:0,reportedEffortEstimate:1,
    initialEffortEstimate:{developerId:'other-author',totalWork:1},actualStatus:'todo'})
  a.estimateReview!.dueTime={high:1,low:0}
  const random=sequence([.5,.999999]),r=advanceSimulation(s,1,random.draw)
  assert.equal(random.count(),2)
  assert.ok(r.tickets[0].reportedEffortEstimate!>20)
  assert.equal(r.tickets[0].lastEstimateEvaluation!.reason,'review')
  assert.equal(r.developers[0].lastAssessment,undefined)
  assert.equal(r.developers[0].activeTicketID,'ticket')
  assert.equal(r.developers[0].flowStreak!.duration,1)
  assert.equal(r.tickets[1].completedWork,0)
})

test('completion has one fresh departure-report opportunity instead of a coincident guaranteed review',()=>{
  for(const [reportDraw,published] of [[0,true],[.9,false]] as const) {
    const s=fixture(true),a=s.developers[0],t=s.tickets[0]
    t.requiredWork=1
    const due=projectWork(a,t,workAmount(1)).seconds!
    a.estimateReview!.dueTime={high:due,low:0}
    const random=sequence([.5,reportDraw,0,.5]),r=advanceSimulation(s,due,random.draw)
    assert.equal(random.count(),4) // Completion appraisal/report, independent status, then idle schedule.
    assert.equal(r.tickets[0].actualStatus,'done')
    assert.equal(r.tickets[0].lastEstimateEvaluation!.reason,'completion')
    assert.equal(r.tickets[0].lastEstimateEvaluation!.published,published)
    assert.equal(r.tickets[0].reportedEffortEstimate,published ? .5 : undefined)
    assert.equal(r.developers[0].estimateReview,undefined)
    assert.equal(r.developers[0].activeTicketID,undefined)
    if(published)assert.equal(firstPublishedEstimate(r.tickets[0]),.5)
    else assert.equal(r.tickets[0].initialEffortEstimate,undefined)
  }
})

test('mixed simultaneous completion and review/discovery share engineer order and remain partition-stable',()=>{
  for(const reverse of [false,true]) {
    const s=fixture(),base=s.developers[0],ongoing=s.tickets[0]
    ongoing.rank=2;base.estimateDiscovery!.target=workAmount(1)
    s.tickets.push({...ongoing,id:'finish',rank:3,requiredWork:1,reportedStatus:'done',reportedEffortEstimate:1,
      initialEffortEstimate:{developerId:'original',totalWork:1}},
      {...ongoing,id:'contested',rank:1,requiredWork:5,reportedEffortEstimate:5,
        initialEffortEstimate:{developerId:'original',totalWork:5},actualStatus:'todo'})
    const due=projectWork(base,ongoing,workAmount(1)).seconds!
    base.estimateReview!.dueTime={high:due,low:0}
    s.developers=[{...base,id:'finishing',activeTicketID:'finish',estimateDiscovery:undefined,
      estimateReview:{ticketId:'finish',dueTime:{high:due,low:0}}}, {...base,id:'learning'}]
    if(reverse)s.developers.reverse()
    const whole=advanceSimulation(s,due+.25)
    assert.equal(whole.developers[0].activeTicketID,'contested')
    assert.equal(whole.developers[1].activeTicketID,'ticket')
    assert.equal(whole.tickets[1].actualStatus,'done')
    assert.equal(whole.randomState,nextRandom(nextRandom(nextRandom(1).state).state).state)
    let split=s
    for(const dt of [.3,.3,.3])split=JSON.parse(JSON.stringify(advanceSimulation(split,dt)))
    split=advanceSimulation(split,due+.25-.9)
    assert.equal(split.randomState,whole.randomState)
    assert.deepEqual(split.developers.map(d=>[d.activeTicketID,d.lastAssessment,d.estimateReview]),whole.developers.map(d=>[d.activeTicketID,d.lastAssessment,d.estimateReview]))
    assert.deepEqual(split.tickets.map(t=>[t.actualStatus,t.estimateHistory,t.reportedEffortEstimate]),whole.tickets.map(t=>[t.actualStatus,t.estimateHistory,t.reportedEffortEstimate]))
  }
})

test('changing Discipline preserves an already sampled deadline and affects the next review only',()=>{
  const s=fixture(),a=s.developers[0]
  a.estimateReview!.dueTime={high:12,low:0};a.productivity=0;a.estimateDiscovery!.productive=false
  const first=advanceSimulation(s,1,noDraw)
  first.developers[0].discipline=100
  const unchanged=advanceSimulation(first,1,noDraw)
  assert.deepEqual(unchanged.developers[0].estimateReview,first.developers[0].estimateReview)
  const r=advanceSimulation(unchanged,10,()=>.5)
  close(r.developers[0].estimateReview!.dueTime.high,12+12/(1+Math.log1p(10)))
})

test('a due saved review runs once at the current timestamp, with positive subsequent deadlines',()=>{
  const s=fixture(),a=s.developers[0]
  a.estimateReview!.dueTime={high:0,low:0}
  const random=sequence([.5]),r=advanceSimulation(s,.001,random.draw)
  assert.equal(random.count(),1)
  assert.equal(r.tickets[0].lastEstimateEvaluation!.reason,'review')
  assert.deepEqual(r.developers[0].estimateReview!.dueTime,{high:12,low:0})
  assert.deepEqual(advanceSimulation(s,0,noDraw),s)
})

test('unsupported review-time precision and invalid reporting draws fail atomically',()=>{
  const s=fixture();delete s.developers[0].estimateReview
  s.simulationTime=1e308;s.simulationTimeRemainder=1e290
  const before=structuredClone(s)
  assert.throws(()=>advanceSimulation(s,1e292),/Review has no positive representable time interval/)
  assert.deepEqual(s,before)
  const unknown=fixture(true);delete unknown.developers[0].estimateReview
  const saved=structuredClone(unknown),random=sequence([.5,1])
  assert.throws(()=>advanceSimulation(unknown,1,random.draw),/Report RNG draw/)
  assert.deepEqual(unknown,saved)
})

test('Discipline never changes actual productivity, estimation quality, Focus or domain competency',()=>{
  const s=fixture(),reference=advanceSimulation(s,1,noDraw)
  for(const d of [0,10,100,Number.MAX_VALUE]) {
    const candidate=structuredClone(s);candidate.developers[0].discipline=d
    const r=advanceSimulation(candidate,1,noDraw)
    assert.equal(r.tickets[0].completedWork,reference.tickets[0].completedWork)
    assert.deepEqual(r.workLog,reference.workLog)
    assert.deepEqual(r.developers[0].flowStreak,reference.developers[0].flowStreak)
    assert.deepEqual(r.developers[0].competencies,reference.developers[0].competencies)
  }
})

test('work-session cache reprojection preserves the independent active review deadline',()=>{
  const s=fixture(),first=advanceSimulation(s,.3,noDraw),a=first.developers[0]
  const deadline=structuredClone(a.estimateReview)
  a.productivity=2;a.competencies.frontend=10;a.focus=100
  const changed=advanceSimulation(JSON.parse(JSON.stringify(first)),.3,noDraw)
  assert.deepEqual(changed.developers[0].estimateReview,deadline)
  assert.notDeepEqual(changed.developers[0].workSession,first.developers[0].workSession)
  close(changed.developers[0].flowStreak!.duration,.6)
})
