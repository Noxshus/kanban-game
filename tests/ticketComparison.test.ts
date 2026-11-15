import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareTicket } from '../src/store/ticketComparison.ts'
import { exampleGameState } from '../src/data/exampleGameState.ts'

function fixture() {
  const state = structuredClone(exampleGameState)
  return { ticket: state.tickets[0], developers: state.developers }
}

test('all matching checks and each mismatch produce appropriate details', () => {
  const { ticket, developers } = fixture()
  const original = structuredClone({ ticket, developers })
  const match = compareTicket(ticket, developers)
  assert.equal(match.matches, true)
  assert.deepEqual(match.details, ['All comparisons match.'])
  assert.ok(Object.values(match.checks).every(c => c.matches))
  for (const [field, value, key] of [['reportedStatus', 'todo', 'status'], ['reportedProgress', 10, 'progress'], ['assignedDeveloperId', 'developer-3', 'assignment']] as const) {
    const mismatch = compareTicket({ ...ticket, [field]: value }, developers)
    assert.equal(mismatch.matches, false)
    assert.equal(mismatch.checks[key].matches, false)
    assert.equal(mismatch.details.length, 1)
  }
  const multiple = compareTicket({ ...ticket, reportedStatus: 'done', reportedProgress: 1, assignedDeveloperId: 'missing' }, developers)
  assert.equal(multiple.details.length, 3)
  assert.match(multiple.details.join(' '), /reported done; actual in_progress/)
  assert.match(multiple.details.join(' '), /reported 1%; actual 40%/)
  assert.match(multiple.details.join(' '), /unknown developer \(missing\)/)
  assert.deepEqual({ ticket, developers }, original)
})

test('assignment means operational alignment, including idle, other work, missing IDs and retained ownership', () => {
  const { ticket, developers } = fixture()
  assert.equal(compareTicket(ticket, developers).checks.assignment.matches, true)
  developers[0].activeTicketID = 'other'
  assert.match(compareTicket(ticket, developers).checks.assignment.detail, /assigned Alex .*actively working nobody/)
  assert.equal(compareTicket(ticket, developers).checks.assignment.matches, false)
  delete developers[0].activeTicketID
  assert.equal(compareTicket(ticket, developers).checks.assignment.matches, false)
  delete ticket.assignedDeveloperId
  assert.equal(compareTicket(ticket, developers).checks.assignment.matches, true)
  developers[0].activeTicketID = ticket.id
  assert.equal(compareTicket(ticket, developers).checks.assignment.matches, false)
  ticket.assignedDeveloperId = 'missing'
  assert.equal(compareTicket(ticket, developers).checks.assignment.matches, false)
  ticket.assignedDeveloperId = 'developer-1'
  developers[1].activeTicketID = ticket.id
  assert.equal(compareTicket(ticket, developers).checks.assignment.matches, false)
  delete developers[0].activeTicketID
  delete developers[1].activeTicketID
  ticket.actualStatus = ticket.reportedStatus = 'done'
  ticket.completedWork = ticket.requiredWork
  ticket.reportedProgress = 100
  const completed = compareTicket(ticket, developers)
  assert.equal(completed.checks.assignment.matches, false)
  assert.match(completed.checks.assignment.detail, /ownership/)
})

test('whole-percent rounding, zero-sized tickets and invalid values are handled', () => {
  const { ticket, developers } = fixture()
  ticket.requiredWork = 3; ticket.completedWork = 1; ticket.reportedProgress = 33.49
  assert.equal(compareTicket(ticket, developers).checks.progress.matches, true)
  ticket.reportedProgress = 33.5
  assert.equal(compareTicket(ticket, developers).checks.progress.matches, false)
  ticket.requiredWork = 0; ticket.completedWork = 0; ticket.reportedProgress = 0
  assert.equal(compareTicket(ticket, developers).checks.progress.matches, true)
  ticket.actualStatus = 'done'; ticket.reportedProgress = 100
  assert.equal(compareTicket(ticket, developers).checks.progress.matches, true)
  ticket.completedWork = 1
  assert.equal(compareTicket(ticket, developers).checks.progress.matches, false)
  ticket.requiredWork = -1
  assert.equal(compareTicket(ticket, developers).checks.progress.matches, false)
  ticket.requiredWork = 1; ticket.completedWork = 0; ticket.reportedProgress = NaN
  assert.equal(compareTicket(ticket, developers).checks.progress.matches, false)
  ticket.reportedProgress = Infinity
  assert.equal(compareTicket(ticket, developers).checks.progress.matches, false)
})
