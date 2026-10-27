# Changelog

Every change, bug found, fix and verification result is recorded here, newest first.
Format: date, what changed, why, and evidence (the commands and results actually observed). Do not record anything as working unless it was run.

---

## 0.3.5 — 2026-10-27 — Faster streaming and startup, visual effects setting, renderer CSP, legacy cleanup

### Performance
- **Long replies slowed the whole app down while streaming.**
  - Cause: every token was its own store update, and the live reply re-parsed all of its Markdown each time. Measured on the dev machine (i7-10610U, React production build) with a 12,443-character reply: re-render cost 8.7 ms at 1,000 characters, 29 ms at 3,000, 81 ms at 6,000 and 148 ms at 12,000, per token. Tokens arrive every 15-30 ms, so the UI fell behind after about 2,000 characters.
  - Fix: tokens are buffered and applied every 60 ms (`store.ts` `flushDeltas`, flushed before any event that ends the live text). The live reply is split into top-level blocks (`Markdown.tsx` `splitBlocks` / `LiveMarkdown`), and finished blocks are memoized, so only the open block is re-parsed. `Transcript` is memoized, and `EditorArea` no longer subscribes to the whole project, so neither re-renders on stream updates.
  - Result, same benchmark with the real `splitBlocks`: 1,036 updates averaging 5.8 ms (worst 49.5 ms), about 6 s of rendering in total for the reply, down from about 150 s.
- **Startup:** Monaco is now loaded lazily (`lazyMonaco.ts`) when an editor or diff is first shown, or when the app is idle 1.5 s after startup. The startup bundle went from 8.8 MB to 1.45 MB of JavaScript. In the built app, `.monaco-editor` is absent before a file is opened and present after clicking `package.json`.
- **Visual effects setting** (Settings > Theme > Visual effects: Automatic, Full, Reduced). Reduced removes the backdrop blur that every theme applied to all panels, and the animated petals layer. Automatic uses Reduced when GPU compositing is not enabled (software rendering, many VMs, Remote Desktop) or the PC has 4 logical CPUs or fewer. The dev machine (8 threads, GPU) reports "full". Checked in the built app: with Reduced, `data-lite` is set and `.panel` computes `backdrop-filter: none`.

### Security
- **Content Security Policy for the packaged renderer** (`electron.vite.config.mts`, build only, because the dev server needs an inline Fast Refresh script). Only the app's own scripts, styles, fonts and workers load, so a Markdown image in a model reply can no longer fetch a remote URL. Verified in the built app: the meta tag is present, and startup, opening `package.json` (Monaco plus its JSON worker) and the Settings view gave 0 console errors.

### Verification
- typecheck 0 errors; vitest **53 passed**, including the new `tests/render.test.ts`. It checks that block splitting keeps code fences and indented list continuations whole, that earlier blocks never change as the text grows, that the split render gives the same HTML as a full render, and that buffered tokens land before the transcript event that clears the live text.

### Fixed
- **Taskbar showed Electron's atom icon instead of the Dahl icon**, on the development machine only.
  - The installed exe has the correct icon (verified by extraction).
  - Cause: smoke tests ran `node_modules/electron/dist/electron.exe` (atom icon) with the same AppUserModelId (`global.dahl.studio`) as the installed app, so Windows cached the atom icon for that ID.
  - Fix: dev and smoke runs now use `global.dahl.studio.dev`. On the affected machine the icon cache was refreshed with `ie4uinit.exe -show`.
  - End users who never ran dev builds are not affected.
