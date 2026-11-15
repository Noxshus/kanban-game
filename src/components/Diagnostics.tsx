import type { DiagnosticsView } from '../store/diagnosticsView'
import { useId } from 'react'

function format(value: number | null) {
  if (value === null) return 'Unavailable (numeric range exceeded)'
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function TicketDiagnostics({ ticket }: { ticket: DiagnosticsView['tickets'][number] }) {
  const tooltipId = useId()
  return (
    <div className="diagnostics ticket-diagnostics">
      <strong>Development diagnostics — true values</strong>
      <span className="comparison-indicator">
        <button type="button" className={ticket.comparison.matches ? 'comparison-match' : 'comparison-mismatch'} aria-describedby={tooltipId}>
          {ticket.comparison.matches ? 'Match' : 'Mismatch'}
        </button>
        <span id={tooltipId} role="tooltip" className="comparison-tooltip">
          {ticket.comparison.details.map((detail) => <span key={detail}>{detail}</span>)}
        </span>
      </span>
      <p>Rank: {ticket.rank}</p>
      <p>Work domain: {ticket.workDomain === 'frontend' ? 'Frontend' : 'Backend'}</p>
      <p>Size: {format(ticket.requiredWork)} work units</p>
      <p>Actual work: {format(ticket.completedWork)} / {format(ticket.requiredWork)} work units</p>
      <p>Remaining: {format(ticket.remainingWork)} work units</p>
      <p>Active developer: {ticket.activeDeveloperName ?? 'None'}</p>
      <p>Active work rate: {format(ticket.workRate)} work units/second</p>
      <p>ETA: {ticket.estimatedSeconds === null ? 'Unavailable (no representable active rate or ETA)'
        : `${format(ticket.estimatedSeconds)} simulated seconds`}</p>
    </div>
  )
}

export function DeveloperDiagnostics({ developer }: { developer: DiagnosticsView['developers'][number] }) {
  return (
    <div className="diagnostics">
      <p>Base productivity: {format(developer.productivity)} work units/second</p>
      <p>Frontend competency: {format(developer.competencies.frontend)}</p>
      <p>Backend competency: {format(developer.competencies.backend)}</p>
      <p>Uninterrupted work duration: {format(developer.focusDuration)} seconds</p>
      <p>Focus bonus: {format(developer.focusBonus * 100)}%; multiplier: {format(developer.focusMultiplier)}×</p>
      <p>Effective productivity: {developer.activeTicket
        ? `${format(developer.workRate)} work units/second` : 'Unavailable (idle)'}</p>
      <p>Active work: {developer.activeTicket
        ? `${developer.activeTicket.id}: ${developer.activeTicket.title}` : 'Idle'}</p>
      <p>Assigned tickets (ownership): {developer.assignedTicketCount}</p>
      <p>Judgement: {format(developer.judgement)}; Discipline: {format(developer.discipline)}</p>
      <details>
        <summary>Most recent work selection</summary>
        {developer.lastSelection ? <>
          <p>Manager candidate: {developer.lastSelection.managerChoice.id}, Rank {developer.lastSelection.managerChoice.rank}, reported progress {format(developer.lastSelection.managerChoice.reportedProgress)}%</p>
          <p>Opportunity candidate: {developer.lastSelection.opportunity.id}, Rank {developer.lastSelection.opportunity.rank}, reported progress {format(developer.lastSelection.opportunity.reportedProgress)}%</p>
          <p>Decision attributes: Judgement {format(developer.lastSelection.judgement)}, Discipline {format(developer.lastSelection.discipline)}</p>
          <p>Override probability: {format(developer.lastSelection.overrideProbability * 100)}%; RNG draw: {developer.lastSelection.draw === null ? 'None (candidates agree)' : developer.lastSelection.draw}</p>
          <p>Selected ticket: {developer.lastSelection.selectedId}</p>
        </> : <p>No selection yet</p>}
      </details>
    </div>
  )
}

export function TeamDiagnostics({ team }: { team: DiagnosticsView['team'] }) {
  return (
    <section className="diagnostics team-diagnostics" aria-labelledby="team-diagnostics-heading">
      <h2 id="team-diagnostics-heading">Development diagnostics: team overview</h2>
      <p>True simulation values, separate from player reports.</p>
      <p>Completed tickets (including backlog in total): {team.completedTickets} / {team.totalTickets}</p>
      <p>Active developers: {team.activeDevelopers} / {team.totalDevelopers}</p>
      <p>Actual team work (including backlog in total): {format(team.completedWork)} / {format(team.requiredWork)} work units</p>
      <p>Current team work rate: {format(team.workRate)} work units/second</p>
      <p>Rates and ETAs use simulated seconds at current productivity, excluding queue wait.</p>
    </section>
  )
}
