import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { decisionFixture } from './helpers/decisionFixture.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { createProgressProjections } from '../src/store/progressProjection.ts'

test('one accessible projection bar and a stationary non-colour-only report marker render without hidden truth', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  try {
    const { TicketProgress } = await server.ssrLoadModule('/src/components/TicketProgress.tsx')
    const state = decisionFixture(), t = state.tickets[0]
    t.reportedProgress = 20; t.assignedDeveloperId = 'a'; t.progressReport = { at: { high: 0, low: 0 }, estimate: 100 }
    const view = getPlayerView(state), projection = createProgressProjections(view.tickets, view.developers)[0]
    const render = (time: number) => renderToStaticMarkup(createElement(TicketProgress, { ticket: getPlayerView(state).tickets[0], projection, at: { high: time, low: 0 } }))
    const html = render(115)
    assert.equal((html.match(/<progress/g) ?? []).length, 1)
    assert.match(html, /135%/); assert.match(html, /35 percentage points beyond estimate/)
    assert.match(html, /value="100"/); assert.match(html, /left:20%/)
    assert.match(html, /Engineer report: <strong>20%/)
    assert.match(html, /aria-label="current projected progress"/)
    assert.match(html, /not actual completion/)
    assert.match(render(5), /left:20%/)
    for (const hidden of ['requiredWork', 'completedWork', 'activeTicketID', 'competencies', 'workLog']) assert.ok(!html.includes(hidden))
    delete t.progressReport; delete t.reportedEffortEstimate
    const unknown = createProgressProjections(getPlayerView(state).tickets, view.developers)[0]
    const unknownHtml = renderToStaticMarkup(createElement(TicketProgress, { ticket: getPlayerView(state).tickets[0], projection: unknown, at: { high: 0, low: 0 } }))
    assert.match(unknownHtml, /Unknown/); assert.match(unknownHtml, /snapshot, time unknown/)
    assert.ok(!unknownHtml.includes('value="0"')) // indeterminate projection, not a fabricated zero estimate
    t.reportedEffortEstimate = Number.MIN_VALUE
    const extreme = getPlayerView(state)
    const overflowHtml = renderToStaticMarkup(createElement(TicketProgress, { ticket: extreme.tickets[0],
      projection: createProgressProjections(extreme.tickets, extreme.developers)[0], at: { high: Number.MAX_VALUE, low: 0 } }))
    assert.match(overflowHtml, /1.7976931348623157E308%/)
    assert.match(overflowHtml, /value="100"/)
    assert.ok(!overflowHtml.includes('Infinity'))
  } finally { await server.close() }
})
