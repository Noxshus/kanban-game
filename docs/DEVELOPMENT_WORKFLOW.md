# Kanban Game — Development Workflow

This is the standing working agreement for building Kanban Game with ChatGPT, Codex, and GitHub. It is **living documentation**, not an open-ended GitHub issue. Update it when our process changes. Read `AGENTS.md` for project-specific code instructions and `GAME_DESIGN.md` for gameplay decisions.

## Responsibilities and handoffs

- **User:** Confirms gameplay decisions and desired priorities, runs Codex locally, performs hands-on verification, and commits/pushes after reviews. Uses **Windows Command Prompt (`cmd.exe`)**, not PowerShell.
- **ChatGPT:** Helps shape issues and design, proactively manages GitHub issues and agreed Markdown documentation, recommends a model/effort appropriate to each task, prepares Codex prompts, evaluates findings, and checks pushed code and deployment status. Do not assume access to local unpushed code.
- **Codex (implementation conversation):** Reads the relevant issue, `AGENTS.md`, and `GAME_DESIGN.md`; makes focused local changes and runs validation. **Do not commit, push, rebase, or close issues unless explicitly requested.**
- **Codex (independent review conversation):** For substantial changes, inspect uncommitted changes against HEAD including untracked files. Report defects separately from suggestions; do not edit files or Git state.

## Track each prompt's actual state

**Never infer that the user executed a suggested prompt.** Use:
- **Suggested:** Prompt provided, not confirmed started.
- **Running:** User explicitly confirmed execution.
- **Completed:** User explicitly confirmed completion or supplied results.

Do not advance workflow steps on assumption. A later prompt may subsume an earlier one, but verify its implementation before claiming that.

## Standard workflow

1. Discuss scope and confirm design decisions. Record actionable implementation tasks and newly agreed decisions in GitHub issues immediately. Update `GAME_DESIGN.md` **before** local implementation begins, or **after** the implementation has been committed and pushed. Never commit overlapping Markdown changes to GitHub while Codex has local work in progress. Keep proposed ideas distinct from approved rules.
2. ChatGPT recommends Codex model and effort and drafts a focused implementation prompt. Codex reads the issue and project instructions.
3. Codex implements locally, adds meaningful tests, and runs `npm test`, `npm run lint`, and `npm run build`. Windows CMD equivalents are `npm.cmd` when needed; do not give PowerShell-specific commands.
4. User manually verifies the behaviour. ChatGPT helps evaluate unexpected results.
5. For **substantial simulation, RNG, state, or architectural changes**, run an independent review in a fresh Codex conversation before committing. For small UI edits, use a narrower proportionate review; avoid exhaustive review by default.
6. Triage confirmed findings. Fix material issues; explicitly log accepted deferred issues rather than repeatedly resurfacing them. Re-run relevant checks. Capture nonblocking enhancements as focused issues.
7. User checks `git status`, commits local work, synchronises with remote, and pushes. The project should already be synchronised **before** Codex starts work, so rebasing at this stage should ordinarily be conflict-free. If the remote did change, use `git pull --rebase origin main` only **after committing** local changes; pause and resolve conflicts if any. Never force-push as a workaround, skip an implementation commit, or rebase mid-implementation.
8. ChatGPT verifies pushed source and GitHub Actions deployment, closes completed issues after successful verification, and only **then** reconciles any queued design-document updates. If ChatGPT makes post-push Markdown commits, explicitly tell the user to pull them on a clean tree **before starting the next local Codex task**. Do not claim tests ran locally if only repository source or build status was inspected.

## Prevent concurrent GitHub/working-copy edits

**GitHub issues are the live design-notes queue during implementation; local code and Markdown are owned by the active Codex/user working copy.** A merge conflict in `GAME_DESIGN.md` occurred during #38 because ChatGPT committed design notes to GitHub while Codex independently edited that same document locally. Avoid that scenario by using the following handoff:

