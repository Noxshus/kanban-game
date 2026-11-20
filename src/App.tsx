import { useEffect, useReducer } from 'react'
import { createSimulationSession, simulationReducer } from './store/simulationControls'
import { getPlayerView } from './store/playerView'
import { DevelopmentUI } from './components/DevelopmentUI'
import { GameBoard } from './components/GameBoard'
import './App.css'

function App() {
  const [{ game: state, isPaused }, dispatch] = useReducer(simulationReducer, undefined, createSimulationSession)
  const view = getPlayerView(state)

  useEffect(() => {
    if (isPaused) return

    const timer = window.setInterval(() => {
      dispatch({ type: 'tick' })
    }, 1000)

    // Clean up on pause as well as unmount, including StrictMode effect restarts.
    return () => window.clearInterval(timer)
  }, [isPaused])

  return (
    <main className="game">
      <header className="game-header">
        <div className="game-identity">
          <p className="eyebrow">Engineering operations</p>
          <h1>Kanban Game<span aria-hidden="true">.</span></h1>
        </div>
        <div className="simulation-controls" aria-label="Simulation controls">
          <p className="simulation-clock"><span>Simulation time</span><strong>{view.simulationTime}<small>seconds</small></strong></p>
          <p className={`simulation-status ${isPaused ? 'is-paused' : 'is-running'}`} role="status">{isPaused ? 'Paused' : 'Running'}</p>
          <button type="button" onClick={() => dispatch({ type: 'togglePause' })}>
            {isPaused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </header>

      {/* One build-mode boundary owns all true-state development UI. */}
      {import.meta.env.DEV ? (
        <DevelopmentUI state={state} isPaused={isPaused} dispatch={dispatch}>
          {(diagnostics) => <GameBoard onReorder={(ticketId, targetId, after) => dispatch({ type: 'reorderTodo', ticketId, targetId, after })} view={view} diagnostics={diagnostics} />}
        </DevelopmentUI>
      ) : <GameBoard onReorder={(ticketId, targetId, after) => dispatch({ type: 'reorderTodo', ticketId, targetId, after })} view={view} />}
    </main>
  )
}

export default App
