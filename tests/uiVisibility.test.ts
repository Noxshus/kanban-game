import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build, createServer } from 'vite'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { exampleGameState as fixture } from '../src/data/exampleGameState.ts'
import { getPlayerView as playerView } from '../src/store/playerView.ts'

test('Vite development shows diagnostics; production retains only the player UI', async () => {
  for (const mode of ['development', 'production']) {
    const previousNodeEnv = process.env.NODE_ENV
    // Mimic separate `vite` / `vite build` processes; createServer sets NODE_ENV globally.
    process.env.NODE_ENV = mode
    // Render real Vite transforms in dev, and a production SSR build for the same App.
    // A dev server with mode='production' still uses DEV=true and cannot test this boundary.
    const server = mode === 'development'
      ? await createServer({ server: { middlewareMode: true }, appType: 'custom' }) : null
    const temporaryRoot = resolve('node_modules/.tmp')
    mkdirSync(temporaryRoot, { recursive: true })
    const output = mode === 'production' ? mkdtempSync(resolve(temporaryRoot, 'ui-visibility-')) : null
    try {
      if (output) await build({ logLevel: 'silent', build: { ssr: true, outDir: output, emptyOutDir: false, rollupOptions: { input: { App: resolve('src/App.tsx'), GameBoard: resolve('src/components/GameBoard.tsx') } } } })
      const { default: App } = server ? await server.ssrLoadModule('/src/App.tsx')
        : await import(pathToFileURL(resolve(output!, 'App.js')).href)
      const html = renderToStaticMarkup(createElement(App))
      assert.equal((html.match(/Estimated effort: Unknown/g) ?? []).length, 7)
      const { GameBoard: Board } = server ? await server.ssrLoadModule('/src/components/GameBoard.tsx')
        : await import(pathToFileURL(resolve(output!, 'GameBoard.js')).href)
      const estimates = structuredClone(fixture)
      estimates.workLog = [{ developerId: 'private-effort-contributor', ticketId: 'ticket-1', effort: { mantissa: 1, exponent: 5, correction: 0 } }]
      estimates.tickets.forEach((ticket, index) => {
        ticket.reportedStatus = (['backlog', 'todo', 'in_progress', 'done'] as const)[index % 4]
        ticket.reportedEffortEstimate = [8.5, 0, 1e-200, 1e200, undefined, 12, Number.MIN_VALUE][index]
        ticket.initialEffortEstimate = { developerId: 'private-original-author', totalWork: 7654321 }
        ticket.lastEstimateEvaluation = { developerId: 'private-estimator', reason: 'discovery', personalWork: 8765432, candidate: 6543210, published: false }
        ticket.requiredWork = 9876543
      })
      const visibleEstimates = renderToStaticMarkup(createElement(Board, { view: playerView(estimates), diagnostics: null }))
      assert.equal((visibleEstimates.match(/class="ticket-estimate"/g) ?? []).length, 7)
      for (const text of ['Estimated effort: 8.5 work units', 'Estimated effort: 0 work units',
        'Estimated effort: 1E-200 work units', 'Estimated effort: 1E200 work units', 'Estimated effort: Unknown']) {
        assert.ok(visibleEstimates.includes(text), mode + ': missing ' + text)
      }
      for (const text of ['private-original-author', '7654321', '9876543', 'Initial engineer belief:', 'actual total effort:',
        'private-effort-contributor', 'Productive effort by engineer', 'Latest effort re-evaluation:', 'private-estimator', '8765432', '6543210']) {
        assert.ok(!visibleEstimates.includes(text), mode + ': leaked ' + text)
      }
      assert.equal((html.match(/class="ticket-domain"/g) ?? []).length, 7)
      assert.match(html, /class="ticket-domain">Frontend<\/span>/)
      assert.match(html, /class="ticket-domain">Backend<\/span>/)
      assert.match(html, /ticket-2<\/span><h4>Fix the search filter<\/h4><span class="ticket-domain">Frontend<\/span>/)
      assert.equal(html.includes('>Mismatch</button>'), mode === 'development')
      assert.equal(html.includes('role="tooltip"'), mode === 'development')
      assert.match(html, /<li[^>]*draggable="true"[^>]*><span class="ticket-id">ticket-2<\/span>/)
      assert.ok(!html.includes('Move ticket-2 up'))
      assert.ok(!html.includes('Move ticket-2 down'))
      assert.equal(html.includes('Rank: 2'), mode === 'development')
      assert.doesNotMatch(html, /<li[^>]*draggable="true"[^>]*><span class="ticket-id">ticket-6<\/span>/)
      const header = html.match(/<header>(.*?)<\/header>/)?.[1] ?? ''
      assert.match(header, /Simulation time: 0 seconds/)
      assert.match(header, /role="status">Paused/)
      assert.match(header, />Resume<\/button>/)
      assert.equal((html.match(/>Resume<\/button>/g) ?? []).length, mode === 'development' ? 2 : 1)
      if (mode === 'development') {
        const panels = [...html.matchAll(/<details([^>]*)><summary[^>]*>([^<]+)<\/summary>/g)]
        assert.deepEqual(panels.slice(0, 2).map((panel) => panel[2]), ['Simulation', 'Team'])
        // Separate unnamed disclosures start closed and are not an exclusive accordion group.
        for (const panel of panels) {
          assert.doesNotMatch(panel[1], /\bopen(?:\s|=|$)/)
          assert.doesNotMatch(panel[1], /\bname=/)
        }
        assert.ok(html.includes('Close Simulation Controls'))
        assert.ok(html.includes('Close Team Diagnostics'))
        assert.ok(html.includes('aria-label="Simulation Controls"'))
        assert.ok(html.includes('aria-label="Team Diagnostics"'))
        assert.match(html, /<\/details><button type="button" aria-label="Resume simulation">Resume<\/button>/)
        const { DevelopmentUI } = await server!.ssrLoadModule('/src/components/DevelopmentUI.tsx')
        const { exampleGameState } = await server!.ssrLoadModule('/src/data/exampleGameState.ts')
        const { GameBoard } = await server!.ssrLoadModule('/src/components/GameBoard.tsx')
        const { getPlayerView } = await server!.ssrLoadModule('/src/store/playerView.ts')
        const { getDiagnosticsView } = await server!.ssrLoadModule('/src/store/diagnosticsView.ts')
        const { DeveloperDiagnostics, TicketDiagnostics } = await server!.ssrLoadModule('/src/components/Diagnostics.tsx')
        const { advanceSimulation } = await server!.ssrLoadModule('/src/game/advanceSimulation.ts')
        const conflictResult = advanceSimulation(exampleGameState, 1, () => 0.5)
        const conflictHtml = renderToStaticMarkup(createElement(DeveloperDiagnostics, {
          developer: getDiagnosticsView(conflictResult).developers[2],
        }))
        for (const text of ['Trigger: pickup', 'perceived remaining', 'perceived completion', 'Rank contribution', 'score', 'Decision: pickup; selected ticket:']) {
          assert.ok(conflictHtml.includes(text), text)
        }
        for(const text of ['Time until next reconsideration:', 'Time since previous assessment:', 'sampled error:', 'noise scale:', 'Reported-score nominee:']) assert.ok(!conflictHtml.includes(text))
        const highCompetency = structuredClone(exampleGameState)
        highCompetency.developers[0].competencies.frontend = 100
        const diagnosticHtml = renderToStaticMarkup(createElement(DeveloperDiagnostics, {
          developer: getDiagnosticsView(highCompetency).developers[0],
        }))
        assert.ok(diagnosticHtml.includes('Frontend competency: 100</p>'))
        assert.ok(!diagnosticHtml.includes(' / 10'))
        const contributed = structuredClone(exampleGameState)
        contributed.workLog = [{ developerId: 'developer-1', ticketId: 'ticket-1', effort: { mantissa: 1, exponent: 5, correction: 0 } }]
        const contributionHtml = renderToStaticMarkup(createElement(TicketDiagnostics, { ticket: getDiagnosticsView(contributed).tickets[0] }))
        assert.match(contributionHtml, /<summary>Productive effort by engineer<\/summary>/)
        assert.ok(contributionHtml.includes('Alex (developer-1): 32 work units'))
        const advanced = advanceSimulation(contributed, 1, () => 0.5)
        const liveHtml = renderToStaticMarkup(createElement(TicketDiagnostics, { ticket: getDiagnosticsView(advanced).tickets[0] }))
        assert.ok(!liveHtml.includes('Alex (developer-1): 32 work units'))
        const learning = structuredClone(exampleGameState)
        learning.developers = [{ ...learning.developers[0], judgement: 10, focus: 0, productivity: 1,
          competencies: { frontend: 5, backend: 0 }, assessmentClock: { elapsed: 0, remaining: 10000 } }]
        learning.tickets = [{ ...learning.tickets[0], completedWork: 0, requiredWork: 100,
          initialEffortEstimate: { developerId: 'original', totalWork: 20 }, reportedEffortEstimate: 20 }]
        const learned = advanceSimulation(learning, 10, () => 0.1)
        const learnedHtml = renderToStaticMarkup(createElement(TicketDiagnostics, { ticket: getDiagnosticsView(learned).tickets[0] }))
        assert.ok(learnedHtml.includes('Latest effort re-evaluation: discovery by developer-1'))
        assert.ok(learnedHtml.includes('; published'))
        assert.ok(learnedHtml.includes('Estimate assessment and publication history'))
        const withoutDiagnostics = renderToStaticMarkup(createElement(GameBoard, {
          view: getPlayerView(learned), diagnostics: null,
        }))
        assert.ok(!withoutDiagnostics.includes('role="tooltip"'))
        for (const text of ['Judgement:', 'Focus:', 'Most recent assessment', 'Time until next reconsideration:', 'Time since previous assessment:', 'Current candidate:', 'RNG draw:']) {
          assert.ok(!withoutDiagnostics.includes(text))
        }
        for (const label of ['Work domain:', 'Frontend competency:', 'Backend competency:', 'Effective productivity:', 'Base productivity:', 'Uninterrupted work duration:', 'Flow bonus:']) {
          assert.ok(!withoutDiagnostics.includes(label))
        }
        assert.ok(!withoutDiagnostics.includes('>Mismatch</button>'))
        assert.ok(!withoutDiagnostics.includes('>Match</button>'))
        assert.ok(!withoutDiagnostics.includes('Estimate assessment and publication history'))
        for (const [isPaused, label] of [[true, 'Resume'], [false, 'Pause']] as const) {
          const toolbar = renderToStaticMarkup(createElement(DevelopmentUI, {
            state: exampleGameState,
            isPaused,
            dispatch: () => {},
          }, () => null))
          assert.match(toolbar, new RegExp(`<\\/details><button type="button" aria-label="${label} simulation">${label}<\\/button>`))
          const disclosures = [...toolbar.matchAll(/<details([^>]*)>/g)]
          assert.equal(disclosures.length, 2)
          assert.ok(disclosures.every((panel) => !/\bopen(?:\s|=|$)/.test(panel[1])))
        }
      }
      for (const playerText of ['Kanban board', 'Backlog', 'To Do', 'In Progress', 'Done',
        'Reported progress:', 'Assigned to:', 'Developers', 'Productivity:', 'Resume',
        'Simulation time: 0 seconds']) {
        assert.ok(html.includes(playerText), `${mode}: missing ${playerText}`)
      }
      for (const debugText of ['Show development diagnostics', 'Step +1s', 'Restart Simulation',
        'Current active RNG seed/state:', 'Apply seed', 'Development diagnostics: team overview',
        'Actual team work', 'Actual work:', 'Remaining:', 'ETA:', 'Active developer:',
        'Initial engineer belief:', 'Published effort estimate:', 'actual total effort:', 'Productive effort by engineer', 'Latest effort re-evaluation:', 'Estimate assessment and publication history',
        'Active work:', 'Assigned tickets (ownership):', 'Work domain: Frontend', 'Work domain: Backend',
        'Frontend competency:', 'Backend competency:', 'Base productivity:', 'Effective productivity:', 'Judgement:', 'Focus:', 'Most recent assessment', 'Uninterrupted work duration:', 'Flow bonus:']) {
        assert.equal(html.includes(debugText), mode === 'development', `${mode}: ${debugText}`)
      }
    } finally {
      if (server) await server.close()
      if (output) {
        assert.ok(resolve(output).startsWith(temporaryRoot + sep))
        rmSync(output, { recursive: true })
      }
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNodeEnv
    }
  }
})
