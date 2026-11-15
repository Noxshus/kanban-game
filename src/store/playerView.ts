import type { GameState, Ticket } from '../game/types'
import { clampReportedProgress } from '../game/reportedProgress.ts'
import { compareRank } from '../game/rank.ts'

export type PlayerTicket = Pick<
  Ticket,
  'id' | 'title' | 'rank' | 'workDomain' | 'reportedStatus' | 'reportedProgress' | 'assignedDeveloperId'
>

export function getPlayerView(state: GameState) {
  return {
    simulationTime: state.simulationTime,
    // Explicit selection prevents hidden simulation fields leaking into the interface.
    tickets: state.tickets.map((ticket): PlayerTicket => ({
      id: ticket.id,
      title: ticket.title,
      workDomain: ticket.workDomain,
      rank: ticket.rank,
      reportedStatus: ticket.reportedStatus,
      reportedProgress: clampReportedProgress(ticket.reportedProgress),
      assignedDeveloperId: ticket.assignedDeveloperId,
    })).sort(compareRank),
    developers: state.developers.map(({ id, name, productivity }) => ({
      id, name, productivity,
    })),
  }
}
