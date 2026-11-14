# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Development and production UI

`npm run dev` enables the single `import.meta.env.DEV` boundary in `src/App.tsx`.
It mounts `DevelopmentUI`, where diagnostics start visible and can be toggled.
Step/Restart/RNG controls remain available in development when diagnostics are hidden.
`npm run build` and `npm run preview` use production assets: the reported board,
normal developer information, Pause/Resume, and clock remain; development UI is absent.
The simulation and seeded RNG behave identically in both builds. This controls UI
visibility, not access to data: the entire simulation runs on the client.

| Classification | Feature and source | Local development | Production preview / Pages |
|---|---|---|---|
| Development-only | Diagnostic toggle and selector: `src/components/DevelopmentUI.tsx` | Visible; diagnostics enabled initially | Absent; authoritative selector not invoked by App |
| Development-only | Step +1s, Restart, RNG state display and seed form: `src/components/DevelopmentControls.tsx` | Visible; Step/seed paused-only | Absent |
| Development-only | Authoritative team totals/rate: `TeamDiagnostics` in `src/components/Diagnostics.tsx` | Visible when Team Diagnostics panel is open | Absent |
| Development-only | Ticket size, actual completed/remaining work, ETA, active developer/rate: `TicketDiagnostics` in `src/components/Diagnostics.tsx` | Visible when enabled | Absent |
| Development-only | Actual active work and ownership counts: `DeveloperDiagnostics` in `src/components/Diagnostics.tsx` | Visible when enabled | Absent |
| Player-facing | Four-column board, ticket IDs/titles, reported status/progress, assignees: `src/components/GameBoard.tsx`, `src/store/playerView.ts` | Visible | Visible |
| Player-facing | Normal developer names/productivity: `src/components/GameBoard.tsx`, `src/store/playerView.ts` | Visible | Visible |
| Player-facing (provisional) | Pause/Resume, clock, initially paused run: `src/App.tsx`, `src/store/simulationControls.ts` | Visible | Visible |
| Player-facing | Existing simulation behavior; no ordinary navigation implemented yet: `src/game/advanceSimulation.ts` | Runs on resume | Runs on resume |
| Undecided / future | Which diagnostics become player unlocks or unreliable reports: `GAME_DESIGN.md` section 4.3.1 | No unlock UI implemented | No unlock UI implemented |
| Development-only | Simulation Controls and Team Diagnostics overlay panels (#19): `src/components/DevelopmentUI.tsx` | Independently openable from the floating toolbar | Absent |

There is no decision trace or other debugging UI in the current source. Diagnostic
components may share rendering code with the board; production absence is a rendering
contract, not a guarantee that every diagnostic string is stripped from bundled code.

To verify, compare `npm run dev` with `npm run build` followed by `npm run preview`.
In development, toggle diagnostics and test Step, seed application and restart. In
preview, verify the absence of the toggle and all diagnostic metrics/controls, then
Resume and Pause to check that the reported board and clock still update normally.
