import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Developer, GameState } from '../src/game/types.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { encounterEstimate, firstPublishedEstimate, migrateEstimateHistory, pauseDiscovery, resumeDiscovery, validateEstimateHistory } from '../src/game/estimateHistory.ts'
import { estimateInitialEffort } from '../src/game/effortEstimate.ts'
import { evaluateEstimate, prepareDiscovery } from '../src/game/reestimation.ts'
import { effortNumber } from '../src/game/workLog.ts'
import { workAmount } from '../src/game/work.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { getDiagnosticsView } from '../src/store/diagnosticsView.ts'
import { projectWork } from '../src/game/completionTime.ts'
import { close } from './helpers/flowExpectation.ts'

const at = { high: 0, low: 0 }
const noDraw = () => { throw Error('No fresh estimation/discovery draw expected') }
function engineer(id: string): Developer {
  return { id, name: id, productivity: 1, judgement: 0, focus: 0, competencies: { frontend: 0, backend: 0 }, estimateReview: { ticketId: 'ticket', dueTime: { high: 1e308, low: 0 } } }
}
function fixture(): GameState {
  return { randomState: 1, simulationTime: 0, developers: [engineer('a'), engineer('b')], tickets: [
    { id: 'ticket', title: 'Ticket', rank: 1, workDomain: 'frontend', actualStatus: 'todo', reportedStatus: 'todo',
      reportedProgress: 0, requiredWork: 100, completedWork: 0 },
  ] }
}

test('only Unknown pickup estimates and publishes; takeover and return read the current shared report', () => {
  const s = fixture(), t = s.tickets[0], [a,b] = s.developers
  encounterEstimate(t, a, at, () => .8)
  close(t.reportedEffortEstimate!, 20)
  const original = structuredClone(t.initialEffortEstimate), history = structuredClone(t.estimateHistory)
  for (let i=0;i<10;i++) {
    encounterEstimate(t, b, at, noDraw)
    encounterEstimate(t, a, at, noDraw)
  }
  assert.deepEqual(t.estimateHistory, history)
  assert.deepEqual(t.initialEffortEstimate, original)
  assert.deepEqual(history!.map(e=>e.kind), ['publication'])
  assert.equal(firstPublishedEstimate(t), original!.totalWork)
})

test('shared improvements survive returns and repeated evaluations do not compound historical work', () => {
  const s = fixture(), t=s.tickets[0], [a,b]=s.developers
  encounterEstimate(t,a,at,()=>.8)
  const baseline=t.initialEffortEstimate!.totalWork
  s.workLog=[{developerId:'a',ticketId:t.id,effort:workAmount(70)}, {developerId:'b',ticketId:t.id,effort:workAmount(10)}]
  assert.equal(evaluateEstimate(s,b,t, 'discovery',()=>0).improved,true)
  const expected=100-(100-baseline)*(1+10/baseline)**-.3
  close(t.reportedEffortEstimate!,expected)
  const history=structuredClone(t.estimateHistory),work=structuredClone(s.workLog)
  for(let i=0;i<5;i++) {
    encounterEstimate(t,a,at,noDraw)
    encounterEstimate(t,b,at,noDraw)
    assert.equal(evaluateEstimate(s,b,t, 'discovery',()=>0).improved,false)
    assert.equal(t.reportedEffortEstimate,history!.at(-1)!.totalWork)
    assert.deepEqual(t.estimateHistory,history)
  }
  // A's earlier gross contribution remains usable, with the SAME ticket E0.
  assert.equal(evaluateEstimate(s,a,t, 'discovery',()=>0).improved,true)
  close(t.reportedEffortEstimate!,100-(100-baseline)*(1+70/baseline)**-.3)
  const shared=structuredClone(t.estimateHistory)
  assert.equal(evaluateEstimate(s,a,t, 'discovery',()=>0).improved,false)
  assert.equal(evaluateEstimate(s,b,t, 'discovery',()=>0).improved,false)
  assert.deepEqual(t.estimateHistory,shared)
  assert.deepEqual(s.workLog,work)
  assert.equal(firstPublishedEstimate(t),baseline)
})

