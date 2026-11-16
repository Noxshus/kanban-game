import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { estimateInitialEffort } from '../src/game/effortEstimate.ts'
import { nextRandom } from '../src/game/random.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { getDiagnosticsView } from '../src/store/diagnosticsView.ts'
import { projectCompletion } from '../src/game/completionTime.ts'

function scenario(active = false) {
  const state = structuredClone(exampleGameState)
  state.developers = [{ ...state.developers[0], activeTicketID: active ? 'ticket-1' : undefined,
    judgement: 0, focus: 0, productivity: 1, competencies: { frontend: 0, backend: 100 } }]
  state.tickets = [{ ...state.tickets[0], actualStatus: active ? 'in_progress' : 'todo',
    reportedStatus: 'todo', requiredWork: 1e6, completedWork: 0, reportedProgress: 0, assignedDeveloperId: undefined }]
  return state
}

test('a genuine pickup publishes total work once, with one estimate draw before scheduling', () => {
  const input = scenario(), before = structuredClone(input)
  const firstDraw = nextRandom(1), secondDraw = nextRandom(firstDraw.state)
  const first = advanceSimulation(input, 0.1)
  const expected = estimateInitialEffort(1e6, 0, 0, firstDraw.value)
  assert.equal(first.randomState, secondDraw.state)
  assert.deepEqual(first.tickets[0].initialEffortEstimate, { developerId: input.developers[0].id, totalWork: expected })
  assert.equal(first.tickets[0].reportedEffortEstimate, expected)
  assert.equal(first.tickets[0].assignedDeveloperId, input.developers[0].id)
  assert.ok(first.tickets[0].completedWork > 0)
  assert.deepEqual(input, before)
  const next = advanceSimulation(first, 0.1, () => { throw Error('Continued work must not draw') })
  assert.equal(next.tickets[0].reportedEffortEstimate, expected)
  assert.deepEqual(next.tickets[0].initialEffortEstimate, first.tickets[0].initialEffortEstimate)
})

test('legacy active claims use the actual worker/domain, not owner, remaining work or Flow', () => {
  for (const domain of ['frontend', 'backend'] as const) {
    const input = scenario(true)
    input.tickets[0].workDomain = domain
    input.tickets[0].completedWork = 100
    input.tickets[0].assignedDeveloperId = 'someone-else'
    input.developers[0].assessmentClock = { elapsed: 0, remaining: 1000 }
    input.developers[0].flowStreak = { ticketId: 'ticket-1', duration: 100 }
    input.developers[0].focus = 1000
    let draws = 0
    const result = advanceSimulation(input, 0.1, () => { draws++; return 0.5 })
    assert.equal(draws, 1)
    assert.equal(result.tickets[0].reportedEffortEstimate,
      estimateInitialEffort(1e6, 0, input.developers[0].competencies[domain], 0.5))
    assert.equal(result.tickets[0].initialEffortEstimate?.developerId, input.developers[0].id)
  }
})

test('example active tickets initialise on positive advance and never-picked Backlog stays unknown', () => {
  const original = structuredClone(exampleGameState)
  assert.deepEqual(advanceSimulation(exampleGameState, 0, () => { throw Error('No draw') }), original)
  const first = advanceSimulation(exampleGameState, 0.1)
  for (const [index, id] of [[0, 'developer-1'], [1, 'developer-2']] as const) {
    assert.equal(first.tickets[index].initialEffortEstimate?.developerId, id)
    assert.ok(first.tickets[index].reportedEffortEstimate! > 0)
  }
  assert.ok(first.tickets.slice(5).every(t => t.reportedEffortEstimate === undefined && t.initialEffortEstimate === undefined))
  const continued = advanceSimulation(first, 0.1)
  for (const t of first.tickets.filter(t => t.initialEffortEstimate)) {
    assert.deepEqual(continued.tickets.find(item => item.id === t.id)?.initialEffortEstimate, t.initialEffortEstimate)
  }
  assert.deepEqual(exampleGameState, original)
})

test('ownership alone, completed work and stale/duplicate active references never create extra estimates', () => {
  const state = scenario(true)
  state.developers.push({ ...state.developers[0], id: 'duplicate' }, { ...state.developers[0], id: 'stale', activeTicketID: 'backlog' })
  state.tickets.push({ ...state.tickets[0], id: 'backlog', rank: 2, actualStatus: 'backlog', assignedDeveloperId: 'stale' },
    { ...state.tickets[0], id: 'done', rank: 3, actualStatus: 'done', completedWork: 1e6 })
  let draws = 0
  const result = advanceSimulation(state, 0.1, () => { draws++; return 0.5 })
  assert.equal(draws, 2) // first active ticket estimate + its schedule
  assert.equal(result.developers[1].activeTicketID, undefined)
  assert.equal(result.developers[2].activeTicketID, undefined)
  assert.ok(result.tickets.slice(1).every(t => t.initialEffortEstimate === undefined))
  const owned = scenario(); owned.tickets[0].assignedDeveloperId = 'owner'; owned.developers = []
  assert.equal(advanceSimulation(owned, 1).tickets[0].reportedEffortEstimate, undefined)
})

