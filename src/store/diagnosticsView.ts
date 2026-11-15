import type { GameState } from '../game/types'
import { compareTicket } from './ticketComparison.ts'
import { getEffectiveProductivity } from '../game/productivity.ts'

// Authoritative development information stays separate from player reports so visibility can evolve.
export function getDiagnosticsView(state: GameState) {
  const claimed = new Set<string>()
  const developers = state.developers.map((developer) => {
    const ticket = state.tickets.find((candidate) => candidate.id === developer.activeTicketID)
    // Match the engine's reservation rule: stale/completed references and duplicate claims are idle.
    const activeTicket = ticket && ticket.actualStatus !== 'done' && ticket.actualStatus !== 'backlog'
      && ticket.completedWork < ticket.requiredWork && !claimed.has(ticket.id)
      ? ticket : undefined
    if (activeTicket) claimed.add(activeTicket.id)
    return {
      id: developer.id,
      name: developer.name,
      productivity: developer.productivity,
      competencies: { ...developer.competencies },
      activeTicket: activeTicket ? { id: activeTicket.id, title: activeTicket.title } : null,
      workRate: activeTicket ? getEffectiveProductivity(developer, activeTicket) : 0,
      assignedTicketCount: state.tickets.filter((candidate) =>
        candidate.assignedDeveloperId === developer.id,
      ).length,
    }
  })
  const tickets = state.tickets.map((ticket) => {
    const activeDeveloper = developers.find((developer) => developer.activeTicket?.id === ticket.id)
    const remainingWork = Math.max(0, ticket.requiredWork - ticket.completedWork)
    const workRate = activeDeveloper ? activeDeveloper.workRate : 0
    // Backlog is uncommitted, so zero remaining work does not imply completion.
    const complete = ticket.actualStatus !== 'backlog'
      && (ticket.actualStatus === 'done' || remainingWork === 0)
    return {
      id: ticket.id,
      comparison: compareTicket(ticket, state.developers),
      rank: ticket.rank,
      workDomain: ticket.workDomain,
      requiredWork: ticket.requiredWork,
      completedWork: ticket.completedWork,
      remainingWork,
      activeDeveloperName: activeDeveloper?.name ?? null,
      workRate,
      // No queue prediction: this estimate assumes the current active rate continues.
      estimatedSeconds: complete && remainingWork === 0 ? 0
        : !complete && workRate !== null && workRate > 0 && Number.isFinite(remainingWork / workRate)
          ? remainingWork / workRate : null,
    }
  })
  return {
    tickets,
    developers,
    team: {
      completedTickets: state.tickets.filter((ticket) =>
        ticket.actualStatus !== 'backlog'
          && (ticket.actualStatus === 'done' || ticket.completedWork >= ticket.requiredWork),
      ).length,
      totalTickets: tickets.length,
      activeDevelopers: developers.filter((developer) => developer.activeTicket !== null).length,
      totalDevelopers: developers.length,
      completedWork: tickets.reduce((total, ticket) => total + ticket.completedWork, 0),
      requiredWork: tickets.reduce((total, ticket) => total + ticket.requiredWork, 0),
      workRate: developers.reduce<number | null>((total, developer) => {
        if (total === null || developer.workRate === null) return null
        const sum = total + developer.workRate
        return Number.isFinite(sum) ? sum : null
      }, 0),
    },
  }
}

export type DiagnosticsView = ReturnType<typeof getDiagnosticsView>