test('return after a coworker revision uses the board; attribute changes refresh only relevant discovery inputs', () => {
  for(const attribute of ['judgement','competency'] as const) {
    const s=fixture(),t=s.tickets[0],[a,b]=s.developers
    encounterEstimate(t,a,at,()=>.5)
    s.workLog=[{developerId:'a',ticketId:t.id,effort:workAmount(1)}, {developerId:'b',ticketId:t.id,effort:workAmount(10)}]
    t.completedWork=11;t.overrunEvaluationConsumed=true
    prepareDiscovery(s,a,t,()=>.2)
    pauseDiscovery(a)
    assert.equal(evaluateEstimate(s,b,t, 'discovery',()=>0).improved,true)
    const board=t.reportedEffortEstimate,history=structuredClone(t.estimateHistory),work=structuredClone(s.workLog)
    if(attribute==='judgement')a.judgement=10;else a.competencies.frontend=10
    encounterEstimate(t,a,at,noDraw);resumeDiscovery(a,t.id)
    assert.equal(t.reportedEffortEstimate,board)
    assert.deepEqual(t.estimateHistory,history)
    let draws=0;prepareDiscovery(s,a,t,()=>{draws++;return .1})
    assert.equal(draws,1) // board changed: one schedule, no estimate draw
    const pending=structuredClone(a.estimateDiscovery)
    assert.equal(pending!.baseline,50)
    assert.equal(pending!.boardEstimate,board)
    for(let i=0;i<5;i++) {
      pauseDiscovery(a);encounterEstimate(t,b,at,noDraw);encounterEstimate(t,a,at,noDraw)
      resumeDiscovery(a,t.id);prepareDiscovery(s,a,t,noDraw)
      assert.deepEqual(a.estimateDiscovery,pending)
    }
    assert.deepEqual(s.workLog,work)
    assert.equal(t.overrunEvaluationConsumed,true)
  }
})

test('competency changes alone do not reroll a parked work target; Judgement changes do', () => {
  const s=fixture(),t=s.tickets[0],a=s.developers[0]
  encounterEstimate(t,a,at,()=>.5);prepareDiscovery(s,a,t,()=>.2)
  const target=structuredClone(a.estimateDiscovery)
  pauseDiscovery(a);a.competencies.frontend=100;encounterEstimate(t,a,at,noDraw)
  resumeDiscovery(a,t.id);prepareDiscovery(s,a,t,noDraw)
  assert.deepEqual(a.estimateDiscovery,target)
  a.judgement=100;let draws=0;prepareDiscovery(s,a,t,()=>{draws++;return .2})
  assert.equal(draws,1)
  assert.notDeepEqual(a.estimateDiscovery!.target,target!.target)
})

test('rapid switches preserve pending and completion-censored targets without free discovery opportunities', () => {
  for(const uniform of [.1,.999999]) {
    const s=fixture(),a=s.developers[0],one=s.tickets[0],two={...one,id:'other',rank:2}
    s.tickets.push(two)
    encounterEstimate(one,a,at,()=>.5);prepareDiscovery(s,a,one,()=>uniform)
    const pending=structuredClone(a.estimateDiscovery)
    pauseDiscovery(a);encounterEstimate(two,a,at,()=>.5);prepareDiscovery(s,a,two,()=>uniform)
    for(let i=0;i<30;i++)for(const t of [one,two]) {
      pauseDiscovery(a);encounterEstimate(t,a,at,noDraw);resumeDiscovery(a,t.id);prepareDiscovery(s,a,t,noDraw)
    }
    pauseDiscovery(a);resumeDiscovery(a,one.id)
    assert.deepEqual(a.estimateDiscovery,pending)
    assert.equal(one.estimateHistory!.length,1)
    assert.deepEqual(JSON.parse(JSON.stringify(s)),s)
  }
})

