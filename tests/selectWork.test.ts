import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scoreCandidates, nominateCandidate, assessWork, selectWork } from '../src/game/selectWork.ts'
import { projectCompletion } from '../src/game/completionTime.ts'
import { getAverageFlowMultiplier } from '../src/game/flow.ts'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { getDiagnosticsView } from '../src/store/diagnosticsView.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { close } from './helpers/flowExpectation.ts'

function scenario(currentWork=100,alternativeWork=50) {
 const state=structuredClone(exampleGameState)
 state.developers=[{...state.developers[0],focus:5,judgement:0,productivity:1,competencies:{frontend:5,backend:5},assessmentClock:{elapsed:0,remaining:1000}}]
 state.tickets=[{...state.tickets[0],rank:1,requiredWork:currentWork,completedWork:0,reportedProgress:0},
 {...state.tickets[0],id:'alternative',rank:2,actualStatus:'todo',reportedStatus:'todo',requiredWork:alternativeWork,completedWork:0,reportedProgress:100}]
 return state
}
function compare(state:ReturnType<typeof scenario>,draw=0.5){return assessWork(state.tickets[0],state.tickets[1],state.tickets,state.developers[0],'reconsideration',()=>draw)}

test('candidate nomination uses half inverse eligible ordinal and half normalized public progress',()=>{
 const state=scenario();state.tickets[0].rank=2;state.tickets[0].reportedProgress=20;state.tickets[1].rank=7;state.tickets[1].reportedProgress=90
 const scores=scoreCandidates([...state.tickets].reverse())
 close(scores[0].score,0.6);close(scores[1].score,0.7)
 assert.equal(nominateCandidate(state.tickets)?.id,'alternative')
 state.tickets[0].reportedProgress=0;state.tickets[1].reportedProgress=50
 assert.equal(nominateCandidate([...state.tickets].reverse())?.id,'ticket-1')
 state.tickets[1].completedWork=49
 assert.deepEqual(scoreCandidates(state.tickets),scoreCandidates(state.tickets.map(t=>({...t,completedWork:0}))))
 state.tickets[1].reportedProgress=Infinity;assert.equal(scoreCandidates(state.tickets)[1].opportunityScore,1)
 state.tickets[1].reportedProgress=NaN;assert.equal(scoreCandidates(state.tickets)[1].opportunityScore,0)
})

test('completion projection inverts integrated Flow and retains current versus fresh alternative Flow',()=>{
 const state=scenario(), developer=state.developers[0], ticket=state.tickets[0]
 for(const duration of [0,10,100]) {
  developer.flowStreak={ticketId:ticket.id,duration}
  const p=projectCompletion(developer,ticket,true)
  close(p.seconds!*getAverageFlowMultiplier(duration,p.seconds!,developer.focus),100)
 }
 assert.ok(projectCompletion(developer,ticket,true).seconds!<projectCompletion(developer,ticket).seconds!)
 ticket.workDomain='backend';developer.competencies.backend=10
 assert.ok(projectCompletion(developer,ticket).seconds!<projectCompletion(developer,{...ticket,workDomain:'frontend'}).seconds!)
})

test('independent logarithmic efficiency, soft Rank preference and logistic error determine outcome',()=>{
 const state=scenario(),decision=compare(state,0.75)
 const stay=projectCompletion(state.developers[0],state.tickets[0],true).seconds!
 const change=projectCompletion(state.developers[0],state.tickets[1]).seconds!
 close(decision.efficiencyAdvantage!,Math.log(stay)-Math.log(change))
 close(decision.rankPreference,-0.125)
 close(decision.complexity,2)
 close(decision.noiseScale,2)
 close(decision.error,2*Math.log(3))
 close(decision.perceivedAdvantage!,Math.log(stay)-Math.log(change)-0.125+2*Math.log(3))
 assert.equal(decision.outcome,'switch')
 assert.equal(decision.selectedId,'alternative')
})

test('soft priority favours higher-ranked slightly slower work but cannot overrule substantial inefficiency',()=>{
 const state=scenario(100,101);state.tickets[0].rank=2;state.tickets[1].rank=1
 const slight=compare(state)
 assert.ok(slight.efficiencyAdvantage!<0);assert.equal(slight.outcome,'switch')
 state.tickets[1].requiredWork=10000
 assert.equal(compare(state).outcome,'stay')
 const fast=scenario(10000,1)
 assert.equal(compare(fast).outcome,'switch')
})

test('both incorrect stays and switches are possible; high Judgement improves accuracy in either direction',()=>{
 for(const [current,other] of [[100,50],[50,100]]) {
  const state=scenario(current,other)
  const target=compare(state).outcome
  assert.equal(compare(state,target==='switch'?0.001:0.999).outcome,target==='switch'?'stay':'switch')
  const counts=[]
  for(const judgement of [0,10,100,10000]) {
   state.developers[0].judgement=judgement
   let correct=0
   for(let i=0;i<500;i++)if(compare(state,(i+0.5)/500).outcome===target)correct++
   counts.push(correct)
  }
  assert.ok(counts.every((count,i)=>i===0||count>=counts[i-1]))
  assert.ok(counts[3]>counts[0]);assert.equal(counts[3],500)
 }
})

