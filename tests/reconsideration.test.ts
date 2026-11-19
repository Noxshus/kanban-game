import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { simulationReducer } from '../src/store/simulationControls.ts'
import { decisionFixture, setPublishedEstimate } from './helpers/decisionFixture.ts'
import { projectWork } from '../src/game/completionTime.ts'
import { workAmount } from '../src/game/work.ts'
import { nextRandom } from '../src/game/random.ts'
import { getDiagnosticsView } from '../src/store/diagnosticsView.ts'
import { getPlayerView } from '../src/store/playerView.ts'
const noDraw=()=>{throw Error('No event should consume RNG')}
const reorder=(game:ReturnType<typeof decisionFixture>,a:string,b:string,after=false,isPaused=false)=>
  simulationReducer({game,isPaused},{type:'reorderTodo',ticketId:a,targetId:b,after}).game

test('time and newly available work never reconsider active work; legacy clocks are safely discarded',()=>{
 const s=decisionFixture(),d=s.developers[0]
 d.assessmentClock={elapsed:NaN,remaining:0}
 d.lastAssessment=JSON.parse('{"kind":"reconsideration","draw":0.5,"error":0,"selectedId":"current"}')
 assert.equal(getDiagnosticsView(s).developers[0].lastAssessment,null)
 const first=advanceSimulation(s,10,noDraw)
 assert.equal(first.developers[0].lastAssessment,undefined)
 assert.equal(first.developers[0].assessmentClock,undefined)
 first.tickets.push({...decisionFixture().tickets[0],id:'new',rank:2,requiredWork:.01,actualStatus:'todo',estimateHistory:undefined,initialEffortEstimate:undefined,reportedEffortEstimate:undefined})
 const next=advanceSimulation(first,10,noDraw)
 assert.equal(next.developers[0].activeTicketID,'current')
 assert.equal(next.developers[0].lastAssessment,undefined)
 assert.equal(next.tickets[1].estimateHistory,undefined)
 assert.deepEqual(advanceSimulation(s,0,noDraw),s)
})

function revisionFixture(alternativeSize=1) {
 const s=decisionFixture(),d=s.developers[0],t=s.tickets[0]
 t.estimateHistory=[];setPublishedEstimate(t,d.id,80)
 t.initialEffortEstimate={developerId:d.id,totalWork:80};t.reportedEffortEstimate=80
 t.overrunEvaluationConsumed=true
 d.estimateDiscovery={ticketId:t.id,boardEstimate:80,requiredWork:100,judgement:0,productive:true,baseline:80,target:workAmount(1)}
 const alt={...decisionFixture().tickets[0],id:'other',rank:2,requiredWork:alternativeSize,actualStatus:'todo' as const,estimateHistory:[]}
 setPublishedEstimate(alt,d.id);alt.reportedEffortEstimate=alternativeSize
 s.tickets.push(alt)
 return s
}

test('genuine #58 revision immediately chooses across all alternatives before another interval of work',()=>{
 const s=revisionFixture(),due=projectWork(s.developers[0],s.tickets[0],workAmount(1)).seconds!
 const r=advanceSimulation(s,due,noDraw)
 assert.equal(r.tickets[0].lastEstimateEvaluation!.published,true)
 assert.equal(r.developers[0].lastAssessment!.trigger,'estimate_revision')
 assert.deepEqual(r.developers[0].lastAssessment!.considered.map(t=>t.id),['current','other'])
 assert.equal(r.developers[0].activeTicketID,'other')
 assert.equal(r.developers[0].flowStreak!.duration,0)
 assert.equal(r.tickets[1].completedWork,0)
 assert.ok(!r.workLog!.some(e=>e.ticketId==='other'))
 const assessment=r.tickets[0].estimateHistory!.at(-1)!
 assert.equal(assessment.kind,'publication')
 assert.deepEqual(assessment.at,r.developers[0].lastAssessment!.at)
})

