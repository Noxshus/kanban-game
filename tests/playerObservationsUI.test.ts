import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { collectPlayerObservations, createPlayerObservations, getPlayerObservations } from '../src/store/playerObservations.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { exampleGameState } from '../src/data/exampleGameState.ts'

test('every ticket has one always-visible Manager View indicator and Unknown facts live in its explanation', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  try {
    const { GameBoard } = await server.ssrLoadModule('/src/components/GameBoard.tsx')
    const html = renderToStaticMarkup(createElement(GameBoard, { view: getPlayerView(exampleGameState) }))
    assert.equal((html.match(/class="manager-view manager-missing"/g) ?? []).length, 7)
    assert.equal((html.match(/No effort estimate has been published\./g) ?? []).length, 7)
    const descriptions = [...html.matchAll(/aria-label="Manager view: Missing estimate" aria-expanded="false" aria-controls="([^"]+)" aria-describedby="\1"/g)]
    assert.equal(descriptions.length, 7)
    for (const [, id] of descriptions) assert.ok(html.includes(`id="${id}" role="region" aria-label="Manager view evidence" tabindex="0" hidden=""`))
    assert.equal((html.match(/>Missing estimate<\/button>/g) ?? []).length, 7)
    assert.ok(!html.includes('observation-unknown') && !html.includes('observation-tooltip'))
    const css = readFileSync('src/App.css', 'utf8')
    assert.match(css, /\.manager-view-details:focus-visible \{ outline: 3px solid var\(--teal\)/)
    const allKnown = structuredClone(exampleGameState)
    for (const ticket of allKnown.tickets) ticket.reportedEffortEstimate = 5
    const neutral = renderToStaticMarkup(createElement(GameBoard, { view: getPlayerView(allKnown) }))
    assert.equal((neutral.match(/class="manager-view manager-neutral"/g) ?? []).length, 7)
    assert.equal((neutral.match(/>No notable observations<\/button>/g) ?? []).length, 7)
    assert.equal((neutral.match(/This is not a check of accuracy\./g) ?? []).length, 7)
    for (const verdict of ['>Verified<', '>Accurate<', '>Trusted<', '>Match<']) assert.ok(!neutral.includes(verdict))
  } finally { await server.close() }
})

test('Manager View consolidates published-estimate facts without deriving a progress-age claim', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  try {
    const { GameBoard } = await server.ssrLoadModule('/src/components/GameBoard.tsx')
    const s = structuredClone(exampleGameState), ticket = s.tickets[0]
    // Hidden truth deliberately contradicts the visible column/progress.
    ticket.actualStatus = 'done'; ticket.completedWork = 987654321; ticket.requiredWork = 987654321
    ticket.reportedStatus = 'in_progress'; ticket.reportedProgress = 12
    const first = getPlayerView(s), c = collectPlayerObservations(createPlayerObservations(first.tickets))
    let last = ''
    for (const [index, value] of [20, 20.000000000000004, 21].entries()) {
      ticket.reportedEffortEstimate = value
      c.observe(getPlayerView(s).tickets[0], { high: index + 1, low: 0 })
      last = renderToStaticMarkup(createElement(GameBoard, {
        view: getPlayerView(s), observations: getPlayerObservations(c.observations),
      }))
      assert.equal(last.includes('<strong>Estimate revised twice</strong>'), index === 2)
    }
    assert.ok(!last.includes('Reported progress unchanged'))
    assert.ok(last.includes('These facts do not establish whether reports are accurate.'))
    assert.ok(last.includes('<ol aria-label="Observed estimate publications">'))
    assert.ok(last.includes('20.000000000000004')) // Details do not round distinct reports into identical values.
    assert.ok(!last.includes('987654321') && !last.includes('actualStatus') && !last.includes('completedWork'))
    assert.equal((last.match(/class="manager-view manager-observations"/g) ?? []).length, 1)
    assert.equal((last.match(/>Observations \(1\)<\/button>/g) ?? []).length, 1)
    assert.equal((last.match(/class="manager-view /g) ?? []).length, 7)
    ticket.reportedEffortEstimate = undefined
    const missing = renderToStaticMarkup(createElement(GameBoard, { view: getPlayerView(s), observations: getPlayerObservations(c.observations) }))
    assert.equal((missing.match(/>Observations \(2\)<\/button>/g) ?? []).length, 1)
    assert.ok(missing.includes('No effort estimate has been published.'))
    assert.ok(!last.includes('>Stalled<') && !last.includes('>Verified<') && !last.includes('>Incorrect<'))
    assert.match(last, /data-todo-ticket="ticket-2" draggable="true"/)
    assert.ok(last.includes('Board Activity'))
  } finally { await server.close() }
})

test('evidence panel touches its shared hover region and remains keyboard-scrollable/selectable', async () => {
  const css = readFileSync('src/App.css', 'utf8')
  const panelRules = css.match(/\.manager-view-details\s*\{([^}]+)\}/)![1]
  assert.match(css, /\.manager-view\s*\{[^}]*position: relative;/)
  // Regression guard for the reviewed 4px gap. DOM/hook tests cannot prove
  // native hit-testing across this edge; verify pointer traversal in a browser.
  assert.match(panelRules, /bottom: 100%;/)
  assert.doesNotMatch(panelRules, /bottom: calc\(100%\s*\+/)
  assert.match(panelRules, /overflow-y: auto;/)
  assert.doesNotMatch(panelRules, /pointer-events: none|user-select: none/)
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  try {
    const { ManagerView } = await server.ssrLoadModule('/src/components/TicketObservations.tsx')
    const html = renderToStaticMarkup(createElement(ManagerView, { estimateUnknown: true }))
    assert.match(html, /^<div class="manager-view manager-missing">.*<button[^>]*aria-controls="([^"]+)"[^>]*>Missing estimate<\/button><div class="manager-view-details" id="\1" role="region" aria-label="Manager view evidence" tabindex="0" hidden="">/)
  } finally { await server.close() }
})
