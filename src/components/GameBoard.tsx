import type { WorkflowStatus } from '../game/types'
import type { getPlayerView } from '../store/playerView'
import type { DiagnosticsView } from '../store/diagnosticsView'
import { DeveloperDiagnostics, TicketDiagnostics } from './Diagnostics'

const columns: { status: WorkflowStatus; title: string }[] = [
  { status: 'backlog', title: 'Backlog' },
  { status: 'todo', title: 'To Do' },
  { status: 'in_progress', title: 'In Progress' },
  { status: 'done', title: 'Done' },
]

interface Props {
  view: ReturnType<typeof getPlayerView>
  diagnostics?: DiagnosticsView | null
}

export function GameBoard({ view, diagnostics }: Props) {
  return (
    <>
      <section aria-labelledby="board-heading">
        <h2 id="board-heading">Kanban board</h2>
        <div className="board">
          {columns.map(({ status, title }) => {
            // Board placement reflects reports, independently of simulation progress.
            const tickets = view.tickets.filter((ticket) => ticket.reportedStatus === status)
            return (
              <section className="column" key={status} aria-labelledby={`column-${status}`}>
                <h3 id={`column-${status}`}>{title}</h3>
                <ul className="ticket-list">
                  {tickets.map((ticket) => {
                    const assignee = view.developers.find(
                      (developer) => developer.id === ticket.assignedDeveloperId,
                    )
                    const diagnostic = diagnostics?.tickets.find((item) => item.id === ticket.id)
                    return (
                      <li className="ticket" key={ticket.id}>
                        <span className="ticket-id">{ticket.id}</span>
                        <h4>{ticket.title}</h4>
                        <p>{assignee ? `Assigned to: ${assignee.name}` : 'Unassigned'}</p>
                        <label className="ticket-progress">
                          <span>Reported progress: {Math.round(ticket.reportedProgress)}%</span>
                          <progress max={100} value={ticket.reportedProgress} />
                        </label>
                        {diagnostic && <TicketDiagnostics ticket={diagnostic} />}
                      </li>
                    )
                  })}
                </ul>
                {tickets.length === 0 && <p>No tickets</p>}
              </section>
            )
          })}
        </div>
      </section>

      <section aria-labelledby="developers-heading">
        <h2 id="developers-heading">Developers</h2>
        <ul className="developer-list">
          {view.developers.map((developer) => {
            const diagnostic = diagnostics?.developers.find((item) => item.id === developer.id)
            return (
            <li key={developer.id}>
              <strong>{developer.name}</strong>
              <span>Productivity: {developer.productivity} work/second</span>
              {diagnostic && <DeveloperDiagnostics developer={diagnostic} />}
            </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}
