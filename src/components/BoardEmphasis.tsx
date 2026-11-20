import type { ReactNode } from 'react'

export function BoardEmphasis({ kind, children }: { kind: 'status' | 'estimate'; children?: ReactNode }) {
  return <span className={`board-emphasis emphasis-${kind}`} aria-hidden={kind === 'status' ? true : undefined}>
    {children}{kind === 'estimate' && <small className="activity-update-label">Updated</small>}
  </span>
}
