# Kanban Game - Game Design Document

**Status:** Early concept / Pre-production  
**Version:** 0.1  
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

The exact workflow stages have not yet been finalized.

### 4.2. Developer Simulation

Developers progress tickets autonomously.

They may:

- Work on assigned tickets.
- Become blocked.
- Fail to update the board.
- Make mistakes.
- Work on inappropriate or lower-priority tasks.

Developer behaviour will eventually be influenced by individual attributes and competencies.

The exact attributes and decision-making systems remain undecided.

### 4.3. Information and Deduction

The player does not automatically know everything occurring within the development team.

There is a distinction between:

1. **Actual state:** What is really happening within the simulation.
2. **Reported state:** What the Kanban board and developers claim is happening.
3. **Player knowledge:** What the player has successfully established through available information and abilities.

The player's task is partly to reconcile these different representations.

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

- What are the precise Kanban workflow stages?
- What resources does the player accumulate?
- How do developers decide what to work on?
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
| Developer personality system | Proposed | Not yet committed |
| Multiple management layers | Proposed | Not yet committed |

---

*This document describes the intended game experience. It is not an implementation specification. Unresolved mechanics must not be treated as approved requirements.*