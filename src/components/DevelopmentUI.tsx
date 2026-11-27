import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, Dispatch, ReactNode } from 'react'
import type { GameState } from '../game/types'
import type { SprintAction, SprintState } from '../store/sprintSession'
import { getDiagnosticsView } from '../store/diagnosticsView'
import type { DiagnosticsView } from '../store/diagnosticsView'
import { DevelopmentControls } from './DevelopmentControls'
import { TeamDiagnostics } from './Diagnostics'
import { filterDiagnosticActivity } from '../game/simulationActivity'
import type { DiagnosticActivity } from '../game/simulationActivity'
import type { ActivityDisplay } from './BoardActivity'
import { describeDiagnosticActivity } from './developmentActivityPresentation'

interface Props {
  state: GameState
  isPaused: boolean
  dispatch: Dispatch<SprintAction>
  sprint?: SprintState
  activity?: readonly DiagnosticActivity[]
  children: (diagnostics: DiagnosticsView | null, activityDisplay: ActivityDisplay) => ReactNode
}

// Mounted only by App's Vite DEV boundary. Future overlays can live here without
// changing the reported player view or putting build-mode decisions in the engine.
export function DevelopmentUI({ state, isPaused, sprint, dispatch, children, activity = [] }: Props) {
  const [showDiagnostics, setShowDiagnostics] = useState(true)
  const [includeInternal, setIncludeInternal] = useState(false)
  const [assessments, setAssessments] = useState(true)
  const [decisions, setDecisions] = useState(true)
  const [noopReviews, setNoopReviews] = useState(false)
  const simulationPanel = useRef<HTMLDetailsElement>(null)
  const teamPanel = useRef<HTMLDetailsElement>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const [toolbarHeight, setToolbarHeight] = useState(120)
  useEffect(() => {
    const element = toolbar.current
    if (!element) return
    // Reserve the actual wrapped height, including browser zoom/font changes.
    const observer = new ResizeObserver(() => setToolbarHeight(element.getBoundingClientRect().height))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const diagnostics = showDiagnostics ? getDiagnosticsView(state) : null
  const activityDisplay: ActivityDisplay = {
    rows: includeInternal ? filterDiagnosticActivity(activity, { assessments, decisions, noopReviews }).map(event => describeDiagnosticActivity(event, state.developers)) : undefined,
    controls: <fieldset className="activity-filters">
      <legend className="visually-hidden">Development activity filters</legend>
      <label><input type="checkbox" checked={includeInternal} onChange={event => setIncludeInternal(event.target.checked)} />Include internal activity (DEV)</label>
      {includeInternal && <div>
        <label><input type="checkbox" checked={assessments} onChange={event => setAssessments(event.target.checked)} />Assessments</label>
        <label><input type="checkbox" checked={decisions} onChange={event => setDecisions(event.target.checked)} />Work decisions</label>
        <label><input type="checkbox" checked={noopReviews} disabled={!assessments} onChange={event => setNoopReviews(event.target.checked)} />No-op reviews</label>
      </div>}
    </fieldset>,
  }

  function closePanel(panel: HTMLDetailsElement | null) {
    if (!panel) return
    panel.open = false
    panel.querySelector('summary')?.focus()
  }

  return (
    <>
      <div ref={toolbar} className="development-toolbar" aria-label="Development tools"
        style={{ '--development-toolbar-height': `${toolbarHeight}px` } as CSSProperties}>
        <details ref={simulationPanel} className="development-menu">
          <summary aria-label="Simulation Controls" title="Simulation Controls">Simulation</summary>
          <div className="development-panel" role="region" aria-label="Simulation Controls">
            <button type="button" onClick={() => closePanel(simulationPanel.current)}>Close Simulation Controls</button>
            {sprint?.phase === 'planning' && <section aria-label="Prototype sprint bridge">
              <p>DEV-only sprint foundation: start an execution timebox using the existing board. Planning, estimation and commitment UI are not implemented yet.</p>
              <button type="button" onClick={() => dispatch({ type: 'startSprint' })}>Start prototype sprint</button>
            </section>}
            <DevelopmentControls isPaused={isPaused} canExecute={sprint?.phase !== 'planning'} randomState={state.randomState} dispatch={dispatch} />
          </div>
        </details>
        <details ref={teamPanel} className="development-menu">
          <summary aria-label="Team Diagnostics" title="Team Diagnostics">Team</summary>
          <div className="development-panel" role="region" aria-label="Team Diagnostics">
            <button type="button" onClick={() => closePanel(teamPanel.current)}>Close Team Diagnostics</button>
            <TeamDiagnostics team={getDiagnosticsView(state).team} />
          </div>
        </details>
        <button type="button" aria-label={isPaused ? 'Resume simulation' : 'Pause simulation'}
          disabled={sprint?.phase === 'planning'}
          onClick={() => dispatch({ type: 'togglePause' })}>
          {isPaused ? 'Resume' : 'Pause'}
        </button>
      <label className="diagnostics-toggle">
        <input type="checkbox" checked={showDiagnostics}
          aria-label="Show development diagnostics (true simulation values)"
          onChange={(event) => setShowDiagnostics(event.target.checked)} />
        Diagnostics
      </label>
      </div>
      {children(diagnostics, activityDisplay)}
      <div aria-hidden="true" style={{ height: toolbarHeight + 24 }} />
    </>
  )
}
