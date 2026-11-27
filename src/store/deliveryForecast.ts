import type { PlayerTicket } from './playerView'
import type { WorkingCalendar } from '../game/workingCalendar'
import { sprintSimulationSeconds, sprintWorkingMinutes } from '../game/workingCalendar.ts'
import { clampReportedProgress } from '../game/reportedProgress.ts'
import { compareWork, scaleWork, workAmount } from '../game/work.ts'

type PublicEngineer = { id: string; name: string; productivity: number }
type PublicTicket = Pick<PlayerTicket, 'id' | 'title' | 'reportedEffortEstimate' | 'reportedProgress'>
export interface ForecastOption {
  engineerId: string; baseProductivity: number; beforeSeconds: number
  seconds: number | null; finishSeconds: number | null
}
export interface TicketForecast {
  ticketId: string; title: string; estimate: number | null; progress: number
  remainingWork: number | null; result: 'forecast' | 'unknown' | 'unforecastable'
  engineerId: string | null; seconds: number | null; finishSeconds: number | null
  reason: string | null; options: ForecastOption[]
}

// Deliberately public inputs only. Until #80, base productivity is the same
// interim rate used by #87; hidden domain competency/Flow cannot be inferred.
// This is a deterministic workload preview, not another simulation or assignment.
export function forecastDelivery(tickets: readonly PublicTicket[], engineers: readonly PublicEngineer[], calendar: WorkingCalendar) {
  const sprintSeconds = sprintSimulationSeconds(calendar), sprintHours = sprintWorkingMinutes(calendar) / 60
  const hoursPerSecond = sprintHours / sprintSeconds
  const loads = [...engineers].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(({ id, name, productivity }) => ({ id, name, productivity, seconds: 0, ticketIds: [] as string[] }))
  const rows = tickets.map((ticket): TicketForecast => {
    const estimate = ticket.reportedEffortEstimate
    const row: TicketForecast = { ticketId: ticket.id, title: ticket.title, estimate: estimate ?? null,
      progress: clampReportedProgress(ticket.reportedProgress), remainingWork: null,
      result: 'unforecastable', engineerId: null, seconds: null, finishSeconds: null, reason: null, options: [] }
    if (estimate === undefined) return { ...row, result: 'unknown', reason: 'No published estimate; effort is unquantified.' }
    if (!Number.isFinite(estimate) || estimate < 0) return { ...row, reason: 'Published estimate is outside the supported range.' }
    const remaining = scaleWork(workAmount(estimate), 1 - row.progress / 100)
    const scalar = remaining.mantissa * 2 ** remaining.exponent
    // Subnormal conversion may round a positive work numerator before division.
    const exactScalar = Number.isFinite(scalar) && compareWork(workAmount(scalar), remaining) === 0
    row.remainingWork = remaining.mantissa > 0 && (scalar === 0 || !Number.isFinite(scalar)) ? null : scalar
    let best: typeof loads[number] | undefined, bestOption: ForecastOption | undefined
    for (const engineer of loads) {
      let seconds: number | null = null
      if (Number.isFinite(engineer.productivity)) {
        if (remaining.mantissa === 0) seconds = 0
        else if (engineer.productivity > 0) {
          const ordinary = scalar / engineer.productivity
          const rate = workAmount(engineer.productivity)
          const ratio = remaining.mantissa / rate.mantissa, power = remaining.exponent - rate.exponent
          const scaled = ratio * 2 ** power
          const duration = exactScalar && ordinary > 0 && Number.isFinite(ordinary) ? ordinary
            : scaled > 0 && Number.isFinite(scaled) ? scaled : Math.exp(Math.log(ratio) + power * Math.LN2)
          if (duration > 0 && Number.isFinite(duration)) seconds = duration
        }
      }
      const finish = seconds === null ? null : engineer.seconds + seconds
      const hours = finish === null ? null : finish * hoursPerSecond
      const representable = finish !== null && Number.isFinite(finish) && hours !== null && Number.isFinite(hours)
        && (finish === 0 || hours > 0)
      const option: ForecastOption = { engineerId: engineer.id, baseProductivity: engineer.productivity,
        beforeSeconds: engineer.seconds, seconds, finishSeconds: representable ? finish : null }
      row.options.push(option)
      // Sorted engineer IDs provide stable ties, independent of input array order.
      if (option.finishSeconds !== null && (!bestOption || option.finishSeconds < bestOption.finishSeconds!)) {
        best = engineer; bestOption = option
      }
    }
    if (!best || !bestOption) return { ...row, reason: !loads.length ? 'No engineers available.'
      : 'No positive public rate or representable completion duration.' }
    best.seconds = bestOption.finishSeconds!
    best.ticketIds.push(ticket.id)
    return { ...row, result: 'forecast', engineerId: best.id, seconds: bestOption.seconds, finishSeconds: best.seconds }
  })
  const busiestSeconds = Math.max(0, ...loads.map(engineer => engineer.seconds))
  const percentage = busiestSeconds / sprintSeconds * 100
  const quantified = rows.some(row => row.result === 'forecast')
  const representablePercentage = Number.isFinite(percentage) && (busiestSeconds === 0 || percentage > 0)
  return { sprintHours, hoursPerSecond,
    utilisation: quantified && representablePercentage ? percentage : null,
    utilisationReason: quantified && !representablePercentage ? 'Utilisation is outside the supported numeric display range.' : null,
    unknownCount: rows.filter(row => row.result === 'unknown').length,
    unforecastableCount: rows.filter(row => row.result === 'unforecastable').length,
    engineers: loads.map(engineer => ({ ...engineer, hours: engineer.seconds * hoursPerSecond })), tickets: rows }
}

export type DeliveryForecast = ReturnType<typeof forecastDelivery>
