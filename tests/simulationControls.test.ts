import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { compareRank } from '../src/game/rank.ts'
import { reconsiderPriorities } from '../src/game/workDecisions.ts'
import { createSimulationSession, parseSeed, simulationReducer } from '../src/store/simulationControls.ts'
import type { SimulationSession } from '../src/store/simulationControls.ts'
import { decisionFixture, setPublishedEstimate } from './helpers/decisionFixture.ts'

const moveFive = { type: 'reorderTodo', ticketId: 'ticket-5', targetId: 'ticket-2' } as const
const order = (session: SimulationSession) => [...session.game.tickets].sort(compareRank).map(t => t.id)

test('a paused step advances exactly one second without resuming', () => {
  const session = createSimulationSession()
  const result = simulationReducer(session, { type: 'step' })
  assert.equal(result.isPaused, true)
  assert.equal(result.game.simulationTime, session.game.simulationTime + 1)
  assert.deepEqual(result.game, advanceSimulation(session.game, 1))
  assert.deepEqual(session.game, exampleGameState)
})

test('repeated steps match repeated direct simulation calls, including RNG', () => {
  let session = createSimulationSession()
  session = simulationReducer(session, { type: 'applySeed', seed: 1972 })
  let direct = structuredClone(session.game)
  for (let i = 0; i < 15; i++) {
    session = simulationReducer(session, { type: 'step' })
    direct = advanceSimulation(direct, 1)
    assert.deepEqual(session.game, direct)
    assert.equal(session.isPaused, true)
  }
})

test('step is ignored while running; ticks advance only while running', () => {
  const paused = createSimulationSession()
  assert.strictEqual(simulationReducer(paused, { type: 'tick' }), paused)
  const running = simulationReducer(paused, { type: 'togglePause' })
  assert.strictEqual(simulationReducer(running, { type: 'step' }), running)
  const advanced = simulationReducer(running, { type: 'tick' })
  assert.deepEqual(advanced.game, advanceSimulation(running.game, 1))
  assert.equal(advanced.isPaused, false)
  const stopped = simulationReducer(advanced, { type: 'togglePause' })
  assert.strictEqual(simulationReducer(stopped, { type: 'tick' }), stopped)
})

test('restart resets the whole run into paused mode and ignores queued ticks', () => {
  for (const running of [false, true]) {
    let session = createSimulationSession()
    session = simulationReducer(session, { type: 'applySeed', seed: 1972 })
    session = simulationReducer(session, { type: 'step' })
    if (running) session = simulationReducer(session, { type: 'togglePause' })
    const result = simulationReducer(session, { type: 'restart' })
    assert.equal(result.isPaused, true)
    assert.deepEqual(result.game, exampleGameState)
    assert.equal(result.game.randomState, 1)
    assert.strictEqual(simulationReducer(result, { type: 'tick' }), result)
  }
})

test('every restart has fresh nested data, even after a prior run was mutated', () => {
  const original = structuredClone(exampleGameState)
  const first = createSimulationSession()
  first.game.tickets[0].completedWork = 99
  first.game.developers[0].activeTicketID = 'changed'
  first.game.developers[0].competencies.frontend = 0
  const second = simulationReducer(first, { type: 'restart' })
  assert.deepEqual(second.game, original)
  second.game.tickets[0].title = 'Changed again'
  const third = simulationReducer(second, { type: 'restart' })
  assert.deepEqual(third.game, original)
  assert.notStrictEqual(third.game.tickets[0], second.game.tickets[0])
  assert.notStrictEqual(third.game.developers[0], second.game.developers[0])
  assert.notStrictEqual(third.game.developers[0].competencies, second.game.developers[0].competencies)
  assert.deepEqual(exampleGameState, original)
})

test('seed validation accepts unsigned 32-bit decimal integers and rejects invalid input', () => {
  for (const [input, expected] of [['0', 0], ['1', 1], ['1972', 1972], ['4294967295', 4294967295], [' 42 ', 42]] as const) {
    assert.equal(parseSeed(input), expected)
  }
  for (const input of ['', ' ', '-1', '4294967296', '1.5', 'NaN', 'Infinity', '1e3', '0x10', 'hello', '9'.repeat(400)]) {
    assert.equal(parseSeed(input), null, input)
  }
})

