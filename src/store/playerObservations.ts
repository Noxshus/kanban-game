import type { BoardObserver, BoardReport } from '../game/boardActivity'
import type { EventTime } from '../game/eventTime'

export interface ObservedPublication {
  from: number | null
  to: number
  at: EventTime
}
export interface TicketObservation {
  ticketId: string
  estimate: number | null
  publications: ObservedPublication[]
}

function firstObservation(report: BoardReport): TicketObservation {
  return { ticketId: report.id, estimate: report.reportedEffortEstimate ?? null, publications: [] }
}

export function createPlayerObservations(reports: readonly BoardReport[]): TicketObservation[] {
  // A loaded board is a starting observation, not an invented publication history.
  return reports.map(firstObservation)
}

export function collectPlayerObservations(initial: readonly TicketObservation[]) {
  // Retain public publication evidence, dropping obsolete freshness fields from
  // local saves. Incidental elapsed-call endpoints are not a reporting cadence
  // from which partition-independent progress ages can be inferred (#35/#79).
  const observations = initial.map(({ ticketId, estimate, publications }) => ({
    ticketId, estimate, publications: structuredClone(publications),
  }))
  const byId = new Map(observations.map(item => [item.ticketId, item]))
  const observe: BoardObserver = (report, at) => {
    const previous = byId.get(report.id)
    if (!previous) {
      const item = firstObservation(report)
      observations.push(item); byId.set(report.id, item)
      return
    }
    const estimate = report.reportedEffortEstimate ?? null
    if (estimate !== null && estimate !== previous.estimate) {
      previous.publications.push({ from: previous.estimate, to: estimate, at: { ...at } })
    }
    previous.estimate = estimate
  }
  return { observations, observe }
}

export function getTicketObservation(observation: TicketObservation | undefined) {
  return {
    revisionCount: observation?.publications.filter(publication => publication.from !== null).length ?? 0,
    publications: observation?.publications ?? [],
  }
}

export type TicketObservationView = ReturnType<typeof getTicketObservation> & { ticketId: string }
export function getPlayerObservations(observations: readonly TicketObservation[] | undefined): TicketObservationView[] {
  return (observations ?? []).map(item => ({ ticketId: item.ticketId, ...getTicketObservation(item) }))
}
