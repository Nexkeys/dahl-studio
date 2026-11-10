# Progress / Handoff

Last updated: 2026-11-10 (0.4.0 built, not yet published). Read README.md, then CHANGELOG.md, then this file.

## 0.4.0 status (2026-11-10)
All 0.4.0 branches are merged on main; full suite, typecheck and build pass; Settings and workspace smoke-checked; one live Build run with a Dahl key changed files and ran a command without approval cards (final reply lost to "model at capacity"). See CHANGELOG 0.4.0 for evidence per feature.
Not verified live: Groq, OpenRouter, Ollama, LM Studio, Tab completions, image description by a vision model, Preview tools with a model, budgets against a real bill.
Known gaps: Accurate OCR does nothing yet (no ONNX runtime, no inference step); PowerShell start is slow on some PCs, so short agent commands can show "(timed out)"; Codestral FIM path unreachable; `/chief` typed by hand is plain text; an extra instruction-files assertion in `tests/skills.test.ts` was left uncommitted in the skills agent's worktree.
Next (0.4.1): background helpers with ping, worktree task panel, hooks, model check, the gaps above.

## Status by area
| Area | Status |
|---|---|
| Electron/React/TS/Monaco foundation, installer | Done. v0.3.6 installer published; v0.2 install/uninstall verified |
| Auto-update (GitHub Releases, differential download) | Done; verified end to end on the user's PC (0.3.3 to 0.3.4) |
| Windows notifications (approvals, task status) | Done; verified in the built app |
| Dahl API (models, SSE, tools, 2-key failover, balance test) | Done; live chat verified in built app |
| OpenAI / Anthropic / Gemini / NVIDIA | Implemented, unit-tested. Anthropic was partly exercised by the user (0.3.1 tool_use fix), but **no successful live run is recorded for any of the four** |
| Auto model discovery (+ New badge, 30 min refresh) | Done (Dahl verified live; NVIDIA list endpoint public) |
| Thinking levels (native per provider; app-level for Dahl) | Done |
| Chat UX (markdown, grouped activity, per-turn summary, revert, live states) | Done, screenshot-verified |
| Attachments (files/folders/images, paste, @mentions, Ctrl+L) | Done |
| Image understanding (view_image / analyze_image with OCR, max 2 vision candidates) | Done; OCR live-verified |
| Reasoning panel (default + presets, per project) | Done, unit-tested |
| Sub-agents + Agents view | Done. Live Review run on Dahl verified (0.3.6); 8 bugs fixed; `tests/subagents.test.ts`. Build-mode delegation not run live |
| Web research (built-in DuckDuckGo search + fetch) | Done, live-verified |
| MCP manager + Free Toolbox | Done; Filesystem, Playwright, DuckDuckGo, Git, Fetch capability-verified. MCP tools in every mode (approval outside Build); `/<server>` and `/mcp` slash commands (0.3.6) |
| Supabase connector | 0.3.6: starts again (peer deps pinned), token field, project ref, write-access switch. Not run with a real token |
| Source Control / GitHub push | 0.3.6: `git_push` agent tool, Publish to GitHub box, optional encrypted token. Tested against local bare repos and an authenticated git http server; no real GitHub push yet |
| Preview browser (webview) | Done (0.3.6); smoke-verified in the built app |
| Logs view (per task + app) | Done |
| App-maintained PROGRESS.md work log for user projects | Done, unit-tested |
| 12 themes with effects + preview cards | Done; Visual effects setting (Automatic / Full / Reduced) for slow PCs. Blueprint and Ink & Paper added (unreleased), smoke-verified |
| Work survives restarts and updates (tasks continue after an update, crash resume card, editor tabs with unsaved edits, terminal Run again) | Done (0.3.7, unreleased); smoke-verified with a simulated interrupted run. Install-when-tasks-finish not exercised with a real update |
| What's New dialog after updates | Done (0.3.7, unreleased); smoke-verified (shows once, Got it saves, themes). Not yet seen through a real auto-update |
| ask_user questions | Done (0.3.7, unreleased); unit-tested. The card has not been seen with a live model |
| Agent git tool (pull, merge, branch, stash, tag, clone, commit) | Done (0.3.7, unreleased); tested against real local repos including a merge conflict |
| Agent github tool (PRs, merge PR, CI status and logs, releases with files) | Done (0.3.7, unreleased); input checks unit-tested; never called against the real GitHub API |
| Dropped or cut streams | Fixed (0.3.7, unreleased): early stream end is an error, lead retries twice. Unit-tested with simulated drops |
| Chat tabs (several conversations per project, restored after restart) | Done (unreleased); unit-tested and smoke-verified with a saved run. A chat streaming in the background while another is on screen is unit-tested only (needs a live key) |
| Editor tabs: drag reorder, context menu, middle-click close, Ctrl+W / Ctrl+Tab / Ctrl+Shift+T, breadcrumbs with cursor position, Ctrl+P go to file, Ctrl+B / Ctrl+Alt+B / Ctrl+J panel toggles | Done (unreleased); smoke-verified (tabs, menu, breadcrumbs). Keyboard shortcuts not exercised in the built app |
| Streaming and startup performance | Done (0.3.5): batched tokens, block-memoized live Markdown, lazy Monaco. Benchmarked, smoke-verified |
| Renderer CSP (packaged build) | Done (0.3.5); smoke-verified with 0 console errors |
| Command palette, skills | Done |

