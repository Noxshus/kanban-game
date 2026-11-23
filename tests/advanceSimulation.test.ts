import { decideNow, setPublishedEstimate } from './helpers/decisionFixture.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { close, expectedWork } from './helpers/flowExpectation.ts'

function state() {
 const value=structuredClone(exampleGameState)
 value.developers=[{...value.developers[0],productivity:2,focus:5,competencies:{frontend:5,backend:5},assessmentClock:{elapsed:0,remaining:1000}}]
 value.tickets=[{...value.tickets[0],actualStatus:'in_progress',completedWork:1,requiredWork:10}]
 return value
}

test('time and integrated domain/Flow work advance immutably, including fractional time',()=>{
 const input=state(), before=structuredClone(input)
 const result=advanceSimulation(input,1.5)
 close(result.tickets[0].completedWork,1+expectedWork(2,1.5))
 assert.equal(result.simulationTime,1.5)
 assert.equal(result.developers[0].flowStreak?.duration,1.5)
 assert.deepEqual(input,before)
 assert.deepEqual(result,advanceSimulation(input,1.5))
})

test('completion caps work, releases the claim and preserves ownership',()=>{
 const input=state()
 const done=advanceSimulation(input,100)
 assert.equal(done.tickets[0].completedWork,10)
 assert.equal(done.tickets[0].actualStatus,'done')
 assert.equal(done.tickets[0].reportedStatus,'done')
 assert.equal(done.tickets[0].reportedProgress,100)
 assert.equal(done.tickets[0].assignedDeveloperId,'developer-1')
 assert.equal(done.developers[0].activeTicketID,undefined)
 assert.equal(done.developers[0].flowStreak,undefined)
 assert.equal(done.developers[0].assessmentClock,undefined)
 assert.deepEqual(advanceSimulation(done,10).tickets,done.tickets)
})

test('completion within an interval naturally selects subsequent work using remaining time',()=>{
 const input=state()
 input.tickets.push({...input.tickets[0],id:'next',rank:2,actualStatus:'todo',completedWork:0,requiredWork:100})
 input.tickets[0].completedWork=9.9
 const result=advanceSimulation(input,1,()=>0.5)
 assert.equal(result.tickets[0].actualStatus,'done')
 assert.equal(result.developers[0].activeTicketID,'next')
 assert.ok(result.tickets[1].completedWork>0)
 assert.ok(result.developers[0].flowStreak!.duration<1)
})

test('actual eligibility reserves claims and ignores stale Backlog/completed/duplicate active references',()=>{
 const input=state()
 input.tickets.push({...input.tickets[0],id:'backlog',rank:2,actualStatus:'backlog',reportedStatus:'todo'})
 input.developers.push({...input.developers[0],id:'duplicate'}, {...input.developers[0],id:'stale',activeTicketID:'backlog'})
 const result=advanceSimulation(input,1,()=>0.5)
 close(result.tickets[0].completedWork,1+expectedWork(2,1))
 assert.equal(result.developers[1].activeTicketID,undefined)
 assert.equal(result.developers[2].activeTicketID,undefined)
 assert.deepEqual(result.tickets[1],input.tickets[1])
})

test('idle or missing active references select eligible work, without leaking hidden reported truth',()=>{
 for(const activeTicketID of [undefined,'missing']) {
  const input=state();input.developers[0].activeTicketID=activeTicketID
  input.tickets[0].reportedStatus='backlog'
  const result=advanceSimulation(input,1,()=>0.5)
  assert.equal(result.developers[0].activeTicketID,'ticket-1')
  assert.equal(result.tickets[0].reportedStatus,'in_progress')
  assert.equal(result.tickets[0].reportedProgress,40) // The independent progress roll at .5 fails; work no longer truth-syncs.
 }
})

test('completed/zero-size committed work reports done; zero-size Backlog remains untouched',()=>{
 const input=state();input.tickets[0].requiredWork=0;input.tickets[0].completedWork=0
 input.tickets.push({...input.tickets[0],id:'backlog',rank:2,actualStatus:'backlog',reportedStatus:'backlog'})
 const result=advanceSimulation(input,1)
 assert.equal(result.tickets[0].reportedProgress,100)
 assert.equal(result.tickets[0].actualStatus,'done')
 assert.deepEqual(result.tickets[1],input.tickets[1])
})

test('zero time changes no state or RNG; invalid time fails without mutation',()=>{
 const input=state(), before=structuredClone(input)
 assert.deepEqual(advanceSimulation(input,0,()=>{throw Error('Unexpected RNG')}),input)
 for(const seconds of [-1,NaN,Infinity,-Infinity]) assert.throws(()=>advanceSimulation(input,seconds),RangeError)
 assert.deepEqual(input,before)
})

test('reported percentages are bounded while uncommitted Backlog remains untouched',()=>{
 for(const [value,expected] of [[-10,0],[150,100],[NaN,0],[Infinity,100],[-Infinity,0]]) {
  const input=state();input.developers=[];input.tickets[0].reportedProgress=value
  assert.equal(advanceSimulation(input,1).tickets[0].reportedProgress,expected)
 }
})

