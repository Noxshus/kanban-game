import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createElement, isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import type { BoardActivity } from '../src/game/boardActivity.ts'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { boardReducer, createDevelopmentBoardSession } from '../src/store/boardSession.ts'
import { filterDiagnosticActivity } from '../src/game/simulationActivity.ts'

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}

const events: BoardActivity[] = Array.from({ length: 5 }, (_, i) => ({
  id: i + 1, ticketId: `ticket-${i + 1}`, ticketTitle: `Title ${i + 1}`,
  at: { high: i + .25, low: 0 }, kind: 'estimate', from: i === 0 ? null : 1, to: i + 2,
}))

// A small hook host uses the existing Vite transforms and actual GameBoard tree.
// This exercises its state, effects, row handlers and rendered card classes without
// adding a DOM package or putting test seams in production components.
async function mountedBoard(component = 'GameBoard') {
  const hookId = 'virtual:board-test-hooks'
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom', plugins: [{
    name: 'board-test-hook-host', enforce: 'pre',
    resolveId(id) { if (id === hookId) return '\0' + hookId },
    load(id) {
      if (id !== '\0' + hookId) return
      return `
        const slots = []; let cursor = 0, dirty = false, pending = [];
        export function useState(initial) {
          const index = cursor++;
          if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
          return [slots[index], value => {
            const next = typeof value === 'function' ? value(slots[index]) : value;
            if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
          }];
        }
        export function useRef(value) {
          const index = cursor++; return slots[index] ??= { current: value };
        }
        export function useId() { return useRef('manager-view-test').current; }
        export function useSyncExternalStore(subscribe, getSnapshot) {
          const [, update] = useState(0);
          useEffect(() => subscribe(() => update(value => value + 1)), [subscribe]);
          return getSnapshot();
        }
        export function useEffect(effect, dependencies) {
          const index = cursor++, previous = slots[index];
          if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
            slots[index] = { dependencies, cleanup: previous?.cleanup };
            pending.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); });
          }
        }
        export function render(component, props) {
          for (let i = 0; i < 20; i++) {
            dirty = false; cursor = 0;
            const tree = component(props), jobs = pending; pending = [];
            jobs.forEach(job => job());
            if (!dirty) return tree;
          }
          throw Error('Component did not settle');
        }
        export function unmount() { slots.forEach(slot => slot?.cleanup?.()); }
      `
    },
    transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/components/GameBoard.tsx')) {
        return code.replace("import { useEffect, useRef, useState, useSyncExternalStore } from 'react'", `import { useEffect, useRef, useState, useSyncExternalStore } from '${hookId}'`)
      }
      if (id.replaceAll('\\', '/').endsWith('/src/components/TicketObservations.tsx')) {
        return code.replace("import { useId, useState } from 'react'", `import { useId, useState } from '${hookId}'`)
      }
    },
  }] })
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let now = 0, nextTimer = 1
  const timers = new Map<number, { at: number; run: () => void }>()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    performance: { now: () => now },
    setTimeout(run: () => void, delay: number) { const id = nextTimer++; timers.set(id, { at: now + delay, run }); return id },
    clearTimeout(id: number) { timers.delete(id) },
  } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { addEventListener() {}, removeEventListener() {} } })
  const { GameBoard } = await server.ssrLoadModule('/src/components/GameBoard.tsx')
  const { ManagerView } = await server.ssrLoadModule('/src/components/TicketObservations.tsx')
  const hooks = await server.ssrLoadModule(hookId)
  return {
    render: (props: Record<string, unknown>) => hooks.render(component === 'ManagerView' ? ManagerView : GameBoard, props),
    advance(ms: number) {
      now += ms
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.run() }
    },
    async close() {
      hooks.unmount()
      assert.equal(timers.size, 0, 'All feedback timers must be cleaned up')
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window')
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else Reflect.deleteProperty(globalThis, 'document')
      await server.close()
    },
  }
}

function boardRows(tree: ReactNode) {
  const log = elements(tree).find(node => typeof node.type === 'function' && node.type.name === 'BoardActivityLog')!
  return elements((log.type as (props: unknown) => ReactNode)(log.props)).filter(node => node.type === 'button')
}
function rowHandlers(tree: ReactNode, ticketId: string) {
  return boardRows(tree).find(row => String(row.props['aria-label']).startsWith(ticketId + ':'))!.props as Record<string, () => void>
}
function highlighted(tree: ReactNode) {
  return elements(tree).filter(node => node.type === 'li' && String(node.props.className).split(' ').includes('activity-target'))
    .map(node => String(node.props['aria-label']).split(':')[0])
}

