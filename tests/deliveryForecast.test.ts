import assert from 'node:assert/strict'
import { test } from 'node:test'
import { forecastDelivery } from '../src/store/deliveryForecast.ts'
import { DEFAULT_WORKING_CALENDAR as calendar } from '../src/game/workingCalendar.ts'
import { exampleGameState } from '../src/data/exampleGameState.ts'
import { getPlayerView } from '../src/store/playerView.ts'
import { getPlanningView } from '../src/store/planningView.ts'
import { createSprintSession } from '../src/store/sprintSession.ts'

const ticket = (id: string, estimate: number | undefined, progress = 0) => ({ id, title: id, reportedEffortEstimate: estimate, reportedProgress: progress })
const team = [{ id: 'a', name: 'Alex', productivity: 1 }, { id: 'b', name: 'Sam', productivity: 2 }]
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) <= Math.max(Number.MIN_VALUE, Math.abs(b) * 3e-14), `${a} != ${b}`)

test('greedy allocation uses commitment order, earlier hypothetical load and stable ID ties', () => {
  const input = [ticket('first', 100), ticket('second', 50), ticket('third', 300)]
  const f = forecastDelivery(input, team, calendar)
  assert.deepEqual(f.tickets.map(row => [row.engineerId, row.seconds, row.finishSeconds]), [['b', 50, 50], ['a', 50, 50], ['b', 150, 200]])
  close(f.engineers.find(d => d.id === 'a')!.hours, 50 / 3)
  close(f.engineers.find(d => d.id === 'b')!.hours, 200 / 3)
  assert.equal(f.sprintHours, 80)
  close(f.utilisation!, 200 / 240 * 100) // Busiest engineer, not total load / team capacity.
  assert.deepEqual(f.tickets[1].options.map(o => [o.engineerId, o.beforeSeconds, o.finishSeconds]), [['a', 0, 50], ['b', 50, 75]])
  assert.deepEqual(forecastDelivery(input, [...team].reverse(), calendar), f)
  const reordered = forecastDelivery([input[2], input[0], input[1]], team, calendar)
  assert.deepEqual(reordered.tickets.map(row => row.engineerId), ['b', 'a', 'a'])
  close(reordered.utilisation!, 150 / 240 * 100)
  const tie = forecastDelivery([ticket('tie', 10)], team.map(d => ({ ...d, productivity: 1 })), calendar)
  assert.equal(tie.tickets[0].engineerId, 'a')
})

test('remaining effort uses only estimate and clamped reported progress, not completion or gross work', () => {
  const f = forecastDelivery([ticket('half', 100, 50), ticket('reported100', 100, 100), ticket('negative', 10, -1), ticket('above', 10, 200)], [team[0]], calendar)
  assert.deepEqual(f.tickets.map(row => row.remainingWork), [50, 0, 10, 0])
  assert.deepEqual(f.tickets.map(row => row.seconds), [50, 0, 10, 0])
  const state = structuredClone(exampleGameState)
  state.tickets[0].reportedEffortEstimate = 100; state.tickets[0].reportedProgress = 50
  const sprint = createSprintSession().sprint
  sprint.planning = { stage: 'estimated', ticketIds: [], outcomes: [], commitmentIds: [state.tickets[0].id] }
  const view = getPlanningView(getPlayerView(state), sprint)
  const changed = structuredClone(state)
  changed.tickets[0].actualStatus = 'done'; changed.tickets[0].completedWork = 1e200; changed.tickets[0].requiredWork = 1e200
  changed.developers.forEach(d => { d.competencies.frontend = 1e200; d.judgement = 1e200; d.focus = 1e200; d.discipline = 1e200; d.flowStreak = { ticketId: state.tickets[0].id, duration: 1e200 } })
  changed.workLog = [{ developerId: state.developers[0].id, ticketId: state.tickets[0].id, effort: { mantissa: 1, exponent: 500, correction: 0 } }]
  assert.deepEqual(getPlanningView(getPlayerView(changed), sprint), view)
})

test('Unknown and zero-rate work remain explicitly unquantified; partial forecasts do not imply missing work is free', () => {
  const f = forecastDelivery([ticket('unknown', undefined), ticket('known', 100)], team, calendar)
  assert.equal(f.unknownCount, 1); assert.equal(f.unforecastableCount, 0)
  assert.equal(f.tickets[0].seconds, null); assert.equal(f.tickets[0].engineerId, null)
  assert.equal(f.tickets[1].finishSeconds, 50)
  const unknownOnly = forecastDelivery([ticket('unknown', undefined)], team, calendar)
  assert.equal(unknownOnly.utilisation, null)
  for (const unavailable of [[], team.map(d => ({ ...d, productivity: 0 })), team.map(d => ({ ...d, productivity: -1 }))]) {
    const blocked = forecastDelivery([ticket('known', 100)], unavailable, calendar)
    assert.equal(blocked.utilisation, null); assert.equal(blocked.unforecastableCount, 1)
    assert.equal(blocked.tickets[0].finishSeconds, null); assert.equal(blocked.tickets[0].remainingWork, 100)
  }
  const zero = forecastDelivery([ticket('zero', 0)], [{ ...team[0], productivity: 0 }], calendar)
  assert.equal(zero.tickets[0].seconds, 0); assert.equal(zero.utilisation, 0)
})