- **The atom icon persisted after that fix** (user report, 2026-10-27). Refreshing the icon cache was not enough.
  - Real cause: Electron creates a Start Menu shortcut for toast notifications when none exists for the AppUserModelId. A pre-fix smoke run on 2026-10-25 08:14 (the notification test) created `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Electron.lnk`, which pointed at `node_modules\electron\dist\electron.exe` and carried `System.AppUserModel.ID = global.dahl.studio`. Windows takes the taskbar icon for an AppUserModelId from the shortcut that owns it, so it used this shortcut instead of `Dahl Studio.lnk`.
  - Checked with `Shell.Application` `ExtendedProperty('System.AppUserModel.ID')`: `Dahl Studio.lnk` (Start Menu and Public Desktop) and `Electron.lnk` all had `global.dahl.studio`.
  - Fix on the dev machine: moved `Electron.lnk` out of the Start Menu (backed up, not deleted) and ran `ie4uinit.exe -show`. The dev AppUserModelId above keeps it from coming back. Any new `Electron.lnk` will have `global.dahl.studio.dev`.

### Removed
- **The legacy Python/pywebview app** (`legacy-pywebview/`, including its PyInstaller exes) and the PyInstaller build leftovers committed under `build/DahlStudio/`. Neither was used by the Electron app or the installer. The legacy source is still in git history (commit `eb5104d`). `build/icon.ico` and `build/icon.png` stay, because electron-builder uses them.
- An unused `id` variable in `McpCard.tsx`, found with `tsc --noUnusedLocals --noUnusedParameters` (the only hit in either tsconfig).
- Local only (gitignored): old installers 0.2.0 to 0.3.3 and `release/win-unpacked`. The 0.3.4 installer and `latest.yml` are kept.

### Verified
- **Auto-update works end to end on the user's PC** (from the user's log):
  - 0.3.3 found 0.3.4 on GitHub Releases and made a differential download (4.5 MB of 130 MB, 213 changed blocks).
  - The user clicked Restart to install, and the app restarted as v0.3.4.

---

## 0.3.4 — 2026-10-25 — Smarter image vision assist, diff view fix (first auto-update test)

### Fixed (seen in the user's application log)
- **Image analysis tried the first "vision" model per provider and retried failures on every image**, flooding the log with errors: Anthropic invalid key, Gemini `*-flash-image` with zero free quota, NVIDIA `fuyu-8b` 404 for the account.
  - It now tries at most 2 candidates: the selected model if it accepts images, then one well-known vision model per provider (Claude Sonnet/Opus/Haiku, GPT-4o/4.1/5, Gemini x.y Flash excluding image/TTS/live variants, Llama 4 / Llama 3.2 Vision / Phi-4 multimodal / Gemma 3).
  - Providers whose key is marked auth-failed or exhausted are skipped. Failed models are not retried for the rest of the session.
  - Failures are logged as info ("unavailable, trying the next option"), not errors. OCR and pixel analysis still work without any vision model.
- **"TextModel got disposed before DiffEditorWidget model got reset"** (renderer console, from closing a diff review). DiffEditor now uses `keepCurrentOriginalModel` and `keepCurrentModifiedModel`.

### Note
- This is the first release published after an auto-updating build (0.3.3) was installed. The user's installed 0.3.3 should download it and offer "Restart to install".

---

## 0.3.3 — 2026-10-25 — Windows notifications; fixed release publishing

### Added
- **System notifications** (`main/notify.ts`, Settings toggle, on by default):
  - Notifies on: an approval request (shows the file, command or connector tool and which agent asked), a finished task, a failed task, a paused task (step limit or Pause), and a failed sub-agent.
  - Shown only while Dahl Studio is not the focused window. Bursts are de-duplicated, and the taskbar icon flashes until the window is focused.
  - Clicking a notification restores and focuses the window and switches to that project (`app:focusProject` event).
  - Settings has a "Send test notification" button. Verified in the built app: `Notification.isSupported()` and show returned true, with 0 errors.

### Fixed
- **The v0.3.2 GitHub release was incomplete** (only the blockmap was uploaded).
  - Cause: my PowerShell output filter (`Select-Object -First`) stopped the pipeline and killed electron-builder mid-upload, before the 127 MB installer and `latest.yml` were sent.
  - Fix: the broken v0.3.2 release and tag were deleted, and 0.3.3 was published with the output logged to a file instead.
  - Lesson for future agents: never pipe long-running publish commands through `Select-Object -First`.
