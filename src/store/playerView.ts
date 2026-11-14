import type { GameState, Ticket } from '../game/types'
import { clampReportedProgress } from '../game/reportedProgress.ts'

export type PlayerTicket = Pick<
  Ticket,
  'id' | 'title' | 'reportedStatus' | 'reportedProgress' | 'assignedDeveloperId'
>

export function getPlayerView(state: GameState) {
  return {
    simulationTime: state.simulationTime,
    // Explicit selection prevents hidden simulation fields leaking into the interface.
    tickets: state.tickets.map((ticket): PlayerTicket => ({
      id: ticket.id,
      title: ticket.title,
      reportedStatus: ticket.reportedStatus,
      reportedProgress: clampReportedProgress(ticket.reportedProgress),
      assignedDeveloperId: ticket.assignedDeveloperId,
    })),
    developers: state.developers.map(({ id, name, productivity }) => ({
      id, name, productivity,
    })),
  }
}
