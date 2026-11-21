import type { Developer, Ticket } from '../game/types'

interface Check { matches: boolean; detail: string }

// Whole percentages match the board's Math.round presentation. Zero-sized work is
// 100% only when actually done; invalid work/progress is never treated as a match.
export function compareTicket(ticket: Ticket, developers: Developer[]) {
  const status: Check = {
    matches: ticket.reportedStatus === ticket.actualStatus,
    detail: `Status: reported ${ticket.reportedStatus}; actual ${ticket.actualStatus}.`,
  }
  const validWork = Number.isFinite(ticket.requiredWork) && ticket.requiredWork >= 0
    && Number.isFinite(ticket.completedWork) && ticket.completedWork >= 0
    && ticket.completedWork <= ticket.requiredWork
  const actualProgress = validWork ? (ticket.requiredWork === 0
    ? (ticket.actualStatus === 'done' ? 100 : 0)
    : ticket.completedWork / ticket.requiredWork * 100) : null
  const validReported = Number.isFinite(ticket.reportedProgress)
    && ticket.reportedProgress >= 0 && ticket.reportedProgress <= 100
  const progress: Check = {
    matches: validReported && actualProgress !== null
      && Math.round(ticket.reportedProgress) === Math.round(actualProgress),
    detail: `Progress: reported ${validReported ? `${Math.round(ticket.reportedProgress)}%` : `invalid (${ticket.reportedProgress})`}; actual ${actualProgress === null ? 'invalid work values' : `${Math.round(actualProgress)}%`}.`,
  }
  const assigned = developers.find(d => d.id === ticket.assignedDeveloperId)
  const active = developers.filter(d => d.activeTicketID === ticket.id)
  const assignedLabel = ticket.assignedDeveloperId === undefined ? 'nobody'
    : assigned ? `${assigned.name} (${assigned.id})` : `unknown developer (${ticket.assignedDeveloperId})`
  const activeLabel = active.length ? active.map(d => `${d.name} (${d.id})`).join(', ') : 'nobody'
  const completed = ticket.actualStatus === 'done'
  // Completion retains ownership as history; it must not require or conceal
  // active work. Unfinished tickets keep the existing operational comparison.
  const assignment: Check = {
    matches: completed ? active.length === 0 && (ticket.assignedDeveloperId === undefined || assigned !== undefined)
      : ticket.assignedDeveloperId === undefined ? active.length === 0
      : assigned !== undefined && active.length === 1 && active[0].id === assigned.id,
    detail: completed
      ? `Active work: N/A — completed.${active.length ? ` Unexpected active claims: ${activeLabel}.` : ''} Historical owner: ${ticket.assignedDeveloperId !== undefined && assigned === undefined ? `invalid developer ID (${ticket.assignedDeveloperId})` : assignedLabel}.`
      : `Assignment/active-work alignment: assigned ${assignedLabel}; actively working ${activeLabel}. Assignment is ownership, which may differ from active work.`,
  }
  const checks = { status, progress, assignment }
  const failures = Object.values(checks).filter(check => !check.matches).map(check => check.detail)
  return { matches: failures.length === 0, checks, details: completed
    ? [assignment.detail, ...failures.filter(detail => detail !== assignment.detail), ...(failures.length ? [] : ['All applicable comparisons match.'])]
    : failures.length ? failures : ['All comparisons match.'] }
}
