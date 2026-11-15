# Kanban Game — Development Workflow

This is the standing working agreement for building Kanban Game with ChatGPT, Codex, and GitHub. It is **living documentation**, not an open-ended GitHub issue. Update it when our process changes. Read `AGENTS.md` for project-specific code instructions and `GAME_DESIGN.md` for gameplay decisions.

## Responsibilities and handoffs

- **User:** Confirms gameplay decisions and priorities, runs Codex locally and performs hands-on verification. After review, **explicitly authorises release**; they may either run Git themselves or delegate the bounded Git operations to Codex. Uses **Windows Command Prompt (`cmd.exe`)**, not PowerShell.
- **ChatGPT:** Helps shape issues and design, proactively manages GitHub issues and agreed Markdown documentation, prepares Codex prompts with the **user's standing Sol + High Codex setting** (without suggesting alternate models/effort), evaluates findings, and checks pushed code and deployment status. Do not assume access to local unpushed code.
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
2. ChatGPT drafts a focused implementation prompt without recommending Codex models or effort levels: the user has chosen **Sol + High for all Codex tasks**, including routine changes and independent reviews, unless they explicitly change that preference. Codex reads the issue and project instructions.
3. Codex implements locally, adds meaningful tests, and runs `npm test`, `npm run lint`, and `npm run build`. At the start, **inspect `git status --short`** and flag pre-existing changes. At the end, **enumerate every changed/untracked file using `git status --short`**, identify which belong to the issue and which are unrelated, and warn about scratch files. Windows CMD equivalents are `npm.cmd` when needed; do not give PowerShell-specific commands.
4. User manually verifies the behaviour. ChatGPT helps evaluate unexpected results.
5. For **substantial simulation, RNG, state, or architectural changes**, run an independent review in a fresh Codex conversation before committing. For small UI edits, use a narrower proportionate review; avoid exhaustive review by default. The independent reviewer should also inspect `git status --short` (including untracked files) and explicitly identify **every issue-related modified file**, not only those named in the implementation prompt.
6. Triage confirmed findings. Fix material issues; explicitly log accepted deferred issues rather than repeatedly resurfacing them. Re-run relevant checks. Capture nonblocking enhancements as focused issues.
7. **After explicit release approval**, use a single bounded Git handoff, preferably delegated to Codex if the user wants less command-line housekeeping. Inspect `git status --short`, stage **every issue-related changed/new file** (do not rely on a guessed static filename list), check `git diff --cached --stat` and `git status --short` **before committing**, and stop if issue-related unstaged changes remain. Exclude scratch files and unrelated local work. Commit, then synchronise using `git pull --rebase origin main` only after a clean working tree, and push. If a conflict or other unexpected condition occurs, stop and report without force-pushing, skipping a commit, stashing/discarding user files, or silently choosing a conflict side. Local and remote should already be synchronised before Codex begins.
8. ChatGPT verifies pushed source and GitHub Actions deployment, reconciles pending agreed design/workflow document updates, **then closes the completed issue** once the release and applicable documentation sync have been verified. If ChatGPT makes post-push Markdown commits, explicitly tell the user to pull them on a clean tree **before starting the next local Codex task**. Do not claim tests ran locally if only repository source or build status was inspected.

## Prevent concurrent GitHub/working-copy edits

**GitHub issues are the live design-notes queue during implementation; local code and Markdown are owned by the active Codex/user working copy.** A merge conflict in `GAME_DESIGN.md` occurred during #38 because ChatGPT committed design notes to GitHub while Codex independently edited that same document locally. Avoid that scenario by using the following handoff:

