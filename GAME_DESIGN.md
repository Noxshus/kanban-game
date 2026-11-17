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

**Player-defined ticket Rank (implemented prototype, #12):** Every ticket belongs to a single, globally ordered list with a unique, consecutive integer `rank` from 1 (highest) to N (lowest), regardless of Kanban column. Rank is the player's intended priority, not objective urgency or a guarantee developers follow it. Initially the player may drag tickets to reorder them **within the reported To Do column**, even if a ticket's hidden actual status differs. This changes only the ranks of the affected reported To Do tickets by permuting their positions in the global order; tickets in every other column retain their exact global rank, even when interleaved. Current engineers consider global Rank together with apparent reported progress when nominating eligible work; Judgement then evaluates a candidate. Cross-column dragging remains deferred.

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

### 4.2.1. Autonomous work selection (implemented #31, redesigned prototype #49/#54; `6177a41`)

Engineers can work on tickets whose **actual** status is **To Do** or **In Progress**, provided they are unfinished and not actively claimed by another engineer. Backlog, Done and another engineer's active claim are excluded. Assignment means ownership and may differ from the ticket an engineer actively works on; abandoned tickets retain their completed work.

**Nominating a plausible candidate:** First, sort eligible tickets by the single global Rank ordering (including ineligible tickets in the stored 1..N ordering, but giving *eligible candidates* ordinal positions for scoring). For each candidate, calculate:

```text
rankScore = 1 / eligibleRankPosition
apparentOpportunity = clamp(reportedProgress, 0, 100) / 100
candidateScore = 0.5 * rankScore + 0.5 * apparentOpportunity
```

The highest-scoring ticket is nominated; ties favour better global Rank. This nomination uses **reported** information, which can be misleading, and preserves Rank as the player's soft managerial direction. The 50/50 weighting is **provisional**. Rank differences themselves do not add a distance-based modifier (#47).

**Initial pickup:** An idle engineer starts with the public-information nominee and makes a single noisy comparison against the other eligible ticket with the fastest **actual** projected completion time (ties resolve by Rank). This privileged challenger discovery is an **explicit provisional limitation** of the first implementation: it differs from the reported-information nomination used during reconsideration, and its long-term role remains open under #49. The player-facing board never reveals those actual projections.

**Holistic Judgement assessment:** Rather than a binary pass/fail check or an obedience contest, the engineer compares staying on one task with taking an alternative. The comparison uses their actual remaining work, relevant domain-adjusted productivity and current **Flow** when staying, versus a fresh Flow ramp after switching. A soft Rank preference and seeded assessment uncertainty influence the outcome:

```text
efficiencyAdvantage = ln(projectedTimeToStay / projectedTimeToSwitch)
rankPreference = 0.25 * (rankScoreSwitch - rankScoreStay)
perceivedAdvantage = efficiencyAdvantage + rankPreference + assessmentError
perceivedAdvantage > 0  => switch; otherwise stay
```

The rank scores for this final comparison are taken across eligible tickets **including the current ticket**. Positive efficiency advantage favours switching. A small priority preference can justify a modest efficiency trade-off, but Judgement is **not** obedience. The initial comparison has no accumulated Flow; a genuine reconsideration can retain Flow by staying. Both mistaken switches and mistaken stays are possible. Higher Judgement reduces uncertainty, rather than directly causing more or fewer switches.

The shipped first-pass uncertainty calibration is:

```text
situationalComplexity = 1 + log2(1 + alternativeCount)
noiseScale = situationalComplexity / (1 + Judgement / 25)
assessmentError = noiseScale * centredLogisticSeededDraw
```

**These are provisional prototype numbers, not the completed #49 redesign.** An alternative count is only a crude complexity proxy; the agreed next design stage is to model genuine *situational decision difficulty* (conflicting evidence, close trade-offs, Flow loss and priorities), then derive meaningful Judgement progression relative to that difficulty. Also revisit initial candidate discovery and possible double counting of Rank. Do not confuse this situational difficulty with private estimates of a ticket's intrinsic complexity (#52). Richer holistic team value, blockers and dependencies remain future work (#45/#33).

**Historical context:** The original #31 sigmoid `0.35 * (Judgement - Discipline) + 4 * reportedProgressGap - 2.5` and its manager-versus-opportunity override draw were **removed** in `6177a41`. Discipline was renamed to **Focus**, and there is no `Judgement - Focus` substitute. The earlier #14 category roll was already superseded by #31. Keep those older mechanics as history, not as a description of current gameplay.

### 4.2.2. Periodic reconsideration (implemented #32; `6177a41`)

The old #16 **1% per-second automatic switch trigger is retired**. While working, an engineer receives a **randomly scheduled opportunity to reconsider** the current task. The first-pass waiting-time distribution is:

```text
F(t) = P(reconsideration due by t) = 1 - exp(-(t / 25)^2)
median wait ≈ 20.8 simulated seconds
```

The engine draws a deadline with deterministic seeded RNG instead of repeatedly rolling the cumulative probability. At that instant, the engineer nominates an eligible alternative using the **Rank plus reported-opportunity score** and makes the one holistic noisy Judgement comparison above. **Staying is a valid result**, not a failed switch; no eligible alternative means continuing work. Switching leaves the previous ticket's work intact and sets its actual status to In Progress.

Two different concepts must remain separate: **time since the last assessment** resets when any reassessment happens, while **uninterrupted Flow duration** continues when the engineer stays and resets only when the active ticket changes or work completes. The reconsideration cadence is independent of Focus. Event-triggered reassessment (such as new priorities or resolved dependencies) is deferred.

Work, projected completions and reassessments are processed at **chronological event boundaries**, including completing a ticket and starting another within one elapsed interval. Completed claims are released first; when different engineers must decide at the same instant, they are processed in **engineer order**. The implementation uses anchored, compensated event instants and consistent integrated work accounting to preserve reproducible decisions, claims and seeded RNG across equivalent elapsed-time partitions, including JSON restoration. Unsupported positive time/work increments are rejected explicitly instead of silently dropping progress. These numerical implementation details are subject to a future **read-only simplification review (#55)**; any behavioural trade-off must be separately agreed.

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

Focus **does not directly penalise** Judgement, the reconsideration schedule or willingness to switch. However, a good Judgement comparison accounts for the *real productivity cost* of losing accumulated Flow and for how quickly a high-Focus engineer could rebuild Flow after switching. Flow duration, bonus, multiplier, time until assessment, projected completion times and detailed decision explanations remain **development-only diagnostics** (#53 tracks the eventual simple player-facing language).

**Domain expertise versus Judgement (#38; implemented prototype):** Every ticket has **one primary work domain**, initially **Frontend** or **Backend**; multi-disciplinary deliverables are made up of tickets at epic/initiative level. Engineers possess **separate Frontend and Backend competencies** rather than mutually exclusive job classifications, enabling full-stack engineers who are competent in both. Competencies are non-negative, finite and **uncapped**; example engineers initially range from 0 to 10, but this is not a permanent ceiling. Effective productivity is calculated as base productivity × (0.5 + relevant domain competency / 10), giving multipliers of ×0.5, ×1 and ×1.5 at competencies 0, 5 and 10 respectively, and continuing to scale above 10. These are provisional balancing values, not a fixed long-term growth curve. Poor skill fit slows ordinary work but does not make completion impossible; minimum-competency requirements are deferred to #40. **Ticket domains are now visible on normal Kanban cards in every reported column (#46), including production**. Engineer competency values and effective rates remain development-only for now; existing base productivity remains visible. Eventual broader player knowledge is undecided. Domain-adjusted rates affect projected completion times in the shipped Judgement comparison, although the initial candidate-nomination score uses only Rank and reported progress. The richer Judgement difficulty and candidate-discovery redesign remains open under #49. Future specialisms (e.g. DBA versus a general Backend engineer) may apply additional domain-related modifiers (#39); their formulas and visibility are undecided.

**Engineer-decision design sequence (PoC):** Work domains/competencies (#38), the initial selector (#31) and the first stay-versus-switch/reconsideration prototype (#32/#49/#54) are implemented with deterministic scenarios (#37). The deeper Judgement difficulty redesign remains open (#49). Later stages include recognising/attempting blocked work (#33), richer execution/results (#34), and deciding when/how accurately to report work (#35). Their numerical rules are not yet approved.

**Future learning from past events (#36):** A periodic one-to-one review (monthly is only an example) might allow engineers to explain previous decisions, blockers and mistakes, with observations recorded in their profiles. The engineer's account is not automatically authoritative truth: statements, actual history, player inferences and verified player knowledge must remain distinguishable. Player attributes such as possible **Deduction** could influence how effectively the manager questions an account or identifies contradictions; names and mechanics are not yet confirmed. Design this later, once the behaviour being reviewed exists; do not add managerial interventions during the simulation-first phase.

**PoC sequencing decision:** Develop convincing autonomous engineer behaviour and the divergence between actual events and Kanban reports **before** introducing new manager interventions. The desired managerial frustration should emerge from watching engineers make their own choices; only then should player actions be designed in response. Initial attribute-driven behaviour is implemented; richer decisions and reporting remain future design work.

### 4.2.4. Initial effort estimates (#57; current prototype)

On first actual pickup, an engineer estimates the ticket's **total required work units** and immediately publishes that estimate on the Kanban card. Unstarted tickets display **Unknown**. Publication occurs once per ticket: resuming, switching back or a handoff does not generate another initial estimate. The original engineer's belief and identity are retained separately from the reported estimate and true required work, allowing later divergence. Only the published estimate is player-visible; actual requirements and private beliefs remain development-only. This does not change reported progress or the #49 selection model.

The approved provisional calibration uses Judgement J, the ticket-domain competency C, true total work T, and one seeded uniform draw U in [0, 1):

```text
q = 1 + 0.09 * J + 0.09 * C
E0 = T * exp(log1p(-U) / q)
expected(E0) = T * q / (q + 1)
```

These are **prototype balancing constants**. Mean accuracy at J/C = 0/0, 10/10, 50/50 and 100/100 is 50%, about 73.7%, about 90.9% and 95% respectively, not a per-seed promise. Attributes remain finite, non-negative and uncapped. Estimates only underestimate (0 <= E0 <= T); exact accuracy can occur at RNG endpoints or finite precision. Positive work whose estimate would underflow to zero is explicitly rejected, rather than assigned an artificial minimum or error cap. Focus and Flow do not directly affect estimation.

Existing active claims without estimates are initialised on their first positive advance, in engineer order; zero-time advances and rendering consume no estimate draws. At a genuine new claim, the estimate draw follows selection and precedes the next reconsideration schedule. Saved beliefs or existing public estimates prevent duplicate initial publication after JSON restoration.

First-pickup publication is a **temporary pre-planning shortcut**, including its visible clue that work has been picked up. Sprint planning (#60) is intended before PoC/MVP and will move initial publication before work, without double publication. Later productive-work learning/revisions (#58, below) publish meaningful improvements immediately under the agreed temporary reporting shortcut. Communication (#63/#35), overestimation (#59) and event-triggered reconsideration (#56) remain separate work.

### 4.2.5. Durable productive-effort log (#65)

The simulation retains cumulative **actual productive work units per engineer/ticket pair**, across sessions, switching, reassignment, completion and returning to earlier work. Past contributors remain recorded independently of current ownership. This is **gross effort invested**, separate from the ticket's net retained completed work: future work loss must not erase previously gained experience. Idle time, merely holding a ticket and intervals producing no work do not contribute. Older states start with no known contributions; existing progress is not attributed to an engineer retrospectively. Contributions survive saves and remain development-only diagnostics for now. This foundational ledger does not implement discovery, estimate revision (#58), work loss (#61), player reports or a timestamped event history.

### 4.2.6. Progressive hands-on re-estimation (#58; provisional prototype)

Engineers re-evaluate total effort at seeded **productive-work exposure thresholds**, using their own cumulative #65 contributions. The original positive #57 estimate E0 and its author remain historical; new claims, handoffs and returns see the latest board estimate without publishing on pickup or granting an extra experience bonus. No independent knowledge attribute, private estimate history or experience checkpoints are introduced.

```text
k(J) = 0.8 * (1 + ln(1 + J/10))
r = (T - Eboard) / T
g(r) = 2r / (r + 0.2)
discovery hazard per personal work unit = k(J) * g(r) / (E0 + w)
a(J,C) = 0.30 * (1 + ln(1 + J/10) + ln(1 + C/10))
candidate = T - (T - E0) * (1 + w/E0)^(-a(J,C))
```

T is true total effort, w is this engineer's gross productive contribution, J is Judgement and C is relevant domain competency. For fixed attributes and board, the instantaneous discovery chance per additional productive work unit steadily decreases as personal work accumulates; an improved board estimate also reduces residual error and responsiveness. This does not mean the cumulative chance of eventually discovering something decreases. The growing overrun-disparity multiplier from #58 is removed (#68); the existing coefficients and accuracy formula remain unchanged. Accurate estimates have no error-discovery events. Focus has no direct estimator modifier; Flow changes the time required to earn work exposure.

Only a genuine evaluation can publish a candidate: **any representably larger candidate publishes immediately** (`candidate > board`), with no minimum improvement threshold or tolerance (#67). Equal or lower candidates leave the board unchanged. Candidates are always computed from original E0 and cumulative personal work, never compounded on the latest report. The shared report represents the latest published assessment, not team-wide omniscience. Future #63/#35 will replace immediate publication.

Reaching the reported total while unfinished can trigger **at most one immediate overrun-crossing evaluation per ticket lifetime** (#68); **completion at the same instant wins**. The opportunity is consumed even if the report stays unchanged. Neither its own publication, a later ordinary discovery, a handoff nor a return re-arms it. All subsequent evaluations use the existing seeded positive-work discovery process. There is no guaranteed correction, observed-work estimate floor or accuracy bonus. Existing overruns in legacy/handoff states do not grant a pickup revision or newly consume the crossing opportunity; further work must reach a new evaluation. Board-only legacy reports retain their original baseline without inventing an author. Invalid/zero baselines on unfinished positive work are rejected; zero-work completed tickets bypass learning. Numerical precision limits fail explicitly rather than silently clipping effort or event time. Hidden candidates and discovery information remain development-only; only published effort reaches the player view. Selection, periodic stay/switch reconsideration, Rank, reporting and Focus/Flow rules are otherwise unchanged; #56, #59 and #61 remain deferred.

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

**Historical checkpoint decisions for #31 (#43; subsequently implemented in #31; partly superseded by #49/#51):** **Judgement** means accuracy of an engineer's *holistic assessment of what is worth doing for the team*, not merely their personal speed. **Discipline** was then modelled as adherence to managerial Rank, but that meaning is **superseded by the beneficial locked-in focus design shipped in #51**; #31 selection code still needs future refactoring (#49). Where an engineer's appraisal disagrees with the manager's priority, a larger positive difference between Judgement and Discipline should make following that appraisal more likely; the first provisional probability curve was subsequently selected and implemented in #31 (see §4.2.1). The #31 selection evaluates eligible **To Do and unclaimed In Progress together**, replacing the provisional 50/50 category split. For now, **all engineers assess the same player-visible reported Kanban-board information** (including public Frontend/Backend ticket-domain labels from #46), not private engineer-specific knowledge or hidden actual ticket truth; actual state still guards eligibility internally. Domain competency numbers remain development-only, so their role in a shared-information appraisal needs separate design. Blockers, dependencies, and ticket value will broaden holistic Judgement as those systems arrive (#45/#33/#30). A more elaborate private engineer-perception model is explicitly deferred and not promised. Personal preferences and full personality systems belong to very late-stage #42. Development diagnostics and deterministic fixtures should reveal why a choice was made without exposing hidden truth to the player. No new managerial interventions were approved by this checkpoint; #31 subsequently approved the narrowly scoped provisional work-selection formula above.

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
- Should scheduled reconsideration eventually respond to events, and how should the provisional 25-second waiting-time scale evolve with ticket durations and progression?
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
| Spontaneous automatic switching (#16) | Superseded by scheduled reconsideration (#32; `6177a41`) | Former 1%-per-second forced switching is retired; reassessments are timed and may result in staying. |
| Accurate prototype reporting and assignments | Temporary validation rule | Keep actual and reported state conceptually separate for future unreliability |
| Player-set ticket Rank | Implemented prototype model (#12) | Unique global 1..N order; drag within reported To Do permutes only its rank slots, preserving other columns' ranks; managerial intent, not binding developer priority |
| Attribute-driven engineer autonomy | Implemented initial prototype (#31/#32/#49/#54) | Judgement improves comparison quality; Focus builds Flow independently; deeper complexity/ability redesign remains #49, personalities deferred #42. |
| Wasted work and red herrings | Agreed direction; design open (#30) | Engineers can attempt blocked work; some tickets can consume effort without delivering value |
| Management interventions sequencing | Confirmed PoC sequencing | Defer new interventions until autonomous engineer behaviour and imperfect reporting demonstrate the tensions they should address |
| Ticket work domains and future specialisms | Agreed initial scope (#38, #39) | One domain per ticket; independent Frontend/Backend competencies allow full-stack engineers; future specialist modifiers such as DBA; multi-disciplinary scope at epic level |
| Competency effects on work rate | Implemented provisional model (#38) | Independent, non-negative, finite and uncapped Frontend/Backend competencies; base productivity × (0.5 + relevant competency / 10); poor fit reduces work rate but never prevents ordinary completion; no changes to selection or switching; competency diagnostics remain development-only; future minimum-competency gates deferred to #40 |
| Public ticket-domain labels | Implemented (#46) | Frontend/Backend domain is visible on every normal Kanban card in both development and production; engineer competencies and effective rates remain development-only for now |
| Initial Judgement/Focus decision model | Implemented provisional model (#32/#49; `6177a41`) | Former Judgement−Discipline sigmoid retired. One noisy holistic stay/switch assessment considers efficiency, soft Rank and uncertainty. Real situational difficulty/uncapped progression design remains open #49. |
| Initial autonomous work-selection scope | Implemented revised prototype (#31/#49; `6177a41`) | Combined eligible actual To Do and unclaimed In Progress; 50/50 inverse eligible Rank ordinal + reported-progress nomination; initial pickup uses a privileged fastest-actual-time challenger (provisional #49 boundary). |
| Apparent opportunity signal | Implemented provisional model (#49) | Reported progress contributes 50% of the candidate-nomination score; unreliable reports remain possible. Former override-probability gap no longer applies. |
| Focus builds Flow | Implemented (#51/#54; `74d098e` and `6177a41`) | Unbounded logarithmic Flow bonus, including Focus 0; Focus accelerates growth. Integrated productivity; Flow resets on switching/completion, not on reassessment/stay. DEV-only metrics; balance provisional. |
| Partial Flow retention on switching | Future upgrade idea (#50) | Current baseline is full Flow reset; upgrades might preserve some momentum. |
| Judgement versus situational difficulty | Shipped provisional model; deeper redesign open (#49/#45) | Alternative-count complexity and Judgement/noise scale are placeholders. Next: model what truly makes a choice difficult, then tune Judgement scaling; don't equate high Judgement with obedience. |
| Scheduled reconsideration | Implemented provisional model (#32; `6177a41`) | Seeded Weibull-style waiting-time distribution `1-exp(-(t/25)^2)`, median ~20.8s; staying preserves Flow. Future event-driven triggers deferred. |
| Numerical simulation event accounting | Shipped and independently verified (#32; `6177a41`) | Chronological completion/assessment deadlines, engineer-order ties, partition-stable RNG/claims and compensated work/time; unsupported precision throws. Simplification assessment deferred #55. |
| Player-facing explanation of attributes | Explicit UX follow-up (#53) | Explain Judgement as better decisions, Focus as faster Flow building and Rank as managerial influence without requiring knowledge of formulas or hidden truth. |
| Numerical engine simplification review | Deferred read-only assessment (#55) | Seek simplest maintainable engine that preserves gameplay guarantees; do not refactor merely to reduce lines of code. |
| Numeric global Rank distance | Deferred (#47) | Ranks span all columns, including ineligible tickets; no rank-gap probability modifier in first selector |
| Non-coding support roles | Future concept (#41) | Roles such as domain architect may improve others' effective competencies without contributing ticket code |
| Engineer personality and profiles | Very late-stage future concept (#42) | Fully fledged autonomous personalities, profile history and potentially personality-driven self-selected avatars |
| Pre-selection design review | Completed (#43) | Followed #38; clarified holistic Judgement, Discipline, shared reported board and observability before implementing #31 |
| Engineer decision design sequence | Initial selection and reconsideration implemented (#31/#32); later stages open | Domain skills #38, Focus/Flow #51/#54 and noisy reconsideration are shipped; blockers #33, work execution #34 and reporting #35 remain future. |
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
while apparent progress contributes to a **50/50 Rank/opportunity candidate score** (#32/#49). The engineer then makes a noisy stay-versus-switch comparison that also considers projected completion times, a soft Rank preference and accumulated **Flow**. **Focus** builds Flow and does not oppose Judgement. The first Judgement difficulty formula remains provisional pending deeper redesign (#49); numeric global-rank gaps remain deferred (#47).
Rank and display order are exposed by the player view; actual status and work remain excluded. Native HTML drag/drop is used without a library;
keyboard-only reordering remains deferred. Desktop drag/drop requires
hands-on verification before commit; automated transition and rendering tests do
not emulate a browser drag gesture.