test('a returning target beyond remaining capacity stays censored instead of rerolling', () => {
  const s=fixture(),t=s.tickets[0],[a,b]=s.developers
  encounterEstimate(t,a,at,()=>.5);prepareDiscovery(s,a,t,()=>.3)
  const target=structuredClone(a.estimateDiscovery!.target)
  pauseDiscovery(a);encounterEstimate(t,b,at,noDraw);t.completedWork=99.9
  encounterEstimate(t,a,at,noDraw);resumeDiscovery(a,t.id);a.activeTicketID=t.id;s.developers=[a]
  t.actualStatus='in_progress' // Returning to already-started work, not a first status-report event.
  const result=advanceSimulation(s,.01,noDraw)
  assert.deepEqual(result.developers[0].estimateDiscovery!.target,target)
  assert.equal(result.developers[0].workSession!.estimateEvents!.discovery,null)
})

test('old personal assessments are discarded while genuine historical publications and provenance survive', () => {
  const s=fixture(),t=s.tickets[0]
  t.initialEffortEstimate={developerId:'a',totalWork:20};t.reportedEffortEstimate=80
  t.estimateHistory=[
    {kind:'assessment',developerId:'a',totalWork:20,reason:'initial',at},
    {kind:'publication',developerId:'a',totalWork:20,reason:'initial',at,sourceAssessmentIndex:0},
    {kind:'assessment',developerId:'b',totalWork:80,reason:'initial',at},
    {kind:'publication',developerId:'b',totalWork:80,reason:'takeover',at,sourceAssessmentIndex:2,replacedTotalWork:20,replacedDeveloperId:'a'},
    {kind:'assessment',developerId:'a',totalWork:90,reason:'discovery',at},
  ]
  const saved=structuredClone(s)
  const result=advanceSimulation(JSON.parse(JSON.stringify(s)),.01,()=>.999999)
  assert.deepEqual(result.tickets[0].estimateHistory!.map(e=>[e.kind,e.developerId,e.totalWork]),
    [['publication','a',20],['publication','b',80]])
  assert.equal(result.tickets[0].reportedEffortEstimate,80)
  assert.equal(firstPublishedEstimate(result.tickets[0]),20)
  assert.ok(result.tickets[0].estimateHistory!.every(e=>!('sourceAssessmentIndex'in e)))
  assert.deepEqual(s,saved)
  const history=structuredClone(result.tickets[0].estimateHistory)
  assert.deepEqual(advanceSimulation(JSON.parse(JSON.stringify(result)),.01,noDraw).tickets[0].estimateHistory,history)
})

test('legacy no-op evaluation cannot identify the author of an earlier publication or invent a belief', () => {
  const s=fixture(),t=s.tickets[0],b=s.developers[1]
  s.simulationTime=100;s.developers=[b];b.activeTicketID=t.id
  t.actualStatus='in_progress'
  b.estimateDiscovery={ticketId:t.id,boardEstimate:60,requiredWork:100,judgement:0,productive:true,target:null}
  t.initialEffortEstimate={developerId:'a',totalWork:20};t.reportedEffortEstimate=60;t.completedWork=30
  t.lastEstimateEvaluation={developerId:'b',reason:'discovery',personalWork:5,candidate:25,published:false}
  let restored=advanceSimulation(JSON.parse(JSON.stringify(s)),.01,noDraw)
  const history=structuredClone(restored.tickets[0].estimateHistory)
  assert.deepEqual(history,[{kind:'legacy_publication',developerId:'a',totalWork:20,at:null},
    {kind:'legacy_publication',totalWork:60,at:null}])
  for(let i=0;i<5;i++) {
    restored=advanceSimulation(JSON.parse(JSON.stringify(restored)),.01,noDraw)
    assert.deepEqual(restored.tickets[0].estimateHistory,history)
    assert.equal(restored.randomState,s.randomState)
    assert.equal(restored.tickets[0].reportedEffortEstimate,60)
  }
})

