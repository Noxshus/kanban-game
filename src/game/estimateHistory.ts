import type { Developer, EstimateEvent, Ticket } from './types'
import type { EventTime } from './eventTime'
import { compareEventTime } from './eventTime.ts'
import { estimateInitialEffort } from './effortEstimate.ts'

function validEffort(ticket: Ticket, value: number) {
  if (!Number.isFinite(value) || value < 0 || value > ticket.requiredWork
      || ticket.requiredWork > 0 && value === 0) throw new RangeError('Estimate history requires valid positive effort within actual total')
}

export function validateEstimateHistory(ticket: Ticket) {
  let previous: EventTime | null = null
  for (const [index, event] of (ticket.estimateHistory ?? []).entries()) {
    validEffort(ticket, event.totalWork)
    if ((event.kind !== 'legacy_publication' || event.developerId !== undefined) && !event.developerId) {
      throw new RangeError('Estimate history requires an engineer ID')
    }
    if ((event.kind === 'assessment' || event.kind === 'publication') && !event.at) {
      throw new RangeError('New estimate events require an event time')
    }
    if (event.at) {
      if (!Number.isFinite(event.at.high) || !Number.isFinite(event.at.low)
          || previous && compareEventTime(event.at, previous) < 0) throw new RangeError('Estimate history must be chronological')
      previous = event.at
    }
    if (event.kind === 'legacy_assessment') validEffort(ticket, event.baseline)
    if (event.kind === 'publication' || event.kind === 'legacy_publication') {
      if (event.kind === 'publication' && event.sourceAssessmentIndex === undefined) {
        throw new RangeError('Publication requires an assessment source')
      }
      if (event.sourceAssessmentIndex !== undefined) {
        const source = ticket.estimateHistory![event.sourceAssessmentIndex]
        if (!Number.isInteger(event.sourceAssessmentIndex) || event.sourceAssessmentIndex >= index
            || !source || source.kind !== 'assessment' && source.kind !== 'legacy_assessment'
            || source.developerId !== event.developerId || source.totalWork !== event.totalWork) {
          throw new RangeError('Publication must reference its actual prior personal assessment')
        }
      }
    }
  }
}

function migrateHistory(ticket: Ticket) {
  if (ticket.estimateHistory !== undefined) return
  const history: EstimateEvent[] = []
  const original = ticket.initialEffortEstimate
  const evaluation = ticket.lastEstimateEvaluation
  if (original) {
    validEffort(ticket, original.totalWork)
    history.push({ kind: 'legacy_assessment', ...original, baseline: original.totalWork, evidence: 'original', at: null })
  }
  // Only a published legacy snapshot proves adoption. Unpublished mathematical
  // candidates do not establish an otherwise missing personal opinion.
  if (evaluation?.published && (!original || evaluation.developerId !== original.developerId || evaluation.candidate !== original.totalWork)) {
    const baseline = original?.totalWork ?? ticket.learningBaseline ?? ticket.reportedEffortEstimate!
    validEffort(ticket, baseline); validEffort(ticket, evaluation.candidate)
    history.push({ kind: 'legacy_assessment', developerId: evaluation.developerId, totalWork: evaluation.candidate,
      baseline, evidence: 'published_revision', at: null })
  }
  if (ticket.reportedEffortEstimate !== undefined) {
    validEffort(ticket, ticket.reportedEffortEstimate)
    const index = history.findLastIndex(event => event.totalWork === ticket.reportedEffortEstimate)
    const source = history[index]
    history.push({ kind: 'legacy_publication', totalWork: ticket.reportedEffortEstimate, at: null,
      ...(source ? { developerId: source.developerId, sourceAssessmentIndex: index } : {}) })
  }
  ticket.estimateHistory = history
}

export function personalEstimate(ticket: Ticket, developerId: string) {
  // Read established legacy evidence without migrating or mutating an unchosen
  // ticket during appraisal. Real pickup imports that same evidence into history.
  if (ticket.estimateHistory === undefined) {
    const original = ticket.initialEffortEstimate
    const evaluation = ticket.lastEstimateEvaluation
    if (evaluation?.published && evaluation.developerId === developerId) {
      return { baseline: original?.totalWork ?? ticket.learningBaseline ?? ticket.reportedEffortEstimate!,
        totalWork: evaluation.candidate, index: -1 }
    }
    if (original?.developerId === developerId) return { baseline: original.totalWork, totalWork: original.totalWork, index: -1 }
  }
  const opinions = (ticket.estimateHistory ?? []).flatMap((event, index) =>
    (event.kind === 'assessment' || event.kind === 'legacy_assessment') && event.developerId === developerId ? [{ event, index }] : [])
  if (!opinions.length) return undefined
  const first = opinions[0].event, last = opinions.at(-1)!
  return { baseline: first.kind === 'legacy_assessment' ? first.baseline : first.totalWork,
    totalWork: last.event.totalWork, index: last.index }
}

