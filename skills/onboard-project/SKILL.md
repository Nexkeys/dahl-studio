---
name: onboard-project
description: Gets oriented in an unfamiliar codebase. Reads the README, manifests, entry points, scripts, CI config and existing agent instruction files, returns a short map (stack, layout, how to run, test and build, conventions, gotchas) and saves the key facts to memory. Use when starting work in a new or unknown project.
argument-hint: "<optional: area to focus on, or 'write AGENTS.md'>"
metadata:
  dahl-mode: plan
  dahl-icon: map
---

# Onboard to a project

Focus: $ARGUMENTS

If the focus is empty, map the whole project. If it names an area ("the API", "billing"), map the whole project briefly and that area in more depth. If it asks for an AGENTS.md, also do step 10.

## When to use
- The first task in a project Dahl has not worked in, or the user asks "what is this project", "get me oriented", "how do I run this".
- Before a larger change in an unfamiliar repository, to learn its commands and conventions first.

## When not to use
- The user asks how one function, file or flow works: use `explain`.
- The user asks where something lives: use `find`.
- The user wants a README or user docs written: use `docs`.
- The user wants a decision about structure or technology: use `architecture-decision`.
- The project has no CI and the user wants it: use `github-actions-ci`.

## Mode
Steps 1 to 6 and 8 to 9 are read-only and work in any mode (Plan is the default). Confirming commands (step 7) and writing AGENTS.md (step 10) need Build mode. In Plan or Review mode, label every command "from <file>, not run" and, if the user wants the commands confirmed or the file written, ask them to switch to Build.

## Checklist
1. `update_plan` with: survey, docs and instruction files, manifests, CI, entry points, confirm commands, gotchas, remember.
2. Survey: `list_dir` the root, then the main source folders one level deep. Monorepo signs: `packages/`, `apps/`, `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json`, a Cargo workspace, several `pyproject.toml` files. In a monorepo, map the workspace layout first, then only the package the focus is about.
3. What the project says about itself (`read_file`, first 150 lines of long files):
   - `README.md`, `CONTRIBUTING.md`, the index of `docs/`.
   - Instruction files for agents: `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`, `.cursorrules`, `.github/copilot-instructions.md`, `.windsurfrules`. These hold the team's conventions: report them and follow them in later tasks.
4. Manifests for stack and commands:
   - Node: `package.json` (`scripts`, `engines`, `type`, `workspaces`, main dependencies), the lock file (`package-lock.json` npm, `pnpm-lock.yaml` pnpm, `yarn.lock` yarn, `bun.lockb` bun), `tsconfig.json`, `.nvmrc`.
   - Python: `pyproject.toml` (build backend, `[project.scripts]`, `[tool.pytest.ini_options]`, `[tool.ruff]`), `requirements*.txt`, `uv.lock`, `poetry.lock`, `tox.ini`, `noxfile.py`.
   - Others: `Cargo.toml`, `go.mod`, `*.csproj` and `*.sln`, `pom.xml` or `build.gradle`, `composer.json`, `Gemfile`, `Makefile`, `justfile`, `Taskfile.yml`, `Dockerfile`, `docker-compose.yml`.
   - Configuration: `.env.example` gives the names of required variables. Never read or print values from `.env`.
5. CI shows what really has to pass: `read_file` `.github/workflows/*.yml` (or `.gitlab-ci.yml`, `azure-pipelines.yml`). Note the runtime version and the exact lint, test and build commands.
6. Entry points and layout: find them from the manifests (`main`, `bin`, `scripts.dev`, `[project.scripts]`, `__main__.py`, `src/main.*`, `src/index.*`, `app/` or `pages/` for Next.js, `manage.py` for Django). `read_file` the entry point and one typical module; `search` for the routing or registration pattern to see how features are wired. Note where tests live and how they are named.
7. Confirm commands (Build mode only) with `run_command`: install with the lock file's manager (`npm ci`, `pnpm install --frozen-lockfile`, `uv sync`, `python -m pip install -r requirements.txt`, `timeout_seconds` up to 600), then the cheap checks: `npm test`, `npm run lint`, `npx tsc --noEmit`, `python -m pytest -q`, `ruff check .`. Record each exit code. Do not start dev servers here: they never exit and block the task.
8. Gotchas: traps and mismatches you found, for example:
   - The README says `npm start` but `package.json` has no `start` script.
   - CI uses Node 20 while `.nvmrc` says 18.
   - Tests need a database, a running service or a variable from `.env.example`.
   - Generated folders that must not be edited by hand.
   - Windows problems: bash-only scripts, `rm -rf` or `export` in npm scripts, imports whose case differs from the file name.
9. `remember` the durable facts, one fact per call, with tags such as `commands`, `stack`, `conventions`, `gotchas`. Example: "Tests: pnpm test (vitest, files in src/**/*.test.ts)". Mark unconfirmed commands as such. Never store secrets or `.env` values.
10. AGENTS.md (only when the user asked for it, and only in Build mode): a short file, under 60 lines, with only verified facts: commands that exited 0 in step 7, the layout, conventions taken from existing files. No generic advice ("write clean code"), no copy of the README, no guesses. If an AGENTS.md or CLAUDE.md already exists, propose edits to it instead of a second file.

## Verify (required before saying done)
- Every command in the map is labelled "ran: exit 0", "failed: <reason>" or "from <file>, not run". Never present an unconfirmed command as working.
- Every convention names its source file (`CLAUDE.md`, `.eslintrc.json`, `pyproject.toml`).
- `remember` was called for at least the install, test and build or run commands.
- AGENTS.md, if written: `read_file` it back; it is under 60 lines and every command in it exited 0 in this task.

## Output
A map of about 40 lines at most:
- **What it is:** one sentence.
- **Stack:** language and version, framework, package manager, test runner, linter.
- **Layout:** a short tree of the important folders, one line each.
- **Commands:** table with Task (install, dev, test, lint, typecheck, build), Command, Status.
- **Conventions:** bullets, each with its source file.
- **Gotchas:** bullets.
- **Saved to memory:** the facts stored.

## Pitfalls
- Trusting the README over `package.json` and CI. READMEs go stale; scripts and workflows are what actually runs.
- A long AGENTS.md full of generic advice. Long, model-written context files make agents perform worse; keep it short and factual, or do not write one.
- Reading every file. Read the manifests, entry points and one example of each kind of module, then stop.
- Printing `.env` values or saving them with `remember`.
- Using the wrong package manager: `npm install` in a pnpm or yarn repository creates a second lock file.
- Starting a dev server with `run_command` and blocking the task until it times out.
