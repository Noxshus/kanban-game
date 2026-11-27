import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { createServer } from 'vite'
import type { GameState } from '../src/game/types'
import type { SprintAction, SprintState } from '../src/store/sprintSession'
import { decisionFixture } from './helpers/decisionFixture.ts'

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}

// Exercise the real App and both Pause entry points with controlled monotonic
// time. As in boardActivityUI, Vite supplies JSX and a small hook host avoids a DOM dependency.
async function mountedApp(game?: GameState) {
  const hookId = 'virtual:playback-test-hooks'
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom', plugins: [{
    name: 'playback-hook-host', enforce: 'pre',
    resolveId(id) { if (id === hookId) return '\0' + hookId },
    load(id) {
      if (id !== '\0' + hookId) return
      return `
        const records = new Map(); let current, cursor;
        export function useState(initial) {
          const record = current, i = cursor++;
          if (!(i in record.slots)) record.slots[i] = typeof initial === 'function' ? initial() : initial;
          return [record.slots[i], value => { record.slots[i] = typeof value === 'function' ? value(record.slots[i]) : value; }];
        }
        let fixture;
        export function setFixture(game) { fixture = game; }
        export function useReducer(reducer, arg, init) {
          const [state, set] = useState(() => { const value = init ? init(arg) : arg; if (fixture) value.simulation.game = fixture; return value; });
          const dispatch = useRef(action => set(previous => reducer(previous, action))).current;
          return [state, dispatch];
        }
        export function useRef(value) { const i = cursor++; return current.slots[i] ??= { current: value }; }
        export function useEffect(effect, deps) {
          const i = cursor++, record = current, previous = record.slots[i];
          if (!previous || deps.some((value, n) => !Object.is(value, previous.deps[n]))) {
            record.pending.push(() => { previous?.cleanup?.(); record.slots[i] = { deps, cleanup: effect() }; });
          }
        }
        export function render(Component, props) {
          current = records.get(Component) ?? { slots: [], pending: [] }; records.set(Component, current); cursor = 0;
          const tree = Component(props); for (const run of current.pending.splice(0)) run(); return tree;
        }
        export function unmount() {
          for (const record of records.values()) for (const slot of record.slots) slot?.cleanup?.(); records.clear();
        }
      `
    },
    transform(code, id) {
      if (/src[/\\](App|components[/\\]DevelopmentUI)\.tsx$/.test(id)) return code.replace(/from ['"]react['"]/g, `from '${hookId}'`)
    },
  }] })
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const oldPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance')
  let now = 0, nextId = 0
  const timers = new Map<number, () => void>(), stale: (() => void)[] = []
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setInterval(run: () => void) { timers.set(++nextId, run); return nextId },
    clearInterval(id: number) { const run = timers.get(id); if (run) stale.push(run); timers.delete(id) },
  } })
  const { default: App } = await server.ssrLoadModule('/src/App.tsx')
  const hooks = await server.ssrLoadModule(hookId)
  if (game) hooks.setFixture(structuredClone(game))
  const application = App()
  const render = () => hooks.render(application.type, application.props) as ReactNode
  const dev = () => elements(render()).find(node => typeof node.type === 'function' && node.type.name === 'DevelopmentUI')!
  const headerPause = () => elements(render()).find(node => node.type === 'button')!.props.onClick as () => void
  const toolbar = () => hooks.render(dev().type, dev().props) as ReactNode
  const floatingPause = () => elements(toolbar()).find(node => node.props['aria-label'] === 'Pause simulation' || node.props['aria-label'] === 'Resume simulation')!.props.onClick as () => void
  return {
    render, dev, timers, stale,
    screen: () => elements((dev().props.children as (diagnostics: null, display: object) => ReactNode)(null, {}))
      .filter(node => typeof node.type === 'function').map(node => (node.type as { name: string }).name),
    headerButtons: () => elements(render()).filter(node => node.type === 'button'),
    time: () => (dev().props.state as { simulationTime: number }).simulationTime,
    elapse(ms: number) { now += ms },
    callback() { for (const run of [...timers.values()]) run(); render() },
    pause: (floating: boolean) => (floating ? floatingPause() : headerPause())(),
    start() {
      const button = elements(toolbar()).find(node => node.type === 'button' && node.props.children === 'Start prototype sprint')!
      ;(button.props.onClick as () => void)(); render()
    },
    action(action: string | SprintAction) { (dev().props.dispatch as (action: SprintAction) => void)(typeof action === 'string' ? { type: action } as SprintAction : action); render() },
    async close() {
      hooks.unmount(); assert.equal(timers.size, 0)
      if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window')
      if (oldPerformance) Object.defineProperty(globalThis, 'performance', oldPerformance)
      await server.close()
    },
  }
}

test('both actual Pause controls settle partial monotonic intervals and exclude paused time on Resume', async () => {
  for (const floating of [false, true]) {
    const app = await mountedApp()
    try {
      app.elapse(10000); assert.equal(app.time(), 0); assert.equal(app.timers.size, 0)
      app.start(); app.pause(floating); app.render() // Resume
      app.elapse(500); app.pause(floating); app.render()
      assert.equal(app.time(), .5)
      app.elapse(60000); app.stale.forEach(run => run()); assert.equal(app.time(), .5)
      app.pause(!floating); app.render(); app.elapse(2500); app.callback()
      assert.equal(app.time(), 3)
      app.elapse(250); app.pause(!floating); app.render(); assert.equal(app.time(), 3.25)
      app.action('step'); assert.equal(app.time(), 4.25)
    } finally { await app.close() }
  }
})