- **Publishing 0.3.3**
  - `electron-builder --publish always` hit "422 Published releases must have a valid tag" (two parallel create calls raced), but the release and tag v0.3.3 were created.
  - `latest.yml` was not written locally, so I generated it (sha512 base64 of the installer, size, version) and uploaded the installer, blockmap and latest.yml with `gh release upload`.
  - Verified: https://github.com/Nexkeys/dahl-studio/releases/tag/v0.3.3 has all 3 assets, `releases/latest/download/latest.yml` downloads, and the installer URL returns 200 with the exact size (133,647,972 bytes).
  - Not yet verified: an installed 0.3.3 app actually auto-updating. That needs a newer release (0.3.4+) to exist.

---

## 0.3.2 — 2026-10-25 — Auto-update via GitHub Releases, PROGRESS.md work log

### Added
- **Auto-update** (`main/updater.ts`, electron-updater 6.8.11):
  - Checks GitHub Releases of `Nexkeys/dahl-studio` 15 s after start and every 4 h.
  - Downloads in the background. The status bar shows progress, then "Update X ready. Restart to install".
  - Nothing installs without the user restarting.
  - Disabled in dev and smoke mode.
  - Publish config is in `electron-builder.yml` (`provider: github`).
  - No Dahl server or database is involved: the app reads the public `latest.yml` release asset.
- **App-maintained PROGRESS.md** (`agent/progress.ts`, Settings toggle "Keep a PROGRESS.md work log", on by default):
  - At the start of every task: writes the current task section (request, mode, model).
  - Every `update_plan` is mirrored into the plan section.
  - At the end of every task: appends a detailed log entry (request, result, files changed, commands with exit codes, errors, next steps, stats).
  - At the start of every task, the file is fed back to the lead model so weak models keep context across sessions and "Continue" resumes the next steps.
  - Only marked sections are rewritten, so user notes are preserved. Old entries are archived to `.dahl/progress-archive.md` above 80 KB.
- **Verification nudge for weaker models:** if a Build turn changed files but ran no command, the model is asked once to verify (run build/tests, or read back and check the files) before finishing.

### Verification
- typecheck 0 errors; vitest **49 passed**. New tests cover PROGRESS.md creation, plan mirroring, the task log, read-back in the next task, and preservation of user notes.
- Secret scan before publishing: only fake test strings matched (`dahl_plaintextkey` and similar); no real keys in the repository.

---

## 0.3.1 — 2026-10-25 — Fixes from user testing of 0.3.0

### Fixed (user-reported)
- **Reasoning > New profile showed a blank page.** The selection effect reset the draft to null for the `__new` id. The draft is now kept. Verified in the built app: the editor opens with "My reasoning" and Save is enabled.
- **Rail tooltips (e.g. "Memory") rendered behind page content.** `.rail` had a backdrop-filter, which creates its own stacking context. It now has `position: relative; z-index: 50`.
- **Anthropic 400: "tool_use ids were found without tool_result blocks immediately after", then "unexpected tool_use_id" after Continue**
  - Cause: images returned by a tool (Playwright screenshot) were pushed as a user message between tool results. Anthropic requires every tool_result directly after its tool_use, before any other content. Continue then added a synthetic duplicate result.
  - Fix:
    - Images are queued and appended after all tool results of the step.
    - New `normalizeToolOrder()` moves results directly after their call, deduplicates, and drops orphan results.
    - The Anthropic adapter always puts tool_result blocks first.
  - Verified: the user's real failed run (98 messages) now converts to a valid Anthropic history, checked read-only.
- **"Lazy" models replied "Here it comes" and stopped without calling tools**
  - In Build mode, `announcesWork()` detects such endings (or a trailing ":") and nudges the model to act, at most twice per agent turn, with a log entry.
- **"Worked through 0 steps" blocks.** Groups without tools now show plain status lines; reasoning-only groups are labelled "Reasoning".
- **Confusing provider errors**
  - "No longer available" or deprecated models are classified as unavailable and removed from the dropdown automatically, with a clear message.
  - Gemini free-tier "limit: 0" now explains that Google gives no free quota for that model and suggests a Flash model or billing.