// Upgrade an already-active old save without a new random signal or fictitious
// past author. This explicitly observed compatibility belief is not an assessment.
export function restoreLegacyEstimate(ticket: Ticket, developerId: string, at: EventTime) {
  const migrating = ticket.estimateHistory === undefined
  migrateHistory(ticket)
  let opinion = personalEstimate(ticket, developerId)
  if ((!opinion || migrating && ticket.reportedEffortEstimate !== undefined && opinion.totalWork !== ticket.reportedEffortEstimate)
      && (ticket.initialEffortEstimate || ticket.reportedEffortEstimate !== undefined)) {
    const baseline = ticket.initialEffortEstimate?.totalWork ?? ticket.learningBaseline ?? ticket.reportedEffortEstimate!
    const totalWork = ticket.reportedEffortEstimate ?? baseline
    validEffort(ticket, baseline); validEffort(ticket, totalWork)
    if (!ticket.initialEffortEstimate) ticket.learningBaseline ??= baseline
    ticket.estimateHistory!.push({ kind: 'legacy_assessment', developerId, baseline, totalWork, evidence: 'active_fallback', at: { ...at } })
    opinion = personalEstimate(ticket, developerId)
  }
  return opinion
}

export function publishEstimate(ticket: Ticket, developerId: string, reason: Extract<EstimateEvent, {kind: 'publication'}>['reason'], at: EventTime) {
  const opinion = personalEstimate(ticket, developerId)!
  const previous = ticket.estimateHistory!.findLast(event => event.kind === 'publication' || event.kind === 'legacy_publication')
  const board = ticket.reportedEffortEstimate
  ticket.estimateHistory!.push({ kind: 'publication', developerId, totalWork: opinion.totalWork, reason,
    sourceAssessmentIndex: opinion.index, at: { ...at },
    ...(board !== undefined ? { replacedTotalWork: board } : {}),
    ...(previous?.totalWork === board && previous?.developerId ? { replacedDeveloperId: previous.developerId } : {}) })
  ticket.reportedEffortEstimate = opinion.totalWork
}

export function encounterEstimate(ticket: Ticket, developer: Developer, at: EventTime, draw: () => number, restoring = false, appraisal?: number) {
  const legacy = ticket.estimateHistory === undefined && (ticket.initialEffortEstimate !== undefined || ticket.reportedEffortEstimate !== undefined)
  if (restoring && legacy) {
    restoreLegacyEstimate(ticket, developer.id, at)
    return
  }
  migrateHistory(ticket)
  const opinion = personalEstimate(ticket, developer.id)
  // Restoring an existing active claim is not a return or a publication event.
  if (restoring && opinion) return
  if (!opinion) {
    // Promote the winning transient appraisal, without a second estimate roll.
    const totalWork = appraisal ?? estimateInitialEffort(ticket.requiredWork, developer.judgement, developer.competencies[ticket.workDomain], draw())
    validEffort(ticket, totalWork)
    ticket.estimateHistory!.push({ kind: 'assessment', developerId: developer.id, totalWork, reason: 'initial', at: { ...at } })
    // Existing ticket-original provenance, including unknown legacy authors, is never replaced.
    if (!legacy && ticket.initialEffortEstimate === undefined && ticket.reportedEffortEstimate === undefined
        && ticket.estimateHistory!.length === 1) ticket.initialEffortEstimate = { developerId: developer.id, totalWork }
    publishEstimate(ticket, developer.id, ticket.reportedEffortEstimate === undefined ? 'initial' : 'takeover', at)
  } else publishEstimate(ticket, developer.id, 'return', at)
}

export function pauseDiscovery(developer: Developer) {
  if (!developer.estimateDiscovery) return
  const pending = developer.estimateDiscovery
  developer.pausedEstimateDiscoveries = (developer.pausedEstimateDiscoveries ?? []).filter(saved => saved.ticketId !== pending.ticketId)
  developer.pausedEstimateDiscoveries.push(pending)
  delete developer.estimateDiscovery
}

export function resumeDiscovery(developer: Developer, ticketId: string) {
  const saved = developer.pausedEstimateDiscoveries?.find(schedule => schedule.ticketId === ticketId)
  if (saved) {
    developer.estimateDiscovery = saved
    developer.pausedEstimateDiscoveries = developer.pausedEstimateDiscoveries!.filter(schedule => schedule.ticketId !== ticketId)
    if (!developer.pausedEstimateDiscoveries.length) delete developer.pausedEstimateDiscoveries
  }
}