test('an idle engineer before an existing worker cannot steal an active claim',()=>{
 const input=state()
 input.tickets.push({...input.tickets[0],id:'available',rank:2,actualStatus:'todo',completedWork:0})
 input.developers.unshift({...input.developers[0],id:'idle',activeTicketID:undefined})
 const result=advanceSimulation(input,1,()=>0.5)
 assert.equal(result.developers[0].activeTicketID,'available')
 assert.equal(result.developers[1].activeTicketID,'ticket-1')
 assert.equal(result.tickets[0].assignedDeveloperId,'developer-1')
 assert.equal(result.tickets[1].assignedDeveloperId,'idle')
})

test('ownership does not reserve work and may differ from an existing active claim',()=>{
 const input=state()
 input.developers.push({...input.developers[0],id:'idle',activeTicketID:undefined})
 input.tickets[0].assignedDeveloperId='idle'
 input.tickets.push({...input.tickets[0],id:'available',rank:2,actualStatus:'todo',completedWork:0,assignedDeveloperId:'developer-1'})
 const result=advanceSimulation(input,0.5,()=>0.5)
 assert.equal(result.developers[0].activeTicketID,'ticket-1')
 assert.equal(result.developers[1].activeTicketID,'available')
 assert.equal(result.tickets[0].assignedDeveloperId,'developer-1')
 assert.equal(result.tickets[1].assignedDeveloperId,'idle')
})

test('misleading reported columns cannot make Backlog/Done eligible or hide actually eligible work',()=>{
 const input=state();input.developers[0].activeTicketID=undefined
 input.tickets=[
  {...input.tickets[0],id:'backlog',rank:1,actualStatus:'backlog',reportedStatus:'todo'},
  {...input.tickets[0],id:'done',rank:2,actualStatus:'done',reportedStatus:'todo',completedWork:10},
  {...input.tickets[0],id:'eligible',rank:3,actualStatus:'todo',reportedStatus:'done'},
 ]
 const before=structuredClone(input.tickets[0])
 const result=advanceSimulation(input,0.5,()=>0.5)
 assert.equal(result.developers[0].activeTicketID,'eligible')
 assert.deepEqual(result.tickets[0],before)
 assert.equal(result.tickets[1].completedWork,10)
})

test('actual accumulated Flow can change an event decision from switch to stay',()=>{
 for(const duration of [0,1000]) {
  const input=state()
  input.developers[0].productivity=1
  input.developers[0].flowStreak={ticketId:'ticket-1',duration}
  input.developers[0].assessmentClock={elapsed:10,remaining:0}
  input.tickets[0]={...input.tickets[0],rank:2,requiredWork:100,completedWork:0}
  input.tickets.push({...input.tickets[0],id:'alternative',rank:1,requiredWork:101,actualStatus:'todo'})
  for (const t of input.tickets) setPublishedEstimate(t,input.developers[0].id)
  const result=advanceSimulation(decideNow(input),0.1,()=>0.5)
  assert.equal(result.developers[0].lastAssessment?.outcome,duration===0?'switch':'stay')
  assert.equal(result.developers[0].activeTicketID,duration===0?'alternative':'ticket-1')
  close(result.developers[0].flowStreak!.duration,duration+0.1)
 }
})

test('high Focus with substantial retained Flow still permits a clearly worthwhile switch',()=>{
 const input=state()
 input.developers[0].focus=1e6
 input.developers[0].flowStreak={ticketId:'ticket-1',duration:1e5}
 input.developers[0].assessmentClock={elapsed:10,remaining:0}
 input.tickets[0].requiredWork=10000;input.tickets[0].completedWork=0
 input.tickets.push({...input.tickets[0],id:'quick',rank:2,requiredWork:1,actualStatus:'todo'})
 for (const t of input.tickets) setPublishedEstimate(t,input.developers[0].id)
 const result=advanceSimulation(decideNow(input),0.01,()=>0.5)
 assert.equal(result.developers[0].lastAssessment?.outcome,'switch')
 assert.equal(result.developers[0].activeTicketID,'quick')
 assert.equal(result.developers[0].lastAssessment!.trigger,'priority')
 close(result.developers[0].flowStreak!.duration,0.01)
})

test('empty queues schedule idle retries, and completed active references cannot accumulate work',()=>{
 const input=state();input.tickets[0].actualStatus='done';input.tickets[0].completedWork=10
 let idleDraws=0
 const draw=()=>{idleDraws++;return .5}
 const result=advanceSimulation(input,2,draw)
 assert.equal(idleDraws,1)
 assert.equal(result.developers[0].idleWorkCheck!.high,12)
 assert.equal(result.developers[0].activeTicketID,undefined)
 assert.equal(result.tickets[0].completedWork,10)
 assert.deepEqual(advanceSimulation(result,1,()=>{throw Error('Not due yet')}).developers,result.developers)
 input.tickets=[]
 assert.equal(advanceSimulation(input,2,draw).simulationTime,2)
 assert.equal(idleDraws,2)
})
