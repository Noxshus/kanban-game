export function clampReportedProgress(value: number): number {
  return Number.isNaN(value) ? 0 : Math.min(100, Math.max(0, value))
}
