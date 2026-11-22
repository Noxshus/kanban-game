import { useEffect, useReducer } from 'react'
import { createBoardSession, createDevelopmentBoardSession, boardReducer } from './store/boardSession'
import { getPlayerView } from './store/playerView'
import { DevelopmentUI } from './components/DevelopmentUI'
import { GameBoard } from './components/GameBoard'
import { getPlayerObservations } from './store/playerObservations'
import './App.css'

function App() {
  // One build-mode boundary gates both diagnostic collection and its UI. A
  // production session never allocates a hidden diagnostic activity history.
  return import.meta.env.DEV ? <GameApplication development /> : <GameApplication />
}

function GameApplication({ development = false }: { development?: boolean }) {
  const [{ simulation: { game: state, isPaused }, activity, diagnosticActivity, observations, projections }, dispatch] = useReducer(boardReducer, undefined, development ? createDevelopmentBoardSession : createBoardSession)
  const view = getPlayerView(state)
  const observationView = getPlayerObservations(observations)

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

      {development ? (
        <DevelopmentUI state={state} isPaused={isPaused} dispatch={dispatch} activity={diagnosticActivity}>
          {(diagnostics, activityDisplay) => <GameBoard projections={projections} isPaused={isPaused} observations={observationView} activity={activity} activityDisplay={activityDisplay} onReorder={(ticketId, targetId, after) => dispatch({ type: 'reorderTodo', ticketId, targetId, after })} view={view} diagnostics={diagnostics} />}
        </DevelopmentUI>
      ) : <GameBoard projections={projections} isPaused={isPaused} observations={observationView} activity={activity} onReorder={(ticketId, targetId, after) => dispatch({ type: 'reorderTodo', ticketId, targetId, after })} view={view} />}
    </main>
  )
}

export default App