- **Playwright screenshots "didn't land in the project folder".** Playwright now uses `--output-dir ${project}/.dahl/browser`, and catalogue servers always use the current pinned catalogue arguments.

### Changed
- **Smoke mode is isolated:** it uses its own profile (`$DAHL_SMOKE/profile`) and skips the single-instance lock. Tests never touch the user's settings and can run while the installed app is open.

### Verification
- typecheck 0 errors. vitest **47 passed**; new tests cover the exact Anthropic failure sequence, the lazy-model nudge, image ordering and announce detection.
- Built-app smoke test (isolated profile): Reasoning > New profile works, 0 console errors.
- Installer: `release/DahlStudio-Setup-0.3.1.exe`.

### Notes on provider behaviour seen by the user (not app bugs)
- **Dahl "model at concurrency capacity":** Dahl admits paid accounts first at peak times. Switch model or retry.
- **Gemini 2.5 Pro "no longer available to new users", and quota 0 for 3.1 Pro on the free tier:** these are account and plan limits.
- **Weaker models** (free-tier Dahl models, Gemini Flash) follow tool instructions less reliably than Claude. The nudge and history repair reduce, but cannot remove, that difference.

---

## 0.3.0 — 2026-10-25 — Multi-provider, agents, toolbox, reasoning panel, chat rework

### Bugs reported by the user (from their real test) and fixed
- **Task stuck in "400 Unterminated string" forever**
  - Cause: the model's `write_file` call for a large file was cut off mid-output, so its arguments were invalid JSON. That broken call was stored in history and re-sent on every turn, so every request, including "Continue", was rejected.
  - Fix:
    - `repairHistory()` (agent/history.ts) replaces invalid arguments with valid placeholders on every resume.
    - The runner sanitises invalid arguments before storing them.
    - The model gets a clear tool error telling it to split the content.
    - New `append_file` tool for writing large files in chunks.
    - `finish_reason=length` triggers an automatic "continue where you stopped".
  - Test: `features.test.ts` simulates an API that rejects invalid history.
- **`$` variables "stripped" in commands**
  - Cause: the model wrapped commands as `powershell -Command "..."` inside our PowerShell, so the outer shell expanded `$f` inside the double quotes.
  - Fix: `unwrapPowershell()` removes the wrapper, and the tool description and system prompt now say commands already run in PowerShell.
- **Ugly cumulative "Files changed... Commands run..." line after every message**
  - Cause: the completion report used totals for the whole conversation.
  - Fix: a per-turn `summary` item rendered as compact chips (files, commands, memory, duration). It expands on click and has a Revert button.
  - Tool steps are now grouped into one collapsible "Worked through N steps" block.
- **Raw `**markdown**`, emoji and leaked `</｜DSML｜tool_calls>` tokens in replies**
  - Markdown is now rendered with react-markdown and GFM (no raw HTML), with copyable code blocks.
  - `cleanModelText()` strips emoji and leaked special tokens, and the system prompt asks for no emoji.
- **Memory never saved**
  - Added auto-memory: after a meaningful turn, one small model call extracts up to 3 durable facts, deduplicated and redacted (Settings toggle, on by default).
  - The prompt now pushes the model to use `remember`.
- **Key Test showed raw JSON**
  - Now shows "Connected (HTTP 200)" with a readable summary, e.g. "N tokens remaining on this key" from `/tokens/current`, or "N chat models available" for other providers.
  - Failures show the HTTP status and reason.
- **Model claimed it cannot see images**
  - Added image attachments (picker, paste, drag-drop), `view_image` for vision models, and `analyze_image` for any model.
  - `analyze_image` combines canvas pixel analysis (size, palette, 6x6 layout grid with detail density), the built-in Windows OCR (text with positions) and an optional description from a vision model the user has configured.

### Bugs found by me during this session
- **React error #185 (infinite render loop) at startup**
  - Cause: zustand selectors returned new arrays (`?? []`, `.map().filter()`) on every render.
  - Fix: stable empty constants, and arrays are now derived outside the selectors.
