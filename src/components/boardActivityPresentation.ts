import type { BoardActivity } from '../game/boardActivity'
import type { EventTime } from '../game/eventTime'
import { formatEffort } from './formatEffort'

const columnNames = { backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress', done: 'Done' }
export type ActivityEngineer = { id: string; name: string }
export interface ActivityRow { id: string; ticketId: string; ticketTitle: string; at: EventTime; text: string; details?: string; internal?: boolean }

export function describeActivity(event: BoardActivity, engineers: readonly ActivityEngineer[]) {
  if (event.kind === 'status') return `Reported column: ${columnNames[event.from]} → ${columnNames[event.to]}`
  if (event.kind === 'estimate') return event.from === null
    ? `Effort published: ${formatEffort(event.to)} work units`
    : `Effort revised: ${formatEffort(event.from)} → ${formatEffort(event.to)} work units`
  const name = (id: string) => engineers.find(engineer => engineer.id === id)?.name ?? id
  return event.to === null ? 'Assignment cleared' : `Assigned to ${name(event.to)}${event.from ? ` (previously ${name(event.from)})` : ''}`
}

export function formatActivityTime(at: EventTime) {
  // Round only the label to tenths of a second; the event retains its exact
  // compensated timestamp and ordering. Large session times stay compact.
  return `${at.high.toLocaleString(undefined, at.high >= 1e6
    ? { notation: 'scientific', maximumSignificantDigits: 3 }
    : { maximumFractionDigits: 1 })}s`
}

export function focusActivityTicket(card: Pick<HTMLElement, 'scrollIntoView' | 'focus'> | undefined) {
  // Only activation navigates. Instant scrolling also respects reduced motion.
  card?.scrollIntoView({ block: 'center', behavior: 'instant' })
  card?.focus({ preventScroll: true })
}
