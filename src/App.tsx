import { useEffect, useReducer, useRef } from 'react'
import { createBoardSession, createDevelopmentBoardSession, boardReducer } from './store/boardSession'
import { getPlayerView } from './store/playerView'
import { DevelopmentUI } from './components/DevelopmentUI'
import { GameBoard } from './components/GameBoard'
import { getPlayerObservations } from './store/playerObservations'
import { sprintWorkingTime } from './store/sprintSession'
import type { SprintAction } from './store/sprintSession'
import { eventTime } from './game/eventTime'
import { formatEffort } from './components/formatEffort'
import './App.css'

function App() {
  // One build-mode boundary gates both diagnostic collection and its UI. A
  // production session never allocates a hidden diagnostic activity history.
  return import.meta.env.DEV ? <GameApplication development /> : <GameApplication />
}

function GameApplication({ development = false }: { development?: boolean }) {
  const [{ simulation: { game: state, isPaused }, sprint, activity, diagnosticActivity, observations, projections }, dispatch] = useReducer(boardReducer, undefined, development ? createDevelopmentBoardSession : createBoardSession)
  const view = getPlayerView(state)
  const observationView = getPlayerObservations(observations)
  const workingTime = sprintWorkingTime(sprint, eventTime(state.simulationTime, state.simulationTimeRemainder))
  const executing = sprint.phase === 'execution'
  const wallClock = useRef<{ sample: () => void } | null>(null)

  function beginPlayback() {
    if (wallClock.current) return wallClock.current
    let previous = performance.now()
    const run = { sample() {
      // A callback queued before Pause/Restart/cleanup cannot act on a later run.
      if (wallClock.current !== run) return
      const now = performance.now()
      // Keep measured time in its native unit. Error-free subtraction retains
      // the timestamp difference; the reducer converts cumulative milliseconds.
      const elapsedRealMilliseconds = eventTime(now, -previous)
      if (elapsedRealMilliseconds.high < 0) throw new RangeError('Invalid monotonic playback interval')
      previous = now
      if (elapsedRealMilliseconds.high > 0) dispatch({ type: 'tick', elapsedRealMilliseconds })
    } }
    wallClock.current = run
    return run
  }

  function send(action: SprintAction) {
    if (action.type === 'restart') wallClock.current = null
    else if (action.type === 'togglePause') {
      if (!executing) return
      if (isPaused) beginPlayback()
      else {
        // Both Pause controls settle the partial interval BEFORE changing phase.
        wallClock.current?.sample()
        wallClock.current = null
      }
    } else if (executing && !isPaused) wallClock.current?.sample()
    dispatch(action)
  }

  useEffect(() => {
    if (isPaused || !executing) return
    const run = beginPlayback()
    const timer = window.setInterval(run.sample, 1000)

    // Clean up on pause as well as unmount, including StrictMode effect restarts.
    return () => {
      if (wallClock.current === run) wallClock.current = null
      window.clearInterval(timer)
    }
  }, [isPaused, executing])

  return (
    <main className="game">
      <header className="game-header">
        <div className="game-identity">
          <p className="eyebrow">Engineering operations</p>
          <h1>Kanban Game<span aria-hidden="true">.</span></h1>
        </div>
        <div className="simulation-controls" aria-label="Simulation controls">
          <p className="simulation-clock"><span>{executing ? 'Sprint Execution' : 'Sprint Planning'}</span>
            <strong>{formatEffort(workingTime.elapsedMinutes)}<small> / {formatEffort(workingTime.totalMinutes)} working minutes</small></strong></p>
          <p className="simulation-clock"><span>Simulation time</span><strong>{view.simulationTime}<small>seconds</small></strong></p>
          <p className={`simulation-status ${isPaused ? 'is-paused' : 'is-running'}`} role="status">{isPaused ? 'Paused' : 'Running'}</p>
          <button type="button" disabled={!executing} onClick={() => send({ type: 'togglePause' })}>
            {isPaused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </header>

      {development ? (
        <DevelopmentUI state={state} isPaused={isPaused} sprint={sprint} dispatch={send} activity={diagnosticActivity}>
          {(diagnostics, activityDisplay) => <GameBoard projections={projections} isPaused={isPaused} observations={observationView} activity={activity} activityDisplay={activityDisplay} onReorder={(ticketId, targetId, after) => send({ type: 'reorderTodo', ticketId, targetId, after })} view={view} diagnostics={diagnostics} />}
        </DevelopmentUI>
      ) : <GameBoard projections={projections} isPaused={isPaused} observations={observationView} activity={activity} onReorder={(ticketId, targetId, after) => send({ type: 'reorderTodo', ticketId, targetId, after })} view={view} />}
    </main>
  )
}

export default App