test('a revision may rationally stay and preserve Flow; no-op evaluations never trigger a decision',()=>{
 const stay=revisionFixture(200),due=projectWork(stay.developers[0],stay.tickets[0],workAmount(1)).seconds!
 const result=advanceSimulation(stay,due,()=>.999999)
 assert.equal(result.developers[0].lastAssessment!.outcome,'stay')
 assert.equal(result.developers[0].flowStreak!.duration,due)
 const noop=revisionFixture()
 // Another publication already exceeds the candidate; E0 remains 80.
 noop.tickets[0].estimateHistory!.push({kind:'publication',developerId:'b',totalWork:100,reason:'revision',at:{high:0,low:0}})
 noop.tickets[0].reportedEffortEstimate=100
 noop.developers[0].estimateDiscovery!.boardEstimate=100
 const count=noop.tickets[0].estimateHistory!.length
 const r=advanceSimulation(noop,due,noDraw)
 assert.equal(r.tickets[0].lastEstimateEvaluation!.published,false)
 assert.equal(r.developers[0].lastAssessment,undefined)
 assert.equal(r.tickets[0].estimateHistory!.length,count)
 assert.equal(r.developers[0].activeTicketID,'current')
})

function priorities(unfamiliar=false) {
 const s=decisionFixture()
 s.tickets[0].reportedProgress=99
 for(const [id,rank]of [['left',2],['right',3],['unaffected',4]] as const) {
  const t={...decisionFixture().tickets[0],id,rank,actualStatus:'todo' as const,reportedStatus:'todo' as const,reportedProgress:0,estimateHistory:undefined,initialEffortEstimate:undefined,reportedEffortEstimate:undefined}
  if(!unfamiliar) setPublishedEstimate(t,'a')
  s.tickets.push(t)
 }
 return s
}

test('priority actions assess only affected alternatives with full-context ordinals, without advancing time/work',()=>{
 for(const isPaused of [true,false]) {
  const s=priorities(),original=structuredClone(s)
  let session=simulationReducer({game:s,isPaused},{type:'reorderTodo',ticketId:'right',targetId:'left'})
  if(isPaused) {
   assert.equal(session.game.developers[0].lastAssessment,undefined)
   session=simulationReducer(session,{type:'togglePause'})
  }
  const r=session.game,a=r.developers[0]
  assert.equal(a.lastAssessment!.trigger,'priority')
  assert.equal(a.lastAssessment!.outcome,'stay')
  assert.deepEqual(a.lastAssessment!.considered.map(t=>[t.id,t.rankScore]),[['current',1],['right',.5],['left',1/3]])
  assert.equal(r.simulationTime,s.simulationTime)
  assert.equal(r.randomState,s.randomState)
  assert.equal(r.workLog,undefined)
  assert.deepEqual(r.tickets.map(t=>t.completedWork),s.tickets.map(t=>t.completedWork))
  assert.deepEqual(s,original)
 }
})

test('irrelevant and no-op changes never assess, sample previews or initialise private beliefs',()=>{
 const s=priorities(true)
 assert.strictEqual(reorder(s,'left','right'),s)
 assert.strictEqual(reorder(s,'missing','left'),s)
 s.tickets[1].actualStatus='backlog';s.tickets[2].actualStatus='done'
 const r=reorder(s,'right','left')
 assert.equal(r.randomState,s.randomState)
 assert.strictEqual(r.developers,s.developers)
 assert.equal(r.developers[0].lastAssessment,undefined)
 assert.deepEqual(r.tickets.map(t=>t.estimateHistory),s.tickets.map(t=>t.estimateHistory))
})

test('repeated genuine reversals get fresh transient appraisals without cooldown or permanent preview beliefs',()=>{
 let s=priorities(true)
 // Stay is overwhelmingly preferable; unchosen candidate appraisal draws remain fallible.
 let expected=s.randomState
 for(let i=0;i<6;i++) {
  const before=s
  s=reorder(s,i%2?'left':'right',i%2?'right':'left')
  expected=nextRandom(nextRandom(expected).state).state
  assert.equal(s.randomState,expected)
  assert.notStrictEqual(s.developers[0].lastAssessment,before.developers[0].lastAssessment)
  assert.equal(s.developers[0].activeTicketID,'current')
  assert.ok(s.tickets.slice(1).every(t=>t.estimateHistory===undefined))
 }
})