test('GameBoard lets the latest hover or keyboard focus win and handles independent exits', async () => {
  const board = await mountedBoard()
  try {
    const props = { view: getPlayerView(exampleGameState), activity: events }
    let tree = board.render(props)
    const first = rowHandlers(tree, 'ticket-1'), second = rowHandlers(tree, 'ticket-2')
    first.onMouseEnter(); tree = board.render(props); assert.deepEqual(highlighted(tree), ['ticket-1'])
    second.onFocus(); tree = board.render(props); assert.deepEqual(highlighted(tree), ['ticket-2'])
    first.onMouseMove(); tree = board.render(props); assert.deepEqual(highlighted(tree), ['ticket-1'])
    second.onFocus(); tree = board.render(props); assert.deepEqual(highlighted(tree), ['ticket-2'])
    first.onMouseLeave(); tree = board.render(props); assert.deepEqual(highlighted(tree), ['ticket-2'])
    first.onMouseEnter(); tree = board.render(props); assert.deepEqual(highlighted(tree), ['ticket-1'])
    first.onMouseLeave(); tree = board.render(props); assert.deepEqual(highlighted(tree), ['ticket-2'])
    second.onBlur(); tree = board.render(props); assert.deepEqual(highlighted(tree), [])
    first.onMouseEnter(); second.onFocus(); tree = board.render(props); assert.deepEqual(highlighted(tree), ['ticket-2'])
    second.onBlur(); tree = board.render(props); assert.deepEqual(highlighted(tree), ['ticket-1'])
    first.onMouseLeave(); tree = board.render(props); assert.deepEqual(highlighted(tree), [])
    first.onMouseEnter(); first.onFocus(); tree = board.render(props); assert.deepEqual(highlighted(tree), ['ticket-1'])
    first.onMouseLeave(); tree = board.render(props); assert.deepEqual(highlighted(tree), ['ticket-1'])
    first.onBlur(); tree = board.render(props); assert.deepEqual(highlighted(tree), [])
    second.onFocus(); first.onBlur(); tree = board.render(props); assert.deepEqual(highlighted(tree), ['ticket-2'])
    const navigation: unknown[] = []
    const card = elements(tree).find(node => node.type === 'li' && String(node.props['aria-label']).startsWith('ticket-2:'))!
    ;(card.props.ref as (node: unknown) => void)({ scrollIntoView: (o: unknown) => navigation.push(o), focus: (o: unknown) => navigation.push(o) })
    assert.deepEqual(navigation, [])
    rowHandlers(tree, 'ticket-2').onClick()
    assert.deepEqual(navigation, [{ block: 'center', behavior: 'instant' }, { preventScroll: true }])
  } finally { await board.close() }
})

test('GameBoard invalidates the originating row on filtering, eviction and Restart without resurrection', async () => {
  const board = await mountedBoard()
  try {
    const base = { view: getPlayerView(exampleGameState), activity: events }
    let tree = board.render(base)
    rowHandlers(tree, 'ticket-1').onMouseEnter(); tree = board.render(base)
    assert.deepEqual(highlighted(tree), ['ticket-1'])
    const evicted = { ...base, activity: events.slice(1) }
    tree = board.render(evicted); assert.deepEqual(highlighted(tree), [])
    tree = board.render(base); assert.deepEqual(highlighted(tree), [])
    const rows = events.map(event => ({ id: `diagnostic-${event.id}`, ticketId: event.ticketId, ticketTitle: event.ticketTitle, at: event.at, text: 'DEV assessment' }))
    const diagnostic = { ...base, activityDisplay: { rows } }
    tree = board.render(diagnostic)
    rowHandlers(tree, 'ticket-2').onFocus(); tree = board.render(diagnostic)
    assert.deepEqual(highlighted(tree), ['ticket-2'])
    tree = board.render({ ...diagnostic, activityDisplay: { rows: rows.filter(row => row.ticketId !== 'ticket-2') } })
    assert.deepEqual(highlighted(tree), []) // Other rows and public ticket-2 events still exist.
    tree = board.render(diagnostic); assert.deepEqual(highlighted(tree), [])
    rowHandlers(tree, 'ticket-1').onMouseEnter(); tree = board.render(diagnostic)
    assert.deepEqual(highlighted(tree), ['ticket-1'])
    tree = board.render({ ...base, activity: [] }); assert.deepEqual(highlighted(tree), [])
    tree = board.render(base); assert.deepEqual(highlighted(tree), []) // Reused post-Restart event IDs are silent.
  } finally { await board.close() }
})

