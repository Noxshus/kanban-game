import { useState } from 'react'
import type { Dispatch, FormEvent } from 'react'
import { parseSeed } from '../store/simulationControls'
import type { SimulationAction } from '../store/simulationControls'

interface Props {
  isPaused: boolean
  canExecute?: boolean
  randomState: number
  dispatch: Dispatch<Extract<SimulationAction, { type: 'step' | 'restart' | 'applySeed' }>>
}

export function DevelopmentControls({ isPaused, canExecute = true, randomState, dispatch }: Props) {
  const [seedInput, setSeedInput] = useState('1')
  const [error, setError] = useState<string | null>(null)

  function applySeed(event: FormEvent) {
    event.preventDefault()
    if (!isPaused) return
    const seed = parseSeed(seedInput)
    if (seed === null) {
      setError('Enter a whole decimal number from 0 to 4294967295.')
      return
    }
    dispatch({ type: 'applySeed', seed })
    setError(null)
  }

  function restart() {
    if (!window.confirm('Restart Simulation? This discards the current run and restores the example state with seed 1, paused.')) return
    dispatch({ type: 'restart' })
    setSeedInput('1')
    setError(null)
  }

  return (
    <section className="development-controls diagnostics" aria-labelledby="development-controls-heading">
      <h2 id="development-controls-heading">Development simulation controls</h2>
      <p>Current active RNG seed/state: <output>{randomState}</output></p>
      <p>Apply a seed while paused to control subsequent decisions. RNG state changes as draws occur.</p>
      <div className="simulation-controls">
        {canExecute && <button type="button" disabled={!isPaused} onClick={() => dispatch({ type: 'step' })}>Step +1s</button>}
        <button type="button" onClick={restart}>Restart Simulation</button>
      </div>
      <p>Restart discards the current run and restores the example seed (1), paused.</p>
      <form onSubmit={applySeed} className="seed-controls" noValidate>
        <label htmlFor="rng-seed">Seed (0–4294967295)</label>
        <input id="rng-seed" type="text" inputMode="numeric" value={seedInput}
          disabled={!isPaused} aria-invalid={error !== null} aria-describedby="seed-help"
          onChange={(event) => { setSeedInput(event.target.value); setError(null) }} />
        <button type="submit" disabled={!isPaused}>Apply seed</button>
        <p id="seed-help" role={error ? 'alert' : undefined}>{error ?? 'Applying a seed preserves tickets and elapsed time. Pause to step or apply a seed.'}</p>
      </form>
    </section>
  )
}
