// Provisional waiting-time and uncertainty calibration, independent of Focus.
export const RECONSIDERATION_SCALE = 25
export const JUDGEMENT_SCALE = 25
export const RANK_PREFERENCE = 0.25

export function openUnit(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('RNG draw must be in [0, 1]')
  // Endpoints have zero probability for a continuous distribution. Map them
  // inward to avoid infinite logistic errors and zero/infinite scheduled waits.
  return Math.max(Number.EPSILON, Math.min(1 - Number.EPSILON, value))
}

export function sampleReconsideration(draw: number) {
  // Survival-uniform inverse CDF; same F(t)=1-exp(-(t/25)^2).
  return RECONSIDERATION_SCALE * Math.sqrt(-Math.log(openUnit(draw)))
}

export function assessmentNoise(judgement: number, alternativeCount: number, draw: number) {
  if (!Number.isFinite(judgement) || judgement < 0 || !Number.isSafeInteger(alternativeCount) || alternativeCount < 0) {
    throw new RangeError('Judgement and alternative count must be finite and non-negative')
  }
  const complexity = 1 + Math.log2(1 + alternativeCount)
  const noiseScale = complexity / (1 + judgement / JUDGEMENT_SCALE)
  const u = openUnit(draw)
  return { complexity, noiseScale, error: noiseScale * (Math.log(u) - Math.log1p(-u)) }
}