## Next steps (suggested order)
1. With real keys: live-test OpenAI, Anthropic, Gemini and NVIDIA chat with tools and images, and fix any adapter mismatch (`providers/registry.ts`, `providers/anthropic.ts`). Add the results to CHANGELOG.
2. Live-test a delegate_agents run (for example `/review`) on Dahl and check the Agents view.
3. Capability-test ToolDash (needs npx) and Godot (needs Godot). Supabase needs a user account and token.
4. Worktree isolation for parallel *write* agents in the same project (currently file leases). This also unlocks chat tabs running at the same time: today only one chat per project can work at once (the runner allows one active run per project), and the UI says so.
5. First real GitHub push from the app (token and Git Credential Manager paths), and a real Supabase token run. Add a Pull button for the unrelated-history case.
6. Clean-machine install test; code signing certificate.
7. Live-test the github tool on a scratch repository: create_pr, ci_status, merge_pr, create_release with an attached file. Watch for ask_user in a real run and check the card.
8. Not yet observed: a long streamed reply from a real model in the built app with the new batching (it is benchmarked and unit-tested only). Also not done: transcript virtualization for very long chats.

## Gaps against the product pack (`Dahl-Studio-Product-Pack/docs`)
- PRODUCT_SPEC principle 2 says Dahl is the only model provider; the app now supports four more. Update the spec if that change is intended.
- Requested video MCPs (Higgsfield, InVideo, ByteDance) are not in the catalog, and the gap is not stated in the UI.
- The test plan asks for end-to-end UI, accessibility, upgrade/uninstall and long-run resume tests; only unit-level tests exist (`tests/`).
- The terminal is a command runner, not a PTY. No MSIX package (optional: the spec says ".exe and/or MSIX").

