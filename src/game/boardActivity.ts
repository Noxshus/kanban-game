import type { Ticket, WorkflowStatus } from './types'
import type { EventTime } from './eventTime'

export const ACTIVITY_LIMIT = 100
export type BoardReport = Pick<Ticket, 'id' | 'title' | 'reportedStatus' | 'reportedEffortEstimate' | 'assignedDeveloperId'>
  & Partial<Pick<Ticket, 'reportedProgress' | 'progressReport'>>
export type BoardObserver = (report: Readonly<BoardReport>, at: Readonly<EventTime>) => void

type BoardChange =
  | { kind: 'status'; from: WorkflowStatus; to: WorkflowStatus }
  | { kind: 'estimate'; from: number | null; to: number }
  | { kind: 'assignment'; from: string | null; to: string | null }
export type BoardActivity = { id: number; ticketId: string; ticketTitle: string; at: EventTime } & BoardChange

function boardReport(ticket: BoardReport): BoardReport {
  return { id: ticket.id, title: ticket.title, reportedStatus: ticket.reportedStatus,
    reportedEffortEstimate: ticket.reportedEffortEstimate, assignedDeveloperId: ticket.assignedDeveloperId,
    reportedProgress: ticket.reportedProgress,
    ...(ticket.progressReport ? { progressReport: { at: { high: ticket.progressReport.at.high, low: ticket.progressReport.at.low }, estimate: ticket.progressReport.estimate } } : {}) }
}

// The observation boundary copies ONLY board fields, never handing a callback
// mutable simulation objects or hidden assessments. It does not drive mechanics.
export function observeBoard(observer: BoardObserver | undefined, ticket: Ticket, at: EventTime) {
  observer?.(boardReport(ticket), { ...at })
}

export function collectBoardActivity(initial: readonly BoardReport[], firstId = 1, onEvent?: (event: BoardActivity) => void) {
  const reports = new Map(initial.map(ticket => [ticket.id, boardReport(ticket)]))
  const events: BoardActivity[] = []
  let nextId = firstId
  const observe: BoardObserver = (report, at) => {
    const before = reports.get(report.id)
    const append = (change: BoardChange) => {
      events.push({ ...change, id: nextId++, ticketId: report.id, ticketTitle: report.title, at: { ...at } })
      onEvent?.(structuredClone(events[events.length - 1]))
      if (events.length > ACTIVITY_LIMIT) events.shift()
    }
    // Seeding snapshots is silent, including loading an already-populated board.
    // Repeated observations deduplicate unchanged reports, not genuine reversals.
    if (before) {
      if (before.reportedStatus !== report.reportedStatus) append({ kind: 'status', from: before.reportedStatus, to: report.reportedStatus })
      if (report.reportedEffortEstimate !== undefined && before.reportedEffortEstimate !== report.reportedEffortEstimate) {
        append({ kind: 'estimate', from: before.reportedEffortEstimate ?? null, to: report.reportedEffortEstimate })
      }
      if (before.assignedDeveloperId !== report.assignedDeveloperId) append({ kind: 'assignment', from: before.assignedDeveloperId ?? null, to: report.assignedDeveloperId ?? null })
    }
    reports.set(report.id, boardReport(report))
  }
  return { observe, events, get nextId() { return nextId } }
}
