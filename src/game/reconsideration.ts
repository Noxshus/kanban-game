// Discovery and reporting-review inversion need an open uniform; work decisions have no
// periodic schedule or final Judgement noise roll.
export function openUnit(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('RNG draw must be in [0, 1]')
  return Math.max(Number.EPSILON, Math.min(1 - Number.EPSILON, value))
}
