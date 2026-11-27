import type { GameState, TicketComplexity } from './types'
import type { BoardObserver } from './boardActivity'
import { observeBoard } from './boardActivity.ts'
import { getTicketComplexity } from './complexity.ts'
import { DISCIPLINE_SCALE, getDiscipline } from './discipline.ts'
import { estimateInitialEffort } from './effortEstimate.ts'
import { firstPublishedEstimate, publishEstimate, validateEstimateHistory } from './estimateHistory.ts'
import { eventTime } from './eventTime.ts'
import { simulationDraw } from './workDecisions.ts'

// Provisional #96 balance; cost is preparation capacity, never working time.
export const ESTIMATION_COSTS: Readonly<Record<TicketComplexity, number>> = Object.freeze({ S: .5, M: 1, L: 2, XL: 3, XXL: 5 })
export const COMMAND_SCALE = 10
export const STARTER_ESTIMATION_CAPACITY = 6
const REFERENCE_CONTRIBUTION = 3 + Math.log(2) + Math.log(1.5)
export const ESTIMATION_CAPACITY_NORMALIZATION = STARTER_ESTIMATION_CAPACITY / REFERENCE_CONTRIBUTION

export interface PlanningOutcome {
  ticketId: string
  result: 'published' | 'retained' | 'not_estimated'
  reportedEffortEstimate?: number
}

export type PlanningState = { stage: 'shortlist'; ticketIds: string[] }
  | { stage: 'estimated'; ticketIds: string[]; outcomes: PlanningOutcome[] }

export type PlanningAction = { type: 'addEstimation'; ticketId: string }
  | { type: 'removeEstimation'; ticketId: string }
  | { type: 'moveEstimation'; ticketId: string; direction: 'up' | 'down' }
  | { type: 'resolveEstimation' }

export const createPlanning = (): PlanningState => ({ stage: 'shortlist', ticketIds: [] })

export function getCommand(state: Pick<GameState, 'manager'>) {
  const command = state.manager === undefined ? 0 : state.manager.command
  if (!Number.isFinite(command) || command < 0) throw new RangeError('Command must be finite and non-negative')
  return command
}

export function estimationCapacity(state: Pick<GameState, 'manager' | 'developers'>) {
  // Consistent summation order makes capacity independent of engineer array order.
  const logs = state.developers.map(developer => Math.log1p(getDiscipline(developer) / DISCIPLINE_SCALE)).sort((a, b) => b - a)
  const contribution = logs.reduce((total, log) => total + log, state.developers.length)
  // Algebraically A * modifier * contribution; a normalized ratio makes the
  // reference team's sixth M ticket affordable exactly, without epsilon/caps.
  return STARTER_ESTIMATION_CAPACITY * (1 + Math.log1p(getCommand(state) / COMMAND_SCALE)) * (contribution / REFERENCE_CONTRIBUTION)
}

export function collectiveMedian(appraisals: readonly number[]) {
  if (!appraisals.length || appraisals.some(value => !Number.isFinite(value) || value < 0)) {
    throw new RangeError('A collective estimate requires finite non-negative engineer appraisals')
  }
  const sorted = [...appraisals].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2) return sorted[middle]
  const lower = sorted[middle - 1], upper = sorted[middle]
  return lower <= Number.MAX_VALUE - upper ? (lower + upper) / 2 : lower / 2 + upper / 2
}

// Transactional and out of working time. Only shared publications and the seeded
// RNG change; individual proposals are local variables, never engineer knowledge.
export function resolveEstimation(state: GameState, ticketIds: readonly string[], observe?: BoardObserver, random?: () => number) {
  if (new Set(ticketIds).size !== ticketIds.length || ticketIds.some(id => !state.tickets.some(ticket => ticket.id === id))) {
    throw new RangeError('Estimation requests must identify distinct existing tickets')
  }
  const game = structuredClone(state), capacity = estimationCapacity(game)
  const draw = random ?? simulationDraw(game)
  const at = eventTime(game.simulationTime, game.simulationTimeRemainder)
  let spent = 0, stopped = false
  const outcomes = ticketIds.map((ticketId): PlanningOutcome => {
    const ticket = game.tickets.find(candidate => candidate.id === ticketId)!
    const cost = ESTIMATION_COSTS[getTicketComplexity(ticket)]
    if (stopped || spent + cost > capacity) {
      stopped = true
      return { ticketId, result: 'not_estimated', reportedEffortEstimate: ticket.reportedEffortEstimate }
    }
    spent += cost // Costs are exact half-integers; compare cumulative cost, not repeated subtraction.
    validateEstimateHistory(ticket)
    const existing = ticket.reportedEffortEstimate
    if (existing !== undefined) firstPublishedEstimate(ticket) // Freeze compatible legacy E0 before a revision.
    const candidate = collectiveMedian(game.developers.map(developer => estimateInitialEffort(
      ticket.requiredWork, developer.judgement, developer.competencies[ticket.workDomain], draw(),
    )))
    const published = existing === undefined || candidate > existing
    if (published) {
      if (existing === undefined) {
        ticket.initialEffortEstimate = { source: 'collective', totalWork: candidate }
        delete ticket.learningBaseline
      }
      publishEstimate(ticket, { source: 'collective' }, candidate, existing === undefined ? 'initial' : 'revision', at)
      observeBoard(observe, ticket, at)
    }
    return { ticketId, result: published ? 'published' : 'retained', reportedEffortEstimate: ticket.reportedEffortEstimate }
  })
  return { game, planning: { stage: 'estimated', ticketIds: [...ticketIds], outcomes } as PlanningState }
}