test('GameBoard emphasis expires after five running seconds, retriggers and clears its timers on Restart', async () => {
  const board = await mountedBoard()
  try {
    const view = getPlayerView(exampleGameState), initial = { view, isPaused: false, activity: [] as BoardActivity[] }
    view.tickets[0].reportedEffortEstimate = events[0].to as number
    board.render(initial)
    const event = events[0], updated = { view, isPaused: false, activity: [event] }
    const cues = (tree: ReactNode) => elements(tree).filter(node => typeof node.type === 'function' && node.type.name === 'BoardEmphasis').length
    assert.equal(cues(board.render(updated)), 1)
    board.advance(4999); assert.equal(cues(board.render(updated)), 1)
    board.advance(1); assert.equal(cues(board.render(updated)), 0)
    const newer = { view, isPaused: false, activity: [event, { ...event, id: 6, to: 9 }] }
    assert.equal(cues(board.render(newer)), 1)
    board.advance(1000); assert.equal(cues(board.render(newer)), 1)
    assert.equal(cues(board.render(initial)), 0)
    board.advance(1000); assert.equal(cues(board.render(initial)), 0)
    assert.equal(cues(board.render(updated)), 1) // A genuinely new run can show new events with IDs starting at 1.
  } finally { await board.close() }
})

test('GameBoard Step cues freeze while paused and Resume consumes only their remaining active time', async () => {
  const board = await mountedBoard()
  try {
    let session = boardReducer(createDevelopmentBoardSession(), { type: 'startSprint' })
    const props = () => ({ view: getPlayerView(session.simulation.game), activity: session.activity, isPaused: session.simulation.isPaused })
    const cues = (tree: ReactNode) => elements(tree).filter(node => typeof node.type === 'function' && node.type.name === 'BoardEmphasis')
    board.render(props())
    session = boardReducer(session, { type: 'step' })
    const count = cues(board.render(props())).length
    assert.ok(count > 0)
    assert.ok(cues(board.render(props())).every(node => node.props.isPaused === true))
    board.advance(60000); assert.equal(cues(board.render(props())).length, count)
    session = boardReducer(session, { type: 'togglePause' })
    board.render(props())
    board.advance(2000)
    session = boardReducer(session, { type: 'togglePause' })
    assert.ok(cues(board.render(props())).every(node => node.props.elapsedMs === 2000))
    board.advance(60000); assert.equal(cues(board.render(props())).length, count)
    session = boardReducer(session, { type: 'togglePause' })
    board.render(props())
    board.advance(2999); assert.equal(cues(board.render(props())).length, count)
    board.advance(1); assert.equal(cues(board.render(props())).length, 0)
    session = boardReducer(session, { type: 'restart' })
    assert.equal(cues(board.render(props())).length, 0)
  } finally { await board.close() }
})

test('Manager View exposes the same evidence on hover, keyboard focus and activation with consistent dismissal', async () => {
  const manager = await mountedBoard('ManagerView')
  try {
    const props = { estimateUnknown: true }
    const nodes = () => elements(manager.render(props))
    const button = () => nodes().find(node => node.type === 'button')!.props as Record<string, () => void>
    const panel = () => nodes().find(node => node.props.role === 'region')!
    const wrapper = () => nodes()[0].props as Record<string, (event?: unknown) => void>
    assert.equal(panel().props.hidden, true)
    wrapper().onMouseEnter(); assert.equal(panel().props.hidden, false)
    wrapper().onMouseLeave({ currentTarget: { contains: () => false } }); assert.equal(panel().props.hidden, true)
    button().onFocus(); assert.equal(panel().props.hidden, false)
    wrapper().onMouseLeave({ currentTarget: { contains: () => true } }); assert.equal(panel().props.hidden, false)
    wrapper().onBlur({ currentTarget: { contains: () => true }, relatedTarget: {} }); assert.equal(panel().props.hidden, false)
    wrapper().onKeyDown({ key: 'Escape' }); assert.equal(panel().props.hidden, true)
    button().onClick(); assert.equal(panel().props.hidden, false)
    wrapper().onBlur({ currentTarget: { contains: () => false }, relatedTarget: null }); assert.equal(panel().props.hidden, true)
    assert.equal(nodes().filter(node => node.type === 'button').length, 1)
    assert.equal(nodes().find(node => node.type === 'button')!.props['aria-controls'], panel().props.id)
  } finally { await manager.close() }
})