test('handoff, resume and divergent public/private beliefs do not re-estimate or republish', () => {
  const initial = advanceSimulation(scenario(), 0.1, () => 0.5)
  const belief = structuredClone(initial.tickets[0].initialEffortEstimate)
  initial.tickets[0].reportedEffortEstimate = 123 // future reporting may diverge
  initial.developers[0].id = 'replacement'
  delete initial.developers[0].activeTicketID
  delete initial.developers[0].flowStreak
  delete initial.developers[0].assessmentClock
  const draws: number[] = []
  const handed = advanceSimulation(initial, 0.1, () => { draws.push(0.5); return 0.5 })
  assert.equal(draws.length, 1) // only the new worker's schedule
  assert.equal(handed.tickets[0].reportedEffortEstimate, 123)
  assert.deepEqual(handed.tickets[0].initialEffortEstimate, belief)
  assert.equal(handed.tickets[0].assignedDeveloperId, 'replacement')
  for (const keep of ['initialEffortEstimate', 'reportedEffortEstimate'] as const) {
    const legacy = scenario(true)
    if (keep === 'initialEffortEstimate') legacy.tickets[0].initialEffortEstimate = belief
    else legacy.tickets[0].reportedEffortEstimate = 0
    legacy.developers[0].assessmentClock = { elapsed: 0, remaining: 1000 }
    const restored = advanceSimulation(JSON.parse(JSON.stringify(legacy)), 0.1, () => { throw Error('No duplicate draw') })
    assert.deepEqual(restored.tickets[0][keep], legacy.tickets[0][keep])
    const absent = keep === 'initialEffortEstimate' ? 'reportedEffortEstimate' : 'initialEffortEstimate'
    assert.equal(restored.tickets[0][absent], undefined)
  }
})

test('switch away and back retain the first engineer belief and publication', () => {
  const first = advanceSimulation(scenario(true), 0.1, () => 0.5)
  first.tickets[0].rank = 2
  first.tickets.push({ ...scenario().tickets[0], id: 'other', rank: 1 })
  first.developers[0].assessmentClock = { elapsed: 0, remaining: 0 }
  let calls = 0
  const switched = advanceSimulation(first, 0.1, () => { calls++; return calls === 1 ? 0.999 : 0.5 })
  assert.equal(switched.developers[0].activeTicketID, 'other')
  assert.equal(calls, 3) // assessment, new ticket's first estimate, schedule
  const before = switched.tickets.map(t => structuredClone(t.initialEffortEstimate))
  switched.developers[0].assessmentClock = { elapsed: 0, remaining: 0 }
  calls = 0
  const returned = advanceSimulation(switched, 0.1, () => { calls++; return calls === 1 ? 0.999 : 0.5 })
  assert.equal(returned.developers[0].activeTicketID, 'ticket-1')
  assert.equal(calls, 2) // assessment + schedule only
  assert.deepEqual(returned.tickets.map(t => t.initialEffortEstimate), before)
  assert.deepEqual(returned.tickets.map(t => t.reportedEffortEstimate), switched.tickets.map(t => t.reportedEffortEstimate))
})

test('published-only player view hides original belief, author and actual total even when values diverge', () => {
  const state = advanceSimulation(scenario(), 0.1)
  state.tickets[0].reportedEffortEstimate = 8.5
  const original = structuredClone(state)
  const player = getPlayerView(state), diagnostic = getDiagnosticsView(state)
  assert.equal(player.tickets[0].reportedEffortEstimate, 8.5)
  for (const key of ['initialEffortEstimate', 'requiredWork', 'completedWork', 'workRemainder', 'actualStatus']) {
    assert.equal(key in player.tickets[0], false)
  }
  assert.equal(diagnostic.tickets[0].requiredWork, 1e6)
  assert.deepEqual(diagnostic.tickets[0].initialEffortEstimate, state.tickets[0].initialEffortEstimate)
  diagnostic.tickets[0].initialEffortEstimate!.totalWork = 0
  assert.deepEqual(state, original)
})

