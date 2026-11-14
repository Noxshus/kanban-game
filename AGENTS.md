
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

## Development UI visibility

- Use the single `import.meta.env.DEV` boundary in `src/App.tsx` for development UI.
- Put development controls, diagnostic visibility state, and authoritative selectors in `DevelopmentUI` and its children. Future diagnostic overlays (#19) belong inside this boundary.
- Production (`npm run build` then `npm run preview`, also GitHub Pages) renders the reported board, normal developer information, Pause/Resume, and simulation clock. Step, Restart, RNG tools, and all true-state diagnostics are development-only.
- Keep simulation behavior independent of Vite build mode and keep hidden values out of `getPlayerView`.
- This is a UI visibility convention, not information security: all simulation state exists client-side. Do not add staging, authentication, or a feature-flag framework for it.


## AI-assisted development workflow

Follow [docs/DEVELOPMENT_WORKFLOW.md](docs/DEVELOPMENT_WORKFLOW.md) for the ChatGPT/Codex/GitHub implementation, review, testing and commit process. For substantial changes, review in a separate Codex conversation before committing; use known deferred-issue references to keep reviews proportionate. Do not assume a proposed prompt has been executed without explicit user confirmation.

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
- Do not overwrite existing work without reason.
- Do not commit or push changes unless asked.
- Do not introduce game mechanics beyond the explicitly requested scope.


## Code documentation

- Document important architectural decisions directly in the source code using concise comments.
- Explain why a design choice exists, not merely what the code does.
- Document non-obvious relationships between game systems and data structures.
- Keep comments synchronized with implementation changes.
- Avoid unnecessary comments for self-explanatory code.
- Do not create separate architecture documents unless explicitly requested.