test('activity entry handlers associate hover/focus without navigation, and activation focuses the ticket', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  try {
    const { BoardActivityLog } = await server.ssrLoadModule('/src/components/BoardActivity.tsx')
    const { focusActivityTicket, describeActivity, formatActivityTime } = await server.ssrLoadModule('/src/components/boardActivityPresentation.ts')
    const hovered: (string | null)[] = [], focused: (string | null)[] = [], activated: string[] = []
    const tree = BoardActivityLog({ events, engineers: [], onHover: (id: string | null) => hovered.push(id),
      onFocus: (id: string | null) => focused.push(id), onActivate: (id: string) => activated.push(id) })
    const rows = elements(tree).filter(node => node.type === 'button')
    assert.equal(rows.length, 5) // Every retained entry in one newest-first list.
    assert.equal(new Set(rows.map(node => node.props['aria-label'])).size, 5)
    assert.ok(String(rows[0].props['aria-label']).startsWith('ticket-5: Title 5.'))
    const first = rows[0].props as Record<string, () => void>
    first.onMouseEnter(); first.onFocus()
    assert.deepEqual(hovered, ['ticket-5']); assert.deepEqual(focused, ['ticket-5']); assert.deepEqual(activated, [])
    first.onClick(); assert.deepEqual(activated, ['ticket-5'])
    first.onMouseLeave(); first.onBlur()
    assert.deepEqual(hovered, ['ticket-5', null]); assert.deepEqual(focused, ['ticket-5', null])
    const navigation: unknown[] = []
    focusActivityTicket({ scrollIntoView: (options: unknown) => navigation.push(options), focus: (options: unknown) => navigation.push(options) })
    assert.deepEqual(navigation, [{ block: 'center', behavior: 'instant' }, { preventScroll: true }])
    focusActivityTicket(undefined); assert.equal(navigation.length, 2)
    const html = renderToStaticMarkup(tree)
    assert.match(html, /<aside class="board-activity" aria-labelledby="activity-heading">/)
    assert.equal(elements(tree).filter(node => node.type === 'ol').length, 1)
    assert.ok(!html.includes('<details') && !html.includes('History (') && !html.includes('activity-recent'))
    assert.ok(html.includes('Latest 100 events'))
    assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/)
    assert.ok(html.includes('4.3s'))
    const exact = { high: 3.7846495520244496, low: 1e-17 }, preserved = structuredClone(exact)
    assert.equal(formatActivityTime(exact), '3.8s')
    assert.deepEqual(exact, preserved)
    assert.equal(formatActivityTime({ high: 1, low: 1e-17 }), '1s')
    assert.equal(formatActivityTime({ high: Number.MIN_VALUE, low: 0 }), '0s')
    assert.equal(formatActivityTime({ high: 1e20, low: 0 }), '1E20s')
    const hundred = Array.from({ length: 100 }, (_, i) => ({ ...events[0], id: i + 1, ticketId: `ticket-${i + 1}` }))
    const full = BoardActivityLog({ events: hundred, engineers: [], onHover: () => {}, onFocus: () => {}, onActivate: () => {} })
    const fullRows = elements(full).filter(node => node.type === 'button')
    assert.equal(fullRows.length, 100)
    assert.ok(String(fullRows[0].props['aria-label']).startsWith('ticket-100:'))
    assert.ok(String(fullRows[99].props['aria-label']).startsWith('ticket-1:'))
    const assignment = describeActivity({ ...events[0], kind: 'assignment', from: 'a', to: 'b' }, [{ id: 'a', name: 'Alex' }, { id: 'b', name: 'Sam' }])
    assert.equal(assignment, 'Assigned to Sam (previously Alex)')
    assert.ok(!assignment.includes('working') && !assignment.includes('started'))
  } finally { await server.close() }
})

