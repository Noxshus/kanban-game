import type { BoardActivity } from '../game/boardActivity'

export const EMPHASIS_DURATION_MS = 5000
interface Clock {
  now(): number
  setTimeout(run: () => void, delay: number): number
  clearTimeout(id: number): void
}
interface Cue { id: number; ticketId: string; kind: 'status' | 'estimate'; remaining: number; started: number | null; timer: number | null }
export interface EmphasisSnapshot { id: number; ticketId: string; kind: 'status' | 'estimate'; elapsedMs: number; runningSince: number | null }

// This clock is presentation-only. It never advances simulation or consumes RNG.
// One cue per field survives card remounts; paused time never consumes its budget.
export function createBoardEmphasisClock(initial: readonly BoardActivity[], clock: Clock) {
  const cues = new Map<string, Cue>()
  const listeners = new Set<() => void>()
  let snapshot: readonly EmphasisSnapshot[] = []
  const changed = () => {
    snapshot = [...cues.values()].map(cue => ({ id: cue.id, ticketId: cue.ticketId, kind: cue.kind,
      elapsedMs: EMPHASIS_DURATION_MS - cue.remaining, runningSince: cue.started }))
    for (const listener of listeners) listener()
  }
  let lastId = initial.at(-1)?.id ?? 0
  let paused = true
  const suspend = () => {
    const now = clock.now()
    for (const cue of cues.values()) {
      if (cue.started !== null) cue.remaining = Math.max(0, cue.remaining - (now - cue.started))
      if (cue.timer !== null) clock.clearTimeout(cue.timer)
      cue.started = null; cue.timer = null
    }
  }
  const update = (events: readonly BoardActivity[], isPaused: boolean) => {
    suspend()
    paused = isPaused
    // Empty history is Restart. Initial loaded history stays silent, while new
    // IDs in a new run can start again from 1 without reviving an earlier cue.
    if (!events.length || events.at(-1)!.id < lastId) { cues.clear(); lastId = 0 }
    for (const event of events) if (event.id > lastId && event.kind !== 'assignment') {
      cues.set(JSON.stringify([event.ticketId, event.kind]), { id: event.id, ticketId: event.ticketId, kind: event.kind, remaining: EMPHASIS_DURATION_MS, started: null, timer: null })
    }
    lastId = events.at(-1)?.id ?? 0
    for (const [key, cue] of cues) {
      if (cue.remaining <= 0) { cues.delete(key); continue }
      if (paused) continue
      cue.started = clock.now()
      const timer = clock.setTimeout(() => {
        // A queued callback from an overwritten/paused cue cannot expire its
        // replacement or resurrect a timer after cleanup (including StrictMode).
        if (paused || cues.get(key) !== cue || cue.timer !== timer) return
        cues.delete(key)
        changed()
      }, Math.ceil(cue.remaining))
      cue.timer = timer
    }
    changed()
  }
  return {
    update, suspend,
    // Cached snapshots let React subscribe to the external display clock without
    // reading mutable refs or starting timers during rendering.
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    ids: () => [...cues.values()].map(cue => cue.id),
    forTarget: (ticketId: string, kind: 'status' | 'estimate') => cues.get(JSON.stringify([ticketId, kind]))?.id,
    elapsed(id: number) {
      const cue = [...cues.values()].find(cue => cue.id === id)
      return cue ? Math.min(EMPHASIS_DURATION_MS, EMPHASIS_DURATION_MS - cue.remaining + (cue.started === null ? 0 : clock.now() - cue.started)) : 0
    },
  }
}
