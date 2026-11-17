import { estimatedFixture } from './helpers/estimatedFixture.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sampleReconsideration, assessmentNoise } from '../src/game/reconsideration.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { close } from './helpers/flowExpectation.ts'
import { nextRandom } from '../src/game/random.ts'

function scenario() {
 const state=structuredClone(exampleGameState)
 state.developers=[{...state.developers[0],flowStreak:{ticketId:'ticket-1',duration:10}}]
 state.tickets=[{...state.tickets[0],completedWork:0,requiredWork:1e6}]
 return estimatedFixture(state)
}

test('scheduled waiting times match the approved cumulative distribution and its median',()=>{
 close(sampleReconsideration(0.5),25*Math.sqrt(Math.log(2)))
 for(const time of [1,10,20,30,100])close(sampleReconsideration(Math.exp(-((time/25)**2))),time)
 for(const u of [0,1])assert.ok(Number.isFinite(sampleReconsideration(u))&&sampleReconsideration(u)>0)
 assert.throws(()=>sampleReconsideration(NaN),RangeError)
 assert.ok(assessmentNoise(0,10,0.75).noiseScale>assessmentNoise(0,1,0.75).noiseScale)
})

test('no per-tick rolling: schedule once, then reset only the assessment clock while retaining Flow on stay',()=>{
 const state=scenario()
 let draws=0;const random=()=>{draws++;return 0.5}
 const first=advanceSimulation(state,1,random)
 assert.equal(draws,1)
 assert.equal(first.developers[0].flowStreak?.duration,11)
 close(first.developers[0].assessmentClock!.elapsed,1)
 const next=advanceSimulation(first,22,random)
 assert.equal(draws,2) // no alternative means no error draw, only rescheduling
 close(next.developers[0].flowStreak!.duration,33)
 close(next.developers[0].assessmentClock!.elapsed,23-25*Math.sqrt(Math.log(2)))
 assert.equal(next.developers[0].lastAssessment?.outcome,'unambiguous')
})

test('mid-interval reconsideration applies work to each ticket only on its own interval',()=>{
 const state=scenario();state.developers[0].assessmentClock={elapsed:20,remaining:0.5}
 state.tickets.push({...state.tickets[0],id:'other',rank:2,completedWork:0,requiredWork:1e6,actualStatus:'todo'})
 let calls=0
 const result=advanceSimulation(state,1,()=>{calls++;return calls===1?0.999:0.5})
 assert.equal(calls,2)
 assert.equal(result.developers[0].activeTicketID,'other')
 close(result.developers[0].flowStreak!.duration,0.5)
 close(result.developers[0].assessmentClock!.elapsed,0.5)
 assert.ok(result.tickets[0].completedWork>0&&result.tickets[1].completedWork>0)
 const stay=advanceSimulation(state,1,()=>0.001)
 assert.equal(stay.developers[0].activeTicketID,'ticket-1')
 close(stay.developers[0].flowStreak!.duration,11)
})

test('same seeded state/call sequence replays, and large/fractional calls preserve scheduled events',()=>{
 const state=scenario(), before=structuredClone(state)
 const whole=advanceSimulation(state,60)
 assert.deepEqual(whole,advanceSimulation(state,60))
 let split=state
 for(let i=0;i<120;i++)split=advanceSimulation(split,0.5)
 assert.equal(whole.randomState,split.randomState)
 close(whole.tickets[0].completedWork,split.tickets[0].completedWork)
 close(whole.developers[0].flowStreak!.duration,split.developers[0].flowStreak!.duration)
 close(whole.developers[0].assessmentClock!.remaining,split.developers[0].assessmentClock!.remaining)
 assert.deepEqual(advanceSimulation(JSON.parse(JSON.stringify(whole)),1),advanceSimulation(whole,1))
 assert.deepEqual(state,before)
 const first=advanceSimulation(state,1)
 assert.equal(first.randomState,nextRandom(state.randomState).state)
})

test('simultaneous reconsiderations resolve in developer order without duplicate claims or changing Rank',()=>{
 const state=scenario();state.tickets[0].rank=2
 state.developers[0].assessmentClock={elapsed:10,remaining:0.5}
 state.developers.push({...state.developers[0],id:'second',activeTicketID:'second-ticket',flowStreak:{ticketId:'second-ticket',duration:10}})
 state.tickets.push({...state.tickets[0],id:'second-ticket',rank:3}, {...state.tickets[0],id:'alternative',rank:1,actualStatus:'todo'})
 const ranks=state.tickets.map(t=>t.rank)
 const result=advanceSimulation(state,1,()=>0.99)
 const claims=result.developers.map(d=>d.activeTicketID)
 assert.equal(claims[0],'alternative')
 assert.equal(new Set(claims).size,claims.length)
 assert.deepEqual(result.tickets.map(t=>t.rank),ranks)
})

test('Focus never changes schedule sampling, and zero time neither initializes nor consumes RNG',()=>{
 const state=scenario()
 const zero=advanceSimulation(state,0,()=>{throw Error('Unexpected draw')})
 assert.deepEqual(zero,state)
 const low=advanceSimulation(state,1,()=>0.5)
 state.developers[0].focus=10000
 const high=advanceSimulation(state,1,()=>0.5)
 assert.deepEqual(high.developers[0].assessmentClock,low.developers[0].assessmentClock)
})

test('completion takes precedence over a simultaneous assessment and clears both clocks',()=>{
 const state=scenario()
 state.tickets[0].requiredWork=0;state.tickets[0].completedWork=0
 estimatedFixture(state)
 state.developers[0].assessmentClock={elapsed:20,remaining:0}
 const result=advanceSimulation(state,1,()=>{throw Error('Completed work must not assess')})
 assert.equal(result.developers[0].assessmentClock,undefined)
 assert.equal(result.developers[0].flowStreak,undefined)
 assert.equal(result.developers[0].lastAssessment,undefined)
})

test('invalid clocks fail explicitly without corrupting state',()=>{
 for(const remaining of [-1,NaN,Infinity]) {
  const state=scenario();state.developers[0].assessmentClock={elapsed:0,remaining}
  const original=structuredClone(state)
  assert.throws(()=>advanceSimulation(state,1),RangeError)
  assert.deepEqual(state,original)
 }
})

test('very short completion times do not silently overflow work, and unresolved enormous time steps fail safely',()=>{
 const state=scenario();state.developers[0].productivity=Number.MAX_VALUE
 state.developers[0].competencies.frontend=Number.MAX_VALUE
 state.tickets[0].requiredWork=Number.MIN_VALUE
 estimatedFixture(state)
 assert.throws(()=>advanceSimulation(state,1,()=>0.5),/below the numeric time range/)
 const idleRate=scenario();idleRate.developers[0].productivity=0
 const before=structuredClone(idleRate)
 assert.throws(()=>advanceSimulation(idleRate,1e300,()=>0.5),/numeric resolution/)
 assert.deepEqual(idleRate,before)
})
