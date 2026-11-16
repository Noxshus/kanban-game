import type { EventTime } from './eventTime'

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
  // Original engineer belief/provenance and public report can diverge in later systems.
  // Absence supports old saves and tickets not yet picked up; either record prevents re-publication.
  initialEffortEstimate?: { developerId: string; totalWork: number }
  reportedEffortEstimate?: number
  requiredWork: number
  completedWork: number
  // Numerical remainder preserves work lost when the displayed total rounds.
  // Snapshots invalidate it if an external fixture/edit changes work quantities.
  workRemainder?: { mantissa: number; exponent: number; requiredWork: number; completedWork: number; roundingError: number; remainderCorrection: number }
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
  focus: number
  // Missing means zero Flow; ticket identity prevents carrying it between tickets.
  flowStreak?: { ticketId: string; duration: number }
  // Numerical integration origin, not another gameplay clock. Reusing one
  // integral across calls preserves completion/assessment coincidence.
  workSession?: {
    ticketId: string; requiredWork: number; productivity: number; competency: number; focus: number
    initialFlowDuration: number; elapsed: number; completionSeconds: number | null
    initialCompletedWork: number; initialRemainder?: Ticket['workRemainder']; lastCompletedWork: number
    originTime?: EventTime
    currentTime?: EventTime
  }
  // One immutable decision snapshot survives later progress/rank changes; never an event log.
  lastAssessment?: AssessmentDecision
  assessmentClock?: { elapsed: number; remaining: number; originTime?: EventTime; dueTime?: EventTime }
}

export interface CandidateScore {
  id: string
  rank: number
  reportedProgress: number
  rankScore: number
  opportunityScore: number
  rankContribution: number
  opportunityContribution: number
  score: number
}

export interface AssessmentDecision {
  kind: 'pickup' | 'reconsideration'
  current: CandidateScore
  alternative: CandidateScore | null
  nomination: CandidateScore | null
  judgement: number
  flowDuration: number
  staySeconds: number | null
  switchSeconds: number | null
  efficiencyAdvantage: number | null
  efficiencyLimit: 'stay' | 'switch' | null
  rankPreference: number
  complexity: number
  noiseScale: number
  draw: number | null
  error: number
  perceivedAdvantage: number | null
  outcome: 'stay' | 'switch' | 'unambiguous'
  selectedId: string
}

export interface GameState {
  randomState: number
  tickets: Ticket[]
  developers: Developer[]
  simulationTime: number
  // Retains ordinary additions' rounding so event origins do not drift by call partition.
  simulationTimeRemainder?: number
}
