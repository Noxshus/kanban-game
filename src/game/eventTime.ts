// A compensated absolute instant: the low word retains addition rounding, so
// separately anchored deadlines remain distinct without an epsilon tie window.
// Both words are ordinary finite numbers and survive JSON round trips.
export interface EventTime { high: number; low: number }

function sum(a: number, b: number): EventTime {
  const high = a + b
  if (!Number.isFinite(high)) throw new RangeError('Event time exceeds the numeric range')
  const recovered = high - a
  return { high, low: (a - (high - recovered)) + (b - recovered) }
}

export function eventTime(high: number, low = 0): EventTime {
  if (!Number.isFinite(high) || !Number.isFinite(low)) throw new RangeError('Event time must be finite')
  return sum(high, low)
}

export function addEventTime(time: EventTime, seconds: number): EventTime {
  if (!Number.isFinite(seconds)) throw new RangeError('Event interval must be finite')
  const added = sum(time.high, seconds)
  return sum(added.high, added.low + time.low)
}

export function compareEventTime(a: EventTime, b: EventTime) {
  return a.high === b.high ? Math.sign(a.low - b.low) : Math.sign(a.high - b.high)
}

export function eventInterval(later: EventTime, earlier: EventTime) {
  let difference = sum(later.high, -earlier.high)
  difference = addEventTime(difference, later.low)
  difference = addEventTime(difference, -earlier.low)
  const seconds = difference.high + difference.low
  if (!Number.isFinite(seconds)) throw new RangeError('Event interval exceeds the numeric range')
  return seconds
}
