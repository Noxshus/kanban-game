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
import { getDiagnosticsView as diagnosticsView } from '../src/store/diagnosticsView.ts'
import { boardReducer, createDevelopmentBoardSession } from '../src/store/boardSession.ts'
import { collectPlayerObservations, createPlayerObservations, getPlayerObservations } from '../src/store/playerObservations.ts'
import { getPlanningView } from '../src/store/planningView.ts'

const textContent = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

test('Vite development shows diagnostics; production retains only the player UI', async () => {
  for (const mode of ['development', 'production']) {
    const previousNodeEnv = process.env.NODE_ENV
    // Mimic separate `vite` / `vite build` processes; createServer sets NODE_ENV globally.
    process.env.NODE_ENV = mode
    // Render real Vite transforms in dev, and a production SSR build for the same App.
    // A dev server with mode='production' still uses DEV=true and cannot test this boundary.
    const server = mode === 'development'
      ? await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' }) : null
    const temporaryRoot = resolve('node_modules/.tmp')
    mkdirSync(temporaryRoot, { recursive: true })
    const output = mode === 'production' ? mkdtempSync(resolve(temporaryRoot, 'ui-visibility-')) : null
    try {
      if (output) await build({ logLevel: 'silent', build: { ssr: true, outDir: output, emptyOutDir: false, rollupOptions: { input: { App: resolve('src/App.tsx'), GameBoard: resolve('src/components/GameBoard.tsx'), SprintPlanning: resolve('src/components/SprintPlanning.tsx') } } } })
      const { default: App } = server ? await server.ssrLoadModule('/src/App.tsx')
        : await import(pathToFileURL(resolve(output!, 'App.js')).href)
      const planningHtml = renderToStaticMarkup(createElement(App))
      for (const operational of ['Kanban board', 'Board Activity', 'Include internal activity (DEV)', 'Step +1s', '>Resume</button>', 'aria-label="Simulation controls"', 'draggable="true"']) {
        assert.ok(!planningHtml.includes(operational), `${mode}: planning exposed ${operational}`)
      }
      const { GameBoard: Board } = server ? await server.ssrLoadModule('/src/components/GameBoard.tsx')
        : await import(pathToFileURL(resolve(output!, 'GameBoard.js')).href)
      // Execution's existing board remains independently covered in both builds;
      // App now mounts it only in Execution, rather than alongside Planning.
      const html = renderToStaticMarkup(createElement(Board, { view: playerView(fixture),
        diagnostics: mode === 'development' ? diagnosticsView(fixture) : null }))
      const text = textContent(planningHtml + html)
      assert.equal((text.match(/Estimated effort: Unknown/g) ?? []).length, 7)
      assert.equal((html.match(/class="ticket-complexity"/g) ?? []).length, 7)
      for (const size of ['S', 'XL', 'XXL']) assert.ok(html.includes(`Complexity: ${size}</span>`), mode)
      assert.ok(!html.includes('activity-internal'))
      const { SprintPlanning } = server ? await server.ssrLoadModule('/src/components/SprintPlanning.tsx')
        : await import(pathToFileURL(resolve(output!, 'SprintPlanning.js')).href)
      let scoped = boardReducer(createDevelopmentBoardSession(), { type: 'resolveEstimation' })
      scoped = boardReducer(scoped, { type: 'addCommitment', ticketId: 'ticket-6' })
      const commitmentHtml = renderToStaticMarkup(createElement(SprintPlanning, {
        view: getPlanningView(playerView(scoped.simulation.game), scoped.sprint), dispatch: () => {},
      }))
      for (const visible of ['Choose the sprint scope', 'Commit and start sprint', 'Known-work utilisation: Not quantified', 'Unknown work: 1', 'Per-ticket forecast breakdown', 'public base productivity only']) assert.ok(commitmentHtml.includes(visible), `${mode}: ${visible}`)
      for (const hidden of ['Actual estimation capacity', 'Frontend competency:', 'Actual work:', 'Start prototype sprint', 'First published estimate:', 'workLog']) assert.ok(!commitmentHtml.includes(hidden), `${mode}: ${hidden}`)
      scoped = boardReducer(scoped, { type: 'commitSprint' })
      const scopedBoard = renderToStaticMarkup(createElement(Board, { view: playerView(scoped.simulation.game) }))
      assert.equal((scopedBoard.match(/class="ticket-scope"/g) ?? []).length, 1)
      assert.ok(scopedBoard.includes('In sprint'))
      // Exercise the real published/unpublished histories, not just an empty App.
      const initial = boardReducer(createDevelopmentBoardSession(), { type: 'startSprint' })
      initial.simulation.game.randomState = 87 // Both genuine public publications and a failed report.
      const populated = boardReducer(initial, { type: 'step' })
      assert.ok(populated.activity.length > 0)
      assert.ok(populated.diagnosticActivity!.some(event => event.kind === 'assessment' && event.improved && !event.published))
      assert.ok(populated.diagnosticActivity!.some(event => event.kind === 'decision'))
      const publishedRendering = renderToStaticMarkup(createElement(Board, {
        view: playerView(populated.simulation.game), activity: populated.activity, diagnostics: null,
      }))
      assert.ok(publishedRendering.includes('Effort published:'))
      for (const hidden of ['report missed', 'candidate', 'Reporting draw', 'probability', 'DEV diagnostics', 'activity-internal', 'Include internal activity']) {
        assert.ok(!publishedRendering.includes(hidden), `${mode}: populated histories leaked ${hidden}`)
      }
      const estimates = structuredClone(fixture)
      estimates.workLog = [{ developerId: 'private-effort-contributor', ticketId: 'ticket-1', effort: { mantissa: 1, exponent: 5, correction: 0 } }]
      estimates.tickets.forEach((ticket, index) => {
        ticket.reportedStatus = (['backlog', 'todo', 'in_progress', 'done'] as const)[index % 4]
        ticket.reportedEffortEstimate = [8.5, 0, 1e-200, 1e200, undefined, 12, Number.MIN_VALUE][index]
        ticket.initialEffortEstimate = { developerId: 'private-original-author', totalWork: 7654321 }
        ticket.lastEstimateEvaluation = { developerId: 'private-estimator', reason: 'discovery', personalWork: 8765432, candidate: 6543210, published: false }
        ticket.requiredWork = 9876543
        ticket.complexity = (['S', 'M', 'L', 'XL', 'XXL', 'S', 'M'] as const)[index]
      })
      const visibleEstimates = renderToStaticMarkup(createElement(Board, { view: playerView(estimates), diagnostics: null }))
      const observedView = playerView(estimates)
      observedView.tickets[0].reportedStatus = 'in_progress'
      const observations = collectPlayerObservations(createPlayerObservations(observedView.tickets))
      for (const value of [9, 10]) {
        observedView.tickets[0].reportedEffortEstimate = value
        observations.observe(observedView.tickets[0], { high: value, low: 0 })
      }
      const observedHtml = renderToStaticMarkup(createElement(Board, { view: observedView, diagnostics: null,
        observations: getPlayerObservations(observations.observations) }))
      assert.ok(observedHtml.includes('<strong>Estimate revised twice</strong>'), mode)
      assert.ok(!observedHtml.includes('Reported progress unchanged'), mode)
      assert.equal((observedHtml.match(/class="manager-view /g) ?? []).length, 7, mode)
      for (const hidden of ['9876543', 'private-estimator', 'private-effort-contributor', 'lastEstimateEvaluation', 'Actual work:', 'report missed']) {
        assert.ok(!observedHtml.includes(hidden), `${mode}: factual observation leaked ${hidden}`)
      }
      const activityHtml = renderToStaticMarkup(createElement(Board, { view: playerView(estimates), diagnostics: null,
        activity: [{ id: 1, ticketId: 'ticket-1', ticketTitle: estimates.tickets[0].title,
          at: { high: 3.125, low: 0 }, kind: 'estimate', from: null, to: 8.5 }] }))
      assert.ok(activityHtml.includes('Board Activity'), mode)
      assert.ok(activityHtml.includes('Effort published: 8.5 work units'), mode)
      assert.ok(activityHtml.includes('3.1s'), mode)
      assert.ok(!activityHtml.includes('private-estimator') && !activityHtml.includes('9876543'), mode)
      const estimateText = textContent(visibleEstimates)
      assert.equal((visibleEstimates.match(/class="ticket-estimate"/g) ?? []).length, 7)
      for (const size of ['S', 'M', 'L', 'XL', 'XXL']) assert.ok(visibleEstimates.includes(`Complexity: ${size}</span>`), mode)
      for (const text of ['Estimated effort: 8.5 work units', 'Estimated effort: 0 work units',
        'Estimated effort: 1E-200 work units', 'Estimated effort: 1E200 work units', 'Estimated effort: Unknown']) {
        assert.ok(estimateText.includes(text), mode + ': missing ' + text)
      }
      for (const text of ['private-original-author', '7654321', '9876543', 'First published estimate:', 'actual total effort:',
        'private-effort-contributor', 'Productive effort by engineer', 'Latest effort re-evaluation:', 'private-estimator', '8765432', '6543210']) {
        assert.ok(!visibleEstimates.includes(text), mode + ': leaked ' + text)
      }
      const completed = structuredClone(fixture)
      completed.tickets[0].actualStatus = completed.tickets[0].reportedStatus = 'done'
      completed.tickets[0].completedWork = completed.tickets[0].requiredWork
      completed.tickets[0].reportedProgress = 100
      completed.developers[0].activeTicketID = 'ticket-5'
      const playerCompleted = renderToStaticMarkup(createElement(Board, { view: playerView(completed) }))
      for (const hidden of ['Historical owner:', 'Active work: N/A', 'All applicable comparisons match.', 'comparison-match', 'comparison-mismatch']) {
        assert.ok(!playerCompleted.includes(hidden), `${mode}: completed diagnostic leaked ${hidden}`)
      }
      assert.equal((html.match(/class="ticket-domain"/g) ?? []).length, 7)
      assert.match(html, /class="ticket-domain">Frontend<\/span>/)
      assert.match(html, /class="ticket-domain">Backend<\/span>/)
      assert.match(html, /ticket-2<\/span><span class="ticket-rank"[^>]*>Rank: 2<\/span><\/div><h4>Fix the search filter<\/h4><div class="ticket-categories"><span class="ticket-domain">Frontend<\/span>/)
      assert.equal(html.includes('>Mismatch</button>'), mode === 'development')
      assert.equal((html.match(/aria-label="Manager view: Missing estimate"/g) ?? []).length, 7)
      assert.equal(html.includes('class="comparison-tooltip"'), mode === 'development')
      assert.match(html, /<li[^>]*draggable="true"[^>]*><div class="ticket-reference"><span class="ticket-id">ticket-2<\/span>/)
      assert.ok(!html.includes('Move ticket-2 up'))
      assert.ok(!html.includes('Move ticket-2 down'))
      assert.ok(html.includes('Rank: 2')) // Managerial priority is player-visible in every mode.
      assert.doesNotMatch(html, /<li[^>]*draggable="true"[^>]*><div class="ticket-reference"><span class="ticket-id">ticket-6<\/span>/)
      const header = planningHtml.match(/<header[^>]*>(.*?)<\/header>/)?.[1] ?? ''
      assert.ok(textContent(header).includes('Sprint Planning'))
      assert.equal(text.includes('Start prototype sprint'), mode === 'development')
      assert.equal(planningHtml.includes('Prototype sprint bridge'), mode === 'development')
      assert.ok(planningHtml.includes('Prepare the estimates'))
      assert.ok(planningHtml.includes('Command</dt><dd>0'))
      assert.ok(planningHtml.includes('Available capacity</dt><dd>Unknown'))
      assert.ok(planningHtml.includes('Resolve estimates and lock shortlist'))
      assert.equal(planningHtml.includes('Actual estimation capacity (DEV): 6'), mode === 'development')
      assert.match(header, /role="status">Sprint Planning/)
      assert.ok(!header.includes('<button'))
      if (mode === 'development') {
        const panels = [...planningHtml.matchAll(/<details([^>]*)><summary[^>]*>([^<]+)<\/summary>/g)]
        assert.deepEqual(panels.slice(0, 2).map((panel) => panel[2]), ['Simulation', 'Team'])
        // Separate unnamed disclosures start closed and are not an exclusive accordion group.
        for (const panel of panels) {
          assert.doesNotMatch(panel[1], /\bopen(?:\s|=|$)/)
          assert.doesNotMatch(panel[1], /\bname=/)
        }
        assert.ok(planningHtml.includes('Close Simulation Controls'))
        assert.ok(planningHtml.includes('Close Team Diagnostics'))
        assert.ok(planningHtml.includes('aria-label="Simulation Controls"'))
        assert.ok(planningHtml.includes('aria-label="Team Diagnostics"'))
        assert.ok(textContent(planningHtml).includes('ticket-1 — ticket diagnostics'))
        assert.ok(!planningHtml.includes('aria-label="Resume simulation"'))
        const { DevelopmentUI } = await server!.ssrLoadModule('/src/components/DevelopmentUI.tsx')
        const { exampleGameState } = await server!.ssrLoadModule('/src/data/exampleGameState.ts')
        const { GameBoard } = await server!.ssrLoadModule('/src/components/GameBoard.tsx')
        const { getPlayerView } = await server!.ssrLoadModule('/src/store/playerView.ts')
        const { getDiagnosticsView } = await server!.ssrLoadModule('/src/store/diagnosticsView.ts')
        const { DeveloperDiagnostics, TicketDiagnostics } = await server!.ssrLoadModule('/src/components/Diagnostics.tsx')
        const collective = structuredClone(exampleGameState)
        collective.tickets[0].initialEffortEstimate = { source: 'collective', totalWork: 12 }
        collective.tickets[0].reportedEffortEstimate = 12
        collective.tickets[0].estimateHistory = [{ kind: 'publication', source: 'collective', totalWork: 12, at: { high: 0, low: 0 }, reason: 'initial' }]
        const collectiveHtml = renderToStaticMarkup(createElement(TicketDiagnostics, { ticket: getDiagnosticsView(collective).tickets[0] }))
        assert.ok(collectiveHtml.includes('First published estimate: 12 work units (Collective team)'))
        assert.ok(collectiveHtml.includes('publication: Collective team'))
        assert.ok(!collectiveHtml.includes('undefined'))
        const completedHtml = renderToStaticMarkup(createElement(TicketDiagnostics, { ticket: getDiagnosticsView(completed).tickets[0] }))
        assert.ok(completedHtml.includes('class="comparison-match"'))
        for (const text of ['Active work: N/A — completed.', 'Historical owner: Alex (developer-1).', 'All applicable comparisons match.']) assert.ok(completedHtml.includes(text))
        const completedTooltipId = completedHtml.match(/<span id="([^"]+)" role="tooltip" class="comparison-tooltip">/)![1]
        assert.ok(completedHtml.includes(`aria-describedby="${completedTooltipId}"`))
        completed.tickets[0].reportedStatus = 'todo'
        completed.tickets[0].reportedProgress = 0
        completed.developers[0].activeTicketID = completed.tickets[0].id
        const badCompletedHtml = renderToStaticMarkup(createElement(TicketDiagnostics, { ticket: getDiagnosticsView(completed).tickets[0] }))
        assert.ok(badCompletedHtml.includes('class="comparison-mismatch"'))
        for (const text of ['Unexpected active claims: Alex (developer-1).', 'Historical owner: Alex (developer-1).', 'Status: reported todo; actual done.', 'Progress: reported 0%; actual 100%.']) assert.ok(badCompletedHtml.includes(text))
        assert.ok(!badCompletedHtml.includes('All applicable comparisons match.'))
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
        learning.developers = [{ ...learning.developers[0], judgement: 10, focus: 0, productivity: 1, estimateReview: { ticketId: 'ticket-1', dueTime: { high: 1e308, low: 0 } },
          competencies: { frontend: 5, backend: 0 }, assessmentClock: { elapsed: 0, remaining: 10000 } }]
        learning.tickets = [{ ...learning.tickets[0], completedWork: 0, requiredWork: 100,
          initialEffortEstimate: { developerId: 'original', totalWork: 20 }, reportedEffortEstimate: 20 }]
        const learned = advanceSimulation(learning, 10, () => 0.1)
        const learnedHtml = renderToStaticMarkup(createElement(TicketDiagnostics, { ticket: getDiagnosticsView(learned).tickets[0] }))
        assert.ok(learnedHtml.includes('Latest effort re-evaluation: discovery by developer-1'))
        assert.ok(learnedHtml.includes('; published'))
        assert.ok(learnedHtml.includes('Estimate publication history'))
        const withoutDiagnostics = renderToStaticMarkup(createElement(GameBoard, {
          view: getPlayerView(learned), diagnostics: null,
        }))
        assert.ok(!withoutDiagnostics.includes('role="tooltip"'))
        for (const text of ['Judgement:', 'Focus:', 'Discipline:', 'Next effort review:', 'Most recent assessment', 'Time until next reconsideration:', 'Time since previous assessment:', 'Current candidate:', 'RNG draw:']) {
          assert.ok(!withoutDiagnostics.includes(text))
        }
        for (const label of ['Work domain:', 'Frontend competency:', 'Backend competency:', 'Effective productivity:', 'Base productivity:', 'Uninterrupted work duration:', 'Flow bonus:']) {
          assert.ok(!withoutDiagnostics.includes(label))
        }
        assert.ok(!withoutDiagnostics.includes('>Mismatch</button>'))
        assert.ok(!withoutDiagnostics.includes('>Match</button>'))
        assert.ok(!withoutDiagnostics.includes('Estimate publication history'))
        for (const [isPaused, label] of [[true, 'Resume'], [false, 'Pause']] as const) {
          const toolbar = renderToStaticMarkup(createElement(DevelopmentUI, {
            state: exampleGameState,
            isPaused,
            dispatch: () => {},
          }, () => null))
          assert.match(toolbar, new RegExp(`<\\/details><button type="button" aria-label="${label} simulation">${label}<\\/button>`))
          assert.ok(toolbar.includes('Step +1s'))
          const disclosures = [...toolbar.matchAll(/<details([^>]*)>/g)]
          assert.equal(disclosures.length, 2)
          assert.ok(disclosures.every((panel) => !/\bopen(?:\s|=|$)/.test(panel[1])))
        }
      }
      for (const playerText of ['Kanban board', 'Backlog', 'To Do', 'In Progress', 'Done',
        'Projected progress', 'Engineer report:', 'Assigned to:', 'Developers', 'Productivity:']) {
        assert.ok(text.includes(playerText), `${mode}: missing ${playerText}`)
      }
      for (const debugText of ['Show development diagnostics', 'Restart Simulation',
        'Current active RNG seed/state:', 'Apply seed', 'Development diagnostics: team overview',
        'Actual team work', 'Actual work:', 'Remaining:', 'ETA:', 'Active developer:',
        'First published estimate:', 'Published effort estimate:', 'actual total effort:', 'Productive effort by engineer', 'Latest effort re-evaluation:', 'Estimate publication history',
        'Active work:', 'Assigned tickets (ownership):', 'Work domain: Frontend', 'Work domain: Backend',
        'Frontend competency:', 'Backend competency:', 'Base productivity:', 'Effective productivity:', 'Judgement:', 'Focus:', 'Most recent assessment', 'Uninterrupted work duration:', 'Flow bonus:']) {
        assert.equal((planningHtml + html).includes(debugText), mode === 'development', `${mode}: ${debugText}`)
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
