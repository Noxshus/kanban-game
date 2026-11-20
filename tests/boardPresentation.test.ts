import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { reorderTodo } from '../src/game/rank.ts'

const textContent = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

test('reported board presentation handles sparse data, extremes and reordered priorities', async (t) => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  try {
    const { GameBoard } = await server.ssrLoadModule('/src/components/GameBoard.tsx')
    const render = (state: typeof exampleGameState) => renderToStaticMarkup(createElement(GameBoard, { view: getPlayerView(state) }))

    await t.test('every reported column presents public metadata and labelled progress without truth diagnostics', () => {
      const state = structuredClone(exampleGameState)
      const before = structuredClone(state)
      const statuses = ['backlog', 'todo', 'in_progress', 'done'] as const
      state.tickets = statuses.map((reportedStatus, index) => ({
        ...state.tickets[index], reportedStatus,
        // Deliberately disagree with the reported column and percentage.
        actualStatus: 'backlog', completedWork: 0,
        reportedProgress: index % 2 ? 100 : 0,
        title: index === 1 ? 'A long ticket title with <markup> & a very long identifier_' + 'x'.repeat(120) : state.tickets[index].title,
        assignedDeveloperId: undefined,
        reportedEffortEstimate: [undefined, 0, Number.MIN_VALUE, 1e200][index],
      }))
      const input = structuredClone(state), html = render(state), text = textContent(html)
      assert.equal((html.match(/class="ticket-report"/g) ?? []).length, 4)
      assert.equal((html.match(/class="ticket-rank"/g) ?? []).length, 4)
      assert.equal((html.match(/class="report-unset">Unassigned/g) ?? []).length, 4)
      for (const ticket of state.tickets) {
        assert.ok(html.includes(`aria-label="${ticket.id} reported progress" max="100" value="${ticket.reportedProgress}"`))
        assert.ok(text.includes(`Rank: ${ticket.rank}`))
      }
      for (const value of ['Unknown', '0 work units', '5E-324 work units', '1E200 work units']) assert.ok(text.includes('Estimated effort: ' + value))
      assert.ok(html.includes('&lt;markup&gt; &amp;'))
      assert.ok(html.includes('No effort estimate has been reported yet'))
      assert.equal((html.match(/draggable="true"/g) ?? []).length, 1)
      for (const hidden of ['Actual work:', 'Remaining:', 'ETA:', 'Frontend competency:', 'Discipline:', 'ticket-diagnostics']) assert.ok(!html.includes(hidden))
      assert.deepEqual(state, input) // Rendering never changes the fixture or its estimates.
      assert.deepEqual(exampleGameState, before)
    })

    await t.test('empty columns remain labelled, with zero counts and a readable empty state', () => {
      const html = render({ ...exampleGameState, tickets: [] })
      for (const status of ['backlog', 'todo', 'in_progress', 'done']) assert.ok(html.includes(`aria-labelledby="column-${status}"`))
      assert.equal((html.match(/aria-label="0 tickets"/g) ?? []).length, 4)
      assert.equal((html.match(/class="column-empty">No tickets/g) ?? []).length, 4)
      assert.equal((html.match(/<progress/g) ?? []).length, 0)
    })

    await t.test('re-rendering a paused reorder immediately shows the new global Rank and visible order', () => {
      const input = structuredClone(exampleGameState)
      const moved = reorderTodo(input, 'ticket-5', 'ticket-2')
      const html = render(moved)
      assert.ok(html.indexOf('class="ticket-id">ticket-5') < html.indexOf('class="ticket-id">ticket-2'))
      for (const ticket of moved.tickets) {
        assert.ok(html.includes(`class="ticket-id">${ticket.id}</span><span class="ticket-rank" title="Global managerial priority; Rank 1 is highest">Rank: ${ticket.rank}</span>`))
      }
      assert.deepEqual(input, exampleGameState)
    })
  } finally {
    await server.close()
  }
})
