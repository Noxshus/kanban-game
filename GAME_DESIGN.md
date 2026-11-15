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

**Player-defined ticket Rank (agreed design; not yet pushed, #12):** Every ticket belongs to a single, globally ordered list with a unique, consecutive integer `rank` from 1 (highest) to N (lowest), regardless of Kanban column. Rank is the player's intended priority, not objective urgency or a guarantee developers follow it. Initially the player may drag tickets to reorder them **within the reported To Do column**, even if a ticket's hidden actual status differs. This changes only the ranks of the affected reported To Do tickets by permuting their positions in the global order; tickets in every other column retain their exact global rank, even when interleaved. When the current prototype selects To Do work, developers use the highest-ranked actually eligible ticket, skipping ineligible ones. Developer-specific judgments remain a future design question; cross-column dragging is deferred.

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

### 4.2.1. Work selection (implemented prototype rule)

When a developer becomes idle, they may take an eligible **To Do** ticket or resume an unfinished **In Progress** ticket that no other developer is actively working on. **Backlog** and **Done** are not eligible under ordinary behaviour.

If both To Do and unclaimed In Progress tickets are available, the developer makes a **50/50 random selection between those two categories**. If only one category is available, they choose that category without a category roll.

**Second-stage ticket selection:** After choosing **In Progress**, the developer selects **uniformly at random among all eligible, unclaimed, unfinished In Progress tickets**. This second draw also applies when In Progress is the only available category (unless only one eligible ticket exists, in which case the result is unambiguous). After choosing **To Do**, the prototype selects the actually eligible To Do ticket with the lowest global rank (rank 1 is highest priority). With both categories available and three eligible In Progress tickets, each has a one-sixth overall selection probability.

This is intentionally a **two-stage decision**: the category-selection roll must not be weighted by the number of tickets in each category. Future developer attributes (e.g. a proposed **Judgement** attribute) may influence both the category choice and which particular ticket is considered worthwhile, but no attribute or specific weighting mechanic is confirmed yet.

These selection rolls take place **when choosing new work**, rather than being independently rerolled on every simulation tick. The spontaneous task-switching rule below is an explicit exception. No two developers work on the same ticket under the current prototype rules.

This equal probability is a **temporary baseline**, not a permanent statement about every developer's behaviour. Later developer attributes, preferences, management abilities or situational factors may change selection probabilities. Those details remain undecided.

**Prototype behaviour:** Random work-selection decisions are reproducible from the same initial simulation state and sequence of elapsed-time calls. See #14 for the implementation and validation details.

### 4.2.2. Spontaneous task switching (implemented prototype rule)

Developers who are already working independently have a **1% chance per one-second simulation tick** to stop their current work and switch to a **different eligible ticket**. The abandoned ticket retains its completed work and remains **In Progress**, even if no developer is actively working on it. Developers must not switch to Backlog, Done or work currently claimed by another developer. If no alternative eligible ticket exists, they continue their current work.

Switch checks occur **before work advances** in each simulated second; a developer progresses only the final chosen ticket during that tick. Each active developer receives an independent switch check using the existing deterministic game-state RNG; idle developers do not roll to switch. A successful switch excludes the previous ticket from replacement candidates and reuses the two-stage work-selection rules above. The implementation processes whole seconds as successive one-second ticks, and uses the equivalent probability **1 − 0.99^elapsedSeconds** for a fractional remainder. Splitting fractional time differently may change decision timing, so exact replays require the same elapsed-time call sequence. The 1% rate remains subject to balancing, and a future developer attribute may modify it; the attribute and formula are not yet decided.

The spontaneous switch check is distinct from the 50/50 choice made when selecting work while idle (see #14 and #16).

The exact future developer attributes and richer decision-making systems remain undecided.

**Engineer-decision design sequence (PoC; design first, implementation sequential):** (1) choose work (#31); (2) continue or switch work (#32); (3) recognise blockers and decide whether to attempt blocked work (#33); (4) perform work with variable competence and results (#34); (5) decide when and how accurately to report work (#35). Attribute names, numerical effects and detailed rules remain open until each decision is designed. Expand curated deterministic scenarios alongside these stages (#37) rather than making procedural ticket generation a prerequisite.

**Future learning from past events (#36):** A periodic one-to-one review (monthly is only an example) might allow engineers to explain previous decisions, blockers and mistakes, with observations recorded in their profiles. The engineer's account is not automatically authoritative truth: statements, actual history and verified player knowledge must remain distinguishable. Design this later, once the behaviour being reviewed exists; do not add managerial interventions during the simulation-first phase.

**PoC sequencing decision:** Develop convincing autonomous engineer behaviour and the divergence between actual events and Kanban reports **before** introducing new manager interventions. The desired managerial frustration should emerge from watching engineers make their own choices; only then should player actions be designed in response. Attribute-driven engineer behaviour is the next design focus.

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
- How will developer attributes (e.g. proposed Judgement) and circumstances affect the provisional 50/50 category decision and random selection among unfinished tickets?
- Should unclaimed In Progress work or To Do work receive any default preference beyond the initial neutral rule?
- How should spontaneous switching probability scale with elapsed simulation time and individual developer attributes?
- How are developer competencies represented?
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
| Resume vs start choice | Prototype decision | Implemented in #14 (`953a722`): 50/50 category roll when both are eligible, uniform random In Progress ticket selection; #12 uses highest global rank among actually eligible To Do tickets; reproducible game-state RNG |
| Spontaneous task switching | Implemented prototype rule | #16 (`3783299`): 1% chance per simulated second, check before work advances, replacement via #14 selection, proportional fractional-time handling; balancing remains provisional |
| Accurate prototype reporting and assignments | Temporary validation rule | Keep actual and reported state conceptually separate for future unreliability |
| Player-set ticket Rank | Agreed model; local implementation under refinement (#12) | Unique global 1..N order; drag within reported To Do permutes only its rank slots, preserving other columns' ranks; managerial intent, not binding developer priority |
| Developer personality system | Next design focus | Attribute-driven autonomy and reporting behaviour before new player interventions; concrete attributes TBD |
| Wasted work and red herrings | Agreed direction; design open (#30) | Engineers can attempt blocked work; some tickets can consume effort without delivering value |
| Management interventions sequencing | Confirmed PoC sequencing | Defer new interventions until autonomous engineer behaviour and imperfect reporting demonstrate the tensions they should address |
| Engineer decision design sequence | Agreed order (#31–#35) | Work selection, switching, blockers, competency-driven execution, reporting; design each before implementation; curated scenarios #37 |
| One-to-one review and engineer history | Future concept (#36) | Periodic retrospective discussion may reveal past problems; engineer statements must not be treated as automatically true |
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

The existing 50/50 category decision and uniform In Progress selection remain.
When To Do is chosen, actual eligibility and active claims are checked first,
then the lowest rank wins. Valid states have no ties. No developer-specific rank preferences
are implemented. Rank and display order are exposed by the player view; actual
status and work remain excluded. Native HTML drag/drop is used without a library;
keyboard-only reordering remains deferred. Desktop drag/drop requires
hands-on verification before commit; automated transition and rendering tests do
not emulate a browser drag gesture.
