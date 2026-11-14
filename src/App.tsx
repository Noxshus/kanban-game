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
      <header>
        <h1>Kanban Game</h1>
        <div className="simulation-controls">
          <p>Simulation time: {view.simulationTime} seconds</p>
          <p role="status">{isPaused ? 'Paused' : 'Running'}</p>
          <button type="button" onClick={() => dispatch({ type: 'togglePause' })}>
            {isPaused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </header>

      {/* One build-mode boundary owns all true-state development UI. */}
      {import.meta.env.DEV ? (
        <DevelopmentUI state={state} isPaused={isPaused} dispatch={dispatch}>
          {(diagnostics) => <GameBoard view={view} diagnostics={diagnostics} />}
        </DevelopmentUI>
      ) : <GameBoard view={view} />}
    </main>
  )
}

export default App
