import { useRef, useState } from 'react'
import type { Dispatch, ReactNode } from 'react'
import type { GameState } from '../game/types'
import type { SimulationAction } from '../store/simulationControls'
import { getDiagnosticsView } from '../store/diagnosticsView'
import type { DiagnosticsView } from '../store/diagnosticsView'
import { DevelopmentControls } from './DevelopmentControls'
import { TeamDiagnostics } from './Diagnostics'

interface Props {
  state: GameState
  isPaused: boolean
  dispatch: Dispatch<SimulationAction>
  children: (diagnostics: DiagnosticsView | null) => ReactNode
}

// Mounted only by App's Vite DEV boundary. Future overlays can live here without
// changing the reported player view or putting build-mode decisions in the engine.
export function DevelopmentUI({ state, isPaused, dispatch, children }: Props) {
  const [showDiagnostics, setShowDiagnostics] = useState(true)
  const simulationPanel = useRef<HTMLDetailsElement>(null)
  const teamPanel = useRef<HTMLDetailsElement>(null)
  const diagnostics = showDiagnostics ? getDiagnosticsView(state) : null

  function closePanel(panel: HTMLDetailsElement | null) {
    if (!panel) return
    panel.open = false
    panel.querySelector('summary')?.focus()
  }

  return (
    <>
      <div className="development-toolbar" aria-label="Development tools">
        <details ref={simulationPanel} className="development-menu">
          <summary>Simulation Controls</summary>
          <div className="development-panel" role="region" aria-label="Simulation Controls">
            <button type="button" onClick={() => closePanel(simulationPanel.current)}>Close Simulation Controls</button>
            <DevelopmentControls isPaused={isPaused} randomState={state.randomState} dispatch={dispatch} />
          </div>
        </details>
        <details ref={teamPanel} className="development-menu">
          <summary>Team Diagnostics</summary>
          <div className="development-panel" role="region" aria-label="Team Diagnostics">
            <button type="button" onClick={() => closePanel(teamPanel.current)}>Close Team Diagnostics</button>
            <TeamDiagnostics team={getDiagnosticsView(state).team} />
          </div>
        </details>
        <button type="button" aria-label={isPaused ? 'Resume simulation' : 'Pause simulation'}
          onClick={() => dispatch({ type: 'togglePause' })}>
          {isPaused ? 'Resume' : 'Pause'}
        </button>
      <label className="diagnostics-toggle">
        <input type="checkbox" checked={showDiagnostics}
          onChange={(event) => setShowDiagnostics(event.target.checked)} />
        Show development diagnostics (true simulation values)
      </label>
      </div>
      {children(diagnostics)}
    </>
  )
}
