import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { reorderTodo, compareRank } from '../src/game/rank.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { simulationReducer, createSimulationSession } from '../src/store/simulationControls.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
const order = (s: typeof exampleGameState) => getPlayerView(s).tickets.filter(t => t.reportedStatus === 'todo').map(t => t.id)

test('fixture ranks are exactly 1..N and order is independent of storage', () => {
  assert.deepEqual(exampleGameState.tickets.map(t => t.rank).sort((a,b)=>a-b),exampleGameState.tickets.map((_,i)=>i+1))
  const state = structuredClone(exampleGameState)
  state.tickets.reverse()
  assert.deepEqual(order(state), order(exampleGameState))
  assert.ok(compareRank({id:'a',rank:1}, {id:'b',rank:1}) < 0)
})

test('top, middle and bottom reorders preserve everything except affected reported To Do ranks', () => {
  let state = structuredClone(exampleGameState)
  const original = structuredClone(state)
  for (const [id, target, after, expected] of [
    ['ticket-5','ticket-2',false,['ticket-5','ticket-2','ticket-3','ticket-4']],
    ['ticket-5','ticket-3',true,['ticket-2','ticket-3','ticket-5','ticket-4']],
    ['ticket-2','ticket-4',true,['ticket-3','ticket-5','ticket-4','ticket-2']],
  ] as const) {
    state = reorderTodo(state,id,target,after)
    assert.deepEqual(order(state), expected)
    assert.deepEqual(state.tickets.map(t=>t.rank).sort((a,b)=>a-b),state.tickets.map((_,i)=>i+1))
  }
  assert.deepEqual(exampleGameState, original)
  for (const ticket of state.tickets) {
    const before = original.tickets.find(t => t.id === ticket.id)!
    assert.deepEqual({...ticket,rank:before.rank}, before)
    if (ticket.reportedStatus !== 'todo') assert.equal(ticket.rank,before.rank)
  }
  assert.deepEqual({...state,tickets:original.tickets},original)
  assert.equal(new Set(state.tickets.map(t=>t.rank)).size,state.tickets.length)
})

test('hidden actual status never blocks reorder and reducer works paused or running', () => {
  for (const isPaused of [true,false]) {
    const session = {...createSimulationSession(),isPaused}
    assert.equal(session.game.tickets[1].actualStatus,'in_progress')
    const result = simulationReducer(session,{type:'reorderTodo',ticketId:'ticket-2',targetId:'ticket-5',after:true})
    assert.equal(order(result.game).at(-1),'ticket-2')
    assert.equal(result.isPaused,isPaused)
    assert.deepEqual({...result.game,tickets:session.game.tickets},session.game)
    assert.deepEqual(advanceSimulation(result.game,1),advanceSimulation(structuredClone(result.game),1))
  }
})

test('invalid moves and malformed ranks are no-ops', () => {
  const state = structuredClone(exampleGameState)
  for (const [a,b] of [['missing','ticket-2'],['ticket-2','ticket-1'],['ticket-6','ticket-2'],['ticket-2','ticket-2']]) assert.strictEqual(reorderTodo(state,a,b),state)
  state.tickets[1].rank = state.tickets[0].rank
  assert.strictEqual(reorderTodo(state,'ticket-5','ticket-2'),state)
})

test('To Do selection uses rank after actual eligibility and active claims', () => {
  const state = structuredClone(exampleGameState)
  state.developers = [{id:'idle',name:'Idle',productivity:1}]
  state.tickets.find(t=>t.id==='ticket-5')!.rank = 1
  state.tickets.find(t=>t.id==='ticket-1')!.rank = 5
  const result = advanceSimulation(state,1,()=>0)
  assert.equal(result.developers[0].activeTicketID,'ticket-5')
  state.developers.unshift({id:'busy',name:'Busy',productivity:1,activeTicketID:'ticket-5'})
  const claimed = advanceSimulation(state,1,()=>0.4)
  assert.equal(claimed.developers[1].activeTicketID,'ticket-3')
})

test('interleaved global slots preserve other columns and do not mutate or reorder storage', () => {
  const state = structuredClone(exampleGameState)
  const template = state.tickets[0]
  state.tickets = [
    { ...template, id: 'A', rank: 1, reportedStatus: 'todo' },
    { ...template, id: 'B', rank: 2, reportedStatus: 'backlog', actualStatus: 'backlog' },
    { ...template, id: 'C', rank: 3, reportedStatus: 'todo' },
    { ...template, id: 'D', rank: 4, reportedStatus: 'in_progress' },
  ]
  state.tickets.reverse()
  const original = structuredClone(state)
  state.tickets.forEach(Object.freeze)
  Object.freeze(state.tickets)
  Object.freeze(state)
  const moved = reorderTodo(state, 'C', 'A')
  assert.deepEqual(order(moved), ['C', 'A'])
  assert.deepEqual([...moved.tickets].sort(compareRank).map(t=>[t.id,t.rank]), [['C',1],['B',2],['A',3],['D',4]])
  assert.deepEqual(moved.tickets.map(t=>t.id),state.tickets.map(t=>t.id))
  for (const ticket of moved.tickets) {
    const before = state.tickets.find(t=>t.id===ticket.id)!
    assert.deepEqual({...ticket,rank:before.rank},before)
    if (ticket.reportedStatus !== 'todo') assert.strictEqual(ticket,before)
  }
  assert.deepEqual(state,original)
  assert.strictEqual(reorderTodo(moved,'C','A'),moved)
  assert.strictEqual(reorderTodo(state,'A','C'),state)
})
