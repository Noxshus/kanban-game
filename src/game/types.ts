import type { EventTime } from './eventTime'
import type { WorkAmount } from './work'

export type WorkflowStatus = 'backlog' | 'todo' | 'in_progress' | 'done'
export type WorkDomain = 'frontend' | 'backend'
export type TicketComplexity = 'S' | 'M' | 'L' | 'XL' | 'XXL'

// Array order resolves events at the same compensated instant. Legacy observations
// have unknown dates; they are evidence, not invented historical events.
export type EstimateEvent =
  | { kind: 'assessment'; developerId: string; totalWork: number; reason: 'initial' | 'discovery' | 'overrun'; at: EventTime }
  | { kind: 'legacy_assessment'; developerId: string; totalWork: number; baseline: number; evidence: 'original' | 'published_revision' | 'active_fallback'; at: EventTime | null }
  | { kind: 'publication'; developerId: string; totalWork: number; reason: 'initial' | 'takeover' | 'return' | 'revision'; sourceAssessmentIndex: number; replacedTotalWork?: number; replacedDeveloperId?: string; at: EventTime }
  | { kind: 'legacy_publication'; developerId?: string; totalWork: number; sourceAssessmentIndex?: number; at: null }

export interface EstimateDiscovery {
  ticketId: string; boardEstimate: number; requiredWork: number; judgement: number
  productive: boolean; target: WorkAmount | null
  // Absent in legacy saves; their target already used the old baseline.
  baseline?: number
}

export interface Ticket {
  id: string
  title: string
  workDomain: WorkDomain
  // Intrinsic technical challenge, independent of base effort. Legacy saves omit it (S).
  complexity?: TicketComplexity
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
  // Immutable ticket-original provenance; personal beliefs live in estimateHistory.
  initialEffortEstimate?: { developerId: string; totalWork: number }
  reportedEffortEstimate?: number
  estimateHistory?: EstimateEvent[]
  // Legacy board-only states lack #57 provenance: retain their first observed baseline, not an invented author.
  learningBaseline?: number
  // Explicit false distinguishes a known unused lifetime alarm from legacy saves
  // whose latest discovery may have overwritten all evidence of an earlier alarm.
  overrunEvaluationConsumed?: boolean
  // Legacy #58 per-board suppression, also written on pickup/discovery. Migrated
  // on the first positive advance; its presence alone is not proof of evaluation.
  evaluatedOverrunEstimate?: number
  // One DEV snapshot, not private belief history or a knowledge attribute.
  lastEstimateEvaluation?: { developerId: string; reason: 'discovery' | 'overrun'; personalWork: number | null; candidate: number; published: boolean }
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
  // Gameplay stint: the gross-ledger baseline survives numerical cache refreshes.
  // Missing on legacy saves; prior contributions are protected on restoration.
  workStint?: { ticketId: string; effortOrigin: WorkAmount }
  // Numerical integration origin, not another gameplay clock. Reusing one
  // integral across calls preserves completion/assessment coincidence.
  workSession?: {
    ticketId: string; requiredWork: number; productivity: number; competency: number; focus: number
    complexity?: TicketComplexity
    initialFlowDuration: number; elapsed: number; completionSeconds: number | null
    initialCompletedWork: number; initialRemainder?: Ticket['workRemainder']; lastCompletedWork: number
    originTime?: EventTime
    currentTime?: EventTime
    // Ledger baseline for this integral; absent on older saves. Not a session history.
    effortOrigin?: { total: WorkAmount; produced: WorkAmount }
    estimateEvents?: { discovery: EventTime | null; overrun: EventTime | null }
  }
  // One immutable decision snapshot survives later progress/rank changes; never an event log.
  lastAssessment?: AssessmentDecision
  // Legacy saves only; the event-driven engine never schedules this clock.
  assessmentClock?: { elapsed: number; remaining: number; originTime?: EventTime; dueTime?: EventTime }
  // Only the next seeded work target; personal experience remains exclusively in workLog.
  estimateDiscovery?: EstimateDiscovery
  // Inactive schedules are moved here, never copied or rerolled on a return.
  pausedEstimateDiscoveries?: EstimateDiscovery[]
}

export interface TicketAppraisal {
  id: string
  rank: number
  reportedProgress: number
  rankScore: number
  estimatedTotal: number
  estimateSource: 'remembered' | 'temporary'
  perceivedRemaining: number | null
  completionSeconds: number | null
  logCompletionTime: number | null
  timeLimit: 'zero' | 'infinite' | null
  rankContribution: number
  score: number | null
}

export interface AssessmentDecision {
  trigger: 'pickup' | 'estimate_revision' | 'priority'
  currentTicketId: string | null
  considered: TicketAppraisal[]
  at: EventTime
  flowDuration: number
  outcome: 'pickup' | 'stay' | 'switch'
  selectedId: string
}

export interface GameState {
  randomState: number
  tickets: Ticket[]
  developers: Developer[]
  simulationTime: number
  // Retains ordinary additions' rounding so event origins do not drift by call partition.
  simulationTimeRemainder?: number
  // Gross productive effort, independent of net ticket progress and current ownership.
  // Missing means no known contributions; never infer historical engineer provenance.
  workLog?: { developerId: string; ticketId: string; effort: WorkAmount }[]
}
