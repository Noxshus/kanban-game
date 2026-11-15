export type WorkflowStatus = 'backlog' | 'todo' | 'in_progress' | 'done'
export type WorkDomain = 'frontend' | 'backend'

export interface Ticket {
  id: string
  title: string
  workDomain: WorkDomain
  // Global position 1..N (1 highest): managerial intent, not guaranteed developer compliance.
  rank: number

   // Actual progress and reported progress are deliberately separate. The Kanban board may not reflect reality.

  actualStatus: WorkflowStatus
  reportedStatus: WorkflowStatus
  // A separate report lets the board differ from actual work as reporting evolves.
  reportedProgress: number

// Represents ticket ownership, NOT necessarily active work. One developer may be assigned multiple tickets.

  assignedDeveloperId?: string
  requiredWork: number
  completedWork: number
}

export interface Developer {
  id: string
  name: string

  // Represents what the developer is actually working on. This may differ from their assigned tickets.

  activeTicketID?: string
  productivity: number
  // Independent non-negative competencies; not mutually exclusive job classes.
  competencies: Record<WorkDomain, number>
  judgement: number
  discipline: number
  // Missing means zero streak; ticket identity prevents carrying focus between tickets.
  focusStreak?: { ticketId: string; duration: number }
  // One immutable decision snapshot survives later progress/rank changes; never an event log.
  lastSelection?: SelectionDecision
}

export interface SelectionDecision {
  managerChoice: { id: string; rank: number; reportedProgress: number }
  opportunity: { id: string; rank: number; reportedProgress: number }
  judgement: number
  discipline: number
  overrideProbability: number
  draw: number | null
  selectedId: string
}

export interface GameState {
  randomState: number
  tickets: Ticket[]
  developers: Developer[]
  simulationTime: number
}
