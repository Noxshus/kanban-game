import assert from 'node:assert/strict'

// Independent antiderivative oracle for ordinary-size test intervals, starting at zero.
export function expectedWork(rate: number, seconds: number, discipline = 5) {
  const a = (1 + discipline / 5) / 10
  const x = 1 + a * seconds
  return rate * (seconds + 0.25 * (x * Math.log(x) - x + 1) / a)
}

export function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`)
}
