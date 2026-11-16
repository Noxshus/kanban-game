// Significant digits retain tiny/large estimates without displaying positive work as zero.
export function formatEffort(value: number | undefined): string {
  if (value === undefined) return 'Unknown'
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Effort must be finite and non-negative')
  return value.toLocaleString(undefined, {
    maximumSignificantDigits: 4,
    notation: value > 0 && (value < 0.001 || value >= 1e6) ? 'scientific' : 'standard',
  })
}