test('phase alone selects dedicated Planning and Execution screens without resetting shared simulation state', async () => {
  const app = await mountedApp()
  try {
    assert.deepEqual(app.screen(), ['SprintPlanning'])
    assert.equal(app.headerButtons().length, 0)
    app.action({ type: 'addEstimation', ticketId: 'ticket-6' })
    app.action('resolveEstimation')
    const planned = structuredClone(app.dev().props.state)
    const planning = structuredClone((app.dev().props.sprint as SprintState).planning)
    assert.equal(planning!.stage, 'estimated')
    assert.deepEqual(app.screen(), ['SprintPlanning']) // Resolution does not enter Execution.
    app.start()
    assert.deepEqual(app.dev().props.state, planned)
    assert.deepEqual((app.dev().props.sprint as SprintState).planning, planning)
    assert.deepEqual(app.screen(), ['GameBoard'])
    assert.equal(app.headerButtons().length, 1)
    assert.equal(app.headerButtons()[0].props.children, 'Resume')
    app.action('step')
    assert.equal(app.time(), 1)
    assert.deepEqual((app.dev().props.sprint as SprintState).planning, planning)
    assert.deepEqual(app.screen(), ['GameBoard'])
    app.pause(false); app.render()
    app.elapse(240000); app.callback()
    assert.equal(app.time(), 240)
    assert.deepEqual(app.screen(), ['SprintPlanning'])
    assert.equal(app.headerButtons().length, 0)
    const frozen = structuredClone(app.dev().props.state)
    app.elapse(60000); app.callback()
    assert.deepEqual(app.dev().props.state, frozen)
    assert.equal(app.timers.size, 0)
    app.action('restart')
    assert.deepEqual(app.screen(), ['SprintPlanning'])
    assert.equal(app.time(), 0)
  } finally { await app.close() }
})

test('player commitment starts paused Execution, preserves the forecast as hypothetical, and ends at the #98 prototype boundary', async () => {
  const app = await mountedApp()
  try {
    const original = structuredClone(app.dev().props.state as GameState)
    app.action('resolveEstimation')
    app.action({ type: 'addCommitment', ticketId: 'ticket-7' })
    assert.deepEqual(app.dev().props.state, original)
    app.action('commitSprint')
    const committed = app.dev().props.state as GameState
    assert.deepEqual(committed.committedTicketIds, ['ticket-7'])
    assert.deepEqual(committed.developers, original.developers)
    assert.equal(app.time(), 0); assert.equal(app.timers.size, 0)
    assert.equal(app.dev().props.isPaused, true)
    assert.deepEqual(app.screen(), ['GameBoard'])
    app.action('step')
    const advanced = app.dev().props.state as GameState
    assert.deepEqual(advanced.tickets.slice(0, 5), original.tickets.slice(0, 5))
    app.pause(false); app.render(); app.elapse(240000); app.callback()
    assert.deepEqual(app.screen(), ['SprintPlanning']); assert.equal(app.time(), 240)
    assert.deepEqual((app.dev().props.state as GameState).committedTicketIds, ['ticket-7'])
    const frozen = structuredClone(app.dev().props.state)
    app.action('commitSprint'); app.action('startSprint')
    assert.deepEqual(app.dev().props.state, frozen)
    assert.equal((app.dev().props.sprint as SprintState).phase, 'planning')
  } finally { await app.close() }
})

test('delayed browser callbacks count actual elapsed time once, cap the sprint and cannot resurrect timers', async () => {
  const app = await mountedApp()
  try {
    app.start(); app.pause(false); app.render()
    app.elapse(3750); app.callback(); assert.equal(app.time(), 3.75)
    app.callback(); assert.equal(app.time(), 3.75)
    app.elapse(300000); app.callback(); assert.equal(app.time(), 240)
    assert.equal(app.dev().props.isPaused, true); assert.equal(app.timers.size, 0)
    app.elapse(10000); app.stale.forEach(run => run()); assert.equal(app.time(), 240)
    app.action('restart'); app.stale.forEach(run => run()); assert.equal(app.time(), 0)
    app.start(); app.pause(false); app.render(); app.stale.forEach(run => run()); assert.equal(app.time(), 0)
  } finally { await app.close() }
})

test('second review: browser native-millisecond partitions preserve sprint phase and seeded review outcomes through both Pause controls', async () => {
  for (const total of [1550, 240000]) for (const floating of [false, true]) {
    const game = decisionFixture()
    game.developers[0].estimateReview!.dueTime = { high: 1.55, low: 0 }
    const results: unknown[] = []
    for (const parts of [[total], total === 1550 ? [1250, 300] : [239700, 300]]) {
      const app = await mountedApp(game)
      try {
        app.start(); app.pause(floating); app.render()
        for (const [index, ms] of parts.entries()) {
          app.elapse(ms)
          if (index < parts.length - 1) app.callback()
        }
        app.pause(floating); app.render()
        results.push({ game: app.dev().props.state, phase: (app.dev().props.sprint as { phase: string }).phase })
        assert.equal((app.dev().props.state as GameState).tickets[0].lastEstimateEvaluation?.reason, total === 1550 ? 'review' : 'completion')
        if (total === 1550) assert.equal((app.dev().props.state as GameState).randomState, 1015568748)
        else assert.equal((app.dev().props.sprint as { phase: string }).phase, 'planning')
      } finally { await app.close() }
    }
    assert.deepEqual(results[0], results[1])
  }
})