test('legacy evidence with a proven published revision keeps its known author, not an invented time', () => {
  const s=fixture(),t=s.tickets[0]
  t.initialEffortEstimate={developerId:'a',totalWork:20};t.reportedEffortEstimate=60
  t.lastEstimateEvaluation={developerId:'b',reason:'discovery',personalWork:5,candidate:60,published:true}
  migrateEstimateHistory(t)
  assert.deepEqual(t.estimateHistory!.at(-1),{kind:'legacy_publication',developerId:'b',totalWork:60,at:null})
  assert.equal(firstPublishedEstimate(t),20)
})

test('board-only legacy E0 is frozen without an invented author; a private-only Unknown requires a real first publication', () => {
  const s=fixture(),t=s.tickets[0],a=s.developers[0]
  t.reportedEffortEstimate=20;encounterEstimate(t,a,at,noDraw)
  assert.equal(t.initialEffortEstimate,undefined)
  assert.equal(firstPublishedEstimate(t),20)
  t.reportedEffortEstimate=90
  assert.equal(firstPublishedEstimate(t),20)
  const unknown=fixture().tickets[0]
  unknown.initialEffortEstimate={developerId:'old-private-author',totalWork:5}
  encounterEstimate(unknown,a,at,()=>.5)
  assert.equal(unknown.reportedEffortEstimate,50)
  assert.deepEqual(unknown.initialEffortEstimate,{developerId:'a',totalWork:50})
})

test('zero time and repeated stays do not publish, migrate, consume RNG or manufacture assessment history', () => {
  let s=fixture();s.developers=[s.developers[0]];s.developers[0].activeTicketID='ticket'
  s.tickets[0].actualStatus='in_progress'
  encounterEstimate(s.tickets[0],s.developers[0],at,()=>0)
  assert.deepEqual(advanceSimulation(s,0,noDraw),s)
  const history=structuredClone(s.tickets[0].estimateHistory)
  for(let i=0;i<4;i++)s=advanceSimulation(s,1,noDraw)
  assert.deepEqual(s.tickets[0].estimateHistory,history)
})

test('publication history validates provenance/order; failures are atomic including original RNG', () => {
  const s=fixture();s.developers=[s.developers[0]];s.developers[0].activeTicketID='ticket'
  encounterEstimate(s.tickets[0],s.developers[0],at,()=>.5)
  for(const change of ['source','time','amount'] as const) {
    const bad=structuredClone(s),history=bad.tickets[0].estimateHistory!
    if(change==='source'&&history[0].kind==='publication')history[0].sourceAssessmentIndex=0
    if(change==='time')history.push({kind:'publication',developerId:'a',totalWork:50,reason:'revision',at:{high:-1,low:0}})
    if(change==='amount')history[0].totalWork=Infinity
    const before=structuredClone(bad)
    assert.throws(()=>advanceSimulation(bad,1),RangeError)
    assert.deepEqual(bad,before)
  }
  const underflow=fixture();underflow.tickets[0].requiredWork=Number.MIN_VALUE
  const before=structuredClone(underflow)
  assert.throws(()=>advanceSimulation(underflow,.1,()=>.9),/positive numeric range/)
  assert.deepEqual(underflow,before)
})