- **Windows OCR script failed with "Cannot convert Object[] to Int32"**
  - Cause: in PowerShell 5.1, WinRT `BoundingRect` access returned a collection.
  - Fix: explicit `@(...)[0]` indexing.
  - Verified: it read "Dahl Studio OCR" from a generated image.
- **Filesystem capability test failed only because the expected string was case-sensitive.** Fixed: it now expects "Allowed directories".
- **Final answer hidden in the reasoning section (seen in a live Dahl call)**
  - MiniMax-M2.7 once returned its final answer only in `reasoning_content`, with empty `content`, and then degenerated into one Chinese phrase repeated many times.
  - Fix: the answer is promoted out of the reasoning when `content` is empty and there are no tool calls, and `trimRepetition()` collapses repeated phrases. Both have tests.
- **Playwright MCP wrote `.playwright-mcp/` snapshots into the user's project.** STDIO servers now run from `%LOCALAPPDATA%\DahlStudio\mcp\work`.

### Added
- **More AI providers alongside Dahl**, by user request (this overrides the original "Dahl only" spec line):
  - OpenAI, Anthropic (native Messages API adapter, `providers/anthropic.ts`), Google Gemini (OpenAI-compatible endpoint, falling back to the native model list) and NVIDIA NIM.
  - Model IDs are namespaced as `provider:model`. Dahl keeps two-key failover. There is no silent cross-provider fallback.
- **Automatic model discovery** (`providers/registry.ts`): on start, when a key is saved, on Refresh and every 30 minutes. Newly enabled models appear automatically, flagged "New". Each model shows vision and native-reasoning capability.
- **Thinking levels: Fast, Light, Balanced and Deep.**
  - Native controls:
    - OpenAI and Gemini: `reasoning_effort`.
    - Anthropic: `thinking` (adaptive plus `output_config.effort`, or a token budget), with thinking blocks replayed through `providerBlocks`.
    - NVIDIA: `chat_template_kwargs.enable_thinking`.
  - If a model rejects the reasoning parameter, the request is retried once without it.
  - For Dahl (no documented parameter), the setting adds app-level thinking guidance and a larger step budget, and the UI labels it that way.
  - Inline `<think>` blocks are split out into reasoning.
- **Reasoning panel** (`store/reasoning.ts`, `ReasoningView`):
  - Ships with a default "Dahl Engineering" profile plus presets: Cybersecurity Analyst (red team), Strict Code Reviewer, Architect, Performance Engineer and Patient Teacher.
  - Profiles can be edited, created, duplicated, reset and deleted, and set globally or per project.
  - The active profile is injected into every request and every sub-agent.
- **Sub-agents**:
  - New `delegate_agents` tool with roles Architect, Implementer, Debugger, Test Engineer, Code Reviewer, Security Reviewer and Researcher. They run in parallel.
  - Write-capable agents hold file leases, so another agent cannot edit their files. Read-only roles cannot write.
  - Reports go back to the lead agent.
  - Live agent cards appear in the chat, plus an Agents view, and the status bar shows a running count.
- **Web research**: `web_search` (DuckDuckGo HTML endpoint, no key) and `web_fetch` (HTML to readable text), controlled by the Web toggle in the composer. Retrieved content is marked untrusted.
- **Composer upgrades**:
  - Attach files, folders (bounded tree and contents digest) or images.
  - Paste or drag images.
  - `@` to attach a project file.
  - `/` for Skills (12 templates, e.g. /security, /review, /ui, /research).
  - Mode and thinking selectors.
  - Ctrl+L in the editor attaches the selection.
