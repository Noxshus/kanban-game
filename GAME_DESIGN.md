# Kanban Game - Game Design Document

**Status:** Early concept / Pre-production  
**Version:** 0.2  
**Working title:** Kanban Game

---

## 1. High-Level Concept

Kanban Game is a browser-based incremental management game in which the player oversees a team of autonomous software developers through a Kanban board.

The central premise is that **the board does not necessarily reflect reality**.

Developers work independently, but they may forget to update tickets, misreport progress, become blocked, make mistakes, or work on tasks other than those assigned to them.

The player's responsibility is to identify discrepancies between the reported state of work and the actual state, intervene where necessary, and maintain an efficient development team.

Poor organization reduces productivity.

The game combines management simulation, deduction, RPG-style character progression, and incremental mechanics.

## 2. Design Pillars

### 2.1. Make the Player Feel Clever

The game should frequently present situations that reward observation, deduction, and informed intervention.

Players should feel satisfaction from identifying underlying problems rather than simply responding to explicit alerts.

### 2.2. Allow Incremental Brute Force

Challenges should generally be solvable through intelligent play, but accumulated progression should provide alternative ways to overcome them.

The player's character becomes more capable over time, allowing previously difficult situations to become easier or automated.

### 2.3. The Board Is Not the Truth

The Kanban board is an imperfect representation of the development team's actual activities.

Players must learn to distinguish between reported information, observable evidence, and underlying reality.

This discrepancy is fundamental to the game's identity.

### 2.4. Autonomous Developers

Developers should function as autonomous agents rather than production units requiring constant player input.

They make their own decisions, progress work, and occasionally behave inefficiently or incorrectly.

The player exercises managerial influence rather than directly controlling every action.

### 2.5. Progressive Mechanical Complexity

New gameplay mechanics, abilities, systems, and responsibilities should unlock gradually.

The initial experience should be relatively simple, with complexity emerging as the player progresses.

## 3. Player Role

The player takes the role of a manager overseeing a software development team.

The exact job title remains undecided and may change during progression.

The player can:

- Observe the Kanban board and available team information.
- Manually change ticket statuses.
- Override developer assignments.
- Set work priorities.
- Investigate discrepancies between reported and actual work.
- Unlock abilities that improve developer performance or reveal additional information.
- Develop their own managerial competencies.

Additional actions will become available as the game progresses.

## 4. Core Game Systems

### 4.1. Kanban Board

The Kanban board is the primary interface through which the player monitors the team.

Tickets move through workflow stages representing the software development process.

**Critical distinction:** A ticket's position on the board does not necessarily correspond to its actual progress.

The player may need to intervene to keep the board accurate and the team productive.

