import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build, createServer } from 'vite'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

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
      if (output) await build({ logLevel: 'silent', build: { ssr: 'src/App.tsx', outDir: output, emptyOutDir: false } })
      const { default: App } = server ? await server.ssrLoadModule('/src/App.tsx')
        : await import(pathToFileURL(resolve(output!, 'App.js')).href)
      const html = renderToStaticMarkup(createElement(App))
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
        const panels = [...html.matchAll(/<details([^>]*)><summary>([^<]+)<\/summary>/g)]
        assert.deepEqual(panels.map((panel) => panel[2]), ['Simulation Controls', 'Team Diagnostics'])
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
        const { DeveloperDiagnostics } = await server!.ssrLoadModule('/src/components/Diagnostics.tsx')
        const highCompetency = structuredClone(exampleGameState)
        highCompetency.developers[0].competencies.frontend = 100
        const diagnosticHtml = renderToStaticMarkup(createElement(DeveloperDiagnostics, {
          developer: getDiagnosticsView(highCompetency).developers[0],
        }))
        assert.ok(diagnosticHtml.includes('Frontend competency: 100</p>'))
        assert.ok(!diagnosticHtml.includes(' / 10'))
        const withoutDiagnostics = renderToStaticMarkup(createElement(GameBoard, {
          view: getPlayerView(exampleGameState), diagnostics: null,
        }))
        assert.ok(!withoutDiagnostics.includes('role="tooltip"'))
        for (const label of ['Work domain:', 'Frontend competency:', 'Backend competency:', 'Effective productivity:', 'Base productivity:']) {
          assert.ok(!withoutDiagnostics.includes(label))
        }
        assert.ok(!withoutDiagnostics.includes('>Mismatch</button>'))
        assert.ok(!withoutDiagnostics.includes('>Match</button>'))
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
        'Active work:', 'Assigned tickets (ownership):', 'Work domain: Frontend', 'Work domain: Backend',
        'Frontend competency:', 'Backend competency:', 'Base productivity:', 'Effective productivity:']) {
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
