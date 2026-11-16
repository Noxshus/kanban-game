// Prototype accuracy calibration; independent of Focus/Flow and work rate.
export const JUDGEMENT_ESTIMATE_WEIGHT = 0.09
export const COMPETENCY_ESTIMATE_WEIGHT = 0.09

/** A first belief about TOTAL work, not remaining work or completion time. */
export function estimateInitialEffort(requiredWork: number, judgement: number, competency: number, uniform: number): number {
  for (const [name, value] of Object.entries({ requiredWork, judgement, competency })) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(name + ' must be finite and non-negative')
  }
  if (!Number.isFinite(uniform) || uniform < 0 || uniform >= 1) {
    throw new RangeError('Estimate RNG draw must be in [0, 1)')
  }
  // Scale each attribute before adding: even two MAX_VALUE attributes stay finite.
  const q = 1 + JUDGEMENT_ESTIMATE_WEIGHT * judgement + COMPETENCY_ESTIMATE_WEIGHT * competency
  const estimate = requiredWork * Math.exp(Math.log1p(-uniform) / q)
  // Do not invent a floor/error cap: #58 needs a positive, representable belief.
  if (requiredWork > 0 && estimate === 0) {
    throw new RangeError('Initial effort estimate is below the positive numeric range')
  }
  return estimate
}
