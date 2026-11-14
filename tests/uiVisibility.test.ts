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
      for (const playerText of ['Kanban board', 'Backlog', 'To Do', 'In Progress', 'Done',
        'Reported progress:', 'Assigned to:', 'Developers', 'Productivity:', 'Resume',
        'Simulation time: 0 seconds']) {
        assert.ok(html.includes(playerText), `${mode}: missing ${playerText}`)
      }
      for (const debugText of ['Show development diagnostics', 'Step +1s', 'Restart Simulation',
        'Current active RNG seed/state:', 'Apply seed', 'Development diagnostics: team overview',
        'Actual team work', 'Actual work:', 'Remaining:', 'ETA:', 'Active developer:',
        'Active work:', 'Assigned tickets (ownership):']) {
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
