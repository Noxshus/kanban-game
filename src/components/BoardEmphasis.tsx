import type { ReactNode } from 'react'
import { useState } from 'react'

export function BoardEmphasis({ kind, children, isPaused = true, elapsedMs = 0, runningSince = null }: { kind: 'status' | 'estimate'; children?: ReactNode; isPaused?: boolean; elapsedMs?: number; runningSince?: number | null }) {
  // A column change can remount the same cue. Resume its existing visual phase;
  // ordinary rerenders must not repeatedly offset an animation already running.
  const [initialElapsed] = useState(() => elapsedMs + (runningSince === null ? 0 : window.performance.now() - runningSince))
  return <span className={`board-emphasis emphasis-${kind}`} aria-hidden={kind === 'status' ? true : undefined}
    style={{ animationPlayState: isPaused ? 'paused' : 'running', animationDelay: `${-initialElapsed}ms` }}>
    {children}{kind === 'estimate' && <small className="activity-update-label">Updated</small>}
  </span>
}
