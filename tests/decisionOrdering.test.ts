import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { projectWork } from '../src/game/completionTime.ts'
import { workAmount, integratedWork } from '../src/game/work.ts'
import { nextRandom } from '../src/game/random.ts'
import { effortNumber } from '../src/game/workLog.ts'
import { decisionFixture, remember } from './helpers/decisionFixture.ts'
import { close } from './helpers/flowExpectation.ts'

function coincident(reverse=false,offset=0) {
 const s=decisionFixture(),base=s.developers[0],template=s.tickets[0]
 base.focus=0;base.competencies.frontend=5
 s.developers=[{...base,id:'finishing',activeTicketID:'finish'},{...base,id:'revising',activeTicketID:'ongoing'}]
 s.tickets=[
  {...template,id:'finish',rank:3,requiredWork:1,estimateHistory:[],initialEffortEstimate:undefined},
  {...template,id:'ongoing',rank:2,requiredWork:1000,estimateHistory:[],initialEffortEstimate:undefined,reportedEffortEstimate:600},
  {...template,id:'contested',rank:1,requiredWork:100,actualStatus:'todo',reportedStatus:'todo',estimateHistory:[],initialEffortEstimate:undefined},
 ]
 for(const t of s.tickets)for(const d of s.developers)remember(t,d.id,t.id==='ongoing'&&d.id==='revising'?600:t.requiredWork)
 for(const t of s.tickets)t.reportedEffortEstimate=t.id==='ongoing'?600:t.requiredWork
 const due=projectWork(s.developers[0],s.tickets[0],workAmount(1)).seconds!
 const quantity=offset===0?workAmount(1):integratedWork(s.developers[1],s.tickets[1],due+offset,0)
 s.developers[1].estimateDiscovery={ticketId:'ongoing',boardEstimate:600,requiredWork:1000,judgement:0,productive:true,baseline:600,target:quantity}
 s.tickets[1].overrunEvaluationConsumed=true
 if(reverse)s.developers.reverse()
 return {s,due}
}
function equivalent(actual:ReturnType<typeof decisionFixture>,expected:ReturnType<typeof decisionFixture>) {
 assert.equal(actual.randomState,expected.randomState)
 assert.deepEqual(actual.tickets.map(t=>[t.id,t.assignedDeveloperId,t.actualStatus,t.estimateHistory]),expected.tickets.map(t=>[t.id,t.assignedDeveloperId,t.actualStatus,t.estimateHistory]))
 assert.deepEqual(actual.developers.map(d=>[d.id,d.activeTicketID,d.lastAssessment]),expected.developers.map(d=>[d.id,d.activeTicketID,d.lastAssessment]))
 assert.deepEqual(actual.workLog?.map(e=>[e.developerId,e.ticketId]),expected.workLog?.map(e=>[e.developerId,e.ticketId]))
 actual.workLog?.forEach((e,i)=>close(effortNumber(e.effort)!,effortNumber(expected.workLog![i].effort)!))
}

test('positive-time completion and genuine estimate revision resolve claims in engineer order, not event-type order',()=>{
 for(const reverse of [false,true]) {
  const {s,due}=coincident(reverse),original=structuredClone(s),r=advanceSimulation(s,due+.25,()=>.999999)
  assert.equal(r.developers[0].activeTicketID,'contested')
  assert.equal(r.developers[1].activeTicketID,'ongoing')
  assert.equal(r.tickets[0].actualStatus,'done')
  assert.equal(r.developers.find(d=>d.id==='revising')!.lastAssessment!.trigger,'estimate_revision')
  assert.equal(r.randomState,s.randomState) // supplied RNG does not mutate the seed
  assert.equal(new Set(r.developers.map(d=>d.activeTicketID)).size,2)
  assert.deepEqual(s,original)
 }
})

