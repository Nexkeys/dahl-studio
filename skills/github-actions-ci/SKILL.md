---
name: github-actions-ci
description: Creates or improves a GitHub Actions CI workflow that runs the project's own lint, typecheck, test and build commands with caching, least-privilege permissions, concurrency and pinned actions, after proving those commands pass locally. Use when the user wants CI set up, a workflow added or an old workflow modernised.
argument-hint: "<optional: what CI should run, e.g. tests on Node 20 and 22>"
metadata:
  dahl-mode: build
  dahl-icon: workflow
---

# Set up GitHub Actions CI

Request: $ARGUMENTS

If the request is empty, build one workflow that runs on pushes to the default branch and on pull requests, with the checks the project already has (lint, typecheck, test, build).

## When to use
- There is no `.github/workflows/` yet and the user wants CI.
- An existing workflow is slow, outdated (`actions/checkout@v2`, `setup-node@v1`, `npm install`), too permissive or missing steps.

## When not to use
- A CI run is failing and the user wants it green: use `fix-ci`.
- Deploying a site from CI (GitHub Pages, Vercel): use `deploy-web`.
- Tagging and publishing a version: use `release`.
- A test that fails only sometimes in CI: use `flaky-test`.
- A dependency vulnerability check: use `dependency-audit`.

## Mode
Needs Build mode (writes workflow files and runs commands). In Plan or Review mode, do steps 1 to 3, return the complete proposed YAML in a code block with one line of reasoning per job, and ask the user to switch to Build.

## Checklist
1. `update_plan` with: read project, run commands locally, write workflow, validate, push and check.
2. Read what exists: `list_dir` `.github/workflows`, `read_file` each workflow, `package.json` (scripts, `engines`), the lock file name, `.nvmrc` or `.node-version`; for Python `pyproject.toml`, `requirements*.txt`, `uv.lock`. Default branch: `github` `repo_info`, or `git` `branches`.
3. Choose the steps from the project's own scripts, in this order: install, lint, typecheck, test, build. Only include a step whose script exists. Install with the manager the lock file names: `npm ci`, `pnpm install --frozen-lockfile`, `yarn install --immutable`, `uv sync --locked`, `python -m pip install -r requirements-dev.txt`.
4. Run the same commands locally first with `run_command`, for example `npm ci; npm run lint; npm run typecheck; npm test; npm run build`, or `python -m pip install -r requirements-dev.txt; ruff check .; python -m pytest -q`. A step that fails locally will fail in CI: fix it or tell the user before adding it. Test runners must not start in watch mode (`vitest run`, `jest --ci`).
5. Write `.github/workflows/ci.yml` with `write_file` (or change an existing workflow with `edit_file` after reading it). Node template:
   ```yaml
   name: CI
   on:
     push:
       branches: [main]
     pull_request:
   permissions:
     contents: read
   concurrency:
     group: ${{ github.workflow }}-${{ github.ref }}
     cancel-in-progress: true
   jobs:
     check:
       runs-on: ubuntu-latest
       timeout-minutes: 15
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version-file: .nvmrc
             cache: npm
         - run: npm ci
         - run: npm run lint
         - run: npm run typecheck
         - run: npm test
         - run: npm run build
   ```
   - Replace `main` with the real default branch. No `.nvmrc`: use `node-version: 20` or the `engines` value.
   - pnpm: add `- uses: pnpm/action-setup@v4` before setup-node and use `cache: pnpm`.
   - Python: `actions/setup-python@v5` with `python-version: "3.12"` and `cache: pip`, then `python -m pip install -r requirements-dev.txt` (or `python -m pip install -e ".[dev]"`), `ruff check .`, `python -m pytest -q`. With uv: `astral-sh/setup-uv@v6`, `uv sync --locked`, `uv run pytest -q`.
6. Matrix only when it earns its cost: a library that supports several Node or Python versions, or a tool that must run on several systems (Electron or CLI apps: `os: [ubuntu-latest, windows-latest]`). Add `fail-fast: false` so one failing leg does not hide the others. An app deployed on one runtime needs one job.
7. Security and hygiene:
   - `permissions: contents: read` at the top. Grant more only to the job that needs it (for example `pull-requests: write` for a bot comment).
   - Pin actions: GitHub-owned actions by major tag (`@v4`, `@v5`); third-party actions by full commit SHA with the version in a comment.
   - Secrets only as `${{ secrets.NAME }}` in the `env:` of the step that needs them. Never echo them. Pull requests from forks do not receive secrets.
   - No `continue-on-error: true` and no `|| true` on checks: a check that cannot fail checks nothing.
8. Validate the YAML: `npx --yes yaml-lint .github/workflows/ci.yml`, or `npx --yes js-yaml .github/workflows/ci.yml` (fails on a parse error). If actionlint is installed (`Get-Command actionlint -ErrorAction SilentlyContinue`), also run `actionlint`: it checks expressions and action inputs.
9. Only if the user wants it on GitHub now: `git` `commit` with `files: [".github/workflows/ci.yml"]` and a message such as `ci: add lint, test and build workflow`, then `git_push`. Then `github` `ci_status` for the branch. A failed job: `github` `ci_logs` with its `job_id`, fix it, or hand over to `fix-ci`.

## Verify (required before saying done)
- The local commands from step 4 with their exit codes (all 0, or each failure explained).
- The YAML validator from step 8 exits 0.
- `read_file` the workflow back: every `run:` step matches a script that exists in the project.
- If pushed: `github` `ci_status` shows the run (passed, failed or still running, as it is). If not pushed, say the workflow has not run on GitHub yet.
- Never claim "CI is green" without a `ci_status` result that shows it.

## Output
- **Workflow:** path, and a table of job, runs on, steps.
- **Local proof:** commands and exit codes.
- **Validation:** validator command and result.
- **On GitHub:** `ci_status` result, or "not pushed yet".
- **Follow-ups:** for example a branch protection rule that requires the check, or `.github/dependabot.yml` with `package-ecosystem: github-actions` to keep actions updated.

## Pitfalls
- `cache: npm` or `npm ci` without a committed lock file: the job fails with "Dependencies lock file is not found".
- Steps that exist only in the workflow and not in the project scripts, so CI checks something developers never run.
- Test runners in watch mode: the job hangs until it times out.
- Pushing a workflow with a token that lacks the Workflows permission: GitHub rejects it ("refusing to allow a Personal Access Token to create or update workflow"). Ask the user to add "Workflows: read and write" to the token saved in Source Control.
- Linux runners are case-sensitive: `import './Utils'` for `utils.ts` passes on Windows and fails in CI.
- A 3 by 3 OS and version matrix for an app that ships on one runtime: nine times the minutes for nothing.
- `on: [push, pull_request]` with no branch filter: every pull request branch runs twice.
