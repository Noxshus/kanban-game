import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareTicket } from '../src/store/ticketComparison.ts'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { advanceSimulation } from '../src/game/advanceSimulation.ts'
import { decisionFixture, setPublishedEstimate } from './helpers/decisionFixture.ts'

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
  assert.equal(completed.checks.assignment.matches, true)
  assert.match(completed.checks.assignment.detail, /Historical owner: Alex/)
})

function completedFixture() {
  const result = fixture(), { ticket, developers } = result
  ticket.actualStatus = ticket.reportedStatus = 'done'
  ticket.completedWork = ticket.requiredWork
  ticket.reportedProgress = 100
  delete developers[0].activeTicketID
  return result
}

test('Done accepts no owner or a valid historical owner, whether idle or working elsewhere, without mutation', () => {
  for (const owner of [undefined, 'developer-1', 'developer-2']) {
    for (const elsewhere of [false, true]) {
      const { ticket, developers } = completedFixture()
      ticket.assignedDeveloperId = owner
      if (elsewhere) developers[0].activeTicketID = 'another-ticket'
      const original = structuredClone({ ticket, developers })
      const result = compareTicket(ticket, developers)
      assert.equal(result.matches, true)
      assert.ok(Object.values(result.checks).every(check => check.matches))
      assert.match(result.details[0], /^Active work: N\/A — completed\. Historical owner:/)
      assert.ok(result.details.includes('All applicable comparisons match.'))
      assert.ok(!result.details.join(' ').includes('Unexpected active claims'))
      if (owner) assert.ok(result.details[0].includes(developers.find(d => d.id === owner)!.name))
      else assert.match(result.details[0], /Historical owner: nobody\./)
      assert.deepEqual({ ticket, developers }, original)
    }
  }
})

test('Done rejects nonexistent or empty historical owner IDs, including a missing developer list', () => {
  for (const owner of ['missing', '']) {
    const { ticket, developers } = completedFixture()
    ticket.assignedDeveloperId = owner
    const result = compareTicket(ticket, developers)
    assert.equal(result.matches, false)
    assert.equal(result.checks.assignment.matches, false)
    assert.equal(result.details.length, 1)
    assert.ok(result.details[0].includes(`Historical owner: invalid developer ID (${owner}).`))
  }
  const { ticket } = completedFixture()
  assert.equal(compareTicket(ticket, []).checks.assignment.matches, false)
  delete ticket.assignedDeveloperId
  assert.equal(compareTicket(ticket, []).matches, true)
})

test('any active claim on actual Done fails, including the historical owner, another worker and duplicate claims', () => {
  for (const owner of [undefined, 'developer-1', 'missing']) {
    for (const claimants of [[0], [2], [0, 1]]) {
      const { ticket, developers } = completedFixture()
      ticket.assignedDeveloperId = owner
      for (const index of claimants) developers[index].activeTicketID = ticket.id
      const result = compareTicket(ticket, developers)
      assert.equal(result.matches, false)
      assert.equal(result.checks.assignment.matches, false)
      assert.equal(result.checks.status.matches, true)
      assert.equal(result.checks.progress.matches, true)
      assert.equal(result.details.length, 1) // Context also explains the failing assignment check, once.
      assert.match(result.details[0], /Unexpected active claims:/)
      for (const index of claimants) assert.ok(result.details[0].includes(`${developers[index].name} (${developers[index].id})`))
      if (owner === 'missing') assert.match(result.details[0], /invalid developer ID \(missing\)/)
      assert.ok(!result.details.includes('All applicable comparisons match.'))
    }
  }
})

test('Done historical ownership never hides independent status/progress discrepancies or simultaneous failures', () => {
  for (const badStatus of [false, true]) for (const badProgress of [false, true]) for (const badOwner of [false, true]) {
    const { ticket, developers } = completedFixture()
    if (badStatus) ticket.reportedStatus = 'todo'
    if (badProgress) ticket.reportedProgress = 40
    if (badOwner) ticket.assignedDeveloperId = 'missing'
    const result = compareTicket(ticket, developers)
    assert.equal(result.matches, !(badStatus || badProgress || badOwner))
    assert.equal(result.checks.status.matches, !badStatus)
    assert.equal(result.checks.progress.matches, !badProgress)
    assert.equal(result.checks.assignment.matches, !badOwner)
    assert.equal(result.details.some(detail => detail.startsWith('Status:')), badStatus)
    assert.equal(result.details.some(detail => detail.startsWith('Progress:')), badProgress)
    assert.ok(result.details[0].includes('Historical owner:'))
    assert.equal(result.details.includes('All applicable comparisons match.'), !(badStatus || badProgress || badOwner))
  }
})

test('reported Done does not exempt unfinished tickets from the original active-work/ownership rules', () => {
  for (const actualStatus of ['backlog', 'todo', 'in_progress'] as const) {
    const { ticket, developers } = fixture()
    ticket.actualStatus = actualStatus; ticket.reportedStatus = 'done'
    developers[0].activeTicketID = 'another-ticket'
    assert.equal(compareTicket(ticket, developers).checks.assignment.matches, false)
    assert.match(compareTicket(ticket, developers).checks.assignment.detail, /^Assignment\/active-work alignment:/)
    developers[1].activeTicketID = ticket.id // Handoff while the old owner remains assigned.
    assert.equal(compareTicket(ticket, developers).checks.assignment.matches, false)
    ticket.assignedDeveloperId = developers[1].id
    assert.equal(compareTicket(ticket, developers).checks.assignment.matches, true)
    developers[0].activeTicketID = ticket.id
    assert.equal(compareTicket(ticket, developers).checks.assignment.matches, false)
    assert.equal(compareTicket(ticket, developers).checks.status.matches, false)
  }
})

test('a naturally completed ticket retains valid history when its engineer immediately picks up new work', () => {
  const state = decisionFixture(), ticket = state.tickets[0], developer = state.developers[0]
  ticket.requiredWork = 1; setPublishedEstimate(ticket, developer.id, 1)
  developer.discipline = Number.MAX_VALUE // Successful Done report isolates retained historical ownership.
  const next = { ...ticket, id: 'next', title: 'Next ticket', rank: 2, requiredWork: 100,
    actualStatus: 'todo' as const, reportedStatus: 'todo' as const }
  setPublishedEstimate(next, developer.id, 100)
  state.tickets.push(next)
  const result = advanceSimulation(state, 1, () => .5)
  assert.equal(result.tickets[0].actualStatus, 'done')
  assert.equal(result.tickets[0].assignedDeveloperId, developer.id)
  assert.equal(result.developers[0].activeTicketID, next.id)
  assert.equal(compareTicket(result.tickets[0], result.developers).matches, true)
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