- **Dahl Free Toolbox (MCP)**:
  - `mcp/client.ts` supports STDIO and Streamable HTTP transports. `mcp/manager.ts` handles the lifecycle:
    - Servers start on demand, never with the app, and crash or disconnect is detected.
    - Each server has logs, an approval policy (ask / auto-allow read-only / allow) and a project-boundary check on path arguments.
    - Secrets live in DPAPI and are never placed in prompts. Child environments never include AI keys.
    - Import and export never include secret values. Imported servers start disabled.
  - Curated catalogue (`mcp/catalog.ts`) with classifications, permissions, risks and pinned versions.
  - Filesystem and Playwright are **bundled**: they run on Electron's own Node with `ELECTRON_RUN_AS_NODE`, so no Node.js install is needed. Playwright uses the installed Microsoft Edge.
- **Source Control view**: status, HEAD-vs-working diff in Monaco, commit all (with confirmation), new branch, set or inspect the remote, and push (with confirmation; never forced, with clear authentication and rejection messages).
- **Logs view**: per-task logs (stored in the run JSON, secrets redacted) and the application log, with an errors-only filter and copy.
- **Revert**: restores the files a turn changed, from backups taken before the first change.
- **Command palette** (Ctrl+K): quick-open files, navigation, modes and themes.
- **10 full themes**: Dahl Classic, Hacker Mode, Baddie Mode, Vibe Coder, Pen Tester, Midnight Terminal, Sakura Flow, Arctic Focus, Forest Syntax and Solar Flare.
  - Each has its own palette, Monaco syntax colours, UI font, corner radius, background treatment, panel translucency and an effect: CRT scanlines with phosphor glow, accent glow, frosted glass, tactical uppercase labels, drifting petals, frost borders or grain.
  - Settings shows a live mini-UI preview card for each.
- **More motion**: message reveal, shimmer "Thinking" and "Working" states, elapsed timer, hover lift on cards, rail tooltips, smooth theme transitions. Respects reduced-motion settings.
- **Code layout**: `main/index.ts` is split into `services.ts` (wiring) and `ipc.ts` (handlers). The runner is split into `runner.ts`, `toolExec.ts` and `history.ts`.

### Verification (actually run)
- `npm run typecheck`: 0 errors. `npx vitest run`: **43 passed** (plus 9 live tests skipped unless `DAHL_LIVE=1`).
- **Live tests** (`$env:DAHL_LIVE=1; npx vitest run tests/live.test.ts`), real network and real servers: **all 9 passed**.
  - Built-in web search returned real DuckDuckGo results, and web_fetch read example.com.
  - Windows OCR recognised the text.
  - MCP real capability calls:
    - Filesystem `list_allowed_directories`
    - DuckDuckGo `search` (returned modelcontextprotocol.io)
    - Playwright `browser_navigate` to example.com in Edge
    - Git `git_status`
    - Fetch `fetch`
  - The filesystem MCP call reading `C:\Windows\win.ini` was blocked by Dahl's boundary check.
- **Packaged app** (`release/win-unpacked`):
  - Bundled Filesystem (14 tools) and Playwright (25 tools) both passed real capability tests through IPC, so no Node.js install is needed.
  - 0 renderer console errors.
