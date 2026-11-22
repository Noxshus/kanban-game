import type { BoardObserver, BoardReport } from '../game/boardActivity'
import type { EventTime } from '../game/eventTime'
import { eventInterval, eventTime } from '../game/eventTime.ts'
import { clampReportedProgress } from '../game/reportedProgress.ts'

type PublicEngineer = { id: string; productivity: number }
export interface ProgressProjection {
  ticketId: string
  estimate: number | null
  status: BoardReport['reportedStatus']
  assignee: string | null
  rate: number
  anchorAt: EventTime
  // Log work keeps forecasts representable even when rate*time overflows or
  // a tiny public percentage implies subnormal work. null means zero work.
  logAnchor: number | null
  report?: { percentage: number; at: EventTime; estimate: number | null }
}

function positiveEstimate(report: BoardReport) {
  const estimate = report.reportedEffortEstimate
  return estimate !== undefined && Number.isFinite(estimate) && estimate > 0 ? estimate : null
}
function rateFor(report: BoardReport, engineers: readonly PublicEngineer[]) {
  const rate = engineers.find(engineer => engineer.id === report.assignedDeveloperId)?.productivity
  return report.reportedStatus === 'in_progress' && rate !== undefined && Number.isFinite(rate) && rate > 0 ? rate : 0
}
function anchor(percentage: number, estimate: number | null) {
  return percentage > 0 && estimate !== null ? Math.log(percentage) - Math.log(100) + Math.log(estimate) : null
}
function workAt(item: ProgressProjection, at: EventTime) {
  const elapsed = eventInterval(at, item.anchorAt)
  if (elapsed < 0) throw new RangeError('Public forecast observations must be chronological')
  if (item.rate === 0 || elapsed === 0) return item.logAnchor
  const added = Math.log(item.rate) + Math.log(elapsed)
  if (item.logAnchor === null) return added
  const high = Math.max(item.logAnchor, added), low = Math.min(item.logAnchor, added)
  return high + Math.log1p(Math.exp(low - high))
}
function snapshot(report: BoardReport, engineers: readonly PublicEngineer[], at: EventTime): ProgressProjection {
  const estimate = positiveEstimate(report)
  return { ticketId: report.id, estimate, status: report.reportedStatus, assignee: report.assignedDeveloperId ?? null,
    rate: rateFor(report, engineers), anchorAt: { ...at },
    // Initial/legacy snapshots seed a PRESENT forecast, never a past publication.
    logAnchor: anchor(clampReportedProgress(report.reportedProgress ?? 0), estimate),
    ...(report.progressReport ? { report: { ...structuredClone(report.progressReport), percentage: clampReportedProgress(report.reportedProgress ?? 0) } } : {}) }
}
export function createProgressProjections(reports: readonly BoardReport[], engineers: readonly PublicEngineer[], at = eventTime(0)) {
  return reports.map(report => snapshot(report, engineers, at))
}

export function collectProgressProjections(initial: readonly ProgressProjection[], engineers: readonly PublicEngineer[]) {
  const projections = structuredClone(initial) as ProgressProjection[]
  const byId = new Map(projections.map(item => [item.ticketId, item]))
  const observe: BoardObserver = (report, at) => {
    let item = byId.get(report.id)
    if (!item) { item = snapshot(report, engineers, at); projections.push(item); byId.set(report.id, item); return }
    const publication = report.progressReport
    const fresh = publication && (!item.report || publication.at.high !== item.report.at.high || publication.at.low !== item.report.at.low
      || publication.estimate !== item.report.estimate || report.reportedProgress !== item.report.percentage)
    const estimate = positiveEstimate(report), rate = rateFor(report, engineers)
    const rateChanged = rate !== item.rate || report.reportedStatus !== item.status || (report.assignedDeveloperId ?? null) !== item.assignee
    if (fresh) {
      item.logAnchor = anchor(clampReportedProgress(report.reportedProgress ?? 0), publication.estimate)
      item.anchorAt = { ...publication.at }
      item.report = { ...structuredClone(publication), percentage: clampReportedProgress(report.reportedProgress ?? 0) }
    } else if (rateChanged || item.estimate === null && estimate !== null) {
      item.logAnchor = item.estimate === null && estimate !== null
        ? anchor(clampReportedProgress(report.reportedProgress ?? 0), estimate) : workAt(item, at)
      item.anchorAt = { ...at }
    }
    // Estimate-only revisions change the denominator, not the historical report
    // marker or work origin. Ignore unchanged elapsed-call endpoint observations.
    item.estimate = estimate; item.status = report.reportedStatus
    item.assignee = report.assignedDeveloperId ?? null; item.rate = rate
  }
  return { projections, observe }
}

export function projectedProgress(item: ProgressProjection, at: EventTime): { percentage: number | null; overflow: boolean; underflow?: boolean } {
  if (item.status === 'done') return { percentage: 100, overflow: false }
  if (item.estimate === null) return { percentage: null, overflow: false }
  const work = workAt(item, at)
  if (work === null) return { percentage: 0, overflow: false }
  const percentage = Math.exp(work - Math.log(item.estimate) + Math.log(100))
  if (percentage === 0) return { percentage: null, overflow: false, underflow: true }
  // A public forecast is not actual work. Display an explicit numeric-range
  // overflow rather than storing Infinity, clipping the forecast, or throwing in rendering.
  return { percentage: Number.isFinite(percentage) ? percentage : null, overflow: !Number.isFinite(percentage) }
}
