// A state-driven 32-bit LCG: replaying an input state repeats its random sequence.
export function nextRandom(state: number) {
  const nextState = (Math.imul(state, 1664525) + 1013904223) >>> 0
  return { state: nextState, value: nextState / 0x100000000 }
}