test('extreme work/attributes support publication and keep fixed E0/history outside the player view', () => {
  for(const total of [Number.MIN_VALUE,1e-300,1e300,Number.MAX_VALUE]) {
    const s=fixture(),t=s.tickets[0],a=s.developers[0]
    t.requiredWork=total;a.judgement=Number.MAX_VALUE;a.competencies.frontend=Number.MAX_VALUE
    encounterEstimate(t,a,at,()=>.5)
    assert.equal(t.reportedEffortEstimate,estimateInitialEffort(total,a.judgement,a.competencies.frontend,.5))
    assert.equal(firstPublishedEstimate(t),t.reportedEffortEstimate)
    validateEstimateHistory(t);assert.deepEqual(JSON.parse(JSON.stringify(s)),s)
    for(const key of ['estimateHistory','learningBaseline','initialEffortEstimate'])assert.equal(key in getPlayerView(s).tickets[0],false)
    assert.equal('pausedEstimateDiscoveries'in getPlayerView(s).developers[0],false)
    const diagnostic=getDiagnosticsView(s)
    assert.deepEqual(diagnostic.tickets[0].estimateHistory,t.estimateHistory)
    diagnostic.tickets[0].estimateHistory[0].totalWork=0
    assert.ok(t.estimateHistory![0].totalWork>0)
  }
})

test('completion preempts coincident discovery without an estimate publication or discovery roll', () => {
  const s=fixture();s.developers=[s.developers[0]]
  const a=s.developers[0],t=s.tickets[0]
  encounterEstimate(t,a,at,()=>.5);a.activeTicketID=t.id;t.overrunEvaluationConsumed=true
  a.estimateDiscovery={ticketId:t.id,boardEstimate:50,requiredWork:100,judgement:0,productive:true,target:workAmount(100)}
  const result=advanceSimulation(s,projectWork(a,t,workAmount(100)).seconds!,()=>.999)
  assert.equal(result.tickets[0].actualStatus,'done')
  assert.equal(result.tickets[0].estimateHistory!.length,1)
  assert.equal(result.tickets[0].lastEstimateEvaluation!.reason,'completion')
  assert.equal(result.tickets[0].lastEstimateEvaluation!.published,false)
  assert.equal(result.randomState,s.randomState)
})


test('same-value known legacy publication retains its actual author while private-only conclusions are removed', () => {
  const s=fixture(),t=s.tickets[0]
  t.initialEffortEstimate={developerId:'a',totalWork:20};t.reportedEffortEstimate=20
  t.lastEstimateEvaluation={developerId:'b',reason:'discovery',personalWork:5,candidate:20,published:true}
  migrateEstimateHistory(t)
  assert.deepEqual(t.estimateHistory,[{kind:'legacy_publication',developerId:'a',totalWork:20,at:null},
    {kind:'legacy_publication',developerId:'b',totalWork:20,at:null}])
  const known=structuredClone(t.estimateHistory)
  migrateEstimateHistory(t);assert.deepEqual(t.estimateHistory,known)
})

test('legacy personal-baseline discovery changes migrate once to shared E0 without switch-based rerolls', () => {
  const s=fixture(),t=s.tickets[0],a=s.developers[0]
  encounterEstimate(t,a,at,()=>.8)
  s.workLog=[{developerId:a.id,ticketId:t.id,effort:workAmount(10)}]
  t.completedWork=10;t.overrunEvaluationConsumed=true
  a.estimateDiscovery={ticketId:t.id,boardEstimate:t.reportedEffortEstimate!,requiredWork:100,
    baseline:50,judgement:0,productive:true,target:workAmount(80)} // obsolete personal E0
  let draws=0
  prepareDiscovery(s,a,t,()=>{draws++;return .1})
  assert.equal(draws,1)
  close(a.estimateDiscovery!.baseline!,t.initialEffortEstimate!.totalWork)
  const pending=structuredClone(a.estimateDiscovery)
  for(let i=0;i<4;i++) {
    pauseDiscovery(a);encounterEstimate(t,a,at,noDraw);resumeDiscovery(a,t.id);prepareDiscovery(s,a,t,noDraw)
    assert.deepEqual(a.estimateDiscovery,pending)
  }
  assert.equal(t.overrunEvaluationConsumed,true)
  assert.deepEqual(s.workLog,[{developerId:a.id,ticketId:t.id,effort:workAmount(10)}])
})