test('applying a seed is immutable, paused-only, and preserves all other game data', () => {
  const paused = simulationReducer(createSimulationSession(), { type: 'step' })
  const original = structuredClone(paused)
  const result = simulationReducer(paused, { type: 'applySeed', seed: 0xffffffff })
  assert.deepEqual(result, { ...paused, game: { ...paused.game, randomState: 0xffffffff } })
  assert.deepEqual(paused, original)
  const running = simulationReducer(paused, { type: 'togglePause' })
  assert.strictEqual(simulationReducer(running, { type: 'applySeed', seed: 0 }), running)
  for (const seed of [-1, NaN, Infinity, 0x100000000, 1.5]) {
    assert.strictEqual(simulationReducer(paused, { type: 'applySeed', seed }), paused)
  }
})

test('restart, apply seed, and step sequence replays deterministically under updater repetition', () => {
  const original = createSimulationSession()
  const run = () => {
    let session = simulationReducer(original, { type: 'restart' })
    session = simulationReducer(session, { type: 'applySeed', seed: 1972 })
    for (let i = 0; i < 8; i++) {
      const next = simulationReducer(session, { type: 'step' })
      assert.deepEqual(simulationReducer(session, { type: 'step' }), next)
      session = next
    }
    return session
  }
  assert.deepEqual(run(), run())
  assert.deepEqual(original, createSimulationSession())
})

test('paused ranking edits change only Rank, leaving claims, Flow, estimates, RNG and time frozen', () => {
  for (const initial of [createSimulationSession(), simulationReducer(createSimulationSession(), { type: 'step' })]) {
    const original = structuredClone(initial)
    const todo = [...initial.game.tickets].filter(t => t.reportedStatus === 'todo').sort(compareRank)
    assert.ok(todo.length >= 2)
    const staged = simulationReducer(initial, { type: 'reorderTodo', ticketId: todo.at(-1)!.id, targetId: todo[0].id })
    assert.notDeepEqual(order(staged), order(initial))
    assert.deepEqual(staged.pausedPriorityOrder, order(initial))
    const oldRanks = new Map(initial.game.tickets.map(t => [t.id, t.rank]))
    assert.deepEqual({ ...staged.game, tickets: staged.game.tickets.map(t => ({ ...t, rank: oldRanks.get(t.id) })) }, initial.game)
    assert.strictEqual(staged.game.developers, initial.game.developers)
    assert.strictEqual(simulationReducer(staged, { type: 'tick' }), staged)
    assert.strictEqual(simulationReducer(staged, { type: 'reorderTodo', ticketId: 'missing', targetId: 'ticket-2' }), staged)
    assert.deepEqual(initial, original)
  }
})

test('multiple paused edits coalesce into one net priority decision per affected engineer', () => {
  const initial = createSimulationSession()
  let staged = simulationReducer(initial, moveFive)
  staged = simulationReducer(staged, { type: 'reorderTodo', ticketId: 'ticket-4', targetId: 'ticket-2' })
  assert.deepEqual(staged.pausedPriorityOrder, order(initial))
  assert.deepEqual(staged.game.developers, initial.game.developers)
  const expected = reconsiderPriorities(initial.game, staged.game)
  const resumed = simulationReducer(staged, { type: 'togglePause' })
  // Exact state/history/RNG equality detects extra appraisals or intermediate publications.
  assert.deepEqual(resumed, { game: expected, isPaused: false })
  const pausedAgain = simulationReducer(resumed, { type: 'togglePause' })
  assert.strictEqual(simulationReducer(pausedAgain, { type: 'togglePause' }).game, resumed.game)
})

