# Progress / Handoff

Last updated: 2026-10-25 (end of session 2, v0.3.0). Read README.md, then CHANGELOG.md, then this file.

## Status by area
| Area | Status |
|---|---|
| Electron/React/TS/Monaco foundation, installer | Done. v0.3.0 installer built; v0.2 install/uninstall verified |
| Dahl API (models, SSE, tools, 2-key failover, balance test) | Done; live chat verified in built app |
| OpenAI / Anthropic / Gemini / NVIDIA | Implemented, unit-tested; **not live-tested (no keys)** |
| Auto model discovery (+ New badge, 30 min refresh) | Done (Dahl verified live; NVIDIA list endpoint public) |
| Thinking levels (native per provider; app-level for Dahl) | Done |
| Chat UX (markdown, grouped activity, per-turn summary, revert, live states) | Done, screenshot-verified |
| Attachments (files/folders/images, paste, @mentions, Ctrl+L) | Done |
| Image understanding (view_image / analyze_image with OCR) | Done; OCR live-verified |
| Reasoning panel (default + presets, per project) | Done, unit-tested |
| Sub-agents + Agents view | Done, unit-tested with scripted model; not yet run against a live model |
| Web research (built-in DuckDuckGo search + fetch) | Done, live-verified |
| MCP manager + Free Toolbox | Done; Filesystem, Playwright, DuckDuckGo, Git, Fetch capability-verified |
| Source Control view | Done; push not tested against a real remote |
| Logs view (per task + app) | Done |
| 10 themes with effects + preview cards | Done |
| Command palette, skills | Done |

## Next steps (suggested order)
1. With real keys: live-test OpenAI, Anthropic, Gemini and NVIDIA chat with tools and images, and fix any adapter mismatch (`providers/registry.ts`, `providers/anthropic.ts`). Add the results to CHANGELOG.
2. Live-test a delegate_agents run (for example `/review`) on Dahl and check the Agents view.
3. Capability-test ToolDash (needs npx) and Godot (needs Godot). Supabase needs a user account and token.
4. Worktree isolation for parallel *write* agents in the same project (currently file leases).
5. GitHub auth helper (device flow) for push without a pre-configured credential manager.
6. Clean-machine install test; code signing certificate.

## Notes for the next agent
- Keep each file write small (under about 250 lines). Long single writes were getting cut off in this environment.
- zustand selectors must not return new arrays or objects (this caused React #185). Derive values outside the selector.
- Smoke mode: `DAHL_SMOKE=<dir>`, optional `DAHL_SMOKE_JS` (runs in the renderer, can call `window.dahl.invoke`), `DAHL_SMOKE_JS_WAIT`, `DAHL_SMOKE_CLICK`. It writes `smoke.json` and `smoke.png`.
- Smoke runs use the real `%LOCALAPPDATA%\DahlStudio\settings.json`. Back it up and restore it afterwards.
- Live tests: `$env:DAHL_LIVE=1; npx vitest run tests/live.test.ts` (needs network, uvx and npx).
