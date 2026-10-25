# Dahl Studio — Product Specification

## 1. Product vision

Create a premium, serious Windows coding workspace where a developer can ask Dahl to make real changes to local software, understand the proposed approach, inspect the affected files and diffs, approve or reject edits, run tests, and push work to GitHub. The experience should combine chat, editor, terminal, agent activity, and change review into one coherent working environment.

## 2. Non-negotiable principles

1. **Local-first storage.** No Dahl-hosted backend, hosted database, cloud sync, analytics service, or account system is required for the core app.
2. **Dahl is the only AI model provider.** Model requests go through Dahl's API. Other providers must not be silently added as fallbacks.
3. **Online model access, local workspace.** Internet access is expected for Dahl API calls and user-authorized integrations. Files, chat history, memory, plans, settings, task state, and locally observed usage records stay on the user's machine.
4. **User control.** File edits, shell commands, Git pushes, MCP tools, credentials, and potentially destructive actions follow explicit permission policies.
5. **Reviewable code changes.** The user should be able to inspect a proposed plan, affected file list, unified diff, test results, and risk notes before approving changes.
6. **No emoji in the product UI.** Use a consistent professional icon system and purposeful typography.
7. **A real Windows application.** Package and verify an installable desktop application; do not ship only a source folder or a script the user must manually launch.

## 3. Core workspace

- Project picker and local folder explorer.
- Editor with syntax highlighting, tabs, search, navigation, and diff/review mode.
- Integrated terminal with command history, running-process status, stop/cancel control, and approval prompts.
- Dahl chat panel that can be resized, collapsed, or expanded.
- Plan/task view showing steps, completion, pending permissions, failures, test results, and next actions.
- File-change panel showing created, modified, renamed, and deleted files plus line-level diffs.
- Agent/activity panel showing which role is active, which files/tools it is using, and its current status.
- Two or more projects can be open at the same time with separate context, files, permissions, and task state.
- Responsive pane layout that works at common Windows screen sizes; panels can be resized or collapsed.

## 4. Chat, planning, and visible reasoning

- User can ask for architecture, implementation, refactoring, security review, tests, debugging, code review, documentation, or research.
- Dahl creates an actionable plan for non-trivial tasks and displays what it intends to do before or while executing.
- Show an honest activity trace: current step, concise reasoning summary, tools called, files inspected, commands run, test outcomes, blockers, and next action.
- Do not represent private hidden chain-of-thought as a verbatim transcript. Provide concise decision summaries and verifiable execution traces instead.
- Provide thinking/effort modes only where supported by Dahl's documented API. The selector should show available modes and explain the practical difference (speed, depth, expected usage) without inventing unsupported modes.
- Streaming responses and progress updates should be supported where Dahl's API permits them.
- Permit the user to cancel a run, pause a run, save a checkpoint, and resume later with a “Continue” action.

## 5. Dahl API, models, and keys

- User enters Dahl API key(s) in a dedicated Settings/Connections area separate from normal coding.
- Discover and display models dynamically from the Dahl API's documented model listing/catalog mechanism. Refresh the list and present supported capabilities; do not hard-code undocumented IDs.
- Each model can expose only API-documented capabilities such as context limits, streaming, tool use, and thinking/effort parameters.
- Support primary and secondary Dahl API keys. Use the primary by default and fail over to the secondary according to explicit error policy and health state.
- Distinguish authentication failure, exhausted quota, rate limiting, transient server error, timeout, and model-not-found. Avoid blind repeated retries; show which key/route was used without showing the key itself.
- Display per-key app-observed calls, tokens, model, estimated or reported usage, errors, latency, last-used time, and health.
- If Dahl provides an authoritative account/key usage endpoint, show its values separately from locally observed usage. If it does not, label app-observed counts accurately and do not imply they are authoritative billing totals.
- Never send an API key into the model prompt, logs, project files, or Git history.

## 6. Local memory and persistent context

- Learn from prior project chats by extracting and saving durable facts: project purpose, stack, conventions, architecture decisions, known bugs, rejected approaches, important paths, test commands, and user preferences relevant to that project.
- Separate project memory from global preferences; the user can inspect, edit, remove, export, and reset memory.
- Use a local retrieval strategy over files and summaries; do not require a database or remote vector service.
- Do not treat every past message as a permanent fact. Track source, confidence, date, and potential staleness; let the user correct learned memory.
- Keep current-run context bounded: retrieve relevant memories and files rather than resending every prior chat to Dahl.
- Each project can have a visible `.dahl/` folder for project-specific memory, plans, checkpoints, and task manifests. This folder should be easy to include/exclude from Git.

## 7. Agent orchestration and long-running work