test('the earliest genuine publication supplies E0 when original provenance is absent', () => {
  const s=fixture(),t=s.tickets[0],a=s.developers[0]
  t.reportedEffortEstimate=60
  t.estimateHistory=[
    {kind:'publication',developerId:'past-a',totalWork:20,reason:'initial',at},
    {kind:'publication',developerId:'past-b',totalWork:60,reason:'revision',at},
  ]
  assert.equal(firstPublishedEstimate(t),20)
  assert.equal(t.initialEffortEstimate,undefined)
  s.workLog=[{developerId:a.id,ticketId:t.id,effort:workAmount(10)}]
  assert.equal(evaluateEstimate(s,a,t, 'discovery',()=>0).improved,false)
  close(t.lastEstimateEvaluation!.candidate,100-80*(1+10/20)**-.3)
  assert.equal(t.reportedEffortEstimate,60)
  assert.equal(firstPublishedEstimate(JSON.parse(JSON.stringify(t))),20)
})

function legacyPrivateThenPublished() {
  const s=fixture(),t=s.tickets[0],[a,b]=s.developers
  t.initialEffortEstimate={developerId:a.id,totalWork:20}
  assert.equal(t.reportedEffortEstimate,undefined)
  const totalWork=estimateInitialEffort(t.requiredWork,b.judgement,b.competencies.frontend,.5)
  assert.equal(totalWork,50)
  // Exact records produced by HEAD's encounterEstimate: migrate A's private-only
  // original, assess B independently, then publish B without replacing A's field.
  t.estimateHistory=[
    {kind:'legacy_assessment',developerId:a.id,totalWork:20,baseline:20,evidence:'original',at:null},
    {kind:'assessment',developerId:b.id,totalWork,reason:'initial',at},
    {kind:'publication',developerId:b.id,totalWork,reason:'initial',sourceAssessmentIndex:1,at},
  ]
  t.reportedEffortEstimate=totalWork
  return s
}

test('HEAD private-only original followed by B initial publication establishes E0=50 for revision and discovery', () => {
  for(const entryPoint of ['discovery','revision'] as const) {
    const s=legacyPrivateThenPublished(),t=s.tickets[0],b=s.developers[1]
    s.workLog=[{developerId:b.id,ticketId:t.id,effort:workAmount(10)}]
    t.completedWork=10
    const originalPublication={kind:'publication',developerId:b.id,totalWork:50,reason:'initial',at}
    if(entryPoint==='discovery') {
      let draws=0
      prepareDiscovery(s,b,t,()=>{draws++;return .1})
      assert.equal(draws,1)
      assert.equal(b.estimateDiscovery!.baseline,50)
      const r=.5,rate=.8*2*r/(r+.2)
      close(effortNumber(b.estimateDiscovery!.target!)!,10+(50+10)*Math.expm1(-Math.log1p(-.1)/rate))
    }
    assert.equal(evaluateEstimate(s,b,t, 'discovery',()=>0).improved,true)
    assert.equal(firstPublishedEstimate(t),50)
    assert.deepEqual(t.initialEffortEstimate,{developerId:b.id,totalWork:50})
    close(t.lastEstimateEvaluation!.candidate,52.661375950046306)
    close(t.reportedEffortEstimate!,52.661375950046306)
    assert.equal(t.lastEstimateEvaluation!.published,true)
    assert.deepEqual(t.estimateHistory![0],originalPublication)
    assert.equal(t.estimateHistory!.length,2)
    assert.equal(t.overrunEvaluationConsumed,false)
    assert.equal(s.randomState,1)
    assert.equal(evaluateEstimate(s,b,t, 'discovery',()=>0).improved,false)
    prepareDiscovery(s,b,t,()=>.1)
    const pending=structuredClone(b.estimateDiscovery)
    const history=structuredClone(t.estimateHistory)
    let saved=s
    for(let i=0;i<4;i++) {
      saved=JSON.parse(JSON.stringify(saved))
      const restored=saved.tickets[0],[a,b]=saved.developers
      migrateEstimateHistory(restored)
      encounterEstimate(restored,a,at,noDraw)
      encounterEstimate(restored,b,at,noDraw)
      assert.equal(firstPublishedEstimate(restored),50)
      assert.deepEqual(restored.estimateHistory,history)
      assert.deepEqual(restored.initialEffortEstimate,{developerId:b.id,totalWork:50})
      prepareDiscovery(saved,b,restored,noDraw)
      assert.deepEqual(b.estimateDiscovery,pending)
      assert.equal(saved.randomState,1)
    }
  }
})

