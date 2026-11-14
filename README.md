# Kanban Game

A browser-based incremental management game about leading autonomous software developers through a Kanban board that does not always reflect reality.

**Status:** Early prototype. Game systems and presentation are still under development.

## Play

[Open the current browser prototype](https://noxshus.github.io/kanban-game/).

The prototype includes a four-column board, autonomous developer activity, a simulation clock and Pause/Resume. Development-only diagnostics and simulation controls are intentionally not shown on the published GitHub Pages build.

## Run locally

Requires a Node.js installation compatible with the versions of Vite and TypeScript in `package.json`.

```cmd
npm install
npm run dev
```

Open the local URL reported by Vite. Available commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local Vite development server, including developer diagnostics |
| `npm test` | Run automated tests |
| `npm run lint` | Run Oxlint |
| `npm run build` | Type-check and build production assets |
| `npm run preview` | Preview the production build locally |

The project uses React, TypeScript and Vite, with GitHub Pages deployment. The simulation runs in the browser; there is no backend.

## Development and production behaviour

Local Vite development mode includes a floating toolbar for simulation controls and team diagnostics, along with optional authoritative ticket and developer metrics. The published production build retains the player-facing Kanban board and Pause/Resume, but not developer debugging tools.

The two build modes use the same simulation rules. Hiding diagnostics is a **UI convention**, not a security boundary: the simulation remains client-side.

## Project documentation

- [Game design](GAME_DESIGN.md) — player experience, confirmed gameplay rules, planned systems and unresolved design questions.
- [Agent and architecture instructions](AGENTS.md) — code architecture and development/production UI boundaries.
- [Development workflow](docs/DEVELOPMENT_WORKFLOW.md) — ChatGPT, Codex and GitHub responsibilities, validation, review and commit practices.
- [GitHub issues](https://github.com/Noxshus/kanban-game/issues) — actionable features, implementation details and deferred improvements.

The smaller READMEs within `src/` describe the responsibility of each code area.