test('overcommitment is uncapped and calendar conversion remains independent of playback speed', () => {
  const f = forecastDelivery([ticket('large', 1000)], [team[0]], calendar)
  close(f.utilisation!, 1000 / 240 * 100)
  close(f.engineers[0].hours, 1000 / 3)
  assert.ok(f.utilisation! > 100)
  assert.deepEqual(forecastDelivery([ticket('large', 1000)], [team[0]], { ...calendar, simulationSecondsPerRealSecond: .1 }), f)
  const longer = forecastDelivery([ticket('large', 1000)], [team[0]], { ...calendar, sprintWeeks: 4 })
  close(longer.utilisation!, f.utilisation! / 2)
  assert.equal(longer.sprintHours, 160)
})

test('previews are immutable, seeded-state independent and stable through JSON restoration', () => {
  const tickets = [ticket('known', 10, 25), ticket('unknown', undefined)], engineers = structuredClone(team)
  const before = structuredClone({ tickets, engineers })
  const a = forecastDelivery(tickets, engineers, calendar)
  for (let i = 0; i < 10; i++) assert.deepEqual(forecastDelivery(JSON.parse(JSON.stringify(tickets)), engineers, calendar), a)
  assert.deepEqual({ tickets, engineers }, before)
  assert.ok(!JSON.stringify(a).includes('requiredWork'))
  assert.ok(!JSON.stringify(a).includes('competenc'))
  const accidentalExtraFields = engineers.map(engineer => ({ ...engineer, discipline: 12345, competencies: { frontend: 12345, backend: 12345 } }))
  assert.deepEqual(forecastDelivery(tickets, accidentalExtraFields, calendar), a)
})

test('extreme estimates/rates use scaled remaining work and explicitly identify unsupported durations', () => {
  for (const value of [Number.MIN_VALUE, 1e-200, 1e200, Number.MAX_VALUE]) {
    const row = forecastDelivery([ticket('balanced', value)], [{ ...team[0], productivity: value }], calendar).tickets[0]
    assert.equal(row.result, 'forecast'); close(row.seconds!, 1)
  }
  const fraction = forecastDelivery([ticket('subnormal', Number.MIN_VALUE, 50)], [{ ...team[0], productivity: Number.MIN_VALUE }], calendar).tickets[0]
  assert.equal(fraction.result, 'forecast'); close(fraction.seconds!, .5)
  assert.equal(fraction.remainingWork, null) // Small work is not silently displayed as zero.
  for (const [work, rate] of [[Number.MAX_VALUE, Number.MIN_VALUE], [Number.MIN_VALUE, Number.MAX_VALUE]]) {
    const row = forecastDelivery([ticket('outside', work)], [{ ...team[0], productivity: rate }], calendar).tickets[0]
    assert.equal(row.result, 'unforecastable'); assert.equal(row.finishSeconds, null)
  }
  for (const work of [-1, Infinity, NaN]) assert.equal(forecastDelivery([ticket('invalid', work)], team, calendar).tickets[0].result, 'unforecastable')
})

test('subnormal remaining effort is divided before scalar rounding can change the duration or utilisation', () => {
  const engineer = { ...team[0], productivity: Number.MIN_VALUE }
  const forecast = forecastDelivery([ticket('review-regression', 2 * Number.MIN_VALUE, 25)], [engineer], calendar)
  assert.equal(forecast.tickets[0].seconds, 1.5)
  assert.equal(forecast.tickets[0].finishSeconds, 1.5)
  assert.equal(forecast.utilisation, .625)
  assert.equal(forecast.engineers[0].hours, .5)
  // Both upward/downward subnormal rounding and values below scalar resolution
  // retain their represented scaled ratio, rather than a rounded work numerator.
  for (const [multiple, progress, seconds] of [[2, 75, .5], [3, 25, 2.25], [3, 50, 1.5], [5, 25, 3.75]]) {
    const row = forecastDelivery([ticket('nearby', multiple * Number.MIN_VALUE, progress)], [engineer], calendar).tickets[0]
    assert.equal(row.result, 'forecast')
    assert.equal(row.seconds, seconds)
  }
})
