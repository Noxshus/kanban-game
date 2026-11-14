import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { createSimulationSession, parseSeed, simulationReducer } from '../src/store/simulationControls.ts'

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
  const second = simulationReducer(first, { type: 'restart' })
  assert.deepEqual(second.game, original)
  second.game.tickets[0].title = 'Changed again'
  const third = simulationReducer(second, { type: 'restart' })
  assert.deepEqual(third.game, original)
  assert.notStrictEqual(third.game.tickets[0], second.game.tickets[0])
  assert.notStrictEqual(third.game.developers[0], second.game.developers[0])
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
