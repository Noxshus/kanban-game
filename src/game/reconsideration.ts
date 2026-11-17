// Discovery inversion needs an open uniform; reconsideration itself has no
// periodic schedule or final Judgement noise roll.
export function openUnit(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('RNG draw must be in [0, 1]')
  return Math.max(Number.EPSILON, Math.min(1 - Number.EPSILON, value))
}