test('reversing all paused edits cancels the net event without assessments or RNG draws', () => {
  const initial = createSimulationSession()
  let staged = simulationReducer(initial, moveFive)
  staged = simulationReducer(staged, { type: 'reorderTodo', ticketId: 'ticket-5', targetId: 'ticket-4', after: true })
  assert.deepEqual(staged, initial)
  assert.deepEqual(simulationReducer(staged, { type: 'togglePause' }), { ...initial, isPaused: false })
  assert.deepEqual(simulationReducer(staged, { type: 'step' }).game, advanceSimulation(initial.game, 1))
})

test('paused changes confined to ineligible work clear on Resume without any simulation side effects', () => {
  const initial = createSimulationSession()
  // Reported To Do permits ranking, but these tickets are not actual eligible work.
  for (const ticket of initial.game.tickets) if (ticket.reportedStatus === 'todo') ticket.actualStatus = 'backlog'
  const staged = simulationReducer(initial, moveFive)
  assert.ok(staged.pausedPriorityOrder)
  const resumed = simulationReducer(staged, { type: 'togglePause' })
  assert.deepEqual(resumed, { game: staged.game, isPaused: false })
  assert.equal(resumed.game.randomState, 1)
  assert.deepEqual(resumed.game.developers, initial.game.developers)
  assert.deepEqual(resumed.game.tickets.map(t => t.estimateHistory), initial.game.tickets.map(t => t.estimateHistory))
})

test('Step flushes seed-1 priorities once at time zero before any productive work', () => {
  const initial = createSimulationSession(), original = structuredClone(initial)
  const staged = simulationReducer(initial, moveFive)
  assert.equal(staged.game.developers[0].activeTicketID, 'ticket-1')
  assert.equal(staged.game.randomState, 1)
  const atZero = reconsiderPriorities(initial.game, staged.game)
  assert.equal(atZero.developers[0].activeTicketID, 'ticket-5')
  assert.deepEqual(atZero.developers[0].lastAssessment!.at, { high: 0, low: 0 })
  const stepped = simulationReducer(staged, { type: 'step' })
  assert.deepEqual(stepped, { game: advanceSimulation(atZero, 1), isPaused: true })
  const ticket = stepped.game.tickets.find(t => t.id === 'ticket-5')!
  const initialPublication = ticket.estimateHistory!.find(e => e.kind === 'publication')!
  assert.deepEqual(initialPublication.at, { high: 0, low: 0 })
  assert.equal(initialPublication.totalWork, atZero.tickets.find(t => t.id === ticket.id)!.reportedEffortEstimate)
  assert.ok(ticket.completedWork > 0)
  assert.ok(stepped.game.workLog!.some(e => e.developerId === 'developer-1' && e.ticketId === 'ticket-5'))
  assert.ok(stepped.game.workLog!.filter(e => e.developerId === 'developer-1').every(e => e.ticketId === 'ticket-5'))
  assert.deepEqual(simulationReducer(stepped, { type: 'step' }).game, advanceSimulation(stepped.game, 1))
  assert.deepEqual(simulationReducer(staged, { type: 'step' }), stepped)
  assert.deepEqual(initial, original)
})

test('Resume flushes priorities immediately with no work or time, then the first tick only advances work', () => {
  const initial = createSimulationSession(), staged = simulationReducer(initial, moveFive)
  const resumed = simulationReducer(staged, { type: 'togglePause' })
  assert.deepEqual(resumed, { game: reconsiderPriorities(initial.game, staged.game), isPaused: false })
  assert.equal(resumed.game.developers[0].activeTicketID, 'ticket-5')
  assert.equal(resumed.game.developers[0].lastAssessment!.trigger, 'priority')
  assert.equal(resumed.game.randomState, 217083232)
  assert.equal(resumed.game.simulationTime, 0)
  assert.equal(resumed.game.workLog, undefined)
  assert.deepEqual(resumed.game.tickets.map(t => t.completedWork), initial.game.tickets.map(t => t.completedWork))
  assert.strictEqual(simulationReducer(resumed, { type: 'step' }), resumed)
  assert.deepEqual(simulationReducer(resumed, { type: 'tick' }).game, advanceSimulation(resumed.game, 1))
})

