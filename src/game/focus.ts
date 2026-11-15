import type { Developer } from './types'

// Provisional #51 balance; no cap or asymptote is applied to time or Discipline.
const BONUS_SCALE = 0.25
const DISCIPLINE_SCALE = 5
const TIME_SCALE = 10

function growthRate(discipline: number) {
  if (!Number.isFinite(discipline) || discipline < 0) throw new RangeError('Discipline must be finite and non-negative')
  return 1 / TIME_SCALE + discipline / DISCIPLINE_SCALE / TIME_SCALE
}

function validateTime(time: number) {
  if (!Number.isFinite(time) || time < 0) throw new RangeError('Focus time must be finite and non-negative')
}

function logGrowth(time: number, rate: number) {
  const product = time * rate
  // The product can overflow even though its logarithm is representable.
  return Number.isFinite(product) ? Math.log1p(product) : Math.log(time) + Math.log(rate)
}

export function getFocusBonus(time: number, discipline: number) {
  validateTime(time)
  return BONUS_SCALE * logGrowth(time, growthRate(discipline))
}

export function getFocusDuration(developer: Developer, ticketId: string) {
  const time = developer.focusStreak?.ticketId === ticketId ? developer.focusStreak.duration : 0
  validateTime(time)
  return time
}

export function getAverageFocusMultiplier(time: number, elapsed: number, discipline: number) {
  validateTime(time)
  validateTime(elapsed)
  const rate = growthRate(discipline)
  if (!Number.isFinite(time + elapsed)) throw new RangeError('Focus duration exceeds the numeric range')
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
