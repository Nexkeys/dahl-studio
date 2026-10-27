# Progress / Handoff

Last updated: 2026-10-27 (v0.3.5 released). Read README.md, then CHANGELOG.md, then this file.

## Status by area
| Area | Status |
|---|---|
| Electron/React/TS/Monaco foundation, installer | Done. v0.3.5 installer published; v0.2 install/uninstall verified |
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
| Sub-agents + Agents view | Done, unit-tested with scripted model; not yet run against a live model |
| Web research (built-in DuckDuckGo search + fetch) | Done, live-verified |
| MCP manager + Free Toolbox | Done; Filesystem, Playwright, DuckDuckGo, Git, Fetch capability-verified |
| Source Control view | Done; push not tested against a real remote |
| Logs view (per task + app) | Done |
| App-maintained PROGRESS.md work log for user projects | Done, unit-tested |
| 10 themes with effects + preview cards | Done; Visual effects setting (Automatic / Full / Reduced) for slow PCs |
| Streaming and startup performance | Done (0.3.5): batched tokens, block-memoized live Markdown, lazy Monaco. Benchmarked, smoke-verified |
| Renderer CSP (packaged build) | Done (0.3.5); smoke-verified with 0 console errors |
| Command palette, skills | Done |

## Next steps (suggested order)
1. With real keys: live-test OpenAI, Anthropic, Gemini and NVIDIA chat with tools and images, and fix any adapter mismatch (`providers/registry.ts`, `providers/anthropic.ts`). Add the results to CHANGELOG.
2. Live-test a delegate_agents run (for example `/review`) on Dahl and check the Agents view.
3. Capability-test ToolDash (needs npx) and Godot (needs Godot). Supabase needs a user account and token.
4. Worktree isolation for parallel *write* agents in the same project (currently file leases).
5. GitHub auth helper (device flow) for push without a pre-configured credential manager.
6. Clean-machine install test; code signing certificate.
7. Not yet observed: a long streamed reply from a real model in the built app with the new batching (it is benchmarked and unit-tested only). Also not done: transcript virtualization for very long chats.

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
