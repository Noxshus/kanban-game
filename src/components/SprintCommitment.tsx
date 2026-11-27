import { useState } from 'react'
import type { Dispatch } from 'react'
import type { CommitmentAction } from '../game/commitment'
import type { PlanningView } from '../store/planningView'
import { formatEffort } from './formatEffort'

export function SprintCommitment({ view, dispatch }: { view: PlanningView; dispatch: Dispatch<CommitmentAction> }) {
  const [selected, setSelected] = useState('')
  const forecast = view.forecast
  const hours = (seconds: number | null) => {
    const value = seconds === null ? null : seconds * forecast.hoursPerSecond
    return value === null || !Number.isFinite(value) || seconds! > 0 && value === 0 ? 'Unavailable' : `${formatEffort(value)}h`
  }
  const name = (id: string | null) => forecast.engineers.find(engineer => engineer.id === id)?.name ?? 'Unallocated'
  return <section className="sprint-commitment" aria-labelledby="commitment-heading">
    <p className="eyebrow">Sprint Planning · Commitment</p>
    <h2 id="commitment-heading">Choose the sprint scope</h2>
    <p>Order work independently of the estimation shortlist. Unknown estimates and overcommitment are allowed.</p>
    <form className="planning-add" onSubmit={event => {
      event.preventDefault()
      if (!view.commitmentCandidates.some(ticket => ticket.id === selected)) return
      dispatch({ type: 'addCommitment', ticketId: selected }); setSelected('')
    }}>
      <label htmlFor="commitment-ticket">Ticket to commit</label>
      <select id="commitment-ticket" value={selected} onChange={event => setSelected(event.target.value)}>
        <option value="">Choose a ticket</option>
        {view.commitmentCandidates.map(ticket => <option key={ticket.id} value={ticket.id}>
          {ticket.id}: {ticket.title} · {ticket.reportedStatus} · Estimate {formatEffort(ticket.reportedEffortEstimate)}
        </option>)}
      </select>
      <button type="submit" disabled={!view.commitmentCandidates.some(ticket => ticket.id === selected)}>Add to sprint</button>
    </form>
    {view.commitment.length ? <ol className="planning-requests" aria-label="Ordered sprint commitment">
      {view.commitment.map((ticket, index) => <li key={ticket.id}>
        <div className="planning-request-info"><strong>{ticket.title}</strong>
          <span>{ticket.id} · {ticket.workDomain} · Complexity: {ticket.complexity}</span>
          <span>Published estimate: {formatEffort(ticket.reportedEffortEstimate)} · Reported progress: {formatEffort(ticket.reportedProgress)}%</span>
        </div>
        <div className="planning-request-actions">
          <button type="button" aria-label={`Move ${ticket.id} earlier in commitment order`} disabled={index === 0}
            onClick={() => dispatch({ type: 'moveCommitment', ticketId: ticket.id, direction: 'up' })}>Earlier</button>
          <button type="button" aria-label={`Move ${ticket.id} later in commitment order`} disabled={index === view.commitment.length - 1}
            onClick={() => dispatch({ type: 'moveCommitment', ticketId: ticket.id, direction: 'down' })}>Later</button>
          <button type="button" aria-label={`Remove ${ticket.id} from sprint`}
            onClick={() => dispatch({ type: 'removeCommitment', ticketId: ticket.id })}>Remove</button>
        </div>
      </li>)}
    </ol> : <p>No tickets selected. An empty sprint is allowed.</p>}
    <section className="delivery-forecast" aria-labelledby="forecast-heading">
      <h3 id="forecast-heading">Delivery forecast · provisional</h3>
      <p><strong>Known-work utilisation: {forecast.utilisation === null ? 'Not quantified' : `${formatEffort(forecast.utilisation)}%`}</strong>
        {' '}of {formatEffort(forecast.sprintHours)} working hours, based on the busiest engineer.</p>
      {forecast.utilisationReason && <p>{forecast.utilisationReason}</p>}
      <p>Unknown work: {forecast.unknownCount} · Unforecastable work: {forecast.unforecastableCount}. These are additional unquantified workload, not zero effort.</p>
      <p className="planning-note">Uses published total effort × the remaining reported percentage and public base productivity only.
        {' '}Until Assessment exists, domain competency and the resulting complexity-adjusted rate are not forecast.
        {' '}No Flow, switching or future reporting is predicted. Hypothetical allocations are not assignments or delivery promises.</p>
      <ul aria-label="Hypothetical engineer workload">{forecast.engineers.map(engineer => <li key={engineer.id}>
        {engineer.name}: {formatEffort(engineer.hours)}h / {formatEffort(forecast.sprintHours)}h
        {engineer.ticketIds.length ? ` · ${engineer.ticketIds.join(', ')}` : ' · No quantified work allocated'}
      </li>)}</ul>
      <details><summary>Per-ticket forecast breakdown</summary>
        <ol>{forecast.tickets.map(ticket => <li key={ticket.ticketId}>
          <strong>{ticket.ticketId}: {ticket.title}</strong>
          <p>Published estimate: {formatEffort(ticket.estimate ?? undefined)}; reported progress: {formatEffort(ticket.progress)}%.
            {' '}Estimated remaining: {ticket.remainingWork === null ? 'Unquantified / outside scalar range' : `${formatEffort(ticket.remainingWork)} work units`}.</p>
          {ticket.result === 'forecast' ? <p>Hypothetical engineer: {name(ticket.engineerId)}; duration {hours(ticket.seconds)}; finish after {hours(ticket.finishSeconds)} including earlier forecast work.</p>
            : <p>{ticket.reason}</p>}
          {ticket.options.length > 0 && <ul>{ticket.options.map(option => <li key={option.engineerId}>
            {name(option.engineerId)}: public base rate {Number.isFinite(option.baseProductivity) && option.baseProductivity >= 0 ? formatEffort(option.baseProductivity) : 'Unavailable'} work units/s;
            {' '}earlier load {hours(option.beforeSeconds)}, duration {hours(option.seconds)}, finish {hours(option.finishSeconds)}.
          </li>)}</ul>}
        </li>)}</ol>
      </details>
    </section>
    <p>Commitment sets initial relative Rank. Engineers choose their own work within this scope. Execution starts paused.</p>
    <button type="button" onClick={() => dispatch({ type: 'commitSprint' })}>Commit and start sprint</button>
  </section>
}