- **Live Dahl chat in the built app** (user's saved key, MiniMax-M2.7, Plan mode): streamed, called list_dir and read_file, completed, and the summary and log were written. This run exposed the reasoning-only-answer issue fixed above.
- `electron-builder`: `release/DahlStudio-Setup-0.3.0.exe` (126.9 MB, unsigned).

### Not verified / limitations
- **OpenAI, Anthropic, Gemini and NVIDIA chat** have not been tested live (no keys here). The adapters are unit-tested for message conversion only. Gemini docs pages could not be fetched during research, so its endpoint usage is from prior knowledge, with a native fallback for listing models.
- **Not exercised end to end:** a sub-agent run against a real model, the Revert button through the GUI, Git push to a real remote, and Supabase, Godot and ToolDash (catalogued but not capability-tested).
- The test runs added Filesystem and Playwright entries, disabled and with passing tests, to the user's MCP config. One test run left a vibe-coder theme in the user's settings; the original settings were restored from backup afterwards.
- No clean-machine install test. — Rewrite on Electron + React + TypeScript + Monaco (core scope)

### Audit of the previous implementation (legacy-pywebview/)
- **What existed:** Python + pywebview (`main.py`, `backend.py`, about 490 lines), vanilla `ui/` (HTML/JS/CSS) and an 18 MB PyInstaller `DahlStudio.exe`.
- **Likely causes of the reported startup freezes, from reading the code.** The freeze was not reproduced, because the legacy exe was not run.
  1. `main.py` passes `js_api=DahlAPI()` and then `api.set_window(window)`, so the exposed API object holds a reference to the pywebview `Window`. pywebview walks the attributes of `js_api` to expose them to JS, and a `Window` reference in there is a known cause of hangs and recursion during bridge setup.
  2. `backend.select_folder()` falls back to creating a `tkinter.Tk()` root from a pywebview worker thread. Tk is not thread-safe off the main thread, so it can deadlock or hang.
  3. `run_command` uses blocking `subprocess.run(timeout=30)`, and agent calls use non-streaming `requests.post(timeout=60)`. Long calls block the bridge and give no progress.
- **Decision:** migrate rather than patch. The codebase was small and none of it was reusable as-is in the target architecture. The legacy code was moved untouched to `legacy-pywebview/` for reference.

### Added
- **Project scaffold:** electron-vite 6, Vite 8, React 19, TypeScript 7, Monaco 0.57, electron-builder 26, vitest 5 and Electron 45. Main, preload and renderer are strictly separated: `contextIsolation`, `sandbox`, no `nodeIntegration`, and window navigation is blocked.
- **Dahl API adapter**, built only from the documented contract: model discovery, SSE streaming with tool-call delta assembly, `reasoning_content` passthrough, key balance, and typed error classification.
- **Two-key failover router:** bounded retries, no retry on invalid requests, no failover after a stream has started.
- **Secret vault:** Electron `safeStorage` (Windows DPAPI). It refuses to store keys if encryption is unavailable. Keys never reach the renderer, logs, model context or child processes. `redact()` scrubs `dahl_…`, Bearer, `ghp_…` and `sk-…` patterns.
- **Local usage ledger,** labelled in the UI as local measurement with an "includes local estimates" flag when the API did not return a `usage` field. Provider balance comes from `GET /tokens/current` and is shown separately.
- **Workspace:** a path-boundary guard covering `..`, absolute paths, other drives and symlink escapes; lazy file tree; text search; atomic writes.
- **Agent runner:**
  - Plan, Review and Build modes; tools for list, read, search, plan, remember, write, edit and run_command.
  - Approval gating, with a Monaco side-by-side diff for writes.
  - Pause, cancel and checkpoint after every step; resume with "Continue".
  - Interrupted-run detection on startup with no auto-resume.
  - Context compaction, and an honest completion report.
- **Project memory** in `<project>/.dahl/memory.json` with a Markdown mirror. Keyword-ranked retrieval sends at most 12 relevant entries; pinned entries are always included.
- **UI:**
  - Nav rail, project tabs (up to 4 open projects, each with its own state), resizable and collapsible Explorer, Editor, Terminal and Chat panels.
  - Monaco tabs with Ctrl+S; command terminal with history and Stop.
  - Settings (keys, models, approvals, theme), Tasks, Memory (edit, pin, delete, export, clear), Storage (real on-disk sizes, open location, clear logs, reset counters).
  - Toasts, and empty, loading and error states throughout.
- **Themes:** Dahl Classic (default, warm light, green accent matching the design reference) and Midnight Terminal (dark). Each theme drives both CSS variables and a Monaco theme with its own syntax palette. Persisted, and switches without restart.
- **Branding:** the real reference icon was cropped to the rounded square with transparent corners and exported as `build/icon.ico` (16–256 px), `build/icon.png`, `resources/icon.png` and the in-app icon. The real wordmark is shown on the Welcome screen, with its background made transparent by un-blending against the paper colour. Nothing was redrawn, no placeholders were used, and Lucide icons are used throughout with no emoji.
- **Smoke-test mode** (`DAHL_SMOKE`, `DAHL_SMOKE_CLICK`): loads the built app, records renderer console errors, captures a screenshot, writes `smoke.json` and quits.
- **Tests:** `tests/dahl.test.ts` and `tests/agent.test.ts`, 27 tests in total.

### Bugs and problems found and fixed during this session
- **TypeScript 7 rejected `baseUrl` in tsconfig** (TS5102/TS5090). Removed `baseUrl` and made `paths` relative (`./src/shared/*`).
- **Vite warned that ESM config files were loaded as CJS.** Renamed `vitest.config.ts` to `.mts` and `electron.vite.config.ts` to `.mts`.
- **The Electron binary was missing after `npm install`** (the postinstall download had not run, so `node_modules/electron/dist` did not exist). Ran `node node_modules/electron/install.js`.
- **The wordmark rendered as a visible grey box** on the welcome screen, because the source PNG has a blurred halo background. Fixed with a tighter crop plus alpha un-blending (threshold L<226). Verified on a contrasting background.
- **`npm run typecheck` failed on `tests/agent.test.ts`** (TS2339: a closure-assigned `let pending` was narrowed to `never`). Fixed with `let pending = null as PendingApproval | null`. The tests themselves already passed; only the typecheck was affected.
- **react-resizable-panels v4 changed its API** (`Group`/`Panel`/`Separator`, `orientation`; number = px, string = %). Code was written against the installed type definitions rather than the v2 API.
- **Smaller installer:** all packages were moved to devDependencies, because Vite bundles the renderer and the main process has no runtime npm deps. Result: no node_modules inside the asar.

### Verification (actually run)
- `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json`: 0 errors.
- `npx vitest run`: 27/27 passed. Covers:
  - Error mapping and SSE parsing (text, reasoning, tool-call deltas, usage); request shape and Bearer header; cancellation.
  - Failover on 401 and 402; transient 503 retry; switching after retries are exhausted; no retry on 400; no key configured; secondary key only.
  - Path guard (traversal, absolute, other drive). Writes stay untouched until approval; rejection keeps the file and passes feedback to the model; commands need approval; writes outside the project are blocked even with auto-approve; plan mode denies writes.
  - Concurrent-run rejection in the same project while another project still runs; checkpoint, interrupted and Continue resume; secrets redacted from tool output.
  - Dangling tool-call repair, memory ranking, corrupt JSON recovery, encrypted key storage that refuses plaintext, redaction patterns, DAHL_* stripped from the child env.
- `npx electron-vite build`: OK. Renderer bundle is about 8.1 MB, mostly Monaco.
- Built-app smoke tests, all with **0 renderer console errors**:
  - Welcome screen: renders, and the model list is fetched live from `GET /v1/models` (MiniMaxAI/MiniMax-M2.7, zai-org/GLM-5.3-Flash, deepseek-ai/DeepSeek-V4-Flash-0731). Load about 0.9 s plus the 4 s probe wait.
  - Project open: explorer tree, terminal and chat panel render.
  - Midnight Terminal theme, opening `tsconfig.web.json` by clicking the tree: Monaco renders with local workers and the theme's syntax colours.
- `npx electron-builder --win nsis`: produced `release/DahlStudio-Setup-0.2.0.exe` (119.7 MB, x64, **unsigned**, no certificate available).
- Silent install (`/S /D=%TEMP%\opencode\DahlInstall`): exit 0. The installed exe has the Dahl icon (extracted and inspected). The installed app's smoke test showed 0 console errors.
- Silent uninstall: removes the install folder. Note that the NSIS uninstaller relaunches itself, so the files disappear a few seconds after the process returns.

### Not verified / blocked
- **Live chat, streaming, tool calling and key failover against the real API:** no Dahl API key was available in this environment. The adapter is covered by mocked-HTTP unit tests only. Needs one run with a real key (see PROGRESS.md).
- **The full approve-and-apply flow through the GUI:** covered by runner unit tests, but not clicked through in the GUI, which needs a key.
- **Clean-machine install:** not tested. The install was on the development machine only.
- The terminal is a command runner, not a PTY. Interactive TTY programs are not supported.
