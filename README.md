# Dahl Studio

Local-first Windows coding studio powered by the Dahl API (https://inference.dahl.global/v1).
Electron + React + TypeScript + Monaco. No Dahl Studio backend, no database: state is plain JSON/Markdown files on disk.

> **For agents picking this up:** read this file, then `CHANGELOG.md` (what was done and why, bugs found and fixed), then `PROGRESS.md` (what is next). You should not need to re-read the whole codebase. Log every change, bug and fix you make in `CHANGELOG.md`, and update `PROGRESS.md`.

## Quick start

```powershell
npm install
node node_modules\electron\install.js   # only if node_modules\electron\dist is missing (postinstall did not run here)
npm run dev          # development with hot reload
npm run typecheck    # tsc for main/preload and renderer
npm test             # vitest unit tests (43 tests; live tests need DAHL_LIVE=1)
npm run build        # production bundle into out/
npm run dist         # typecheck + test + build + NSIS installer into release/
```

Smoke-test the built app (no dev server). This writes `smoke.json` (renderer console errors and a DOM probe) and `smoke.png` (a screenshot), then exits:

```powershell
$env:DAHL_SMOKE="$env:TEMP\dahl-smoke"; $env:DAHL_SMOKE_CLICK="package.json"  # CLICK is optional: clicks an element by title
Start-Process release\win-unpacked\DahlStudio.exe -Wait   # or node_modules\electron\dist\electron.exe .
```

## Architecture (v0.3)

```
src/shared/types.ts          All shared types (providers, models, runs, agents, MCP, reasoning)
src/main/                    Electron main process (all privileged work)
  index.ts                   Lifecycle, window, smoke mode
  services.ts                Singletons and wiring (settings, vault, models, runner, mcp, image analysis)
  ipc.ts                     All IPC handlers (errors redacted; every fs/agent call checks the project is open)
  settings.ts / secrets.ts   Settings JSON; DPAPI vault (any slot name: Dahl keys, provider keys, mcp:<id>:<VAR>)
  terminal.ts / git.ts       PowerShell runner (AI keys stripped from env); git CLI helpers (never force-push)
  dahl/client.ts             OpenAI-compatible SSE client (Dahl, OpenAI, Gemini, NVIDIA), error classification, <think> splitting
  dahl/router.ts             Dahl two-key failover
  providers/anthropic.ts     Native Anthropic Messages adapter (thinking blocks replayed via providerBlocks)
  providers/registry.ts      Live model discovery for all providers, thinking-parameter mapping, single chat() entry
  agent/tools.ts             Tool schemas, role/mode tool sets, system prompt (reasoning profile injected)
  agent/runner.ts            Turn loop, sub-agents (delegate_agents, file leases), approvals, revert, auto-memory, logs
  agent/toolExec.ts          Tool implementations (files, commands, web, images, MCP)
  agent/history.ts           History repair, attachments to content, context compaction
  tools/web.ts / image.ts    DuckDuckGo search + page fetch; image breakdown (canvas analysis + Windows OCR)
  mcp/client.ts|manager.ts|catalog.ts   MCP STDIO and HTTP client; lifecycle, policies, tests; curated Free Toolbox
  store/projectStore.ts      <project>/.dahl memory and runs; store/reasoning.ts reasoning profiles
src/preload/index.ts         window.dahl.invoke + allow-listed events
src/renderer/src/            React UI: App (rail, views, palette), store.ts (zustand), themes*.ts (10 themes),
                             components/ (ChatPanel, Transcript, Composer, ApprovalCard, AgentsView, SettingsView,
                             ReasoningView, ToolboxView, McpCard, GitView, LogsView, CommandPalette, EditorArea, Explorer,
                             TerminalPanel, Views), ui-*.css
tests/                       dahl / agent / features (unit, 43); live.test.ts (real network, DAHL_LIVE=1)
```

Bundled MCP servers (`@modelcontextprotocol/server-filesystem`, `@playwright/mcp`) are real `dependencies`, unpacked from asar and run with Electron's own Node (`ELECTRON_RUN_AS_NODE=1`). All UI packages are devDependencies because Vite bundles them.
### Dahl API facts used (from `Dahl-Studio-Product-Pack/docs/Dahl_API_DOCS.md`)
- `GET /v1/models` (public) is where model IDs come from. Nothing is hard-coded.
- `POST /v1/chat/completions` is OpenAI-compatible, with `stream: true` for SSE and `tools` for function calling.
- `GET /tokens/current` (service root, Bearer key) returns the remaining tokens on that key. It is shown as the "provider-reported balance".
- Errors: 401 auth, 402 exhausted, 429 `model_concurrency` / `parallel_key_limit`, 400 "not currently offered", 5xx transient, `context_length_exceeded`.
- **No thinking/reasoning parameter is documented**, so the UI does not offer a thinking-depth selector. If a model streams `reasoning_content`, it is shown collapsed and labelled as model output.

### Failover policy (`dahl/router.ts`)
| Error | Action |
|---|---|
| 401, 402, 429 parallel limit | Mark key health, switch to the other key immediately |
| 5xx, timeout, network, 429 model_concurrency | Retry the same key up to 2 times (1s, 2s backoff, or Retry-After capped at 10s), then switch |
| 400 / model unavailable / context length | Never retried or switched; shown to the user |
| Any error after streaming has started | Not retried (would duplicate output) |

### Agent workflow (`agent/runner.ts`)
- **Modes:** Plan and Review are read-only (list/read/search/plan/remember). Build adds write_file, edit_file and run_command.
- **Approvals:** every write shows a side-by-side Monaco diff and needs approval; every command needs approval. Both can be switched to auto-approve in Settings (off by default). Path-boundary checks still apply with auto-approve on.
- **Isolation:** one active run per project. Different projects run concurrently with separate runs, memory and checkpoints.
- **Checkpoints:** the run manifest is saved after every step to `<project>/.dahl/runs/<id>.json`. On startup, runs left `running` are marked `interrupted` and never auto-resumed. "Continue" resumes, and dangling tool calls get synthetic "not executed" results.
- **Untrusted content:** tool output is redacted for secrets and the system prompt tells the model that file and command content is data, not instructions.
- **Completion report:** lists changed files and commands with exit codes, and says explicitly when changes were not verified.

### Where data lives
- `%LOCALAPPDATA%\DahlStudio\settings.json`: non-secret settings (theme, model, key names, open projects, approval policy)
- `%LOCALAPPDATA%\DahlStudio\secrets\{primary,secondary}.bin`: DPAPI-encrypted keys (base64)
- `%LOCALAPPDATA%\DahlStudio\usage\`: local usage measurements
- `%LOCALAPPDATA%\DahlStudio\logs\main.jsonl`: redacted logs
- `<project>\.dahl\`: memory.json, memory.md and runs/ (conversations = runs = checkpoints)

### IPC channels (main/ipc.ts)
`settings:get|update`, `keys:list|set|clear|test`, `usage:get|reset`, `models:list`, `project:pick|open|close`,
`fs:tree|read|write|create|search|reveal`, `git:status`, `term:start|stop`, `agent:start|pause|cancel|checkpoint|approve|pending|active|runs|loadRun|deleteRun`,
`memory:list|save|add`, `storage:report|open|clearLogs`, `app:info`. Events: `agent:event`, `term:event`, `keys:changed`, `usage:changed`.
Every fs, terminal and agent call checks that the project is in `settings.openProjects` (opened by the user through the folder picker).

## Releases and auto-update
- Source code and releases: https://github.com/Nexkeys/dahl-studio
- Installed apps check GitHub Releases for updates (electron-updater, `src/main/updater.ts`) and install them on restart.
- To publish a new version:
  1. Bump `version` in package.json.
  2. Add a CHANGELOG entry.
  3. Run `npm run typecheck; npm test; npx electron-vite build`.
  4. Run `$env:GH_TOKEN = (gh auth token); npx electron-builder --win nsis --publish always`.
- That uploads the installer, the blockmap and `latest.yml` as a release, and existing installs pick it up within about 4 hours or on next start.
- The app is unsigned, so Windows SmartScreen may warn on first install. A code-signing certificate removes that.

## PROGRESS.md (per project)
Dahl Studio keeps `PROGRESS.md` in each opened project (Settings toggle). It holds the current task, the plan and a task log. It is fed back to the model at the start of every task. Only the `<!-- dahl:... -->` sections are machine-managed.

## Adding a theme
Add a palette object (colours, syntax, font, radius, backdrop, glass, effect) to one of `src/renderer/src/themes-*.ts` and add the id to `ThemeId` in `src/shared/types.ts`. The UI (CSS variables) and the editor (Monaco theme and syntax colours) both pick it up.