**Player-defined ticket Rank (implemented prototype, #12):** Every ticket belongs to a single, globally ordered list with a unique, consecutive integer `rank` from 1 (highest) to N (lowest), regardless of Kanban column. Rank is the player's intended priority, not objective urgency or a guarantee developers follow it. Initially the player may drag tickets to reorder them **within the reported To Do column**, even if a ticket's hidden actual status differs. This changes only the ranks of the affected reported To Do tickets by permuting their positions in the global order; tickets in every other column retain their exact global rank, even when interleaved. Current engineers compare perceived completion times using personal effort estimates, reported progress, domain productivity, Flow and a single soft Rank preference. Cross-column dragging remains deferred.

### 4.1.1. Workflow stages (current prototype direction)

The current prototype distinguishes four stages:

- **Backlog:** Potential work that management has not yet committed to development. A ticket can remain here indefinitely; not every idea deserves implementation.
- **To Do:** Committed, authorized work awaiting a developer.
- **In Progress:** Work that has started but is not necessarily being actively worked on at this instant.
- **Done:** Completed work.

These are currently presented together as four columns for ease of inspection. A separate Backlog screen may be preferable as the game grows; that presentation choice remains open.

A developer's **active work** is distinct from a ticket's In Progress workflow status. A ticket can remain In Progress without an active developer and can later be resumed by another developer.

The Backlog boundary is deliberate: normal autonomous developer selection must not pick Backlog tickets. Misbehaviour that breaks this rule is a potential future mechanic, not part of the current prototype.

For now, true status, reported status, reported progress and visible assignment are kept in sync for verification when work advances. The distinct underlying fields must remain, because unreliable reporting is a confirmed long-term design pillar.

### 4.2. Developer Simulation

Developers progress tickets autonomously.

They may:

- Work on assigned tickets.
- Become blocked.
- Fail to update the board.
- Make mistakes.
- Work on inappropriate or lower-priority tasks.

Developer behaviour will eventually be influenced by individual attributes and competencies.

**Wasted effort (agreed design direction, detailed mechanics open; #30):** Developers may attempt blocked work and expend time without useful progress, rather than always being prevented by dependency checks. Some tickets may also be fully executable yet deliver little or no actual value (red herrings). These are distinct possibilities: *ability to make progress* and *value of completing the work* should not be conflated. Players may not initially know which work is blocked or valueless. The effects on work/progress, reporting, dependencies and engineer judgment remain to be designed.

### 4.2.1. Perceived-work selection (#49/#56; released prototype)

Engineers can work on tickets whose **actual** status is **To Do** or **In Progress**, provided they are unfinished and not actively claimed by another engineer. Backlog, Done and another engineer's active claim are excluded. Assignment means ownership and can differ from active work. These truth-based eligibility safeguards do not make the engineer's appraisal omniscient.

For every relevant option, use the engineer's latest genuine personal total-effort estimate from #70. An unfamiliar ticket receives one transient independent appraisal from the existing #57 distribution, using Judgement and the relevant domain competency. It is private decision input: an unchosen appraisal changes no belief, published estimate or estimate history. If chosen, that **exact appraisal** becomes the engineer's first official personal estimate and immediate publication; there is no second estimate roll. A returning engineer republishes their remembered assessment under #70.

Infer remaining effort exclusively from that belief and the ticket's reported progress:

```text
perceivedRemaining = personalEstimatedTotal * (1 - clamp(reportedProgress, 0, 100) / 100)
score = -ln(perceivedCompletionTime) + 0.25 * (1 / eligibleRankOrdinal)
```

The same report-based progress rule applies to current work and alternatives. Hidden completed work and #65 gross personal effort are **not** completion proxies for a decision. Hidden total effort is used only inside the existing fallible #57 sampling formula and actual simulation execution. Stale or contradictory reports, including an unfinished ticket reported as 100% complete, can therefore mislead engineers intentionally.

Perceived completion time reuses the existing domain-adjusted productivity and integrated Focus/Flow projection with perceived remaining work. Staying retains accumulated Flow; switching or idle pickup starts fresh Flow. No extra Focus, competency or Judgement modifier is applied to the final comparison. Scaled work and log-time comparisons handle very small/large quantities; zero perceived time and impossible positive-work completion have explicit limits.

Choose the highest score deterministically, breaking ties by better global Rank and ticket ID. Rank ordinal is calculated from the **full actual-eligible context including current work**, even when the event limits which alternatives are compared. Rank enters once. The provisional **0.25** preference permits a modest efficiency sacrifice for management priorities, not unlimited obedience. There is no separate nomination stage, privileged actual-fastest challenger, holistic noise roll, weighted random choice or softmax. Judgement affects decision quality through the existing fallible estimation mechanics, not another decision roll.

**Historical:** This replaces the #32/#49 50/50 Rank/reported-opportunity nomination and noisy holistic comparison. The older #31 Judgement-minus-Discipline sigmoid and #14 category roll remain superseded. Blockers, dependencies, ticket value and richer team economics remain future systems; the current coefficients are not a final balance commitment.

### 4.2.2. Event-driven reconsideration (#56; released prototype)

The periodic Weibull-style reconsideration clock and older #16 automatic switching are removed. Active engineers reconsider only when:

- Their own #58 personal estimate genuinely improves at a discovery or lifetime overrun event. Consider current work and **all** eligible alternatives immediately. An evaluation with no adopted assessment, or a publication without a new personal belief, does not trigger reconsideration. Revising does not force switching.
- A player Rank action changes the relative ordering of relevant eligible work. Consider current work plus alternatives participating in those changed pairwise orderings, using full-context Rank ordinals. No-op drops and changes confined to ineligible work do not trigger decisions. Existing To Do-only, slot-preserving drag/drop remains the only ranking interaction.
- Their current ticket completes: perform ordinary idle/next-work selection across eligible work. This is a pickup, not a stay-versus-switch decision.

New availability alone never interrupts active work. While running, a relevant priority action triggers decisions immediately at the current simulation instant without advancing work or time. Genuine repeated running priority reversals may create fresh transient appraisals; there is deliberately no cooldown, decision cache or anti-reroll state. In contrast, #70 still protects persistent personal baselines and seeded discovery targets against switch-only rerolls.

Pause freezes engineer decisions, estimates/publications, RNG, productive work, Flow and simulation time. The player may still reorder tickets and see Rank change immediately. Paused edits accumulate only their net relative-order change against the order when the paused interval began; reversing all edits triggers no reconsideration. Step +1s and Resume process each affected engineer at most once for that net priority change, at the current simulation timestamp, before any work/time advancement. Resume processes it immediately, without waiting for a timer tick; Step then advances one second. Pending edits are cleared after processing, and Restart discards them.

Events process chronologically. Release all completed claims first, then process pickups and revision decisions in engineer order at a true tie. Priority actions also resolve engineers in order, respecting earlier claims; newly freed work alone does not become a new Rank trigger for later engineers. Completion wins a coincident discovery/overrun on the same ticket. Staying preserves Flow; actual switching/completion resets it. Legacy periodic clock fields are ignored/removed without consuming schedule RNG.

Anchored compensated event instants and integrated actual work remain in place for elapsed partitions, JSON restoration and numerical safety. Unsupported actual time/work precision still fails explicitly. The #49/#56 prototype passed manual QA and independent review and was released in `ec12f8b`. Additional triggers, autonomous reporting #63, planning #60 and overestimation #59 remain unimplemented. Actual switch-loss consequences are now implemented locally under #61 below.

### 4.2.3. Focus builds Flow (implemented #51 and naming #54; `74d098e`, `6177a41`)

**Focus** is the permanent, beneficial engineer attribute determining how quickly **Flow** accumulates through uninterrupted work on the same ticket. **Flow** is the temporary productivity bonus. Even Focus 0 builds Flow; higher Focus builds it faster. The bonus has **no finite ceiling**, although marginal gains diminish strongly.

The first implemented, provisional balancing curve (unchanged from #51 except for names) is:

```text
t = uninterrupted active work time in simulated seconds
F = Focus (finite, non-negative)
flowBonus(t, F) = 0.25 * ln(1 + (1 + F / 5) * t / 10)
instantaneousWorkRate(t) = domainAdjustedWorkRate * (1 + flowBonus(t, F))
```

Work advances using the **integrated** Flow multiplier, not merely a sample of the instantaneous rate. Flow is tracked per engineer and ticket. **Switching tickets or completing work resets Flow to zero**; a reconsideration ending in **stay**, pausing, advancing zero time or changing managerial Rank **does not**. Partial Flow retention is a deferred upgrade (#50).

Focus **does not directly penalise** Judgement, event relevance or willingness to switch. However, a good Judgement comparison accounts for the *real productivity cost* of losing accumulated Flow and for how quickly a high-Focus engineer could rebuild Flow after switching. Flow duration, bonus, multiplier, perceived completion times, event triggers and detailed decision explanations remain **development-only diagnostics** (#53 tracks the eventual simple player-facing language).

**Domain expertise versus Judgement (#38; implemented prototype):** Every ticket has **one primary work domain**, initially **Frontend** or **Backend**; multi-disciplinary deliverables are made up of tickets at epic/initiative level. Engineers possess **separate Frontend and Backend competencies** rather than mutually exclusive job classifications, enabling full-stack engineers who are competent in both. Competencies are non-negative, finite and **uncapped**; example engineers initially range from 0 to 10, but this is not a permanent ceiling. Effective productivity now uses the single competency/complexity rate below (#52). At S complexity it preserves base productivity × (0.5 + relevant domain competency / 10), including multipliers of ×0.5, ×1 and ×1.5 at competencies 0, 5 and 10, and continues scaling above 10. These are provisional balancing values, not a fixed long-term growth curve. Poor skill fit slows ordinary work but does not make completion impossible; minimum-competency requirements are deferred to #40. **Ticket domains are now visible on normal Kanban cards in every reported column (#46), including production**. Engineer competency values and effective rates remain development-only for now; existing base productivity remains visible. Eventual broader player knowledge is undecided. Domain-adjusted rates affect perceived completion-time comparisons under #49/#56; competency also affects the existing fallible effort-estimation distribution. No separate nomination or Judgement noise is applied. Future specialisms (e.g. DBA versus a general Backend engineer) may apply additional domain-related modifiers (#39); their formulas and visibility are undecided.

### 4.2.3.1. Intrinsic technical complexity (#52; released first scope)

Every ticket has a T-shirt technical-complexity label, independent of its engineer-independent base work quantity (`requiredWork`). **This is not effort sizing:** a 10-work-unit XXL ticket can be more technically challenging than a 100-work-unit S ticket.

The provisional multipliers are **S = 1, M = 1.5, L = 2, XL = 3, XXL = 5**. Use one unified domain-adjusted rate:

```text
D = complexity multiplier
C = relevant Frontend/Backend competency
workRateBeforeFlow = baseProductivity * (C / 10 + 0.5 / D)
```

Complexity reduces the novice baseline contribution; it does not apply a second independent competency/complexity penalty. S exactly preserves the former formula. At competency 0, the pre-Flow time penalty versus S is D; as uncapped competency grows, the relative penalty tends to zero. Existing integrated Flow multiplies this rate, so actual completion times also reflect Flow growth. No competency cap, difficulty gate or eligibility threshold is added.

The same rate governs actual productive work, completion/discovery/overrun projections, perceived decision times and DEV effective-rate diagnostics. Base work requirements, gross productive-effort contributions and total-effort estimates retain their existing units. Complexity adds no estimation modifier, distribution, learning formula or RNG draw. Tickets and older saves with no complexity label are treated as S without rewriting their work or history.

**Temporary first-scope information rule:** complexity is accurate and visible on every Kanban card, in both development and production, and engineers use that same label for decision projections. Hidden base requirements and engineer competencies remain outside the player view. Future fallible engineer-specific complexity assessments, remembered beliefs, learning and reports (#52/#35) should follow/reuse the effort-estimation lifecycle, but their categorical formulas and reporting rules remain unimplemented. Actual execution will ultimately use true complexity while decisions use believed/reported complexity. Actual switch-related work loss is defined in the following section.

### 4.2.3.2. Current-stint work loss (#61; implemented local prototype)

Actually abandoning an unfinished ticket discards a complexity- and competency-derived fraction of the useful progress produced during that engineer's **current uninterrupted stint**:

```text
D = intrinsic T-shirt complexity multiplier
C = abandoning engineer's relevant domain competency
lossFraction = (1 - 1 / D) / (1 + C / 5)
lostProgress = currentStintProductiveWork * lossFraction
```

S loses no progress. More complexity increases loss, while uncapped competency reduces it toward zero. There is no added coefficient or random draw. Earlier stints' retained progress, including other contributors' work, is protected. For example, with 40 earlier units and 30 new units, XL at competency 10 loses 30 * 2/9 = 6.67 units, retaining about 63.33 units overall.

Only a genuine ticket change applies loss, after the decision is made. Staying, no-op priority changes, pause/resume without a switch, numerical cache refreshes, ordinary completion and idle next-work pickup apply none. Paused Rank changes remain deferred; any loss occurs only if the eventual Step/Resume decision actually switches. Changing tickets also retains the existing independent full Flow reset. Returning starts a new stint; cache reprojections and attribute/rate changes do not restart a gameplay stint. Legacy active saves without a stint marker protect all progress known at restoration rather than inventing its historical stint provenance.

Gross productive effort in #65, genuine personal beliefs/history and learning remain intact when useful progress rolls back. Existing discovery targets are not regenerated simply because progress was lost, and the lifetime overrun alarm is not re-armed. Abandonment does not itself change reported progress or estimates; existing active-work reporting and #70 publications still apply at their normal times. The new stint marker and authoritative net progress remain outside the normal player view.

**Approved Option B:** #49/#56 scoring is unchanged. Engineers do **not** anticipate or price this lost progress when choosing work; the consequence is applied afterward. Future switching-cost awareness belongs to #72. Architecture/Solution Design attributes (#71), fallible complexity beliefs, rework debt and handoff-quality systems are not implemented. Existing explicit numerical precision limits still apply.

**Engineer-decision design sequence (PoC):** Work domains/competencies (#38), the initial selector (#31) and the first stay-versus-switch/reconsideration prototype (#32/#49/#54) are implemented with deterministic scenarios (#37). The deeper Judgement difficulty redesign remains open (#49). Later stages include recognising/attempting blocked work (#33), richer execution/results (#34), and deciding when/how accurately to report work (#35). Their numerical rules are not yet approved.

**Future learning from past events (#36):** A periodic one-to-one review (monthly is only an example) might allow engineers to explain previous decisions, blockers and mistakes, with observations recorded in their profiles. The engineer's account is not automatically authoritative truth: statements, actual history, player inferences and verified player knowledge must remain distinguishable. Player attributes such as possible **Deduction** could influence how effectively the manager questions an account or identifies contradictions; names and mechanics are not yet confirmed. Design this later, once the behaviour being reviewed exists; do not add managerial interventions during the simulation-first phase.

**PoC sequencing decision:** Develop convincing autonomous engineer behaviour and the divergence between actual events and Kanban reports **before** introducing new manager interventions. The desired managerial frustration should emerge from watching engineers make their own choices; only then should player actions be designed in response. Initial attribute-driven behaviour is implemented; richer decisions and reporting remain future design work.

### 4.2.4. Personal effort estimates and publication (#57/#70; current prototype)

On an engineer's first genuine encounter with a ticket, they independently estimate its **total required work units**, irrespective of the previous board estimate, and immediately publish their opinion. A new engineer's report replaces the old value **even when lower**, including below already completed work. Unstarted tickets display **Unknown**. Each engineer-ticket pair gets only one random starting estimate. On return, the engineer remembers and republishes their latest genuine personal assessment without a fresh estimate draw or automatic accuracy improvement. Simply continuing work or reconsidering and staying creates no new assessment or publication. The ticket's original #57 estimate and author remain immutable historical provenance. Only the current published value is player-visible; actual requirements and private beliefs remain development-only. Reported progress and the #49 selection model are unchanged.

The approved provisional calibration uses Judgement J, the ticket-domain competency C, true total work T, and one seeded uniform draw U in [0, 1):

```text
q = 1 + 0.09 * J + 0.09 * C
E0 = T * exp(log1p(-U) / q)
expected(E0) = T * q / (q + 1)
```

These are **prototype balancing constants**. Mean accuracy at J/C = 0/0, 10/10, 50/50 and 100/100 is 50%, about 73.7%, about 90.9% and 95% respectively, not a per-seed promise. Attributes remain finite, non-negative and uncapped. Estimates only underestimate (0 <= E0 <= T); exact accuracy can occur at RNG endpoints or finite precision. Positive work whose estimate would underflow to zero is explicitly rejected, rather than assigned an artificial minimum or error cap. Focus and Flow do not directly affect estimation.

Existing active claims without estimates are initialised before their first positive advance or first relevant priority decision, in engineer order; zero-time advances and rendering consume no estimate draws. Unfamiliar-ticket appraisals are sampled in eligible Rank/ID order. A selected appraisal is promoted without resampling, and discovery work targets are prepared after the same-instant decisions; no periodic scheduling draw remains. A single durable, chronological ticket history distinguishes genuine personal assessments from publications, including return publications with the same number but different provenance. Array order distinguishes events at the same instant; a publication points to the assessment it reports and retains the displaced report and its author when known. Unchanged evaluations and per-tick calculations do not enter that history. The history supports future investigation but is currently inspectable only in development diagnostics, not a shipped player investigation interface.

Legacy saves import only established evidence, marking unknown historical times or authors explicitly. An already-active legacy engineer whose latest personal opinion is unavailable adopts the saved board value as an explicitly identified compatibility belief, retaining the old learning baseline without inventing a past personal assessment or consuming a new estimate draw. A private-only legacy estimate remains unpublished on restoration. Unrecorded inactive engineers' past opinions cannot be reconstructed; their first post-upgrade encounter generates a personal starting estimate once. These compatibility observations persist through saves so restoration does not repeat migration or estimation.

First-pickup publication is a **temporary pre-planning shortcut**, including its visible clue that work has been picked up. Sprint planning (#60) is intended before PoC/MVP and will move initial publication before work, without double publication. Later productive-work learning/revisions (#58, below) publish meaningful improvements immediately under the agreed temporary reporting shortcut. Communication (#63/#35), overestimation (#59) and additional event triggers remain separate work; #56 now implements the bounded triggers in section 4.2.2.

### 4.2.5. Durable productive-effort log (#65)

The simulation retains cumulative **actual productive work units per engineer/ticket pair**, across sessions, switching, reassignment, completion and returning to earlier work. Past contributors remain recorded independently of current ownership. This is **gross effort invested**, separate from the ticket's net retained completed work: switch-related progress loss never erases previously gained experience. Idle time, merely holding a ticket and intervals producing no work do not contribute. Older states start with no known contributions; existing progress is not attributed to an engineer retrospectively. Contributions survive saves and remain development-only diagnostics for now. The ledger supplies productive experience to #58 and current-stint exposure to #61; it remains independent of net retained progress and does not add player reports or a timestamped event history.

### 4.2.6. Progressive hands-on re-estimation (#58; provisional prototype)

Engineers re-evaluate total effort at seeded **productive-work exposure thresholds**, using their own cumulative #65 contributions and their **own positive personal starting estimate E0** (#70), rather than a shared ticket-global baseline. Personal starting and latest accepted opinions are recovered from the canonical assessment/publication history, not a separate knowledge attribute or experience-checkpoint system. Handoffs and returns publish as described above, without granting extra productive experience.

```text
k(J) = 0.8 * (1 + ln(1 + J/10))
r = (T - Eboard) / T
g(r) = 2r / (r + 0.2)
discovery hazard per personal work unit = k(J) * g(r) / (E0 + w)
a(J,C) = 0.30 * (1 + ln(1 + J/10) + ln(1 + C/10))
candidate = T - (T - E0) * (1 + w/E0)^(-a(J,C))
```

T is true total effort, E0 is this engineer's personal starting estimate, w is their gross productive contribution, J is Judgement and C is relevant domain competency. For fixed attributes and board, the instantaneous discovery chance per additional productive work unit steadily decreases as personal work accumulates; an improved board estimate also reduces residual error and responsiveness. This does not mean the cumulative chance of eventually discovering something decreases. The growing overrun-disparity multiplier from #58 is removed (#68); the existing coefficients and accuracy formula remain unchanged. Accurate estimates have no error-discovery events. Focus has no direct estimator modifier; Flow changes the time required to earn work exposure.

At a genuine hands-on evaluation, **any representably larger candidate than that engineer's latest personal belief is adopted and published immediately**, with no minimum improvement threshold or tolerance (#67/#70). Equal or lower candidates create no assessment or publication event. Each engineer's hands-on beliefs improve monotonically; the board can move in either direction on takeover or return. Candidates are computed from personal E0 and cumulative personal work, never compounded on another engineer's report. Immediate publication is the current prototype shortcut; autonomous reporting remains future #63/#35.

Pending seeded discovery work targets, including completion-censored targets, survive switching and returning. Republishing an unchanged remembered belief does not reroll discovery; another engineer's remaining contribution can censor an existing target at completion. A genuine revision or relevant change to scheduling inputs uses the existing discovery process. There is no additional timer or switch-based source of free discovery attempts.

Reaching the reported total while unfinished can trigger **at most one immediate overrun-crossing evaluation per ticket lifetime** (#68); **completion at the same instant wins**. The opportunity is consumed even if the report stays unchanged. Neither its own publication, a later ordinary discovery, a handoff nor a return re-arms it. All subsequent evaluations use the existing seeded positive-work discovery process. There is no guaranteed correction, observed-work estimate floor or accuracy bonus. A takeover report already below completed work does not create an immediate crossing evaluation or newly consume the opportunity; the independent takeover assessment is a separate event. Board-only legacy reports retain their original baseline without inventing a historical author. Invalid/zero baselines on unfinished positive work are rejected; zero-work completed tickets bypass learning. Numerical precision limits fail explicitly rather than silently clipping effort or event time. Hidden candidates, personal history and discovery information remain development-only; only published effort reaches the player view. A genuine personal revision now triggers the bounded reconsideration in section 4.2.2. Global Rank, reported status/progress and Focus/Flow production rules are otherwise unchanged; #61 progress loss preserves gross learning and the lifetime alarm, while #59 remains deferred.

### 4.3. Information and Deduction

The player does not automatically know everything occurring within the development team.

There is a distinction between:

1. **Actual state:** What is really happening within the simulation.
2. **Reported state:** What the Kanban board and developers claim is happening.
3. **Player knowledge:** What the player has successfully established through available information and abilities.

The player's task is partly to reconcile these different representations.

### 4.3.1. Information visibility and future unlocks

The player should not begin with complete or reliably accurate knowledge of ticket progress, developer activity, or team performance. Individual pieces of information may later become unlockable, approximate, misleading, or subject to investigation. The precise unlock and verification mechanics remain undecided.

The current prototype exposes extra authoritative information for testing; those development-only displays are an implementation aid rather than a player-facing design commitment. See `AGENTS.md` and the relevant GitHub implementation issues for development UI conventions.

### 4.3.2. Keep autonomous behaviour inferable (checkpoint #43 completed)

**Ongoing design risk:** An internally rich simulation is not sufficient if the player cannot observe enough evidence to develop and test meaningful hypotheses about engineer behaviour. The board should remain imperfect, but uncertainty must not collapse into uninformed guessing. Slow work, a task switch, a blocker, poor ticket choice and stale reporting can produce similar visible symptoms; later reporting, retrospective one-to-ones (#36) or other discoveries may help the player distinguish them. Specific clues and unlocks are deliberately undecided, and managerial interventions remain deferred until the simulation creates problems worth solving.

Checkpoint #43 was completed after competency implementation (#38) and before attribute-driven work selection (#31). It revisited:
- **Incremental progression:** Both general productivity and domain competency may grow **without hard caps**. At fixed competencies, a multiplicative modifier retains its relative effect across productivity levels; raising competency changes the modifier itself. Assess whether multiplying two uncapped growth tracks creates desirable progression, whether later diminishing marginal returns (without caps) or support roles are needed, and how to preserve specialist advantages alongside brute force. The initial #38 formula need not be rebalanced merely to remove the 10-point input ceiling.
- **Engineer Judgement and information:** Distinguish actual work requirements/value, the engineer's beliefs about them, their estimate of their own capability, and the player's knowledge. Ignoring Rank might result from information, preferences or poor Judgement; these should not be conflated.
- **Player observability:** Identify the minimum evidence and eventual learning paths needed for the player to reason about what happened, without making the Kanban board an infallible source of truth.

**Historical checkpoint decisions for #31 (#43; subsequently implemented in #31; partly superseded by #49/#51):** **Judgement** means accuracy of an engineer's *holistic assessment of what is worth doing for the team*, not merely their personal speed. **Discipline** was then modelled as adherence to managerial Rank, but that meaning is **superseded by Focus building Flow (#51/#54)**. The #31 selection formula was subsequently replaced, most recently by perceived-work selection in section 4.2.1. Where an engineer's appraisal disagrees with the manager's priority, a larger positive difference between Judgement and Discipline should make following that appraisal more likely; the first provisional probability curve was subsequently selected and implemented in #31 (see §4.2.1). The #31 selection evaluates eligible **To Do and unclaimed In Progress together**, replacing the provisional 50/50 category split. The current #49/#56 prototype combines genuine #70 personal estimates (or transient independent #57 appraisals) with reported progress and Rank; actual state only guards eligibility and work execution, not remaining-effort valuation. Domain competency numbers remain development-only, so their role in a shared-information appraisal needs separate design. Blockers, dependencies, and ticket value will broaden holistic Judgement as those systems arrive (#45/#33/#30). A more elaborate private engineer-perception model is explicitly deferred and not promised. Personal preferences and full personality systems belong to very late-stage #42. Development diagnostics and deterministic fixtures should reveal why a choice was made without exposing hidden truth to the player. No new managerial interventions were approved by this checkpoint; #31 subsequently approved the narrowly scoped provisional work-selection formula above.

### 4.4. Player Attributes and Abilities

The player has RPG-like attributes that influence their effectiveness as a manager.

These attributes may affect their ability to:

- Detect inaccurate information.
- Identify developer competencies.
- Investigate problems.
- Successfully intervene in team activities.

The exact attribute names, progression mechanisms, and effects remain undecided.

### 4.5. Incremental Progression

The game will feature incremental progression in which accumulated resources, abilities, or improvements allow the player to manage increasingly complex situations.

Progression should reduce the effort required to solve previously encountered problems.

Automation is an intended feature, but its exact implementation remains undecided.

### 4.6. Prestige and Career Progression

The game will feature a prestige mechanic based on changing jobs.

The player leaves their current employer and begins working at a new organization.

Organizational progress resets, while some aspects of the player's accumulated capabilities persist.

The specific reset rules, retained attributes, and incentives for changing employers remain undecided.

## 5. Game Progression

The game should gradually introduce new mechanics and responsibilities rather than presenting its full complexity immediately.

Early gameplay is expected to focus on monitoring a small team and managing individual tickets.

Later gameplay will introduce more sophisticated abilities, automation, and organizational challenges.

**The game will have a defined end-state.**

The precise progression structure, duration, and victory conditions have not yet been determined.

## 6. Presentation and Platform

The game is intended to be browser-based, with relatively simple graphical requirements.

The interface will primarily consist of:

- A Kanban board.
- Ticket information.
- Developer information.
- Player attributes and abilities.
- Progression interfaces.

The game should not require a traditional graphical game engine.

A desktop application may be produced in the future.

The visual identity, aesthetic direction, and user experience conventions remain undecided.

## 7. Open Design Questions

The following questions remain unresolved:

- Will Backlog eventually have a separate screen rather than a board column?
- What resources does the player accumulate?
- How should Judgement overcome **decision complexity** at uncapped incremental attribute values, and how should that complexity be measured (ticket difficulty, relationships between candidates, blockers, dependencies and competing objectives)? The curve and scale are not yet approved (#49/#45).
- Should any future status-specific or rank-distance preference supplement the combined work selection, after examining real behaviour (#47)?
- Should richer future systems justify additional reconsideration events beyond personal estimate revisions and relevant player priority changes?
- How should the provisional competency scale evolve, and what can players know about it?
- What RPG attributes does the player possess?
- How does the player investigate discrepancies?
- What penalties arise from inaccurate board information?
- How does automation operate?
- What exactly persists between career resets?
- What determines the game's end-state?

These should be resolved through design discussion and prototyping rather than assumed during implementation.

## 8. Design Decision Log

Record significant decisions here as the project evolves.

| Decision | Status | Notes |
|---|---|---|
| Browser-first development | Confirmed | React, TypeScript, Vite |
| Autonomous developers | Confirmed | Core gameplay premise |
| Unreliable Kanban information | Confirmed | Central design mechanic |
| RPG-style player attributes | Confirmed | Exact attributes TBD |
| Incremental progression | Confirmed | Details TBD |
| Career-based prestige | Confirmed | Changing employers |
| Defined game ending | Confirmed | Victory conditions TBD |
| Backlog separate from committed work | Confirmed | Backlog is potential work; only committed or already-started work is eligible for normal selection |
| Four columns in prototype | Prototype decision | Backlog / To Do / In Progress / Done; separate backlog screen deferred |
| In Progress need not mean actively worked | Confirmed | Unclaimed unfinished tickets can be resumed by another developer |
| Resume vs start choice | Superseded prototype (#14) | The old 50/50 category roll and uniform random In Progress selection were replaced by combined eligible-ticket selection in #31; see §4.2.1 |
| Spontaneous automatic switching (#16) | Superseded | Both the 1% automatic switch and later periodic reconsideration are retired; section 4.2.2 contains current event triggers. |
| Accurate prototype reporting and assignments | Temporary validation rule | Keep actual and reported state conceptually separate for future unreliability |
| Player-set ticket Rank | Implemented prototype model (#12) | Unique global 1..N order; drag within reported To Do permutes only its rank slots, preserving other columns' ranks; managerial intent, not binding developer priority |
| Attribute-driven engineer autonomy | Implemented initial prototype (#31/#32/#49/#54) | Judgement improves comparison quality; Focus builds Flow independently; deeper complexity/ability redesign remains #49, personalities deferred #42. |
| Wasted work and red herrings | Agreed direction; design open (#30) | Engineers can attempt blocked work; some tickets can consume effort without delivering value |
| Management interventions sequencing | Confirmed PoC sequencing | Defer new interventions until autonomous engineer behaviour and imperfect reporting demonstrate the tensions they should address |
| Ticket work domains and future specialisms | Agreed initial scope (#38, #39) | One domain per ticket; independent Frontend/Backend competencies allow full-stack engineers; future specialist modifiers such as DBA; multi-disciplinary scope at epic level |
| Competency effects on work rate | Implemented provisional model (#38) | Independent, non-negative, finite and uncapped Frontend/Backend competencies; base productivity × (relevant competency / 10 + 0.5 / complexityMultiplier) under #52; S preserves the former rate; poor fit reduces work rate but never prevents ordinary completion; selection uses the same rate in perceived completion times; competency diagnostics remain development-only; future minimum-competency gates deferred to #40 |
| Intrinsic ticket complexity (#52) | Implemented local prototype | Accurate visible S/M/L/XL/XXL technical labels, separate from base effort; one unified domain rate; missing labels mean S. Fallible complexity beliefs/reporting remain future; #61 now applies actual current-stint work loss. |
| Public ticket-domain labels | Implemented (#46) | Frontend/Backend domain is visible on every normal Kanban card in both development and production; engineer competencies and effective rates remain development-only for now |
| Perceived-work decision model (#49/#56) | Released prototype | Personal/transient fallible estimates plus reported progress, integrated Flow economics and one soft Rank preference; no final Judgement noise. |
| Autonomous work-selection scope | Released prototype (#49/#56) | Direct comparison across eligible actual To Do and unclaimed In Progress; trigger-specific subsets for priority events; no nomination or true-fastest challenger. |
| Apparent opportunity signal | Released prototype (#49/#56) | Reported progress determines perceived remaining fraction; hidden actual work and gross experience are not decision completion proxies. |
| Focus builds Flow | Implemented (#51/#54; `74d098e` and `6177a41`) | Unbounded logarithmic Flow bonus, including Focus 0; Focus accelerates growth. Integrated productivity; Flow resets on switching/completion, not on reassessment/stay. DEV-only metrics; balance provisional. |
| Current-stint switch loss (#61) | Implemented local prototype; Option B | Complexity/competency-derived rollback only on actual unfinished-ticket abandonment; older retained work and gross experience protected. Scoring unchanged; future cost awareness is #72. |
| Partial Flow retention on switching | Future upgrade idea (#50) | Current baseline is full Flow reset; upgrades might preserve some momentum. |
| Judgement versus situational difficulty | Current estimation-based prototype; broader design open | Uncertainty comes from existing effort estimation; former alternative-count noise model removed. Richer team economics remain future #45. |
| Event-driven reconsideration (#56) | Released prototype | Genuine personal revisions and relevant priority ordering changes; completion selects next work. No periodic schedule, cooldown or availability-only interrupt. |
| Numerical simulation event accounting | Shipped and independently verified (#32; `6177a41`) | Chronological completion/assessment deadlines, engineer-order ties, partition-stable RNG/claims and compensated work/time; unsupported precision throws. Simplification assessment deferred #55. |
| Player-facing explanation of attributes | Explicit UX follow-up (#53) | Explain Judgement as better decisions, Focus as faster Flow building and Rank as managerial influence without requiring knowledge of formulas or hidden truth. |
| Numerical engine simplification review | Deferred read-only assessment (#55) | Seek simplest maintainable engine that preserves gameplay guarantees; do not refactor merely to reduce lines of code. |
| Numeric global Rank distance | Deferred (#47) | Ranks span all columns, including ineligible tickets; no rank-gap probability modifier in first selector |
| Non-coding support roles | Future concept (#41) | Roles such as domain architect may improve others' effective competencies without contributing ticket code |
| Engineer personality and profiles | Very late-stage future concept (#42) | Fully fledged autonomous personalities, profile history and potentially personality-driven self-selected avatars |
| Pre-selection design review | Completed (#43) | Followed #38; clarified holistic Judgement, Discipline, shared reported board and observability before implementing #31 |
| Engineer decision design sequence | Initial selection and reconsideration implemented (#31/#32); later stages open | Domain skills #38, Focus/Flow #51/#54 and event-driven perceived-work decisions #49/#56 are shipped; blockers #33, work execution #34 and reporting #35 remain future. |
| One-to-one review and engineer history | Future concept (#36) | Engineer accounts can be wrong; player Deduction or similar attributes may help uncover contradictions, with reported accounts distinct from verified knowledge |
| Multiple management layers | Proposed | Not yet committed |

---

*This document describes the intended game experience. It is not an implementation specification. Unresolved mechanics must not be treated as approved requirements.*

### Prototype managerial ranking (#12)

All tickets share one global list with unique consecutive integer `rank` values
from 1 through N, across all columns. Rank 1 is highest. This expresses managerial intent, not an
objective urgency category or guaranteed developer obedience. The player can drag
cards within reported To Do, dropping on the upper/lower half of a card to place
before/after it. Keyboard-only ranking is deferred to #27, and compact Move to
Top/Bottom actions are deferred to #26. Hidden
actual status does not constrain this visible action. Other columns cannot accept
moves. Reordering works paused or running and changes only ranks in the reported
To Do group: sort all tickets by rank, identify the slots belonging to reported
To Do tickets, and permute only the tickets in those slots. Other columns retain
their exact ranks, even when interleaved. No second ranking structure is stored.
The example fixture replaces its former 10-point increments with 1..N directly;
there is no persisted-save migration in this prototype. Malformed rank sets are
rejected as no-op drops rather than repaired by changing unrelated columns.

The former 50/50 category decision and uniform In Progress selection have been **superseded by #31**.
Selection considers eligible actual To Do and unclaimed unfinished In Progress tickets in
one pool; the manager's preference is the lowest **global** rank of an eligible ticket,
while reported progress determines perceived remaining effort from genuine or transient total-effort estimates (#49/#56). Direct comparison uses integrated perceived completion time, retained **Flow** when staying and one soft Rank preference. **Focus** builds Flow; Judgement influences fallible estimates without a second decision roll. Relevant priority reorders trigger reconsideration immediately while running, or as one net change on Step/Resume while paused, before work/time advances; numeric global-rank gaps remain deferred (#47).
Rank and display order are exposed by the player view; actual status and work remain excluded. Native HTML drag/drop is used without a library;
keyboard-only reordering remains deferred. Desktop drag/drop requires
hands-on verification before commit; automated transition and rendering tests do
not emulate a browser drag gesture.