test('running edits still reconsider immediately; pausing begins a fresh ordering baseline', () => {
  const initial = createSimulationSession()
  const running = simulationReducer(initial, { type: 'togglePause' })
  const reordered = simulationReducer(running, moveFive)
  assert.equal(reordered.game.developers[0].activeTicketID, 'ticket-5')
  assert.equal(reordered.game.developers[0].lastAssessment!.trigger, 'priority')
  assert.equal(reordered.game.simulationTime, 0)
  assert.equal(reordered.pausedPriorityOrder, undefined)
  const paused = simulationReducer(reordered, { type: 'togglePause' })
  const staged = simulationReducer(paused, { type: 'reorderTodo', ticketId: 'ticket-4', targetId: 'ticket-3' })
  assert.deepEqual(staged.pausedPriorityOrder, order(paused))
  assert.deepEqual(staged.game.developers, paused.game.developers)
  assert.deepEqual(simulationReducer(staged, { type: 'togglePause' }).game, reconsiderPriorities(paused.game, staged.game))
})

test('pending edits survive JSON and seed changes; restart discards them and replay stays deterministic', () => {
  for (const seed of [0, 1, 1972, 0xffffffff]) {
    const initial = createSimulationSession()
    const staged = simulationReducer(simulationReducer(initial, moveFive), { type: 'applySeed', seed })
    const saved: SimulationSession = JSON.parse(JSON.stringify(staged))
    const baseline = { ...initial.game, randomState: seed }
    const expected = reconsiderPriorities(baseline, staged.game)
    assert.deepEqual(simulationReducer(saved, { type: 'togglePause' }), { game: expected, isPaused: false })
    assert.deepEqual(simulationReducer(saved, { type: 'step' }), { game: advanceSimulation(expected, 1), isPaused: true })
    assert.deepEqual(simulationReducer(saved, { type: 'step' }), simulationReducer(staged, { type: 'step' }))
    const restarted = simulationReducer(saved, { type: 'restart' })
    assert.deepEqual(restarted, initial)
    assert.deepEqual(simulationReducer(restarted, { type: 'togglePause' }), { ...initial, isPaused: false })
    assert.deepEqual(saved, staged)
  }
})

test('a deferred net change respects engineer ordering and exclusive claims at the saved instant', () => {
  for (const reversed of [false, true]) {
    const game = decisionFixture()
    game.simulationTime = 7
    game.developers.push({ ...game.developers[0], id: 'b', activeTicketID: 'second' })
    game.tickets.push({ ...game.tickets[0], id: 'second', rank: 2, estimateHistory: [] })
    for (const [id, rank] of [['left', 3], ['middle', 4], ['right', 5]] as const) {
      game.tickets.push({ ...game.tickets[0], id, rank, actualStatus: 'todo', reportedStatus: 'todo', requiredWork: 1, estimateHistory: [] })
    }
    for (const ticket of game.tickets) for (const developer of game.developers) setPublishedEstimate(ticket, developer.id)
    if (reversed) game.developers.reverse()
    const initial = { game, isPaused: true }
    let staged = simulationReducer(initial, { type: 'reorderTodo', ticketId: 'right', targetId: 'left' })
    staged = simulationReducer(staged, { type: 'reorderTodo', ticketId: 'middle', targetId: 'left' })
    assert.deepEqual(staged.game.developers, initial.game.developers)
    const resumed = simulationReducer(JSON.parse(JSON.stringify(staged)), { type: 'togglePause' })
    assert.deepEqual(resumed.game, reconsiderPriorities(game, staged.game))
    assert.deepEqual(resumed.game.developers.map(d => d.activeTicketID), ['right', 'middle'])
    assert.equal(new Set(resumed.game.developers.map(d => d.activeTicketID)).size, 2)
    for (const developer of resumed.game.developers) {
      assert.equal(developer.lastAssessment!.trigger, 'priority')
      assert.deepEqual(developer.lastAssessment!.at, { high: 7, low: 0 })
    }
    assert.equal(resumed.game.simulationTime, 7)
    assert.ok(resumed.game.tickets.every(t => t.completedWork === 0))
  }
})
