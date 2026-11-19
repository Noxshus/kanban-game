import type { DiagnosticsView } from '../store/diagnosticsView'
import { useId } from 'react'
import { formatEffort } from './formatEffort'

function format(value: number | null) {
  if (value === null) return 'Unavailable (zero rate or outside numeric range)'
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function TicketDiagnostics({ ticket }: { ticket: DiagnosticsView['tickets'][number] }) {
  const tooltipId = useId()
  return (
    <div className="diagnostics ticket-diagnostics">
      <strong>Development diagnostics — true values</strong>
      <span className="comparison-indicator">
        <button type="button" className={ticket.comparison.matches ? 'comparison-match' : 'comparison-mismatch'} aria-describedby={tooltipId}>
          {ticket.comparison.matches ? 'Match' : 'Mismatch'}
        </button>
        <span id={tooltipId} role="tooltip" className="comparison-tooltip">
          {ticket.comparison.details.map((detail) => <span key={detail}>{detail}</span>)}
        </span>
      </span>
      <p>Rank: {ticket.rank}</p>
      <p>Work domain: {ticket.workDomain === 'frontend' ? 'Frontend' : 'Backend'}</p>
      <p>Size: {format(ticket.requiredWork)} work units</p>
      <p>First published estimate: {ticket.initialEffortEstimate
        ? formatEffort(ticket.initialEffortEstimate.totalWork) + ' work units (' + ticket.initialEffortEstimate.developerId + ')' : 'Unknown'}</p>
      <p>Published effort estimate: {formatEffort(ticket.reportedEffortEstimate ?? undefined)}; actual total effort: {formatEffort(ticket.requiredWork)} work units</p>
      <details>
        <summary>Estimate publication history ({ticket.estimateHistory.length})</summary>
        {ticket.estimateHistory.length ? <ol>{ticket.estimateHistory.map((event, index) => (
          <li key={index}>
            {event.kind}: {event.developerId ?? 'Unknown author'}; {formatEffort(event.totalWork)} work units;
            {' '}{event.at ? format(event.at.high + event.at.low) + 's' : 'historical time unknown'}
            {'reason' in event ? '; ' + event.reason : 'evidence' in event ? '; ' + event.evidence : '; imported board observation'}
            {event.kind === 'publication' && event.replacedTotalWork !== undefined
              ? '; replaced ' + formatEffort(event.replacedTotalWork) + ' (' + (event.replacedDeveloperId ?? 'unknown author') + ')' : ''}
          </li>
        ))}</ol> : <p>No estimate events recorded.</p>}
      </details>
      <p>Latest effort re-evaluation: {ticket.lastEstimateEvaluation
        ? ticket.lastEstimateEvaluation.reason + ' by ' + ticket.lastEstimateEvaluation.developerId
          + '; personal work ' + (ticket.lastEstimateEvaluation.personalWork === null ? 'below scalar range' : formatEffort(ticket.lastEstimateEvaluation.personalWork))
          + '; candidate ' + formatEffort(ticket.lastEstimateEvaluation.candidate)
          + (ticket.lastEstimateEvaluation.published ? '; published' : '; board unchanged') : 'None'}</p>
      <details>
        <summary>Productive effort by engineer</summary>
        {ticket.contributions.length ? <ul>{ticket.contributions.map(contribution => (
          <li key={contribution.developerId}>{contribution.developerName} ({contribution.developerId}): {contribution.effort === null
            ? 'Below scalar display range (retained in ledger)' : formatEffort(contribution.effort) + ' work units'}</li>
        ))}</ul> : <p>No recorded contributions; historical effort is unknown.</p>}
      </details>
      <p>Actual work: {format(ticket.completedWork)} / {format(ticket.requiredWork)} work units</p>
      <p>Remaining: {format(ticket.remainingWork)} work units</p>
      <p>Active developer: {ticket.activeDeveloperName ?? 'None'}</p>
      <p>Active work rate: {format(ticket.workRate)} work units/second</p>
      <p>ETA: {ticket.estimatedSeconds === null ? 'Unavailable (no representable active rate or ETA)'
        : `${format(ticket.estimatedSeconds)} simulated seconds`}</p>
    </div>
  )
}

export function DeveloperDiagnostics({ developer }: { developer: DiagnosticsView['developers'][number] }) {
  return (
    <div className="diagnostics">
      <p>Base productivity: {format(developer.productivity)} work units/second</p>
      <p>Frontend competency: {format(developer.competencies.frontend)}</p>
      <p>Backend competency: {format(developer.competencies.backend)}</p>
      <p>Uninterrupted work duration: {format(developer.flowDuration)} seconds</p>
      <p>Flow bonus: {format(developer.flowBonus * 100)}%; multiplier: {format(developer.flowMultiplier)}×</p>
      <p>Effective productivity: {developer.activeTicket
        ? `${format(developer.workRate)} work units/second` : 'Unavailable (idle)'}</p>
      <p>Active work: {developer.activeTicket
        ? `${developer.activeTicket.id}: ${developer.activeTicket.title}` : 'Idle'}</p>
      <p>Assigned tickets (ownership): {developer.assignedTicketCount}</p>
      <p>Judgement: {format(developer.judgement)}; Focus: {format(developer.focus)}</p>
      <details>
        <summary>Most recent assessment</summary>
        {developer.lastAssessment ? <>
          <p>Trigger: {developer.lastAssessment.trigger}; current ticket: {developer.lastAssessment.currentTicketId ?? 'Idle'}</p>
          <p>Flow at assessment: {format(developer.lastAssessment.flowDuration)} seconds; alternatives start fresh Flow</p>
          <ul>{developer.lastAssessment.considered.map(option => <li key={option.id}>
            {option.id}, Rank {option.rank}; {option.estimateSource} total {formatEffort(option.estimatedTotal)};
            {' '}perceived remaining {option.perceivedRemaining === null ? 'Below scalar range' : formatEffort(option.perceivedRemaining)};
            {' '}perceived completion {option.timeLimit === 'zero' ? 'Zero (reported complete)' : option.timeLimit === 'infinite' ? 'Impossible at current rate' : format(option.completionSeconds) + ' seconds'};
            {' '}Rank contribution {format(option.rankContribution)}; score {option.score === null ? option.timeLimit : format(option.score)}
          </li>)}</ul>
          <p>Decision: {developer.lastAssessment.outcome}; selected ticket: {developer.lastAssessment.selectedId}</p>
        </> : <p>No assessment yet</p>}
      </details>
    </div>
  )
}

export function TeamDiagnostics({ team }: { team: DiagnosticsView['team'] }) {
  return (
    <section className="diagnostics team-diagnostics" aria-labelledby="team-diagnostics-heading">
      <h2 id="team-diagnostics-heading">Development diagnostics: team overview</h2>
      <p>True simulation values, separate from player reports.</p>
      <p>Completed tickets (including backlog in total): {team.completedTickets} / {team.totalTickets}</p>
      <p>Active developers: {team.activeDevelopers} / {team.totalDevelopers}</p>
      <p>Actual team work (including backlog in total): {format(team.completedWork)} / {format(team.requiredWork)} work units</p>
      <p>Current team work rate: {format(team.workRate)} work units/second</p>
      <p>Rates and ETAs use simulated seconds at current productivity, excluding queue wait.</p>
    </section>
  )
}