## Notes for the next agent
- Keep each file write small (under about 250 lines). Long single writes were getting cut off in this environment.
- zustand selectors must not return new arrays or objects (this caused React #185). Derive values outside the selector.
- Smoke mode: `DAHL_SMOKE=<dir>`, optional `DAHL_SMOKE_JS` (runs in the renderer, can call `window.dahl.invoke`), `DAHL_SMOKE_JS_WAIT`, `DAHL_SMOKE_CLICK`. It writes `smoke.json` and `smoke.png`.
- Smoke runs use their own profile (`<DAHL_SMOKE>\profile`), not the real settings. To open a project, write a `settings.json` there first (`openProjects`, `activeProject`). Clear `ELECTRON_RUN_AS_NODE` in the shell, or electron.exe runs as Node.
- Performance rules (see CHANGELOG "Performance"): never import `monaco-editor` or `@monaco-editor/react` outside `lazyMonaco.ts` / `monaco.ts`, or Monaco goes back into the startup bundle. Stream deltas go through the buffer in `store.ts`. Components shown during streaming should select narrow fields, not `s.projects[root]`.
- Live tests: `$env:DAHL_LIVE=1; npx vitest run tests/live.test.ts` (needs network, uvx and npx).
- Atom icon on the installed app's taskbar button: look for a Start Menu `.lnk` that carries `System.AppUserModel.ID = global.dahl.studio` but targets `electron.exe`. Electron creates one for notifications. Dev and smoke runs must keep the `.dev` AppUserModelId.
- Never pipe long-running publish commands through `Select-Object -First` (it killed a release upload). Log to a file instead.
- `window.prompt()` does not exist in Electron (it throws). Use inline inputs; 0.3.6 removed every use.
- Product rules: no em or en dashes anywhere (`src/shared/dashes.ts` enforces it on model output and agent writes); ownership notice is NexKeys (LICENSE, build stamp).

<!-- dahl:current -->
## Current task
- Status: completed
- Last request: Explain how this project works: purpose, architecture, main modules, data flow and how to run it. Be concise and use headings.
<!-- /dahl:current -->

<!-- dahl:plan -->
## Plan
(no plan yet)
<!-- /dahl:plan -->

<!-- dahl:log -->
## Task log

### 10/31/2026, 8:51:33 AM | completed | review | dahl:deepseek-ai/DeepSeek-V4-Flash-0731

**Request:** Explain how this project works: purpose, architecture, main modules, data flow and how to run it. Be concise and use headings.

**Result:** I have a clear picture from README, PROGRESS.md, package.json, the architecture doc, and the main-process wiring. Here is the concise overview.

# What this project is

**Dahl Studio** is a local-first Windows coding studio (Electron app) where an LLM agent works inside your projects: it can read/search files, propose edits, run terminals and git commands, use MCP tools, and answer questions — all behind an approval gate. It is powered by the **Dahl API** (`https://inference.dahl.global/v1`, OpenAI-compatible) and also supports OpenAI, Anthropic, Gemini, and NVIDIA keys. There is **no backend and no database** — all state is plain JSON/Markdown files on disk.

Version 0.3.5, TypeScript throughout (`tsconfig.node.json` for main/preload, `tsconfig.web.json` for renderer), tests with Vitest, packaged with electron-builder + NSIS, auto-updates via GitHub Releases.

# Architecture (three layers)

- **Main process (`src/main/`)** — all privileged work: filesystem, terminal, git, secrets, the agent turn loop, MCP servers, provider adapters, model discovery, updates. `index.ts` = lifecycle + window + smoke mode; `services.ts` = singletons/wiring; `ipc.ts` = every IPC handler.
- **Preload (`src/preload/index.ts`)** — the single bridge. Exposes only `window.dahl.invoke(channel, ...)` and `window.dahl.on(channel)` with an allow-listed event set. Renderer gets no Node, no raw `ipcRenderer`, no secrets.
- **Renderer (`src/renderer/src/`)** — React 19 + zustand UI: chat, editor (Monaco, lazy-loaded), terminal view, agents view, settings, themes, command palette. `App.tsx` (rail/views), `store.ts` (UI state), `themes-*.ts`.

# Main modules

| Module | Role |
|---|---|
| `providers/registry.ts` + `dahl/client.ts` + `dahl/router.ts` | One `chat()` entry; OpenAI-compatible SSE client, er

**Files changed:** none

**Verification:** no commands were run

_9 tool calls, 118s, 3 memories saved_
<!-- /dahl:log -->
