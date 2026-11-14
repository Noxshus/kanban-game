import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEdgeScroller, edgeSpeed } from '../src/components/edgeScroll.ts'

test('edge zones determine bounded direction and speed', () => {
  assert.equal(edgeSpeed(400, 0, 800), 0)
  assert.equal(edgeSpeed(-1, 0, 800), 0)
  assert.equal(edgeSpeed(0, 0, 800), -480)
  assert.equal(edgeSpeed(800, 0, 800), 480)
  assert.equal(edgeSpeed(32, 0, 800), -240)
  assert.equal(edgeSpeed(768, 0, 800), 240)
  assert.equal(edgeSpeed(64, 0, 800), 0)
})

test('frames keep scrolling at a stationary pointer and stop or cancel cleanly', () => {
  const pending = new Map<number, FrameRequestCallback>()
  let next = 0, distance = 0, updates = 0, blocked = false
  const scroller = createEdgeScroller({
    request: cb => { const id = ++next; pending.set(id, cb); return id },
    cancel: id => { pending.delete(id) },
    scroll: pixels => { distance += pixels; return !blocked },
    refresh: () => { updates++ },
  })
  const frame = (time: number) => { const [id, cb] = pending.entries().next().value!; pending.delete(id); cb(time) }
  scroller.update(240)
  scroller.update(240)
  assert.equal(pending.size, 1)
  frame(0); frame(16)
  assert.ok(distance > 0)
  assert.equal(updates, 2)
  scroller.update(0)
  assert.equal(pending.size, 0)
  scroller.update(-240)
  frame(32)
  blocked = true
  frame(48)
  assert.equal(pending.size, 0)
  blocked = false
  scroller.update(240)
  assert.equal(pending.size, 1)
  scroller.stop()
  assert.equal(pending.size, 0)
  scroller.stop()
})
