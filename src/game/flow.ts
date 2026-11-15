import type { Developer } from './types'

// Provisional #51 balance; no cap or asymptote is applied to time or Focus.
const BONUS_SCALE = 0.25
const FOCUS_SCALE = 5
const TIME_SCALE = 10

function growthRate(focus: number) {
  if (!Number.isFinite(focus) || focus < 0) throw new RangeError('Focus must be finite and non-negative')
  return 1 / TIME_SCALE + focus / FOCUS_SCALE / TIME_SCALE
}

function validateTime(time: number) {
  if (!Number.isFinite(time) || time < 0) throw new RangeError('Flow time must be finite and non-negative')
}

function logGrowth(time: number, rate: number) {
  const product = time * rate
  // The product can overflow even though its logarithm is representable.
  return Number.isFinite(product) ? Math.log1p(product) : Math.log(time) + Math.log(rate)
}

export function getFlowBonus(time: number, focus: number) {
  validateTime(time)
  return BONUS_SCALE * logGrowth(time, growthRate(focus))
}

export function getFlowDuration(developer: Developer, ticketId: string) {
  const time = developer.flowStreak?.ticketId === ticketId ? developer.flowStreak.duration : 0
  validateTime(time)
  return time
}

export function getAverageFlowMultiplier(time: number, elapsed: number, focus: number) {
  validateTime(time)
  validateTime(elapsed)
  const rate = growthRate(focus)
  if (!Number.isFinite(time + elapsed)) throw new RangeError('Flow duration exceeds the numeric range')
  const startLog = logGrowth(time, rate)
  if (elapsed === 0) return 1 + BONUS_SCALE * startLog
  // Integral mean of ln(1+a*(t+s)) = ln(1+a*t) + h(r),
  // r=dt/(t+1/a), h(r)=(1+1/r)*ln(1+r)-1. Avoid subtracting
  // large antiderivatives; a series avoids cancellation at tiny intervals.
  const denominator = time + 1 / rate
  const ratio = elapsed / denominator
  const meanIncrement = ratio < 1e-4
    ? ratio * (0.5 + ratio * (-1 / 6 + ratio / 12))
    : Number.isFinite(ratio)
      ? Math.log1p(ratio) + Math.log1p(ratio) / ratio - 1
      : Math.log(elapsed) - Math.log(denominator) - 1
  return 1 + BONUS_SCALE * (startLog + meanIncrement)
}

// Projection-only form of the same integral mean. Completion times can lie
// outside Number's range even though their logarithms and comparisons are useful.
export function getProjectedFlowMultiplier(time: number, logElapsed: number, focus: number) {
  validateTime(time)
  if (!Number.isFinite(logElapsed)) throw new RangeError('Projected log interval must be finite')
  const rate = growthRate(focus)
  const logRatio = logElapsed - Math.log(time + 1 / rate)
  const ratio = Math.exp(logRatio)
  const increment = ratio < 1e-4 ? ratio * (0.5 + ratio * (-1 / 6 + ratio / 12))
    : Number.isFinite(ratio) ? Math.log1p(ratio) + Math.log1p(ratio) / ratio - 1 : logRatio - 1
  return 1 + BONUS_SCALE * (logGrowth(time, rate) + increment)
}