1. **Before a new Codex task:** On a clean local checkout, run `git pull --rebase origin main` and verify `git status`. Finalise any needed shared Markdown changes *before* the task starts, then synchronise again if ChatGPT made a remote commit. Only then provide/run the implementation prompt.
2. **While Codex is running or the implementation is locally uncommitted:** ChatGPT may create/update GitHub issues, comments and acceptance criteria, but **must not use direct GitHub commits to alter `GAME_DESIGN.md`, `AGENTS.md`, `README.md`, `docs/DEVELOPMENT_WORKFLOW.md`, or any repository file**. Log each new agreed decision in the relevant issue using an explicit **`Documentation sync: PENDING`** note (include the target Markdown file and the decision). If documentation is needed immediately for the implementation, instruct Codex to update the **local copy** as part of its change instead.
3. **After independent review:** User commits and pushes the local implementation first. At the push-confirmation handoff, **ChatGPT proactively checks the active issue and any pending notes for `Documentation sync: PENDING`**, reconciles the agreed decisions into the appropriate Markdown documents (unless Codex already included them accurately), then marks the notes **`Documentation sync: DONE`** in the issue. Do this as part of the normal push/deployment/issue-closure workflow; **the user must not be expected to remind ChatGPT about documentation synchronisation**. A post-push documentation commit creates a new remote HEAD; the user must pull it **before** starting the next Codex task.
4. **If a rebase conflict still occurs:** Do not use `git rebase --skip` or `git push --force` to bypass it. Preserve both sides of substantive documentation; resolve the conflict explicitly, stage the resolution and continue the rebase. When useful, ChatGPT can provide a resolved file for the user to replace locally.
5. **Before editing repository files via GitHub:** ChatGPT should check whether a local Codex task or unpushed changes are in progress based on the conversation. If status is uncertain, prefer issue comments rather than risking a remote commit.

The rule covers **all direct repository-file edits**, not just `GAME_DESIGN.md`. It does **not** prevent issue updates, which do not change Git history.

## Low-friction Git handoff (optional, user-authorised)

Git bookkeeping should not occupy the user's game-design time. **The default implementation and review conversations remain read-only with respect to Git history:** no commit, push, pull or rebase. After the user manually verifies a change and the independent review approves it, ChatGPT can provide a **separate, explicit release instruction** authorising Codex to handle that issue's Git handoff end to end. The user must explicitly run/authorise it; this is never implied by an implementation prompt.

**Shipping checks:**
- Read `git status --short` and inspect the tracked/untracked changes. Stage all and only files belonging to the approved issue, including tests or newly created files that the earlier suggested list may have omitted. **Do not blindly `git add -A`** when unrelated scratch files or work might exist.
- Compare `git diff --cached --name-only` and `git status --short`. **If any issue-related file is still unstaged, do not commit.** Flag unrelated/unknown files; do not delete them without approval.
- Re-run appropriate checks if anything has changed since review. Commit with a descriptive message, confirm the working tree is clean, then `git pull --rebase origin main` and `git push origin main`.
- **Stop and ask** on conflicts, unexpected dirty state, failing checks, permissions/auth failures, divergence, or anything that might overwrite someone else's work. No `--force`, `rebase --skip`, automatic stashing, `reset --hard`, or unapproved file deletion.
- Return final commit SHA, push destination and status. ChatGPT then confirms the actual remote commit and GitHub Pages deployment, handles pending documentation, and closes the issue.

**Reusable approved shipping prompt (after review; replace issue number and commit description):**

```text
The implementation for issue #NUMBER has passed manual verification and independent review.
You are explicitly authorised to perform its local Git release operations.

Check git status --short and the diff (including untracked files); identify all files changed for this issue,
including tests missing from any prior file list. Do not stage unrelated/scratch files.
Stage exactly the approved issue's changes. Inspect git diff --cached --stat and git status --short,
and ensure no issue-related changes remain unstaged. If anything is ambiguous, stop and ask.

Commit with a descriptive message. Verify the working tree is clean.
Then git pull --rebase origin main and git push origin main.
Never force-push, skip a commit, discard/stash unknown changes, or silently resolve conflicts.
If any command fails or the state is unexpected, stop and report the exact issue.
Return the commit SHA and push result. Do not close GitHub issues.
```

This would have avoided the #46 omitted-test-file rebase blocker. It also keeps Git privileges **bounded to an explicitly approved release**, rather than allowing implementation agents to push autonomously.

## Fixed Codex model and effort preference

**Standing user choice (2026-11-15):** Use **Sol + High** for **every Codex task**, including implementation, small UI edits, review and Git release tasks. The user explicitly prioritises quality over response time or token use. **Do not suggest alternate Codex models or effort settings in prompts**, or continue giving per-task model recommendations. Only revisit this choice if the user asks to change it.

This is a **Codex-specific preference**; it does not mandate any particular ChatGPT model or alter the requirement that independent reviews remain read-only unless separately authorised. Keep review **scope** proportionate to actual risks even when the reviewer uses Sol + High.

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
