import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BoardActivity } from '../src/game/boardActivity'
import { createBoardEmphasisClock, EMPHASIS_DURATION_MS } from '../src/components/boardEmphasisClock.ts'

const event = (id: number, ticketId = 'ticket'): BoardActivity => ({ id, ticketId, ticketTitle: ticketId,
  at: { high: id, low: 0 }, kind: 'estimate', from: id - 1, to: id })
function fixture(initial: BoardActivity[] = []) {
  let now = 0, id = 0, notifications = 0
  const timers = new Map<number, { run: () => void; at: number }>()
  const callbacks: (() => void)[] = []
  const clock = createBoardEmphasisClock(initial, {
    now: () => now,
    setTimeout(run, delay) { callbacks.push(run); timers.set(++id, { run, at: now + delay }); return id },
    clearTimeout(id) { timers.delete(id) },
  })
  clock.subscribe(() => notifications++)
  return { clock, timers, callbacks, notifications: () => notifications,
    advance(ms: number) {
      now += ms
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.run() }
    } }
}

test('emphasis lasts five running wall-clock seconds and initial/restored history is silent', () => {
  assert.equal(EMPHASIS_DURATION_MS, 5000)
  const f = fixture([event(1)])
  f.clock.update([event(1)], false)
  assert.deepEqual(f.clock.ids(), [])
  f.clock.update([event(1), event(2)], false)
  assert.deepEqual(f.clock.ids(), [2])
  const snapshot = f.clock.getSnapshot()
  assert.strictEqual(f.clock.getSnapshot(), snapshot)
  f.advance(4999); assert.deepEqual(f.clock.ids(), [2])
  assert.strictEqual(f.clock.getSnapshot(), snapshot) // No render-driven snapshots or timers.
  f.advance(1); assert.deepEqual(f.clock.ids(), [])
  assert.equal(f.notifications(), 3)
  f.clock.update([event(1), event(2)], false)
  assert.deepEqual(f.clock.ids(), [])
})

test('pausing freezes the remaining budget and repeated paused updates never spend display time', () => {
  const f = fixture(), history = [event(1)]
  f.clock.update(history, false)
  f.advance(1234.5)
  f.clock.update(history, true)
  assert.equal(f.timers.size, 0)
  assert.equal(f.clock.elapsed(1), 1234.5)
  f.advance(100000)
  f.clock.update(history, true)
  assert.equal(f.clock.elapsed(1), 1234.5)
  f.clock.update(history, false)
  f.advance(3765.49); assert.deepEqual(f.clock.ids(), [1])
  // Fractional millisecond budgets round timer delays upward, never expiring early.
  f.advance(.51); assert.deepEqual(f.clock.ids(), [])
})

test('a paused Step starts a full frozen cue; resuming runs it without changing simulated time', () => {
  const f = fixture(), history = [event(1)]
  f.clock.update(history, true)
  assert.equal(f.timers.size, 0)
  f.advance(100000)
  assert.equal(f.clock.elapsed(1), 0)
  f.clock.update(history, false)
  f.advance(4999); assert.deepEqual(f.clock.ids(), [1])
  f.advance(1); assert.deepEqual(f.clock.ids(), [])
  assert.deepEqual(history[0].at, { high: 1, low: 0 })
})

test('newer same-field events supersede old cues and restart all five seconds without affecting other fields', () => {
  const f = fixture(), first = event(1), status: BoardActivity = { ...event(2), kind: 'status', from: 'todo', to: 'in_progress' }
  f.clock.update([first, status], false)
  f.advance(4000)
  f.clock.update([first, status, event(3)], false)
  assert.deepEqual(f.clock.ids(), [3, 2])
  assert.equal(f.clock.forTarget('ticket', 'estimate'), 3)
  assert.equal(f.clock.elapsed(3), 0)
  f.callbacks[0]() // An already-queued old expiration cannot expire the replacement.
  assert.deepEqual(f.clock.ids(), [3, 2])
  f.advance(1000); assert.deepEqual(f.clock.ids(), [3])
  f.advance(3999); assert.deepEqual(f.clock.ids(), [3])
  f.advance(1); assert.deepEqual(f.clock.ids(), [])
})

test('ticker eviction does not shorten a visible cue; assignment events do not create or overwrite emphasis', () => {
  const f = fixture()
  f.clock.update([event(1)], false)
  f.advance(1000)
  f.clock.update([event(102, 'other'), { ...event(103), kind: 'assignment', from: null, to: 'owner' }], false)
  assert.equal(f.clock.forTarget('ticket', 'estimate'), 1)
  assert.equal(f.clock.elapsed(1), 1000)
  assert.equal(f.clock.forTarget('other', 'estimate'), 102)
  f.advance(4000)
  assert.equal(f.clock.forTarget('ticket', 'estimate'), undefined)
  assert.deepEqual(f.clock.ids(), [102])
  f.clock.suspend()
})

test('Restart and unmount cancel all timers; stale callbacks cannot resurrect feedback in a new run', () => {
  const f = fixture()
  f.clock.update([event(1)], false)
  const old = f.callbacks[0]
  f.clock.update([], true)
  assert.equal(f.timers.size, 0)
  f.clock.update([event(1)], true)
  const notifications = f.notifications()
  old()
  assert.deepEqual(f.clock.ids(), [1])
  assert.equal(f.notifications(), notifications)
  f.clock.update([event(1)], false)
  const pending = f.callbacks.at(-1)!
  f.advance(2000)
  f.clock.suspend()
  assert.equal(f.timers.size, 0)
  const beforeUnmountCallback = f.notifications()
  pending()
  assert.equal(f.notifications(), beforeUnmountCallback)
})

test('StrictMode-style effect cleanup/setup preserves the active budget without duplicate timers', () => {
  const f = fixture(), history = [event(1)]
  f.clock.update(history, false)
  f.advance(2000)
  f.clock.suspend()
  f.advance(10000) // Time without a mounted active effect is not displayed time.
  f.clock.update(history, false)
  assert.equal(f.timers.size, 1)
  assert.equal(f.clock.elapsed(1), 2000)
  f.advance(2999); assert.deepEqual(f.clock.ids(), [1])
  f.advance(1); assert.deepEqual(f.clock.ids(), [])
  assert.equal(f.notifications(), 3)
})
