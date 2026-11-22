import type { PlayerTicket } from '../store/playerView'
import type { ProgressProjection } from '../store/progressProjection'
import type { EventTime } from '../game/eventTime'
import { projectedProgress } from '../store/progressProjection'
import { formatEffort } from './formatEffort'

export function TicketProgress({ ticket, projection, at }: { ticket: PlayerTicket; projection: ProgressProjection; at: EventTime }) {
  const { percentage, overflow, underflow } = projectedProgress(projection, at)
  const text = overflow ? '>1.7976931348623157E308%' : underflow ? '<5E-324%' : percentage === null ? 'Unknown' : `${formatEffort(percentage)}%`
  // Use the same significant-digit presentation in the caption and explanation;
  // logarithmic roundoff at exactly 100 must not produce a contradictory warning.
  const visiblyBeyond = overflow || percentage !== null && percentage > 100 && formatEffort(percentage) !== formatEffort(100)
  return (
    <div className="ticket-progress">
      <div className="progress-caption"><span>Projected progress</span><strong>{text}</strong></div>
      <div className="progress-track">
        <progress aria-label={`${ticket.id} projected progress`} aria-valuetext={`${text} projected; not actual completion`}
          max={100} value={overflow ? 100 : percentage === null ? undefined : Math.min(100, percentage)} />
        <span className="progress-report-marker" aria-hidden="true" style={{ left: `${ticket.reportedProgress}%` }} />
      </div>
      <p className="progress-report-label">Engineer report: <strong>{formatEffort(ticket.reportedProgress)}%</strong>
        {!ticket.progressReport && <small> · snapshot, time unknown</small>}
      </p>
      {visiblyBeyond ? <p className="progress-overrun">{overflow ? 'Beyond numeric display range' : `${formatEffort(percentage! - 100)} percentage points beyond estimate`} · not completion</p> : null}
    </div>
  )
}
