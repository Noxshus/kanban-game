import type { Developer, EstimateAuthor, EstimateEvent, Ticket } from './types'
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
    const collective = 'source' in event && event.source === 'collective'
    if (collective && (event.developerId !== undefined || event.kind !== 'publication' && event.kind !== 'legacy_publication')) {
      throw new RangeError('Collective publications cannot be attributed to an individual engineer')
    }
    if (!collective && (event.kind !== 'legacy_publication' || event.developerId !== undefined) && !event.developerId) {
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

// Keep board history as evidence, never as a source of personal beliefs. Old
// assessment records are removed; publication author/time remain exactly as saved.
export function migrateEstimateHistory(ticket: Ticket) {
  if (ticket.estimateHistory !== undefined) {
    const first = ticket.estimateHistory.find(event => event.kind === 'publication' || event.kind === 'legacy_publication')
    const original = ticket.initialEffortEstimate
    // An explicit initial publication proves the board was Unknown. Older private
    // provenance must yield to it; partial revision/takeover history proves no such thing.
    if (first?.kind === 'publication' && first.reason === 'initial' && original
        && (original.totalWork !== first.totalWork || original.developerId !== first.developerId || original.source !== first.source)) {
      ticket.initialEffortEstimate = first.source === 'collective'
        ? { source: 'collective', totalWork: first.totalWork }
        : { developerId: first.developerId, totalWork: first.totalWork }
      delete ticket.learningBaseline
    }
    ticket.estimateHistory = ticket.estimateHistory.flatMap(event => {
      if (event.kind !== 'publication' && event.kind !== 'legacy_publication') return []
      const publication = { ...event }
      delete publication.sourceAssessmentIndex
      return [publication]
    })
    return
  }
  if (ticket.reportedEffortEstimate === undefined) return
  const history: EstimateEvent[] = []
  const original = ticket.initialEffortEstimate
  const evaluation = ticket.lastEstimateEvaluation
  if (original) {
    validEffort(ticket, original.totalWork)
    history.push({ kind: 'legacy_publication', ...original, at: null })
  }
  const board = ticket.reportedEffortEstimate
  validEffort(ticket, board)
  // A no-op evaluation cannot establish who published an earlier report.
  const knownPublisher = evaluation?.published && evaluation.candidate === board ? evaluation.developerId : undefined
  if (!original || board !== original.totalWork || knownPublisher && knownPublisher !== original.developerId) {
    history.push({ kind: 'legacy_publication', totalWork: board, at: null,
      ...(knownPublisher ? { developerId: knownPublisher } : {}) })
  }
  ticket.estimateHistory = history
}

export function firstPublishedEstimate(ticket: Ticket) {
  if (ticket.reportedEffortEstimate === undefined) return null
  migrateEstimateHistory(ticket)
  // Board-only legacy saves have no known original author. Freeze the earliest
  // known shared reference once, rather than compounding work into later reports.
  const baseline = ticket.initialEffortEstimate?.totalWork ?? (ticket.learningBaseline ??=
    ticket.estimateHistory?.find(event => event.kind === 'publication' || event.kind === 'legacy_publication')?.totalWork
    ?? ticket.reportedEffortEstimate)
  validEffort(ticket, baseline)
  return baseline
}

export function publishEstimate(ticket: Ticket, author: string | Extract<EstimateAuthor, { source: 'collective' }>, totalWork: number, reason: 'initial' | 'revision', at: EventTime) {
  validEffort(ticket, totalWork)
  migrateEstimateHistory(ticket)
  const previous = ticket.estimateHistory?.at(-1)
  const board = ticket.reportedEffortEstimate
  // A genuine first publication is not legacy evidence of an earlier crossing.
  // Both individual and collective reports preserve any explicit lifetime history.
  if (board === undefined) ticket.overrunEvaluationConsumed ??= false
  const history = ticket.estimateHistory ??= []
  history.push({ kind: 'publication', ...(typeof author === 'string' ? { developerId: author } : { source: 'collective' as const }), totalWork, reason, at: { ...at },
    ...(board !== undefined ? { replacedTotalWork: board } : {}),
    ...(previous?.totalWork === board && previous?.developerId ? { replacedDeveloperId: previous.developerId } : {}),
    ...(previous && previous.totalWork === board && 'source' in previous && previous.source === 'collective' ? { replacedSource: 'collective' as const } : {}) })
  ticket.reportedEffortEstimate = totalWork
}

export function encounterEstimate(ticket: Ticket, developer: Developer, at: EventTime, draw: () => number, appraisal?: number) {
  migrateEstimateHistory(ticket)
  if (ticket.reportedEffortEstimate !== undefined) return
  // Promote only an Unknown ticket's winning preview. Existing board estimates
  // are shared references; takeover/return never grants an estimate or publication.
  const totalWork = appraisal ?? estimateInitialEffort(ticket.requiredWork, developer.judgement, developer.competencies[ticket.workDomain], draw())
  validEffort(ticket, totalWork)
  ticket.initialEffortEstimate = { developerId: developer.id, totalWork }
  delete ticket.learningBaseline
  publishEstimate(ticket, developer.id, totalWork, 'initial', at)
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
