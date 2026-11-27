import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement, isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { boardReducer, createBoardSession } from '../src/store/boardSession.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { getPlanningView } from '../src/store/planningView.ts'
import type { PlanningAction } from '../src/game/planning'

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}

test('planning form and accessible order controls edit only the shortlist, then display locked outcomes', async () => {
  // Match the existing component hook-host pattern: real JSX and local selection
  // state, without adding a DOM dependency or production-only testing seams.
  const hookId = 'virtual:planning-test-hooks'
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom', plugins: [{
    name: 'planning-test-hook-host', enforce: 'pre',
    resolveId(id) { if (id === hookId) return '\0' + hookId },
    load(id) {
      if (id === '\0' + hookId) return `
        let selected = '';
        export function useState() { return [selected, value => { selected = value; }]; }
      `
    },
    transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/components/SprintPlanning.tsx')) {
        return code.replace("import { useState } from 'react'", `import { useState } from '${hookId}'`)
      }
    },
  }] })
  try {
    const { SprintPlanning } = await server.ssrLoadModule('/src/components/SprintPlanning.tsx')
    let session = createBoardSession()
    const original = structuredClone(session.simulation)
    const dispatch = (action: PlanningAction) => { session = boardReducer(session, action) }
    const render = () => elements(SprintPlanning({ view: getPlanningView(getPlayerView(session.simulation.game), session.sprint), dispatch }))
    const button = (label: string) => render().find(node => node.type === 'button' && (node.props['aria-label'] ?? node.props.children) === label)!
    const click = (label: string) => {
      const node = button(label)
      assert.ok(node, label); assert.ok(!node.props.disabled, label)
      ;(node.props.onClick as () => void)()
    }
    function add(ticketId: string) {
      const select = render().find(node => node.type === 'select')!
      ;(select.props.onChange as (event: unknown) => void)({ target: { value: ticketId } })
      const tree = render()
      const submit = tree.find(node => node.type === 'button' && node.props.type === 'submit')!
      assert.equal(submit.props.disabled, false)
      let prevented = false
      ;(tree.find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => void)({ preventDefault() { prevented = true } })
      assert.ok(prevented)
      assert.equal(render().find(node => node.type === 'select')!.props.value, '')
    }
    assert.equal(render().find(node => node.type === 'button' && node.props.type === 'submit')!.props.disabled, true)
    assert.ok(render().some(node => node.type === 'label' && node.props.htmlFor === 'planning-ticket'))
    add('ticket-6'); add('ticket-7'); add('ticket-3') // XL + XXL + S exceeds capacity; this is allowed.
    assert.deepEqual(session.sprint.planning!.ticketIds, ['ticket-6', 'ticket-7', 'ticket-3'])
    assert.equal(getPlanningView(getPlayerView(session.simulation.game), session.sprint).requestedCapacity, 8.5)
    assert.ok(!render().some(node => node.type === 'option' && node.props.value === 'ticket-6'))
    assert.equal(button('Move ticket-6 earlier in estimation order').props.disabled, true)
    assert.equal(button('Move ticket-3 later in estimation order').props.disabled, true)
    click('Move ticket-3 earlier in estimation order')
    click('Move ticket-3 later in estimation order')
    click('Remove ticket-3 estimation request'); add('ticket-3')
    assert.deepEqual(session.simulation, original) // Rank, time, RNG, work and engineer state untouched.
    click('Resolve estimates and lock shortlist')
    const locked = structuredClone(session)
    assert.equal(session.sprint.planning!.stage, 'estimated')
    assert.equal(render().filter(node => ['form', 'select', 'button'].includes(node.type as string)).length, 0)
    assert.ok(render().some(node => node.props.role === 'status' && String(node.props.children).includes('Shortlist locked')))
    const results = render().filter(node => node.props.className === 'planning-result').map(node => node.props.children)
    assert.deepEqual(results, ['Estimate published', 'Not assessed', 'Not assessed'])
    assert.equal(session.simulation.game.simulationTime, 0)
    session = boardReducer(session, { type: 'resolveEstimation' })
    assert.deepEqual(session, locked)
  } finally { await server.close() }
})

test('planning presentation distinguishes known and Unknown reports, retained outcomes and extreme public values', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  try {
    const { SprintPlanning } = await server.ssrLoadModule('/src/components/SprintPlanning.tsx')
    let session = createBoardSession()
    session.simulation.game.manager = { command: 100 }
    session.simulation.game.developers.forEach(d => { d.discipline = 987654; d.judgement = 987654 })
    for (const [index, estimate] of [undefined, 1e-200, 1e200].entries()) {
      const ticket = session.simulation.game.tickets[index]
      ticket.reportedEffortEstimate = estimate
      ticket.requiredWork = 7654321 // Hidden input must never enter this view.
      session = boardReducer(session, { type: 'addEstimation', ticketId: ticket.id })
    }
    const render = () => renderToStaticMarkup(createElement(SprintPlanning, {
      view: getPlanningView(getPlayerView(session.simulation.game), session.sprint), dispatch: () => {},
    }))
    const html = render()
    for (const value of ['Command</dt><dd>100', 'Available capacity</dt><dd>Unknown', 'Published estimate: Unknown', '1E-200 work units', '1E200 work units']) {
      assert.ok(html.includes(value), value)
    }
    for (const hidden of ['987654', '7654321', 'Actual estimation capacity', 'Start prototype sprint', 'firstPublishedEstimate']) assert.ok(!html.includes(hidden))
    session.sprint.planning = { stage: 'estimated', ticketIds: session.sprint.planning!.ticketIds,
      outcomes: session.sprint.planning!.ticketIds.map(ticketId => ({ ticketId, result: 'retained' })) }
    assert.equal((render().match(/Existing estimate retained/g) ?? []).length, 3)
    assert.ok(!render().includes('Resolve estimates and lock shortlist'))
  } finally { await server.close() }
})