test('estimate failures leave original tickets, developers and seeded RNG untouched, even after prior successful claims', () => {
  const state = scenario(true)
  state.developers.push({ ...state.developers[0], id: 'underflow', activeTicketID: 'tiny' })
  state.tickets.push({ ...state.tickets[0], id: 'tiny', rank: 2, requiredWork: Number.MIN_VALUE })
  const before = structuredClone(state)
  assert.throws(() => advanceSimulation(state, 0.1, () => 0.9), /positive numeric range/)
  assert.deepEqual(state, before)
  // This seed also reaches the second claim's underflow after the first succeeds.
  assert.throws(() => advanceSimulation(state, 0.1), /positive numeric range/)
  assert.deepEqual(state, before)
  for (const bad of [NaN, Infinity]) {
    const invalid = scenario(true); invalid.tickets[0].requiredWork = bad
    assert.throws(() => advanceSimulation(invalid, 0.1), RangeError)
  }
})

// Exercise first publications inside mixed positive-time events, not just call-start migration.
function coincident(reverse: boolean) {
  const state = scenario(true), base = state.developers[0], ticket = state.tickets[0]
  state.developers = [
    { ...base, id: 'finishing', activeTicketID: 'finish', assessmentClock: { elapsed: 0, remaining: 1000 } },
    { ...base, id: 'reconsidering', activeTicketID: 'ongoing', assessmentClock: { elapsed: 0, remaining: 1000 } },
  ]
  state.tickets = [
    { ...ticket, id: 'finish', rank: 3, requiredWork: 1, actualStatus: 'in_progress' },
    { ...ticket, id: 'ongoing', rank: 2, requiredWork: 1000, actualStatus: 'in_progress' },
    { ...ticket, id: 'contested', rank: 1, requiredWork: 100, reportedProgress: 100 },
  ]
  const due = projectCompletion(state.developers[0], state.tickets[0], true).seconds!
  state.developers[1].assessmentClock!.remaining = due
  if (reverse) state.developers.reverse()
  return { state, due }
}

test('simultaneous first publications preserve engineer order, partitioned decisions, claims and seeded RNG', () => {
  for (const reverse of [false, true]) {
    const { state, due } = coincident(reverse)
    const original = structuredClone(state)
    const whole = advanceSimulation(state, due + 0.25)
    let split = state
    for (let i = 0; i < 3; i++) split = JSON.parse(JSON.stringify(advanceSimulation(split, 0.3)))
    split = advanceSimulation(split, due + 0.25 - 0.9)
    let expectedSeed = state.randomState
    for (let i = 0; i < (reverse ? 6 : 5); i++) expectedSeed = nextRandom(expectedSeed).state
    assert.equal(whole.randomState, expectedSeed)
    assert.equal(split.randomState, whole.randomState)
    assert.deepEqual(split.developers.map(d => [d.id, d.activeTicketID, d.lastAssessment]),
      whole.developers.map(d => [d.id, d.activeTicketID, d.lastAssessment]))
    assert.deepEqual(split.tickets.map(t => [t.id, t.initialEffortEstimate, t.reportedEffortEstimate, t.actualStatus, t.assignedDeveloperId]),
      whole.tickets.map(t => [t.id, t.initialEffortEstimate, t.reportedEffortEstimate, t.actualStatus, t.assignedDeveloperId]))
    const contested = whole.tickets.find(t => t.id === 'contested')!
    assert.equal(contested.initialEffortEstimate?.developerId, state.developers[0].id)
    assert.equal(contested.assignedDeveloperId, state.developers[0].id)
    assert.deepEqual(advanceSimulation(JSON.parse(JSON.stringify(whole)), 1), advanceSimulation(whole, 1))
    assert.deepEqual(whole, advanceSimulation(state, due + 0.25))
    assert.deepEqual(state, original)
  }
})


test('completion chaining publishes once for each new ticket across partitioned advances and JSON restoration', () => {
  const state = scenario()
  state.tickets = [1, 2, 3].map((work, i) => ({ ...state.tickets[0], id: 'work-' + i, rank: i + 1, requiredWork: work }))
  const whole = advanceSimulation(state, 30)
  let split = state
  for (let i = 0; i < 30; i++) split = JSON.parse(JSON.stringify(advanceSimulation(split, 1)))
  assert.deepEqual(split.tickets, whole.tickets)
  assert.deepEqual(split.developers, whole.developers)
  assert.equal(split.randomState, whole.randomState)
  let expectedSeed = 1
  for (let i = 0; i < 8; i++) expectedSeed = nextRandom(expectedSeed).state
  assert.equal(whole.randomState, expectedSeed) // three estimates, three schedules, two multi-candidate pickup assessments
  for (const ticket of whole.tickets) {
    assert.equal(ticket.actualStatus, 'done')
    assert.ok(ticket.reportedEffortEstimate! > 0 && ticket.reportedEffortEstimate! <= ticket.requiredWork)
    assert.equal(ticket.initialEffortEstimate?.developerId, state.developers[0].id)
  }
  assert.deepEqual(advanceSimulation(whole, 1, () => { throw Error('Finished work cannot estimate') }).tickets, whole.tickets)
})
