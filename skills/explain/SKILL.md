---
name: explain
description: Explains how a project, folder or file works (purpose, architecture, main modules, data flow, how to run and test it), citing file paths. Read-only. Use when the user asks how something works, what a file does, or wants a tour of unfamiliar code.
argument-hint: "<file, folder, feature or question; empty for the whole project>"
metadata:
  dahl-mode: review
  dahl-icon: book
---

# Explain the code

Target: $ARGUMENTS

If the target is empty, explain the whole project at the top level. If it names a file, folder, function or feature, explain that and how it connects to the rest. If `search` cannot find what it names, say so and list the closest matches instead of guessing.

## When to use
- "How does this project work?", "What does src/sync.ts do?", "Walk me through the login flow."
- Before changing unfamiliar code, to build a correct picture first.
- The user wants to know how to run, build or test the project.

## When not to use
- The user wants findings, risks or a quality verdict: use `review` (or `security` for security questions).
- The user wants a written onboarding guide for the repo: use `onboard-project`. Writing or updating README files: use `docs`.
- The user only wants to know where something is defined: use `find`.
- Something is broken: use `fix`, or `debug-stack-trace` when there is a stack trace.

## Mode
Read-only. Works in any mode. Use only `list_dir`, `read_file`, `search`, `git` read actions and `remember`. Do not edit files and do not run commands; reading the code is enough to explain it.

## Checklist
1. `update_plan` with: map the project, find entry points, trace a flow, write the explanation.
2. Map the project:
   - `list_dir` the root and the main source folder (`src/`, `app/`, `lib/`, `packages/*`, `cmd/`, the Python package folder).
   - `read_file` the manifest: package.json (scripts, dependencies, `main`, `bin`, `exports`, `workspaces`), pyproject.toml or requirements.txt, go.mod, Cargo.toml.
   - Read the README if there is one, but trust the code over the prose.
3. Find the entry points:
   - package.json `main`, `bin`, `scripts.dev` and `scripts.start`; `src/main.ts`, `src/index.ts`; Next.js `app/layout.tsx` and `app/page.tsx`; Electron main process file (the `main` field) vs renderer.
   - Python: `main.py`, `app.py`, `manage.py`, `[project.scripts]` in pyproject.toml. Go: `cmd/*/main.go`.
   - `search` for `listen(`, `createServer`, `createRoot(`, `app = FastAPI`, `Flask(__name__)`, `if __name__ == "__main__"`.
4. For a file or module target: `read_file` it fully. `search` its exported names to find callers, and read its imports to find dependencies. One level out in each direction is usually enough.
5. Trace one representative flow end to end (a request, a user action, a CLI command): entry point, routing, business logic, storage or external call, response. Note `file:line` at each hop.
6. Configuration: `search` for `process.env.`, `import.meta.env.`, `os.environ`, `os.getenv`, and read `.env.example` (never `.env` values), plus config files such as vite.config.*, next.config.*, tsconfig.json paths, settings.py.
7. Run and test: collect the real commands from package.json scripts (dev, build, start, test, lint, typecheck), Makefile targets, pyproject `[tool.pytest.ini_options]`, tox.ini. Note the package manager from the lockfile (package-lock.json npm, pnpm-lock.yaml pnpm, yarn.lock yarn). Record only what exists.
8. `git` `log` on the target path (optional) when history explains a design choice.
9. `remember` the run and test commands and the main entry points if they are not saved yet. Facts only, no secrets.

Budget: for a whole project, read the manifest, the entry points and 5 to 12 key files; do not read every file. For a large monorepo you may `delegate_agents` with up to 3 `researcher` agents, one per package, and merge their findings.

## Verify (required before answering)
- Every path, function name and command you cite comes from a file you read or a `search` hit in this session. Re-check any you are unsure of with `search`.
- Commands are listed only if they exist in a script, Makefile or config you read. Say they were not run.
- If the project has no test script or no tests, say so plainly instead of suggesting `npm test`.
- Mark inferences as "likely" and list what you did not read (for example "did not inspect packages/legacy"). Never present a guess as fact.

## Output
Keep it short: under about 60 lines for a project, under 30 for a file. Use these headings.

For a project:
- **Purpose:** one to three sentences.
- **Architecture:** one bullet per main module, `path/` and what it owns.
- **Data flow:** numbered hops with `file:line`. A small text diagram is fine when it helps.
- **Run and test:** the real commands, and the package manager.
- **Configuration:** env vars and config files that matter.
- **Worth knowing:** gotchas, surprising design choices, parts not inspected.

For a file or module:
- **Purpose**
- **Key exports:** table with name, what it does, used by.
- **Depends on**
- **Worth knowing**

## Pitfalls
- Repeating what the README claims instead of what the code does.
- Inventing commands (`npm test` when there is no test script, `yarn` when the lockfile is npm).
- Dumping file contents or listing every file instead of explaining how the parts fit.
- Missing the real entry point: Electron main vs renderer, a monorepo workspace, a framework's file-based routing.
- "Fixing" things you notice. List them under Worth knowing; suggest `fix` or `review`.
