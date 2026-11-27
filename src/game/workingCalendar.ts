import { eventTime, compareEventTime } from './eventTime.ts'
import type { EventTime } from './eventTime'

export interface WorkingCalendar {
  workingDaysPerWeek: number
  workingHoursPerDay: number
  sprintWeeks: number
  workingMinutesPerSimulationSecond: number
  simulationSecondsPerRealSecond: number
}

// Calendar/display conversion, not a reinterpretation of work or review rates.
export const DEFAULT_WORKING_CALENDAR: Readonly<WorkingCalendar> = Object.freeze({
  workingDaysPerWeek: 5,
  workingHoursPerDay: 8,
  sprintWeeks: 2,
  workingMinutesPerSimulationSecond: 20,
  simulationSecondsPerRealSecond: 1,
})

export function validateCalendar(calendar: WorkingCalendar) {
  for (const value of [calendar.workingDaysPerWeek, calendar.workingHoursPerDay, calendar.sprintWeeks,
    calendar.workingMinutesPerSimulationSecond, calendar.simulationSecondsPerRealSecond]) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('Calendar settings must be positive and finite')
  }
  if (!Number.isInteger(calendar.workingDaysPerWeek) || calendar.workingDaysPerWeek > 7
      || calendar.workingHoursPerDay > 24) throw new RangeError('Invalid working week or working day')
}

function finite(value: number) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Calendar duration exceeds the supported numeric range')
  return value
}

export function sprintWorkingMinutes(calendar: WorkingCalendar) {
  validateCalendar(calendar)
  const minutes = finite(calendar.sprintWeeks * calendar.workingDaysPerWeek * calendar.workingHoursPerDay * 60)
  if (minutes === 0) throw new RangeError('Sprint duration is below numeric resolution')
  return minutes
}

export function sprintSimulationSeconds(calendar: WorkingCalendar) {
  const seconds = finite(sprintWorkingMinutes(calendar) / calendar.workingMinutesPerSimulationSecond)
  if (seconds === 0) throw new RangeError('Sprint duration is below numeric resolution')
  return seconds
}

export function workingMinutes(simulationSeconds: number, calendar: WorkingCalendar) {
  validateCalendar(calendar)
  const minutes = finite(finite(simulationSeconds) * calendar.workingMinutesPerSimulationSecond)
  if (simulationSeconds > 0 && minutes === 0) throw new RangeError('Working time is below numeric resolution')
  return minutes
}

// Extend the ordinary rounded scalar conversion monotonically to compensated
// input. Between adjacent binary64 inputs, interpolate their rounded outputs.
// Input is ALWAYS cumulative milliseconds; output is simulation seconds. This
// agrees exactly with JS (milliseconds / 1000) * speed at scalar inputs and is
// continuous at high-word transitions. Independent high/low scaling lacks these
// guarantees because the rounded high product can jump underneath its correction.
export function convertPlaybackElapsed(input: EventTime, calendar: WorkingCalendar): EventTime {
  validateCalendar(calendar)
  const elapsed = eventTime(input.high, input.low)
  if (compareEventTime(elapsed, eventTime(0)) < 0) throw new RangeError('Playback elapsed time must be non-negative')
  const convert = (value: number) => {
    const seconds = finite(finite(value) / 1000 * calendar.simulationSecondsPerRealSecond)
    if (value > 0 && seconds === 0) throw new RangeError('Playback interval is below numeric resolution')
    return seconds
  }
  const high = convert(elapsed.high)
  if (elapsed.low === 0) return eventTime(high)
  const bits = new DataView(new ArrayBuffer(8))
  bits.setFloat64(0, elapsed.high)
  bits.setBigUint64(0, bits.getBigUint64(0) + (elapsed.low > 0 ? 1n : -1n))
  const adjacent = bits.getFloat64(0)
  const distance = Math.abs(adjacent - elapsed.high)
  const step = Math.abs(convert(adjacent) - high)
  const correction = elapsed.low * (step / distance)
  if (!Number.isFinite(correction) || (elapsed.low !== 0 && step !== 0 && correction === 0)) {
    throw new RangeError('Playback correction is below numeric resolution')
  }
  return eventTime(high, correction)
}