test('a priority winner promotes its exact temporary appraisal once at the current time without advancing work',()=>{
 const s=priorities(true)
 s.tickets[0].reportedProgress=0
 // The unaffected ticket must not be previewed or consume a hidden third draw.
 const r=reorder(s,'right','left'),decision=r.developers[0].lastAssessment!
 assert.equal(decision.outcome,'switch')
 const winner=r.tickets.find(t=>t.id===decision.selectedId)!
 const appraisal=decision.considered.find(t=>t.id===winner.id)!
 assert.equal(appraisal.estimateSource,'temporary')
 assert.equal(winner.initialEffortEstimate!.totalWork,appraisal.estimatedTotal)
 assert.equal(winner.reportedEffortEstimate,appraisal.estimatedTotal)
 assert.deepEqual(winner.estimateHistory!.map(e=>[e.kind,e.at]),[['publication',{high:0,low:0}]])
 assert.ok(r.tickets.filter(t=>t.id!=='current'&&t.id!==winner.id).every(t=>t.estimateHistory===undefined))
 assert.equal(r.randomState,nextRandom(nextRandom(nextRandom(s.randomState).state).state).state)
 assert.equal(r.simulationTime,0)
 assert.equal(r.workLog,undefined)
 assert.ok(r.tickets.every(t=>t.completedWork===0))
})

test('relative ordering, not changed numeric ranks of ineligible tickets, determines relevance',()=>{
 const s=priorities()
 s.tickets[1].actualStatus='backlog'
 // Swap an eligible alternative with an ineligible neighbour. Its ordinal among
 // relevant work is unchanged, although its stored global rank changes.
 const r=reorder(s,'right','left')
 assert.equal(r.randomState,s.randomState)
 assert.equal(r.developers[0].lastAssessment,undefined)
})

test('active claims exclude colleagues tickets and priority choices remain exclusive in engineer order',()=>{
 const s=priorities()
 s.developers.push({...s.developers[0],id:'b',activeTicketID:'left'})
 s.tickets[0].reportedProgress=0
 for(const t of s.tickets)setPublishedEstimate(t,'b',t.requiredWork)
 const r=reorder(s,'right','left')
 assert.equal(new Set(r.developers.map(d=>d.activeTicketID)).size,2)
 for(const d of r.developers)assert.ok(!d.lastAssessment?.considered.some(t=>t.id===r.developers.find(other=>other.id!==d.id)!.activeTicketID))
})

test('completion picks new work normally and no estimate/priority event fabricates elapsed work',()=>{
 const s=decisionFixture();s.tickets[0].requiredWork=1
 s.tickets[0].estimateHistory=[];setPublishedEstimate(s.tickets[0],'a',1);s.tickets[0].reportedEffortEstimate=1
 s.tickets.push({...s.tickets[0],id:'next',rank:2,actualStatus:'todo',estimateHistory:[]})
 setPublishedEstimate(s.tickets[1],'a')
 const r=advanceSimulation(s,1,noDraw)
 assert.equal(r.tickets[0].actualStatus,'done')
 assert.equal(r.developers[0].activeTicketID,'next')
 assert.equal(r.developers[0].lastAssessment!.trigger,'pickup')
 assert.ok(r.tickets[1].completedWork>0)
})

test('decision snapshots remain development-only and have no obsolete clock/noise diagnostics',()=>{
 const s=priorities(),r=reorder(s,'right','left')
 const diagnostics=getDiagnosticsView(r)
 assert.ok(diagnostics.developers[0].lastAssessment!.considered.length)
 for(const key of ['timeSinceLastAssessment','timeUntilNextAssessment'])assert.equal(key in diagnostics.developers[0],false)
 const player=getPlayerView(r)
 assert.ok(player.developers.every(d=>!('lastAssessment'in d)&&!('assessmentClock'in d)))
 assert.ok(player.tickets.every(t=>!('estimateHistory'in t)&&!('completedWork'in t)))
})
