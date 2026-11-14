export type WorkflowStatus = 'backlog' | 'todo' | 'in_progress' | 'done'

export interface Ticket {
  id: string
  title: string

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
}

export interface GameState {
  tickets: Ticket[]
  developers: Developer[]
  simulationTime: number
}
