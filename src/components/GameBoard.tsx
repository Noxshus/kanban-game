import type { WorkflowStatus } from '../game/types'
import type { getPlayerView } from '../store/playerView'
import type { DiagnosticsView } from '../store/diagnosticsView'
import { DeveloperDiagnostics, TicketDiagnostics } from './Diagnostics'
import { useEffect, useRef, useState } from 'react'
import { createEdgeScroller, edgeSpeed } from './edgeScroll'
import { formatEffort } from './formatEffort'
import type { BoardActivity } from '../game/boardActivity'
import { BoardActivityLog } from './BoardActivity'
import type { ActivityDisplay } from './BoardActivity'
import { focusActivityTicket } from './boardActivityPresentation'
import { BoardEmphasis } from './BoardEmphasis'

const noActivity: BoardActivity[] = []
type ActivityTarget = { rowId: string; ticketId: string; order: number }

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
  activity?: readonly BoardActivity[]
  activityDisplay?: ActivityDisplay
}

export function GameBoard({ view, diagnostics, onReorder, activity = noActivity, activityDisplay }: Props) {
  const [targets, setTargets] = useState<{ hover: ActivityTarget | null; focus: ActivityTarget | null; order: number }>({ hover: null, focus: null, order: 0 })
  const visibleRows = new Set(activityDisplay?.rows ? activityDisplay.rows.map(row => row.id) : activity.map(event => `board-${event.id}`))
  // Only currently visible origins can highlight a card. Keep pointer and focus
  // independent so an older leave/blur cannot cancel a newer interaction.
  const hovered = targets.hover && visibleRows.has(targets.hover.rowId) ? targets.hover : null
  const focused = targets.focus && visibleRows.has(targets.focus.rowId) ? targets.focus : null
  if (hovered !== targets.hover || focused !== targets.focus) {
    // Reset invalid origins with the changed rows, before children are committed.
    // Restoring a filter must not resurrect an earlier interaction.
    setTargets({ ...targets, hover: hovered, focus: focused })
  }
  const highlightedTicket = hovered && (!focused || hovered.order > focused.order) ? hovered.ticketId : focused?.ticketId
  function targetActivity(source: 'hover' | 'focus', ticketId: string | null, rowId: string) {
    setTargets(previous => {
      if (ticketId === null) return previous[source]?.rowId === rowId ? { ...previous, [source]: null } : previous
      const other = previous[source === 'hover' ? 'focus' : 'hover']
      if (previous[source]?.rowId === rowId && (!other || previous[source]!.order > other.order)) return previous
      const order = previous.order + 1
      return { ...previous, order, [source]: { ticketId, rowId, order } }
    })
  }
  const cards = useRef(new Map<string, HTMLLIElement>())
  const [feedback, setFeedback] = useState<ReadonlySet<number>>(() => new Set())
  const lastActivity = useRef(activity.at(-1)?.id ?? 0)
  const feedbackTimers = useRef(new Map<number, number>())
  useEffect(() => {
    const current = new Set(activity.map(event => event.id))
    const fresh = activity.filter(event => event.id > lastActivity.current && event.kind !== 'assignment')
    lastActivity.current = activity.at(-1)?.id ?? 0
    // Lifetime belongs to the board, not the card: changing columns remounts a
    // card and must not replay an old estimate cue. Initial history is silent.
    for (const [id, timer] of feedbackTimers.current) if (!current.has(id)) {
      window.clearTimeout(timer); feedbackTimers.current.delete(id)
    }
    setFeedback(previous => new Set([...previous].filter(id => current.has(id)).concat(fresh.map(event => event.id))))
    for (const event of fresh) {
      feedbackTimers.current.set(event.id, window.setTimeout(() => {
        feedbackTimers.current.delete(event.id)
        setFeedback(previous => new Set([...previous].filter(id => id !== event.id)))
      }, 1500))
    }
  }, [activity])
  useEffect(() => {
    const timers = feedbackTimers.current
    return () => { for (const timer of timers.values()) window.clearTimeout(timer); timers.clear() }
  }, [])
  const [dragged, setDragged] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [dropAfter, setDropAfter] = useState(false)
  const todoColumn = useRef<HTMLElement>(null)
  const dragId = useRef<string | null>(null)
  const onReorderRef = useRef(onReorder)
  useEffect(() => { onReorderRef.current = onReorder }, [onReorder])
  useEffect(() => {
    let x = 0, y = 0
    let container: HTMLElement | null = null
    const findTarget = () => {
      const element = document.elementFromPoint(x, y)
      if (element?.closest('.development-toolbar, .development-panel')) return null
      const card = element?.closest<HTMLElement>('[data-todo-ticket]')
      return card && todoColumn.current?.contains(card) ? card : null
    }
    const refresh = () => {
      const card = findTarget()
      setDropTarget(card?.dataset.todoTicket ?? null)
      if (card) { const rect = card.getBoundingClientRect(); setDropAfter(y > rect.top + rect.height / 2) }
    }
    const scroller = createEdgeScroller({
      request: cb => requestAnimationFrame(cb), cancel: id => cancelAnimationFrame(id),
      scroll: pixels => {
        if (!container) return false
        const before = container.scrollTop
        container.scrollTop += pixels
        return container.scrollTop !== before
      }, refresh,
    })
    function dragover(event: DragEvent) {
      if (!dragId.current || !todoColumn.current) return
      x = event.clientX; y = event.clientY
      if (!container) {
        let parent = todoColumn.current.parentElement
        while (parent && parent !== document.body && parent !== document.documentElement) {
          const style = getComputedStyle(parent)
          if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight) break
          parent = parent.parentElement
        }
        container = parent && parent !== document.body && parent !== document.documentElement
          ? parent : document.scrollingElement as HTMLElement | null
      }
      const column = todoColumn.current.getBoundingClientRect()
      const viewport = container === document.scrollingElement
        ? { top: 0, bottom: window.innerHeight } : container?.getBoundingClientRect()
      const underPointer = document.elementFromPoint(x, y)
      const blocked = underPointer?.closest('.development-toolbar, .development-panel')
      scroller.update(viewport && x >= column.left && x <= column.right && !blocked
        ? edgeSpeed(y, Math.max(0, viewport.top), Math.min(window.innerHeight, viewport.bottom)) : 0)
      refresh()
      if (findTarget()) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move' }
    }
    function end() { scroller.stop(); container = null; dragId.current = null; setDragged(null); setDropTarget(null) }
    function leave(event: DragEvent) {
      if (dragId.current && !event.relatedTarget &&
        (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight)) {
        scroller.stop(); setDropTarget(null)
      }
    }
    function drop(event: DragEvent) {
      if (!dragId.current) return
      // Hit-test at drop time: native drag targets can lag behind programmatic scrolling.
      x = event.clientX; y = event.clientY
      const card = findTarget()
      if (card && event.dataTransfer?.getData('text/plain') === dragId.current) {
        const bounds = card.getBoundingClientRect()
        event.preventDefault(); event.stopPropagation()
        onReorderRef.current?.(dragId.current, card.dataset.todoTicket!, y > bounds.top + bounds.height / 2)
      }
      end()
    }
    document.addEventListener('dragover', dragover, true)
    document.addEventListener('drop', drop, true)
    document.addEventListener('dragend', end, true)
    document.addEventListener('dragleave', leave, true)
    return () => { scroller.stop(); document.removeEventListener('dragover', dragover, true); document.removeEventListener('drop', drop, true); document.removeEventListener('dragend', end, true); document.removeEventListener('dragleave', leave, true) }
  }, [])
  return (
    <>
      <section className="board-section" aria-labelledby="board-heading">
        <div className="section-heading">
          <h2 id="board-heading">Kanban board</h2>
          <p>The team’s reports. Your priorities.</p>
        </div>
        <div className="board-workspace">
        <div className="board-content">
        <div className="board">
          {columns.map(({ status, title }) => {
            // Board placement reflects reports, independently of simulation progress.
            const tickets = view.tickets.filter((ticket) => ticket.reportedStatus === status)
            return (
              <section className={`column column-${status}`} key={status} ref={status === 'todo' ? todoColumn : undefined} aria-labelledby={`column-${status}`}>
                <div className="column-heading">
                  <h3 id={`column-${status}`}>{title}</h3>
                  <span className="column-count" aria-label={`${tickets.length} ${tickets.length === 1 ? 'ticket' : 'tickets'}`}>{tickets.length}</span>
                </div>
                <ul className="ticket-list">
                  {tickets.map((ticket) => {
                    const assignee = view.developers.find(
                      (developer) => developer.id === ticket.assignedDeveloperId,
                    )
                    const diagnostic = diagnostics?.tickets.find((item) => item.id === ticket.id)
                    const statusEvent = activity.findLast(event => event.ticketId === ticket.id && event.kind === 'status')
                    const estimateEvent = activity.findLast(event => event.ticketId === ticket.id && event.kind === 'estimate')
                    return (
                      <li className={`ticket${highlightedTicket === ticket.id ? ' activity-target' : ''}${dropTarget === ticket.id ? (dropAfter ? ' drop-after' : ' drop-before') : ''}`} key={ticket.id}
                        ref={card => { if (card) cards.current.set(ticket.id, card); else cards.current.delete(ticket.id) }}
                        tabIndex={-1} aria-label={`${ticket.id}: ${ticket.title}`}
                        data-todo-ticket={status === 'todo' ? ticket.id : undefined}
                        draggable={status === 'todo'}
                        onDragStart={status === 'todo' ? (event) => {
                          setDragged(ticket.id)
                          dragId.current = ticket.id
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
                        <div className="ticket-reference">
                          <span className="ticket-id">{ticket.id}</span>
                          <span className="ticket-rank" title="Global managerial priority; Rank 1 is highest">Rank: {ticket.rank}</span>
                        </div>
                        <h4>{ticket.title}</h4>
                        <div className="ticket-categories">
                          <span className="ticket-domain">{ticket.workDomain === 'frontend' ? 'Frontend' : 'Backend'}</span>
                          <span className="ticket-complexity">Complexity: {ticket.complexity}</span>
                        </div>
                        <dl className="ticket-report">
                          <div><dt>Assigned to:</dt><dd className={assignee ? undefined : 'report-unset'}>{assignee?.name ?? 'Unassigned'}</dd></div>
                          <div className="ticket-estimate"><dt>Estimated effort:</dt><dd>
                            <span className={ticket.reportedEffortEstimate === undefined ? 'report-unset' : undefined}
                              title={ticket.reportedEffortEstimate === undefined ? 'No effort estimate has been reported yet' : 'Published estimate of total effort'}>
                              {estimateEvent && feedback.has(estimateEvent.id) ? <BoardEmphasis key={`estimate-${estimateEvent.id}`} kind="estimate">{formatEffort(ticket.reportedEffortEstimate)}</BoardEmphasis> : formatEffort(ticket.reportedEffortEstimate)}
                            </span>
                            {ticket.reportedEffortEstimate !== undefined && <small> work units</small>}
                          </dd></div>
                        </dl>
                        <label className="ticket-progress">
                          <span>Reported progress: <strong>{Math.round(ticket.reportedProgress)}%</strong></span>
                          <progress aria-label={`${ticket.id} reported progress`} max={100} value={ticket.reportedProgress} />
                        </label>
                        {statusEvent && feedback.has(statusEvent.id) && <BoardEmphasis key={`status-${statusEvent.id}`} kind="status" />}
                        {diagnostic && <TicketDiagnostics ticket={diagnostic} />}
                      </li>
                    )
                  })}
                </ul>
                {tickets.length === 0 && <p className="column-empty">No tickets<span>Nothing reported in {title}.</span></p>}
              </section>
            )
          })}
        </div>
        <p className="board-note">Rank 1 is highest priority. Unknown effort means no estimate has been reported.</p>
        </div>
        <BoardActivityLog events={activity} engineers={view.developers} onHover={(ticketId, rowId) => targetActivity('hover', ticketId, rowId)} onFocus={(ticketId, rowId) => targetActivity('focus', ticketId, rowId)}
          onActivate={id => focusActivityTicket(cards.current.get(id))} display={activityDisplay} />
        </div>
      </section>

      <section className="developers-section" aria-labelledby="developers-heading">
        <div className="section-heading">
          <h2 id="developers-heading">Developers</h2>
          <p>Your autonomous engineering team</p>
        </div>
        <ul className="developer-list">
          {view.developers.map((developer) => {
            const diagnostic = diagnostics?.developers.find((item) => item.id === developer.id)
            return (
            <li className="developer-card" key={developer.id}>
              <div className="developer-summary">
                <strong>{developer.name}</strong>
                <span>Productivity: <b>{developer.productivity}</b> <small>work/second</small></span>
              </div>
              {diagnostic && <DeveloperDiagnostics developer={diagnostic} />}
            </li>
            )
          })}
        </ul>
        <p className="team-note">Focus builds Flow during uninterrupted work. Judgement helps engineers decide whether changing tasks is worthwhile.</p>
      </section>
    </>
  )
}
