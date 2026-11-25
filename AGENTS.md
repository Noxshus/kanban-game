
# Kanban Game — Development Instructions


## Project overview

Kanban Game is a browser-based incremental management game about overseeing autonomous software developers through an unreliable Kanban board.

The player must identify discrepancies between reported information and actual developer activity.

Read GAME_DESIGN.md for the game's vision, mechanics, design principles, and confirmed design decisions.

Do not treat proposed mechanics or open design questions as approved implementation requirements.


## Technology

- React with TypeScript
- Vite
- GitHub Pages for hosting
- No backend unless explicitly approved
- Desktop packaging may be added later

## Architecture

- Keep simulation logic independent of React.
- Separate actual ticket state from reported Kanban board state. What the player sees is not necessarily the truth.
- Prefer data-driven systems over hardcoded cases.
- Keep game logic modular and testable.
- Avoid unnecessary dependencies.
- Do not introduce complex abstractions prematurely.

## Simulation architecture invariants

- Preserve pure, deterministic simulation transitions; seeded random draws belong to simulation state, not ambient browser randomness.
- Keep reported workflow status and progress distinct from actual ticket status and completed work. Developer assignment represents ownership, not necessarily active work.
- Developers select from one reported-eligible To Do/In Progress pool, excluding actual Backlog and other engineers' active claims. Physical completion is checked on execution, so stale-completed tickets remain candidates. Existing unfinished active claims may continue even if their reports differ; ownership alone does not reserve work.
- Preserve the current perceived-work selector, deliberately top-heavy soft Rank preference and event-driven reconsideration in `GAME_DESIGN.md`. The old 50/50 category selection, 1% random switching and periodic active-work reconsideration are superseded. Successful stale Done corrections permit immediate normal reselection; failed reports use the existing idle-check schedule (#90).
- Keep player-facing selectors from exposing authoritative diagnostic values. Technical regression cases and implementation particulars belong in code/tests or finite GitHub issues, not in the game design decision log.

## Development UI visibility

- Use the single `import.meta.env.DEV` boundary in `src/App.tsx` for development UI.
- Put development controls, diagnostic visibility state, and authoritative selectors in `DevelopmentUI` and its children. The floating development toolbar and diagnostic overlays (#19) live inside this boundary.
- Production (`npm run build` then `npm run preview`, also GitHub Pages) renders the reported board, normal developer information, Pause/Resume, and simulation clock. Step, Restart, RNG tools, and all true-state diagnostics are development-only.
- Keep simulation behavior independent of Vite build mode and keep hidden values out of `getPlayerView`.
- This is a UI visibility convention, not information security: all simulation state exists client-side. Do not add staging, authentication, or a feature-flag framework for it.
- Ticket Match/Mismatch indicators are **implemented development-only diagnostics** ([#25](https://github.com/Noxshus/kanban-game/issues/25), [#69](https://github.com/Noxshus/kanban-game/issues/69)), not a player-facing mechanic or a manager accuracy verdict. Preserve the diagnostic selectors' status, progress and ownership/active-work comparisons, including valid historical ownership on completed tickets, without leaking authoritative state into the player view.


## AI-assisted development workflow

Follow [docs/DEVELOPMENT_WORKFLOW.md](docs/DEVELOPMENT_WORKFLOW.md) for the ChatGPT/Codex/GitHub implementation, review, testing and commit process. For substantial changes, review in a separate Codex conversation before committing; use known deferred-issue references to keep reviews proportionate. Do not assume a proposed prompt has been executed without explicit user confirmation.

## Concurrent-edit prevention

**Do not create competing remote Markdown commits while local implementation is underway.** During a Codex task, ChatGPT records newly agreed design decisions in GitHub issues/comments only; any documentation changes required immediately must be made in the **local working copy**. Direct GitHub repository-file edits are deferred until after the user has committed and pushed the local task. Synchronise a clean checkout with `git pull --rebase origin main` **before** starting a new Codex task. See `docs/DEVELOPMENT_WORKFLOW.md` for the full handoff and rebase conflict procedure.

## Development practices

- Use TypeScript throughout.
- Prefer clear, readable code.
- Make small, focused changes.
- Explain significant architectural decisions.
- Avoid modifying unrelated functionality.
- Do not add dependencies without explaining why.
- Preserve GitHub Pages compatibility.
- Run the build and lint checks after changes.
- Report any errors or warnings.

## Working with the project

- Inspect existing code before modifying it.
- At the beginning and end of an implementation, inspect `git status --short` and identify **all** issue-related changed/untracked files, including test changes; flag unrelated scratch files. Do not provide a partial hard-coded list as if it covered the entire change.
- Do not overwrite existing work without reason.
- **Do not commit, push, pull or rebase during normal implementation or independent review.** After the user explicitly authorises a *separate* post-review release handoff, Codex may stage/commit/synchronise/push the approved issue only, following `docs/DEVELOPMENT_WORKFLOW.md`. Verify no issue-related unstaged files remain; never force-push, discard unknown changes or resolve conflicts unilaterally.
- Do not introduce game mechanics beyond the explicitly requested scope.


## Code documentation

- Document important architectural decisions directly in the source code using concise comments.
- Explain why a design choice exists, not merely what the code does.
- Document non-obvious relationships between game systems and data structures.
- Keep comments synchronized with implementation changes.
- Avoid unnecessary comments for self-explanatory code.
- Do not create separate architecture documents unless explicitly requested.
