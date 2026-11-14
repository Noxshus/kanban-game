import { useEffect, useState } from 'react'
import { exampleGameState } from './data/exampleGameState'
import { advanceSimulation } from './game/advanceSimulation'
import type { WorkflowStatus } from './game/types'
import { getPlayerView } from './store/playerView'
import './App.css'

const columns: { status: WorkflowStatus; title: string }[] = [
  { status: 'todo', title: 'To Do' },
  { status: 'in_progress', title: 'In Progress' },
  { status: 'done', title: 'Done' },
]

function App() {
  const [state, setState] = useState(() => structuredClone(exampleGameState))
  const [isPaused, setIsPaused] = useState(false)
  const view = getPlayerView(state)

  useEffect(() => {
    if (isPaused) return

    const timer = window.setInterval(() => {
      setState((current) => advanceSimulation(current, 1))
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
          <button type="button" onClick={() => setIsPaused((paused) => !paused)}>
            {isPaused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </header>

      <section aria-labelledby="board-heading">
        <h2 id="board-heading">Kanban board</h2>
        <div className="board">
          {columns.map(({ status, title }) => {
            // Board placement reflects reports, independently of simulation progress.
            const tickets = view.tickets.filter((ticket) => ticket.reportedStatus === status)
            return (
              <section className="column" key={status} aria-labelledby={`column-${status}`}>
                <h3 id={`column-${status}`}>{title}</h3>
                <ul className="ticket-list">
                  {tickets.map((ticket) => {
                    const assignee = view.developers.find(
                      (developer) => developer.id === ticket.assignedDeveloperId,
                    )
                    return (
                      <li className="ticket" key={ticket.id}>
                        <span className="ticket-id">{ticket.id}</span>
                        <h4>{ticket.title}</h4>
                        <p>{assignee ? `Assigned to: ${assignee.name}` : 'Unassigned'}</p>
                        <label className="ticket-progress">
                          <span>Reported progress: {Math.round(ticket.reportedProgress)}%</span>
                          <progress max={100} value={ticket.reportedProgress} />
                        </label>
                      </li>
                    )
                  })}
                </ul>
                {tickets.length === 0 && <p>No tickets</p>}
              </section>
            )
          })}
        </div>
      </section>

      <section aria-labelledby="developers-heading">
        <h2 id="developers-heading">Developers</h2>
        <ul className="developer-list">
          {view.developers.map((developer) => (
            <li key={developer.id}>
              <strong>{developer.name}</strong>
              <span>Productivity: {developer.productivity} work/second</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

export default App