1. **Before a new Codex task:** On a clean local checkout, run `git pull --rebase origin main` and verify `git status`. Finalise any needed shared Markdown changes *before* the task starts, then synchronise again if ChatGPT made a remote commit. Only then provide/run the implementation prompt.
2. **While Codex is running or the implementation is locally uncommitted:** ChatGPT may create/update GitHub issues, comments and acceptance criteria, but **must not use direct GitHub commits to alter `GAME_DESIGN.md`, `AGENTS.md`, `README.md`, `docs/DEVELOPMENT_WORKFLOW.md`, or any repository file**. Log new decisions in issues and mark documentation synchronisation as pending. If documentation is needed immediately for the implementation, instruct Codex to update the **local copy** as part of its change instead.
3. **After independent review:** User commits and pushes the local implementation first. ChatGPT verifies the push/deployment, then updates any pending Markdown documentation on GitHub. A post-push documentation commit creates a new remote HEAD; the user must pull it **before** starting the next Codex task.
4. **If a rebase conflict still occurs:** Do not use `git rebase --skip` or `git push --force` to bypass it. Preserve both sides of substantive documentation; resolve the conflict explicitly, stage the resolution and continue the rebase. When useful, ChatGPT can provide a resolved file for the user to replace locally.
5. **Before editing repository files via GitHub:** ChatGPT should check whether a local Codex task or unpushed changes are in progress based on the conversation. If status is uncertain, prefer issue comments rather than risking a remote commit.

The rule covers **all direct repository-file edits**, not just `GAME_DESIGN.md`. It does **not** prevent issue updates, which do not change Git history.

## Model and effort guidance

These are guidelines, not requirements; names and availability may change.

| Task | Suggested default |
| --- | --- |
| ChatGPT design, planning and milestone review | GPT-6 Medium; High for difficult systems design |
| Codex routine scoped UI or cleanup | Terra Medium; Low for trivial changes |
| Codex simulation / data model / RNG implementation | Sol Medium; High for complex architecture |
| Independent Codex review | Sol High for substantial simulation/architecture changes; Sol Medium or narrower review for routine UI |

Keep review scope proportionate to the risk and the time/token cost.

## Review policy: scope and known issues

- State the **intended platform and target viewport** before reviewing UI. Kanban Game is currently desktop-first; development overlays do not need exhaustive phone-width testing.
- Read the **specific accepted known-issue links** relevant to the change. For the development overlay, narrow-screen defects are deferred under [#23](https://github.com/Noxshus/kanban-game/issues/23), and browser-interaction test hardening under [#24](https://github.com/Noxshus/kanban-game/issues/24).
- Review **changed code and affected regression paths first**; run tests/lint/build. Avoid wide browser matrices or major speculative audits unless requested or warranted by the change.
- Do not repeatedly present unchanged, accepted limitations as new blockers. Put them in a compact `Known/deferred` section or cite their issue. **Still flag** any materially worsened behaviour, newly affected supported environment, serious accessibility or safety problem, or true functional regression.
- Do not treat a lack of new interactive regression tests as a failing unit test: separate passing-test status from coverage suggestions. Use #24 for the current development overlay coverage gap.
- Distinguish **confirmed defects**, **risks**, and **future improvements**. Never manufacture findings to fill severity categories.

## Concise reusable independent review prompt

```text
Act as an independent code reviewer, not an implementer. Do not modify files or Git state.

Read AGENTS.md, GAME_DESIGN.md, docs/DEVELOPMENT_WORKFLOW.md and the target GitHub issue.
Inspect uncommitted changes against HEAD, including untracked files.
Focus on changed behaviour, correctness, relevant regressions, and the explicitly supported use cases.
Read relevant known/deferred GitHub issues. Do not reopen unchanged accepted limitations as new blockers.
For substantial gameplay changes, assess simulation purity, deterministic RNG, actual/reported state separation,
and no-duplicate-claim invariants. For UI-only work, focus on the intended desktop behaviour and interactions.

Run npm test, npm run lint, and npm run build.
Report actionable findings in severity order with file references, reproduction and suggested corrections.
Separate new defects from known/deferred issues and optional coverage improvements.
Do not commit, push, pull, rebase or close issues.
Conclude with a clear recommendation: ready to commit, or changes required.
```

## Persistent tracking and documentation

- **GitHub issues:** Finite, actionable work and explicitly deferred defects. Close once verified or intentionally cancelled.
- **`GAME_DESIGN.md`:** Confirmed and proposed gameplay decisions, design rationale and open gameplay questions.
- **`AGENTS.md`:** Concise project/agent instructions and a link to this workflow.
- **This guide:** Workflow conventions, review expectations and role ownership. Update it directly when the process changes.
- **`README.md`:** Public project overview and getting-started information (it currently retains some Vite starter text tracked by cleanup issue #15).

This workflow is adaptable: prefer the smallest process that reliably protects the current change.
