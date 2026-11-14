export function edgeSpeed(y: number, top: number, bottom: number): number {
  const zone = Math.min(64, (bottom - top) / 3)
  if (y < top || y > bottom || zone <= 0) return 0
  if (y < top + zone) return -Math.min(480, 480 * (top + zone - y) / zone)
  if (y > bottom - zone) return Math.min(480, 480 * (y - (bottom - zone)) / zone)
  return 0
}

interface ScrollDriver {
  request: (callback: FrameRequestCallback) => number
  cancel: (id: number) => void
  scroll: (pixels: number) => boolean
  refresh: () => void
}

// A frame loop, rather than dragover frequency, keeps scrolling under a stationary pointer.
export function createEdgeScroller(driver: ScrollDriver) {
  let speed = 0
  let frame: number | null = null
  let lastTime: number | null = null
  function tick(time: number) {
    frame = null
    if (!speed) return
    const seconds = lastTime === null ? 1 / 60 : Math.min((time - lastTime) / 1000, 0.05)
    lastTime = time
    if (!driver.scroll(speed * seconds)) { speed = 0; lastTime = null; return }
    driver.refresh()
    frame = driver.request(tick)
  }
  return {
    update(next: number) {
      speed = next
      if (!speed) { if (frame !== null) driver.cancel(frame); frame = null; lastTime = null }
      else if (frame === null) frame = driver.request(tick)
    },
    stop() {
      speed = 0
      if (frame !== null) driver.cancel(frame)
      frame = null
      lastTime = null
    },
  }
}
