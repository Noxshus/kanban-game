import type { BoardActivity } from '../game/boardActivity'
import { ACTIVITY_LIMIT } from '../game/boardActivity'
import { describeActivity, formatActivityTime } from './boardActivityPresentation'
import type { ActivityEngineer, ActivityRow } from './boardActivityPresentation'
import type { ReactNode } from 'react'

export interface ActivityDisplay { rows?: readonly ActivityRow[]; controls?: ReactNode }

interface Props {
  events: readonly BoardActivity[]
  engineers: readonly ActivityEngineer[]
  onHover: (ticketId: string | null, rowId: string) => void
  onFocus: (ticketId: string | null, rowId: string) => void
  onActivate: (ticketId: string) => void
  display?: ActivityDisplay
}

export function BoardActivityLog({ events, engineers, onHover, onFocus, onActivate, display }: Props) {
  const rows: readonly ActivityRow[] = display?.rows ?? events.map(event => ({ ...event, id: `board-${event.id}`, text: describeActivity(event, engineers) }))
  const newestFirst = [...rows].reverse()
  const entry = (event: ActivityRow) => (
    <li key={event.id}>
      <button type="button" className={`activity-entry${event.internal ? ' activity-internal' : ''}`} title={`${event.ticketTitle}${event.details ? '\n' + event.details : ''}`}
        aria-label={`${event.internal ? 'DEV. ' : ''}${event.ticketId}: ${event.ticketTitle}. ${event.text} ${event.details ?? ''} Simulation time ${formatActivityTime(event.at)}. Go to ticket.`}
        onMouseEnter={() => onHover(event.ticketId, event.id)} onMouseLeave={() => onHover(null, event.id)}
        onMouseMove={() => onHover(event.ticketId, event.id)}
        onFocus={() => onFocus(event.ticketId, event.id)} onBlur={() => onFocus(null, event.id)}
        onClick={() => onActivate(event.ticketId)}>
        <span className="activity-time">{formatActivityTime(event.at)}</span>
        <span className="activity-message"><strong>{event.internal && <span className="activity-dev-label">DEV · </span>}{event.ticketId}</strong><span>{event.text}</span></span>
      </button>
    </li>
  )
  return (
    <aside className="board-activity" aria-labelledby="activity-heading">
      <div className="activity-heading"><h3 id="activity-heading">Board Activity</h3><span>{display?.rows ? 'DEV diagnostics' : 'Reported updates'} · simulation time</span></div>
      {display?.controls}
      {newestFirst.length ? <ol className="activity-list" aria-label="Recent board activity, newest first" tabIndex={0}>{newestFirst.map(entry)}</ol>
        : <p className="activity-empty">{display?.rows ? 'No matching diagnostic activity in the retained events.' : 'No board changes yet. Reported updates will appear here.'}</p>}
      <p className="activity-retention">Latest {ACTIVITY_LIMIT} events · this run only</p>
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {newestFirst[0] ? `${newestFirst[0].internal ? 'DEV. ' : ''}${newestFirst[0].ticketId}. ${newestFirst[0].text}` : 'No board activity yet.'}
      </p>
    </aside>
  )
}
