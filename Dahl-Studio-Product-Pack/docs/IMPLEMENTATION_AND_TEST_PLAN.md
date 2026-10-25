# Dahl Studio — Implementation and Test Plan

## Phase 0 — Reference, API contract, and baseline

- Preserve icon/UI references in this project pack.
- Obtain the actual Dahl API documentation and build an endpoint/capability contract.
- Inspect any existing Dahl Studio source repository before selecting a final project structure or overwriting files.
- Decide data schema versions for chat, memory, usage and run-state files.
- Establish linting, formatting, type checking, unit tests, CI/build commands, and a clean Windows packaging baseline.

**Exit gate:** documented API contract; repository inventory; working empty Windows shell; tests and build pass.

## Phase 1 — Desktop foundation and file-based storage

- Build app shell and window behavior; resize/collapse panels.
- Add local folder/project picker, project explorer, file tabs, Monaco editor, integrated terminal view, and file search.
- Implement file-only persistence, settings, chat history skeleton, Storage browser and local logs.
- Create `.dahl/` project-state support and ignore handling.
- Add the ten-theme system with accessibility checks and no emoji UI elements.

**Exit gate:** state survives app restart; user can inspect/open storage; no database dependency exists; project files remain in the chosen local paths.

## Phase 2 — Dahl API and model control

- Implement Dahl adapter against official documentation.
- Load model catalogue dynamically and show model capability details.
- Add secure key entry, primary/secondary key health, tested failover rules, streaming, documented thinking/effort modes, and usage monitor.
- Test key invalidation, rate limits, quota exhaustion, timeouts, model-not-found, network loss, and recovery.

**Exit gate:** models come from the live documented catalog; both keys work independently; failover follows policy; no keys appear in files, logs, prompts, or UI beyond a masked identifier.

## Phase 3 — Coding workflow and review

- Add plan-first coding tasks, file context selection, diff creation and review, approve/reject/apply, formatter/linter/test actions, and file-conflict detection.
- Include clear proposed/approved/applied states and recovery from partial writes.
- Expose readable progress, concise rationale, tool activity, results, and blockers.

**Exit gate:** sample code changes can be proposed, reviewed, applied, tested, rejected, and recovered without silent overwrites.

## Phase 4 — Local memory, resumable jobs, and agents

- Build project memory extraction/retrieval and memory edit/delete/export controls.
- Persist task manifests, ordered steps, logs, checkpoints and resumable state.
- Add agent roles and controlled patch integration.
- Support two active codebases without context or permission bleed.
- Test app shutdown/restart, API outage mid-task, user cancellation, checkpoint resume, and conflicting agent patches.

**Exit gate:** “save state” then restart then “continue” resumes from the last durable checkpoint and clearly verifies current files first.

## Phase 5 — GitHub, MCP, Supabase, and web access

- Implement Git status/diff/branch/commit/remote/push flows and secure GitHub authentication.
- Add curated MCP directory, install/configuration lifecycle, per-project permissions, process supervision, and connector diagnostics.
- Verify requested service connectors before labeling them built in; support custom MCP configuration where safe.
- Add supported direct Supabase project connection and user-authorized online tools.
- Test denied permissions, token expiry, malicious tool output, remote changes, failed pushes and recovery.

**Exit gate:** every external action is permission-gated, credentials remain outside model context, and connector failures are understandable and recoverable.

## Phase 6 — Hardening and installer

- Automated test suite: unit, integration, end-to-end UI, security, storage migration, accessibility, theme, API fallback, multi-agent conflict, long-run resume, Git/MCP, and upgrade/uninstall.
- Test on a clean supported Windows machine/user profile, including first launch, key entry, model discovery, opening a local codebase, editing, tests, Git push to a test repo, app restart, and uninstall/reinstall.
- Confirm logs redact credentials and no app-owned state is transmitted to a Dahl-controlled database or sync service.
- Produce versioned Windows x64 installer (`.exe` installer and/or MSIX), verify install/uninstall, and retain test evidence.

**Release gate:** no installer is presented as production-ready until the clean-install smoke test and release test suite pass. The deliverable is a Windows installer, not an APK.

## Minimum launch acceptance criteria

1. A user can install Dahl Studio on Windows without manually launching source code.
2. The user can add one or two Dahl API keys and see documented available models.
3. The user can open a local repository, chat with Dahl, inspect a plan and diff, apply/reject changes, and run tests.
4. Chat, project memory, plans, checkpoints, settings and usage observations persist to local files only.
5. App restart does not lose durable task state; a saved task can resume safely.
6. Primary-key failure triggers the configured secondary-key fallback and displays the event without revealing secrets.
7. The user can run two independent project workspaces without context or permission crossover.
8. GitHub push and MCP actions require clearly scoped credentials and approvals.
9. Ten themes are selectable and visibly affect the full UI/editor presentation without harming usability.
10. Tests and clean-install checks pass before distributing an installer.