test('Focus only affects actual Flow trajectories, never uncertainty or the rank preference',()=>{
 const state=scenario()
 const low=compare(state,0.75)
 state.developers[0].focus=1000
 const high=compare(state,0.75)
 assert.equal(high.noiseScale,low.noiseScale);assert.equal(high.error,low.error)
 assert.equal(high.rankPreference,low.rankPreference)
 state.developers[0].flowStreak={ticketId:'ticket-1',duration:1e5}
 assert.ok(compare(state).efficiencyAdvantage!<high.efficiencyAdvantage!)
})

test('high Judgement correctness targets the management-weighted outcome, including a slower priority choice',()=>{
 const state=scenario(100,101);state.tickets[0].rank=2;state.tickets[1].rank=1
 assert.ok(compare(state).efficiencyAdvantage!<0)
 assert.ok(compare(state).perceivedAdvantage!>0)
 assert.equal(compare(state,0.01).outcome,'stay')
 state.developers[0].judgement=100000
 assert.equal(compare(state,0.01).outcome,'switch')
})

test('nomination snapshot is distinct from the final Rank-prior ordinal pool including current work',()=>{
 const state=scenario()
 const decision=compare(state)
 assert.equal(decision.nomination?.id,'alternative')
 assert.equal(decision.nomination?.rankScore,1)
 assert.equal(decision.alternative?.rankScore,0.5)
})

test('ties stay at neutral error; impossible work, RNG endpoints and huge finite attributes are explicit',()=>{
 const state=scenario(100,100)
 // Equal times still have the explicit ordinal Rank preference; no noise at u=0.5.
 assert.equal(compare(state).error,0)
 assert.equal(compare(state).outcome,'stay')
 for(const u of [0,1])assert.ok(Number.isFinite(compare(state,u).error))
 state.developers[0].judgement=Number.MAX_VALUE;state.developers[0].focus=Number.MAX_VALUE
 assert.ok(Number.isFinite(compare(state).noiseScale))
 state.developers[0].productivity=0
 const impossible=compare(state)
 assert.equal(impossible.efficiencyAdvantage,0);assert.equal(impossible.staySeconds,null)
 assert.equal(impossible.switchSeconds,null)
 for(const value of [-1,NaN,Infinity]) {
  state.developers[0].judgement=value;assert.throws(()=>compare(state),RangeError)
 }
})

test('idle pickup compares reported-score nominee with fastest fresh-Flow alternative using one draw',()=>{
 const state=scenario(1000,1);state.tickets[1].reportedProgress=0
 let calls=0
 const decision=selectWork(state.tickets,state.developers[0],()=>{calls++;return 0.5})!
 assert.equal(calls,1);assert.equal(decision.current.id,'ticket-1')
 assert.equal(decision.selectedId,'alternative');assert.equal(decision.kind,'pickup')
 assert.equal(selectWork([state.tickets[0]],state.developers[0],()=>{throw Error('Unnecessary draw')})!.draw,null)
 const bestNominee=scenario(1,1000);bestNominee.tickets[1].reportedProgress=0
 assert.equal(selectWork(bestNominee.tickets,bestNominee.developers[0],()=>0.999)!.selectedId,'alternative')
})

test('log projections remain comparable across incremental scales without overflowing time ratios',()=>{
 for(const scale of [1e-200,1,1e200]) {
  const state=scenario(100*scale,50*scale);state.developers[0].productivity=scale
  close(compare(state).efficiencyAdvantage!,compare(scenario()).efficiencyAdvantage!)
 }
 const state=scenario(100,50);state.developers[0].productivity=1e308;state.developers[0].competencies.frontend=100
 const p=projectCompletion(state.developers[0],state.tickets[0])
 assert.ok(Number.isFinite(p.logSeconds));assert.ok(p.seconds!>0)
 state.tickets[0].requiredWork=Number.MAX_VALUE;state.developers[0].productivity=Number.MIN_VALUE
 assert.equal(projectCompletion(state.developers[0],state.tickets[0]).seconds,null)
 assert.ok(Number.isFinite(projectCompletion(state.developers[0],state.tickets[0]).logSeconds))
})

test('diagnostics retain actual decisions read-only and player selectors omit all assessment/Flow data',()=>{
 const state=scenario();state.developers[0].assessmentClock.remaining=0
 const result=advanceSimulation(state,0.1,()=>0.5)
 const before=structuredClone(result)
 const diagnostic=getDiagnosticsView(result).developers[0]
 assert.deepEqual(diagnostic.lastAssessment,result.developers[0].lastAssessment)
 assert.deepEqual(result,before)
 assert.deepEqual(Object.keys(getPlayerView(result).developers[0]).sort(),['id','name','productivity'])
})