test('nonbinary partitions and JSON preserve mixed-event coincidence, histories, claims and exact RNG',()=>{
 for(const reverse of [false,true])for(const parts of [[.3,.3,.3],[.1,.2,.3],[.13,.17,.19,.23]]) {
  const {s,due}=coincident(reverse),whole=advanceSimulation(s,due+.25)
  let split=s
  for(const dt of parts)split=JSON.parse(JSON.stringify(advanceSimulation(split,dt)))
  split=advanceSimulation(split,due+.25-parts.reduce((a,b)=>a+b,0))
  equivalent(split,whole)
  assert.equal(whole.randomState,reverse?s.randomState:nextRandom(s.randomState).state)
 }
})

test('nearby distinct completion and discovery instants are not merged by an epsilon window',()=>{
 for(const offset of [-1e-12,1e-12]) {
  const {s,due}=coincident(false,offset),r=advanceSimulation(s,due+.25,()=>.999999)
  assert.equal(r.developers[offset<0?1:0].activeTicketID,'contested')
 }
})

test('a revision at the exact call boundary runs once; zero-time and subsequent tiny work never repeat it',()=>{
 const {s,due}=coincident(true)
 const first=advanceSimulation(s,due,()=>.999999)
 const history=structuredClone(first.tickets[1].estimateHistory)
 assert.equal(first.developers[0].lastAssessment!.trigger,'estimate_revision')
 assert.deepEqual(advanceSimulation(first,0,()=>{throw Error('Zero time')}),first)
 const next=advanceSimulation(JSON.parse(JSON.stringify(first)),.01,()=>{throw Error('No repeated decision')})
 assert.deepEqual(next.tickets[1].estimateHistory,history)
})

test('a one-ULP earlier discovery retains chronological priority over engineer order',()=>{
 const {s,due}=coincident()
 const bits=new DataView(new ArrayBuffer(8))
 bits.setFloat64(0,due);bits.setBigUint64(0,bits.getBigUint64(0)-1n)
 const earlier=bits.getFloat64(0),d=s.developers[1],ticket=s.tickets[1]
 const target=integratedWork(d,ticket,earlier,0)
 assert.equal(projectWork(d,ticket,target).seconds,earlier)
 d.estimateDiscovery!.target=target
 const result=advanceSimulation(s,due+.25,()=>.999999)
 assert.equal(result.developers[1].activeTicketID,'contested')
 assert.equal(result.developers[0].activeTicketID,'ongoing')
})

test('completion wins a discovery tie on the same ticket and releases every claim before pickups',()=>{
 const s=decisionFixture(),d=s.developers[0],t=s.tickets[0]
 d.estimateDiscovery={ticketId:t.id,requiredWork:100,boardEstimate:100,judgement:0,productive:true,target:workAmount(100)}
 t.overrunEvaluationConsumed=true
 const due=projectWork(d,t,workAmount(100)).seconds!
 const r=advanceSimulation(s,due,()=>{throw Error('Completion cannot trigger reconsideration')})
 assert.equal(r.tickets[0].actualStatus,'done')
 assert.equal(r.tickets[0].lastEstimateEvaluation,undefined)
 assert.equal(r.developers[0].lastAssessment,undefined)
 assert.equal(r.developers[0].activeTicketID,undefined)
})

test('simultaneous ending work is logged before new claims, without progressing two tickets at the boundary',()=>{
 for(const reverse of [false,true]) {
  const {s,due}=coincident(reverse),r=advanceSimulation(s,due,()=>.999999)
  assert.equal(r.developers[0].activeTicketID,'contested')
  assert.equal(r.workLog!.some(e=>e.ticketId==='contested'),false)
  assert.equal(effortNumber(r.workLog!.find(e=>e.ticketId==='finish')!.effort),1)
  const after=advanceSimulation(r,.25,()=>.999999)
  assert.equal(after.workLog!.find(e=>e.ticketId==='contested')!.developerId,s.developers[0].id)
  equivalent(after,advanceSimulation(s,due+.25,()=>.999999))
 }
})
