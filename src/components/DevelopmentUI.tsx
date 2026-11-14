import { useState } from 'react'
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
  const diagnostics = showDiagnostics ? getDiagnosticsView(state) : null

  return (
    <>
      <label className="diagnostics-toggle">
        <input type="checkbox" checked={showDiagnostics}
          onChange={(event) => setShowDiagnostics(event.target.checked)} />
        Show development diagnostics (true simulation values)
      </label>
      <DevelopmentControls isPaused={isPaused} randomState={state.randomState} dispatch={dispatch} />
      {diagnostics && <TeamDiagnostics team={diagnostics.team} />}
      {children(diagnostics)}
    </>
  )
}