- Built-in roles can include Architect/Planner, Implementer, Debugger, Test Engineer, Code Reviewer, Security Reviewer, and Documentation Agent.
- Agents use Dahl models only and share the same task goals, approved scope, local file permissions, and evidence log.
- Multi-agent work must avoid uncontrolled concurrent writes: use file ownership/leases or staged patches, then merge/review changes centrally.
- Support work across two codebases simultaneously, with independent project state and explicit cross-project handoff when needed.
- Long-running tasks need persisted run manifests, ordered steps, tool logs, checkpoint files, resumable state, and clear recovery after app restart or a failed API request.
- The user can ask to save state and later say “Continue”; Dahl should resume from the last durable checkpoint, explain what is complete, and verify the working tree before continuing.
- Runs must support cancellation, pause/resume, retries within policy, and a visible failure/recovery path.

## 8. Git and GitHub

- Work with local Git repositories and user-selected GitHub remotes.
- Support inspect status/diff, create branch, stage, commit, configure remote, push a repository, and push updates to an existing repository.
- Show the exact files and commit message before commit; obtain explicit approval before pushing remote changes unless the user has deliberately changed the project-specific permission policy.
- Never overwrite an existing remote repo or rewrite published history without a clear, separate approval.
- GitHub authentication is a separate integration permission/credential from Dahl's model API key. Store it securely and never place it in model context.

## 9. MCP and external tools

- Provide a built-in, curated MCP directory with search, install, configure, test connection, enable/disable, update, and uninstall actions.
- Desired categories include video generation/editing (including the user's requested Higgsfield, InVideo, and ByteDance-related services where verifiable supported connectors exist), 3D modeling/design, software/app building, browser/search, GitHub, local filesystem, terminal, Supabase, and chief-of-staff/productivity tools.
- Only list an MCP as built-in/verified after its package, publisher, compatibility, and auth requirements have been checked. If a requested service has no maintained official MCP, make the gap clear and allow a vetted custom connector instead.
- MCP installations may require their own user credentials, software, subscription, or service access. This does not change the rule that Dahl is the only AI model provider.
- Permissions are configurable per MCP and per project: Ask every time, Allow for this project, or Deny. Higher-risk actions (delete, publish, deploy, spend money, push, or change production resources) should remain approval-gated by default.

## 10. Supabase and other project services

- Let the user connect a customer's own Supabase project from the local app using supported direct client/CLI/API authentication flows.
- Dahl Studio should not require the developer of Dahl Studio to host a proxy or database merely to offer this connection.
- Use only the credentials and permission level the user has authorized. Never reveal service-role keys to the model or put them in source control. Where a workflow would require a high-privilege key, explain the risk and use a guarded local process where possible.
- Similar direct integrations can be added through MCP or documented APIs, with separate secure credentials and explicit permissions.

## 11. Storage browser

Provide a Settings > Storage screen that shows:

- Dahl Studio app data location and an “Open folder” action.
- Per-project and global storage sizes.
- Chat/session history, memory, plans, checkpoints, logs, caches, and MCP configuration sizes.
- Export, backup, cleanup, retention controls, and delete options with confirmation.
- Clear distinction between Dahl Studio data and each project's source code.

## 12. Themes

Provide ten named themes. Theme selection changes the overall interface palette, surfaces, typography tokens, editor syntax palette, selection/cursor treatment, icon color/weight treatment, borders, focus states, and visual effects while preserving usability and accessibility.

1. **Studio Light** — warm whites, neutral grays, restrained sage/emerald accent; default.
2. **Hacker Mode** — near-black, terminal green, high-contrast code surfaces.
3. **Baddie Mode** — berry, blush, rose, polished high-fashion contrast.
4. **Vibe Coder** — lavender, violet, and cool neutral surfaces.
5. **Pen Tester** — graphite, red, and restrained amber risk signals.
6. **Midnight Terminal** — deep navy, blue-cyan accents, quiet luminance.
7. **Matcha Mode** — pale greens, muted sage, warm neutral editor surfaces.
8. **Cyberpunk Neon** — dark plum, electric cyan, controlled magenta accents.
9. **Solar Flare** — warm ivory, amber, coral, dark ink text.
10. **Blueprint** — deep technical blue, crisp pale surfaces, precise grid-like detailing.

Theme names are not permission levels and do not change security behavior. No theme should reduce legibility, conceal destructive actions, or use emoji as icons.

## 13. Design direction

- Premium, finished Windows desktop software; not a marketing website, futuristic concept screen, or generic AI dashboard.
- Start with the approved warm-light interface; do not force a dark theme as the default.
- Keep chat, editor, terminal, change review, and task activity integrated as one work surface.
- Use warm whites, quiet gray surfaces, fine borders, thoughtful spacing, precise typography, and one restrained accent per theme.
- Glass effects are limited to selected controls; never use glass as the whole application foundation.
- Use professional vector icons, consistent stroke weight, meaningful states, clear keyboard focus, accessible contrast, and useful empty/loading/error states.
- API keys and integrations live in separate settings screens, not in the middle of the coding flow.

## 14. Release target

Target a Windows x64 installable application with a signed or signable installer path, versioned releases, clean uninstall, and data-preserving updates. First run validation, unit/integration/security checks, packaging tests, and clean-install smoke tests must pass before publishing the installer. The requested Windows deliverable is `.exe` and/or MSIX; APK is for Android and is not the Windows package format.
