# Dahl Studio — Architecture and Security Decisions

## 1. Proposed desktop architecture

**Recommended starting point:** Electron + React + TypeScript, with Monaco Editor for code editing and a dedicated local runtime/orchestrator in the Electron main process or a tightly controlled child process. This suits a desktop product that needs broad Windows filesystem access, terminals, Git, MCP stdio servers, and a mature installer ecosystem. Keep Electron renderer privileges limited.

Suggested layers:

- **Renderer/UI:** workspace, chat, editor, diff viewer, terminal view, model selector, task/agent monitor, theme manager, settings and storage browser.
- **Typed IPC boundary:** an explicit allowlist of commands/events between UI and privileged local runtime. Validate payloads and authorize every filesystem/process operation.
- **Workspace service:** selected folders, project boundaries, file reading/writing, file watchers, ignore rules, change staging and conflict detection.
- **Agent orchestrator:** task state machine, plans, role assignment, API calls, tool routing, checkpoints, retries, cancellation and resume.
- **Dahl adapter:** the only LLM provider adapter; endpoint/auth/schema are based on Dahl's actual docs.
- **Local tool runner:** Git, shell commands, tests, builds, and MCP process supervision with bounded permissions and approval gates.
- **Persistence service:** file-based storage only; no SQL database, embedded database, hosted database or cloud persistence.
- **Integration adapters:** GitHub, Supabase, browser/web, and MCP connectors; each owns its own credential and permission handling.
- **Packaging/update layer:** Windows installer, upgrade/uninstall behavior, diagnostics and release verification.

## 2. Storage layout

A proposed user-visible layout:

```text
%LOCALAPPDATA%/Dahl Studio/
  settings.json
  themes.json
  models-cache.json
  chats/
    <conversation-id>.jsonl
  memory/
    global.md
    projects/<project-id>.md
  tasks/
    <run-id>/
      plan.md
      state.json
      events.jsonl
      checkpoints/
  usage/
    key-1.jsonl
    key-2.jsonl
  logs/
  mcp/
    registry.json
    configs/
  exports/
```

Each selected project can also contain:

```text
<project-root>/.dahl/
  project.md
  architecture.md
  decisions.md
  tasks/<run-id>/plan.md
  tasks/<run-id>/checkpoint.json
```

Use flat files (Markdown, JSON, JSONL and ordinary generated patch files) with atomic writes and versioned schemas. This is deliberately file-based; do not replace it with SQLite, IndexedDB persistence, or a remote store. If the user chooses not to have a `.dahl/` folder inside a repository, save project state in the global local folder and keep a mapping in local configuration.

Do not assume that Windows Local AppData is the only place the user wants project artifacts: expose the storage root in Settings and support opening/exporting it. The app should not silently move or delete source projects.

## 3. Credential handling

- Keep Dahl API keys in Windows Credential Manager/DPAPI-backed secret storage, not plain-text JSON or project files.
- Keep non-secret key metadata in local files (label, masked suffix, enabled state, priority, last-used time).
- Never log full authorization headers or key values. Redact secrets from crash reports and diagnostics.
- GitHub, Supabase and MCP credentials are separate integration credentials. They may be needed even though Dahl is the only AI model provider. Keep each credential scoped to its intended integration and project.
- Never place secrets in prompts, chat history, agent handoff payloads, source code, commits, or generated reports. Exclude `.env`, credential files, private keys, and common secret paths from context scanning by default.

## 4. API key fallback and usage accounting

- Choose the primary enabled key by priority.
- Fail over to the secondary key only on defined conditions (e.g. primary key unauthorized/disabled, exhausted quota, rate limit where policy permits, transient endpoint failure after bounded retry, timeout).
- Do not treat bad request/model-not-found/invalid parameter errors as a reason to loop indefinitely. Surface the failure and show safe diagnostic details.
- Respect `Retry-After` or equivalent documented headers if Dahl exposes them.
- Do not concurrently spend both keys for the same generation by default. Parallel calls are a separate deliberate agent-routing decision, not fallback.
- Count app-observed requests, token usage reported in responses, estimated tokens where necessary, latency, model, errors and which masked key was used.
- Clearly distinguish app-observed usage from provider-account billing totals. Exact key-level billing totals require a documented authoritative Dahl usage endpoint; never invent them from estimates.

## 5. Thinking and transparency

Show the task plan, concise rationale/decision summaries, live progress, tool calls, files read/changed, commands, output excerpts, test results and approvals. Do not build a “raw thoughts” dump or promise verbatim private chain-of-thought. Actual effort/reasoning mode controls must map to supported Dahl API parameters only.

## 6. File and process safety

- Grant folder access explicitly; show the selected root and the exact write scope.
- Default to proposing a patch/diff before write operations. Track the original file hash so external edits during a run are detected instead of overwritten.
- Require approval for destructive or high-impact actions: delete files, overwrite large sets of files, install dependencies, run untrusted scripts, push to GitHub, deploy, change production resources, alter permissions, or use a connector with high privileges.
- Provide project-level Ask / Allow for this project / Deny policies for tool classes. Offer a one-run override rather than requiring broad permanent access.
- Shell commands must be visible, cancellable, logged with secret redaction, and run with a working directory and timeout/resource policy.
- Do not permit a model or MCP server to silently expand its own permissions.
- Before pushing, show remote URL, branch, commits, diff summary, and whether the remote already contains content.
- For MCP, store version/publisher/command/arguments/permissions; verify package source and require user consent before installing or updating executables.

## 7. Multi-agent concurrency

Agents should not write independently to the same file at the same time. Allocate file ownership or patch branches, collect proposed patches, detect overlapping edits, and use a central merge/review stage. Two concurrently active projects must have separate roots, memory, run logs, permission scopes, Git context, and active terminals.

## 8. Supabase and external integrations

Dahl Studio itself needs no hosted server to access a user's Supabase project. It can use locally executed SDK/CLI/API flows with the user's authorized credentials. Avoid service-role secrets in the model context; when an operation truly requires elevated credentials, execute it locally behind a narrow tool boundary, explain the capability and require explicit approval.

A local desktop client can connect to a third-party service only if that service exposes a supported API/auth mechanism and the user has access to it. The app should not pretend that any particular named MCP exists until its official or maintained implementation has been verified.

## 9. API-doc dependency

The actual Dahl API documentation is required to implement and test:

- base URL and API version;
- authentication header/key format;
- model catalog/listing;
- streaming protocol;
- tool/function calling schema;
- effort/thinking parameters and reasoning summaries (if provided);
- token usage response fields;
- quota, rate-limit, model failure and retry semantics;
- authoritative usage endpoints, if any.

Do not create endpoints or parameters from assumption. Until documentation is available, keep the provider adapter isolated behind an interface and test it using fixtures/mocks.
