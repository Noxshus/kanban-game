import assert from 'node:assert/strict'
import { test } from 'node:test'
import { estimateInitialEffort } from '../src/game/effortEstimate.ts'
import { nextRandom } from '../src/game/random.ts'
import { formatEffort } from '../src/components/formatEffort.ts'

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) <= Math.max(1, expected) * 1e-14, actual + ' vs ' + expected)

test('initial estimate follows the calibrated inverse distribution using one supplied uniform', () => {
  for (const [j, c] of [[0, 0], [10, 10], [50, 50], [100, 100], [0, 100], [100, 0]]) {
    for (const u of [0, 0.1, 0.5, 0.99, 1 - Number.EPSILON / 2]) {
      const expected = 80 * Math.pow(1 - u, 1 / (1 + 0.09 * j + 0.09 * c))
      close(estimateInitialEffort(80, j, c, u), expected)
    }
  }
})

test('large seeded samples match the expected average accuracy and retain individual variation', () => {
  for (const [j, c, expected] of [[0, 0, 0.5], [10, 10, 2.8 / 3.8], [50, 50, 10 / 11], [100, 100, 0.95]]) {
    let seed = 1, total = 0, min = 1, max = 0
    for (let i = 0; i < 100_000; i++) {
      const next = nextRandom(seed); seed = next.state
      const estimate = estimateInitialEffort(1, j, c, next.value)
      assert.ok(estimate > 0 && estimate <= 1)
      total += estimate; min = Math.min(min, estimate); max = Math.max(max, estimate)
    }
    assert.ok(Math.abs(total / 100_000 - expected) < 0.003)
    assert.ok(max - min > 0.25)
  }
})

test('both uncapped attributes independently improve accuracy for controlled draws', () => {
  for (const u of [0.01, 0.25, 0.9]) {
    const basic = estimateInitialEffort(100, 0, 0, u)
    const judgement = estimateInitialEffort(100, 100, 0, u)
    const competency = estimateInitialEffort(100, 0, 100, u)
    assert.ok(judgement > basic)
    assert.equal(judgement, competency)
    assert.ok(estimateInitialEffort(100, 100, 100, u) > judgement)
    assert.ok(estimateInitialEffort(100, 10000, 10000, u) > estimateInitialEffort(100, 100, 100, u))
  }
})

test('extreme finite work, attributes and RNG endpoints stay bounded without artificial floors', () => {
  for (const t of [0, Number.MIN_VALUE, 1e-300, 1, 1e300, Number.MAX_VALUE]) {
    assert.equal(estimateInitialEffort(t, 0, 0, 0), t)
    assert.equal(estimateInitialEffort(t, Number.MAX_VALUE, Number.MAX_VALUE, 0.99), t)
  }
  for (const t of [1e-300, 1e-100, 1, 1e100, Number.MAX_VALUE]) {
    const e = estimateInitialEffort(t, 0, 0, 1 - Number.EPSILON / 2)
    assert.ok(Number.isFinite(e) && e > 0 && e <= t)
  }
  assert.equal(estimateInitialEffort(0, 0, 0, 0.99), 0)
  assert.throws(() => estimateInitialEffort(Number.MIN_VALUE, 0, 0, 0.9), /positive numeric range/)
})

test('invalid work, attributes and uniform draws fail explicitly', () => {
  for (const bad of [-1, NaN, Infinity, -Infinity, undefined]) {
    for (const position of [0, 1, 2]) {
      const args = [100, 5, 5, 0.5]; args[position] = bad as number
      assert.throws(() => estimateInitialEffort(...args as [number, number, number, number]), RangeError)
    }
  }
  for (const u of [-1, NaN, Infinity, -Infinity, 1, 1.01]) {
    assert.throws(() => estimateInitialEffort(100, 5, 5, u), RangeError)
    assert.throws(() => estimateInitialEffort(0, 5, 5, u), RangeError)
  }
})

test('effort formatting preserves small/large positive values and unknown estimates', () => {
  assert.equal(formatEffort(undefined), 'Unknown')
  assert.equal(formatEffort(0), '0')
  assert.equal(formatEffort(8.5), '8.5')
  for (const value of [Number.MIN_VALUE, 1e-200, 1e200, Number.MAX_VALUE]) {
    assert.match(formatEffort(value), /E[-+]?\d+/i)
    assert.doesNotMatch(formatEffort(value), /^0(?:[.,]0+)?$/)
    assert.doesNotMatch(formatEffort(value), /NaN|Infinity/)
  }
})
