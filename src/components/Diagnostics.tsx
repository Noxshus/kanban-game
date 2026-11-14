import type { DiagnosticsView } from '../store/diagnosticsView'

function format(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function TicketDiagnostics({ ticket }: { ticket: DiagnosticsView['tickets'][number] }) {
  return (
    <div className="diagnostics ticket-diagnostics">
      <strong>Development diagnostics — true values</strong>
      <p>Size: {format(ticket.requiredWork)} work units</p>
      <p>Actual work: {format(ticket.completedWork)} / {format(ticket.requiredWork)} work units</p>
      <p>Remaining: {format(ticket.remainingWork)} work units</p>
      <p>Active developer: {ticket.activeDeveloperName ?? 'None'}</p>
      <p>Active work rate: {format(ticket.workRate)} work units/second</p>
      <p>ETA: {ticket.estimatedSeconds === null ? 'Unavailable (no active work rate)'
        : `${format(ticket.estimatedSeconds)} simulated seconds`}</p>
    </div>
  )
}

export function DeveloperDiagnostics({ developer }: { developer: DiagnosticsView['developers'][number] }) {
  return (
    <div className="diagnostics">
      <p>Active work: {developer.activeTicket
        ? `${developer.activeTicket.id}: ${developer.activeTicket.title}` : 'Idle'}</p>
      <p>Assigned tickets (ownership): {developer.assignedTicketCount}</p>
    </div>
  )
}

export function TeamDiagnostics({ team }: { team: DiagnosticsView['team'] }) {
  return (
    <section className="diagnostics team-diagnostics" aria-labelledby="team-diagnostics-heading">
      <h2 id="team-diagnostics-heading">Development diagnostics: team overview</h2>
      <p>True simulation values, separate from player reports.</p>
      <p>Completed tickets: {team.completedTickets} / {team.totalTickets}</p>
      <p>Active developers: {team.activeDevelopers} / {team.totalDevelopers}</p>
      <p>Actual team work: {format(team.completedWork)} / {format(team.requiredWork)} work units</p>
      <p>Current team work rate: {format(team.workRate)} work units/second</p>
      <p>Rates and ETAs use simulated seconds at current productivity, excluding queue wait.</p>
    </section>
  )
}
