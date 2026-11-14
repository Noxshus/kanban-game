import type { WorkflowStatus } from '../game/types'
import type { getPlayerView } from '../store/playerView'
import type { DiagnosticsView } from '../store/diagnosticsView'
import { DeveloperDiagnostics, TicketDiagnostics } from './Diagnostics'
import { useState } from 'react'

const columns: { status: WorkflowStatus; title: string }[] = [
  { status: 'backlog', title: 'Backlog' },
  { status: 'todo', title: 'To Do' },
  { status: 'in_progress', title: 'In Progress' },
  { status: 'done', title: 'Done' },
]

interface Props {
  onReorder?: (ticketId: string, targetId: string, after: boolean) => void
  view: ReturnType<typeof getPlayerView>
  diagnostics?: DiagnosticsView | null
}

export function GameBoard({ view, diagnostics, onReorder }: Props) {
  const [dragged, setDragged] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [dropAfter, setDropAfter] = useState(false)
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
                      <li className={`ticket${dropTarget === ticket.id ? (dropAfter ? ' drop-after' : ' drop-before') : ''}`} key={ticket.id}
                        draggable={status === 'todo'}
                        onDragStart={status === 'todo' ? (event) => {
                          setDragged(ticket.id)
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('text/plain', ticket.id)
                        } : undefined}
                        onDragEnd={() => { setDragged(null); setDropTarget(null) }}
                        onDragOver={status === 'todo' ? (event) => {
                          if (!dragged) return
                          event.preventDefault()
                          event.dataTransfer.dropEffect = 'move'
                          setDropTarget(ticket.id)
                          const bounds = event.currentTarget.getBoundingClientRect()
                          setDropAfter(event.clientY > bounds.top + bounds.height / 2)
                        } : undefined}
                        onDrop={status === 'todo' ? (event) => {
                          event.preventDefault()
                          if (dragged && event.dataTransfer.getData('text/plain') === dragged) {
                            const bounds = event.currentTarget.getBoundingClientRect()
                            onReorder?.(dragged, ticket.id, event.clientY > bounds.top + bounds.height / 2)
                          }
                          setDragged(null); setDropTarget(null)
                        } : undefined}>
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