test('a first publication keeps E0 fixed when later board revisions already exist', () => {
  const s=legacyPrivateThenPublished(),t=s.tickets[0]
  t.estimateHistory!.push(
    {kind:'assessment',developerId:'b',totalWork:80,reason:'discovery',at:{high:1,low:0}},
    {kind:'publication',developerId:'b',totalWork:80,reason:'revision',sourceAssessmentIndex:3,
      replacedTotalWork:50,replacedDeveloperId:'b',at:{high:1,low:0}},
  )
  t.reportedEffortEstimate=80
  t.learningBaseline=20 // previously cached legacy value is disproved by publication evidence
  const publications=structuredClone(t.estimateHistory!.filter(e=>e.kind==='publication'))
  for(const publication of publications)delete publication.sourceAssessmentIndex
  for(let i=0;i<3;i++) {
    migrateEstimateHistory(t)
    assert.equal(firstPublishedEstimate(t),50)
    assert.equal(t.reportedEffortEstimate,80)
    assert.deepEqual(t.estimateHistory,publications)
    assert.equal(firstPublishedEstimate(JSON.parse(JSON.stringify(t))),50)
  }
})

test('genuinely published originals survive complete, partial and history-free legacy records', () => {
  for(const evidence of ['complete','revision-only','takeover-only','return-only','legacy-observation','history-free'] as const) {
    const s=fixture(),t=s.tickets[0]
    t.initialEffortEstimate={developerId:'a',totalWork:20}
    t.reportedEffortEstimate=60
    if(evidence==='complete')t.estimateHistory=[
      {kind:'publication',developerId:'a',totalWork:20,reason:'initial',at},
      {kind:'publication',developerId:'b',totalWork:60,reason:'revision',at},
    ]
    if(evidence==='revision-only'||evidence==='takeover-only'||evidence==='return-only')t.estimateHistory=[
      {kind:'publication',developerId:'b',totalWork:60,
        reason:evidence==='revision-only'?'revision':evidence==='takeover-only'?'takeover':'return',at},
    ]
    if(evidence==='legacy-observation')t.estimateHistory=[{kind:'legacy_publication',totalWork:60,at:null}]
    for(let i=0;i<3;i++) {
      migrateEstimateHistory(t)
      assert.equal(firstPublishedEstimate(t),20)
      assert.deepEqual(t.initialEffortEstimate,{developerId:'a',totalWork:20})
      assert.equal(firstPublishedEstimate(JSON.parse(JSON.stringify(t))),20)
      assert.equal(t.reportedEffortEstimate,60)
    }
  }
})

test('correcting private-only provenance preserves an existing valid E0=50 discovery target without RNG', () => {
  const s=legacyPrivateThenPublished(),t=s.tickets[0],b=s.developers[1]
  b.estimateDiscovery={ticketId:t.id,boardEstimate:50,requiredWork:100,baseline:50,
    judgement:0,productive:true,target:workAmount(75)}
  const pending=structuredClone(b.estimateDiscovery)
  prepareDiscovery(s,b,t,noDraw)
  assert.equal(firstPublishedEstimate(t),50)
  assert.deepEqual(b.estimateDiscovery,pending)
  assert.equal(s.randomState,1)
})
