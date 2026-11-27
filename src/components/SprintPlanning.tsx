import { useState } from 'react'
import type { Dispatch } from 'react'
import type { PlanningAction } from '../game/planning'
import type { PlanningView } from '../store/planningView'
import { formatEffort } from './formatEffort'

export function SprintPlanning({ view, dispatch }: { view: PlanningView; dispatch: Dispatch<PlanningAction> }) {
  const [selected, setSelected] = useState('')
  const editable = view.stage === 'shortlist'
  return <section className="sprint-planning" aria-labelledby="planning-heading">
    <div className="planning-heading">
      <div><p className="eyebrow">Sprint Planning · {editable ? 'Estimation shortlist' : 'Estimation complete'}</p>
        <h2 id="planning-heading">Prepare the estimates</h2></div>
      <dl className="planning-capacity">
        <div><dt>Command</dt><dd>{formatEffort(view.command)}</dd></div>
        <div><dt>Requested capacity</dt><dd>{formatEffort(view.requestedCapacity)}</dd></div>
        <div><dt>Available capacity</dt><dd>Unknown</dd></div>
      </dl>
    </div>
    <p>Requests are assessed in this order, stopping at the first that cannot be completed. Planning uses no working time.</p>
    <p className="planning-note">Available capacity will become assessable with the future Assessment system. Estimates remain fallible.</p>
    {editable && <form className="planning-add" onSubmit={event => {
      event.preventDefault()
      if (!view.candidates.some(ticket => ticket.id === selected)) return
      dispatch({ type: 'addEstimation', ticketId: selected }); setSelected('')
    }}>
      <label htmlFor="planning-ticket">Ticket to estimate</label>
      <select id="planning-ticket" value={selected} onChange={event => setSelected(event.target.value)}>
        <option value="">Choose a ticket</option>
        {view.candidates.map(ticket => <option key={ticket.id} value={ticket.id}>
          {ticket.id}: {ticket.title} · {ticket.complexity}, cost {ticket.cost} · {ticket.reportedEffortEstimate === undefined ? 'Unknown estimate' : 'Estimate ' + formatEffort(ticket.reportedEffortEstimate)}
        </option>)}
      </select>
      <button type="submit" disabled={!view.candidates.some(ticket => ticket.id === selected)}>Add request</button>
    </form>}
    {view.requests.length ? <ol className="planning-requests" aria-label="Ordered estimation requests">
      {view.requests.map((ticket, index) => {
        const outcome = view.outcomes.find(item => item.ticketId === ticket.id)
        return <li key={ticket.id}>
          <div className="planning-request-info"><strong>{ticket.title}</strong>
            <span>{ticket.id} · Complexity: {ticket.complexity} · Cost: {ticket.cost}</span>
            <span>Published estimate: {formatEffort(ticket.reportedEffortEstimate)}{ticket.reportedEffortEstimate !== undefined ? ' work units' : ''}</span>
            {outcome && <span className="planning-result">{outcome.result === 'published' ? 'Estimate published' : outcome.result === 'retained' ? 'Existing estimate retained' : 'Not assessed'}</span>}
          </div>
          {editable && <div className="planning-request-actions">
            <button type="button" aria-label={`Move ${ticket.id} earlier in estimation order`} disabled={index === 0}
              onClick={() => dispatch({ type: 'moveEstimation', ticketId: ticket.id, direction: 'up' })}>Earlier</button>
            <button type="button" aria-label={`Move ${ticket.id} later in estimation order`} disabled={index === view.requests.length - 1}
              onClick={() => dispatch({ type: 'moveEstimation', ticketId: ticket.id, direction: 'down' })}>Later</button>
            <button type="button" aria-label={`Remove ${ticket.id} estimation request`}
              onClick={() => dispatch({ type: 'removeEstimation', ticketId: ticket.id })}>Remove</button>
          </div>}
        </li>
      })}
    </ol> : <p>No estimation requests. You can finish estimation without requesting any tickets.</p>}
    {editable ? <div className="planning-submit">
      <p>Resolve once per planning cycle. The shortlist locks after submission, including requests the team cannot complete.</p>
      <button type="button" onClick={() => dispatch({ type: 'resolveEstimation' })}>Resolve estimates and lock shortlist</button>
    </div> : <p role="status">Estimation resolved. Shortlist locked. Sprint commitment is not available in this prototype yet.</p>}
  </section>
}
