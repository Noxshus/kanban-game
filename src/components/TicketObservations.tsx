import { useId, useState } from 'react'
import type { TicketObservationView } from '../store/playerObservations'
import { formatActivityTime } from './boardActivityPresentation'

export function ManagerView({ observation, estimateUnknown }: { observation?: TicketObservationView; estimateUnknown: boolean }) {
  const id = useId()
  const [isOpen, setOpen] = useState(false)
  const revised = (observation?.revisionCount ?? 0) >= 2
  const count = Number(estimateUnknown) + Number(revised)
  const state = revised ? 'observations' : estimateUnknown ? 'missing' : 'neutral'
  const label = state === 'observations' ? `Observations (${count})` : estimateUnknown ? 'Missing estimate' : 'No notable observations'
  return <div className={`manager-view manager-${state}`} onMouseEnter={() => setOpen(true)}
    onMouseLeave={event => { if (!event.currentTarget.contains(document.activeElement)) setOpen(false) }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}
    onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
    <span className="manager-view-heading">Manager view</span>
    <button type="button" aria-label={`Manager view: ${label}`} aria-expanded={isOpen} aria-controls={id} aria-describedby={id}
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)}>{label}</button>
    <div className="manager-view-details" id={id} role="region" aria-label="Manager view evidence" tabIndex={0} hidden={!isOpen}>
      {count === 0 ? <p>No notable observations have accumulated from the board this run. This is not a check of accuracy.</p> : <>
        <p>Observed board information. These facts do not establish whether reports are accurate.</p>
        <ul>
          {estimateUnknown && <li>No effort estimate has been published.</li>}
          {revised && <li><strong>Estimate revised {observation!.revisionCount === 2 ? 'twice' : `${observation!.revisionCount} times`}</strong>
            <p>Changes observed on the board this run:</p>
            <ol aria-label="Observed estimate publications">
              {observation!.publications.map((publication, index) => <li key={index}>
                <span className="observation-time">{formatActivityTime(publication.at)}</span>{' '}
                {publication.from === null ? 'Unknown' : <data value={publication.from}>{String(publication.from)}</data>}
                {' → '}<data value={publication.to}>{String(publication.to)}</data> work units
              </li>)}
            </ol>
          </li>}
        </ul>
      </>}
    </div>
  </div>
}