test('activity and finite feedback render from public reports, retain drag hooks and respect reduced motion', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  try {
    const { GameBoard } = await server.ssrLoadModule('/src/components/GameBoard.tsx')
    const { BoardEmphasis } = await server.ssrLoadModule('/src/components/BoardEmphasis.tsx')
    const state = structuredClone(exampleGameState)
    state.tickets[0].reportedStatus = 'done' // Event targeting follows identity, not the old column.
    state.tickets[0].actualStatus = 'in_progress'
    const activity = [events[0], { ...events[0], id: 6, kind: 'status', from: 'todo', to: 'done' }] as BoardActivity[]
    const html = renderToStaticMarkup(createElement(GameBoard, { view: getPlayerView(state), activity }))
    assert.ok(html.includes('Board Activity'))
    assert.ok(html.indexOf('class="board"') < html.indexOf('<aside class="board-activity"'))
    assert.ok(html.includes('class="board-workspace"') && html.includes('class="board-content"'))
    assert.ok(!html.includes('board-emphasis')) // Mounting/restoring old activity must not replay cues.
    const valueCue = renderToStaticMarkup(createElement(BoardEmphasis, { kind: 'estimate' }, '8.5'))
    assert.ok(valueCue.includes('board-emphasis emphasis-estimate'))
    assert.ok(valueCue.includes('Updated'))
    assert.ok(renderToStaticMarkup(createElement(BoardEmphasis, { kind: 'status' })).includes('aria-hidden="true"'))
    const pausedCue = renderToStaticMarkup(createElement(BoardEmphasis, { kind: 'status', isPaused: true, elapsedMs: 2000 }))
    assert.ok(pausedCue.includes('animation-play-state:paused') && pausedCue.includes('animation-delay:-2000ms'))
    const runningCue = renderToStaticMarkup(createElement(BoardEmphasis, { kind: 'status', isPaused: false, elapsedMs: 2000 }))
    assert.ok(runningCue.includes('animation-play-state:running') && runningCue.includes('animation-delay:-2000ms'))
    assert.match(html, /tabindex="-1" aria-label="ticket-1: Build the navigation menu"/)
    assert.match(html, /data-todo-ticket="ticket-2" draggable="true"/)
    for (const text of ['Actual work:', 'Discipline:', 'lastEstimateEvaluation', 'actualStatus']) assert.ok(!html.includes(text))
    const quiet = renderToStaticMarkup(createElement(GameBoard, { view: getPlayerView(state) }))
    assert.ok(!quiet.includes('board-emphasis'))
    assert.ok(quiet.includes('No board changes yet.'))
    const css = readFileSync('src/App.css', 'utf8')
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.emphasis-status\s*\{\s*animation: none;/)
    assert.match(css, /\.emphasis-status[^}]*pointer-events: none/)
    assert.match(css, /\.emphasis-status[^}]*animation: board-change-fade 5s/)
    assert.match(css, /\.ticket\.activity-target, \.ticket:focus/)
    assert.match(css, /\.board-workspace[^}]*grid-template-columns: minmax\(0, 1fr\) 280px/)
    assert.match(css, /\.activity-list\s*\{[^}]*max-height:[^}]*overflow-y: auto/)
    assert.match(css, /@media \(max-width: 1000px\)\s*\{\s*\.board-workspace \{ grid-template-columns: minmax\(0, 1fr\)/)
  } finally { await server.close() }
})

test('DEV rows reuse the sidebar interactions and expose missed-report details only when explicitly supplied', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  try {
    const { BoardActivityLog } = await server.ssrLoadModule('/src/components/BoardActivity.tsx')
    const { describeDiagnosticActivity } = await server.ssrLoadModule('/src/components/developmentActivityPresentation.ts')
    const initial = boardReducer(createDevelopmentBoardSession(), { type: 'startSprint' })
    initial.simulation.game.randomState = 87 // Populated public reports AND a failed effort report with #87 draws.
    const session = boardReducer(initial, { type: 'step' })
    const filtered = filterDiagnosticActivity(session.diagnosticActivity!, { assessments: true, decisions: true, noopReviews: false })
    const rows = filtered.map(event => describeDiagnosticActivity(event, session.simulation.game.developers))
    const missed = rows.find(row => row.text.includes('report missed'))!
    assert.ok(missed && missed.internal)
    assert.ok(missed.text.includes('candidate') && missed.details!.includes('Reporting draw'))
    const hovered: (string | null)[] = [], focused: (string | null)[] = [], activated: string[] = []
    const props = { events: session.activity, engineers: session.simulation.game.developers,
      onHover: (id: string | null) => hovered.push(id), onFocus: (id: string | null) => focused.push(id), onActivate: (id: string) => activated.push(id) }
    const tree = BoardActivityLog({ ...props, display: { rows } })
    const row = elements(tree).find(node => node.type === 'button' && String(node.props['aria-label']).includes(missed.text))!
    const handlers = row.props as Record<string, () => void>
    handlers.onMouseEnter(); handlers.onFocus()
    assert.deepEqual(hovered, [missed.ticketId]); assert.deepEqual(focused, [missed.ticketId]); assert.deepEqual(activated, [])
    handlers.onClick(); assert.deepEqual(activated, [missed.ticketId])
    const html = renderToStaticMarkup(tree)
    assert.ok(html.includes('DEV diagnostics') && html.includes('activity-internal') && html.includes('DEV · '))
    assert.equal(elements(tree).filter(node => node.type === 'ol').length, 1)
    const publicOnly = renderToStaticMarkup(BoardActivityLog(props))
    for (const hidden of ['report missed', 'candidate', 'Reporting draw', 'activity-internal', 'DEV diagnostics']) assert.ok(!publicOnly.includes(hidden))
  } finally { await server.close() }
})
