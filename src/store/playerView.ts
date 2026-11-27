import type { GameState, Ticket } from '../game/types'
import { clampReportedProgress } from '../game/reportedProgress.ts'
import { compareRank } from '../game/rank.ts'
import { getTicketComplexity } from '../game/complexity.ts'
import { getCommand } from '../game/planning.ts'

export type PlayerTicket = Pick<
  Ticket,
  'id' | 'title' | 'rank' | 'workDomain' | 'reportedStatus' | 'reportedProgress' | 'progressReport' | 'assignedDeveloperId' | 'reportedEffortEstimate'
> & { complexity: NonNullable<Ticket['complexity']> }

export function getPlayerView(state: GameState) {
  return {
    manager: { command: getCommand(state) },
    simulationTime: state.simulationTime,
    ...(state.simulationTimeRemainder !== undefined ? { simulationTimeRemainder: state.simulationTimeRemainder } : {}),
    // Explicit selection prevents hidden simulation fields leaking into the interface.
    tickets: state.tickets.map((ticket): PlayerTicket => ({
      id: ticket.id,
      title: ticket.title,
      workDomain: ticket.workDomain,
      complexity: getTicketComplexity(ticket),
      rank: ticket.rank,
      reportedStatus: ticket.reportedStatus,
      reportedProgress: clampReportedProgress(ticket.reportedProgress),
      ...(ticket.progressReport ? { progressReport: { at: { high: ticket.progressReport.at.high, low: ticket.progressReport.at.low }, estimate: ticket.progressReport.estimate } } : {}),
      assignedDeveloperId: ticket.assignedDeveloperId,
      reportedEffortEstimate: ticket.reportedEffortEstimate,
    })).sort(compareRank),
    developers: state.developers.map(({ id, name, productivity }) => ({
      id, name, productivity,
    })),
  }
}
