---
name: dead-code
description: Finds unused exports, files and dependencies (knip, depcheck, vulture), confirms each by searching for dynamic and config references, and removes them in small batches with build and tests after each. Use when the user asks to remove dead or unused code or packages.
argument-hint: "<optional: folder, or exports | files | deps>"
metadata:
  dahl-mode: build
  dahl-icon: scissors
---

# Remove dead code safely

Scope: $ARGUMENTS

If the scope is empty, look for unused files, exports and dependencies across the project. If it says `deps`, `files` or `exports`, or names a folder, limit the work to that.

## When to use
- "Remove dead code", "find unused files", "which packages can we drop?", "clean out leftovers from the old checkout".
- After a feature was removed or a migration finished and remnants are left.

## When not to use
- Restructuring code that is used: use `refactor`.
- Unused variable or import warnings from the linter: use `fix-types-and-lint`.
- Upgrading or replacing packages: use `dependency-upgrade`. Vulnerable packages: use `dependency-audit`.
- Shrinking the shipped JavaScript bundle: use `bundle-size`.

## Mode
Needs Build mode (runs detectors, deletes code, runs the build and tests). In Plan or Review mode, find candidates with `search` and `read_file` only, confirm them with step 4, report the list with evidence, and ask the user to switch to Build to remove them.

## Checklist
1. `update_plan` with: baseline, detect, confirm, remove batch, verify batch, report.
2. Baseline: run the build, type check and tests (`npm run build`, `npx tsc --noEmit`, `npm test`; `python -m pytest -q`) and record the results. If anything is red, stop and report. Check `git` `status`: untracked files are not recoverable from git, so ask before deleting any.
3. Detect candidates. Use `npx --yes` so npx does not stop to ask:
   - JS/TS: `npx --yes knip --reporter compact` (unused files, exports, dependencies). Knip has plugins for Next.js, Vite, Vitest, Storybook and more; if it flags framework entry files, fix its config (`knip.json` `entry`/`project`) instead of deleting them.
   - Older TS projects: `npx --yes ts-prune` for exports, `npx --yes depcheck` for dependencies.
   - Python: `python -m vulture src/ --min-confidence 80` (install with `python -m pip install vulture` after `ask_user`); `deptry .` for dependencies if installed.
   - Go: `staticcheck ./...` (check U1000).
   - No tool available: list exports with `search` (`^export `, `^def `, `^class `) and search each name.
4. Confirm every candidate yourself. A tool report is a lead, not proof. For each name or file:
   - `search` the name across the whole repo, all file types (code, JSON, YAML, HTML, Markdown in docs sites, CI files), excluding its own definition.
   - Dynamic use: `import(` with template strings, `require(` with variables, `import.meta.glob`, lazy routes, registries keyed by strings (`handlers[name]`), dependency injection, Python `importlib`, `getattr`, dotted path strings ("app.handlers.export_csv"), Django settings and URL strings, Celery task names, pytest fixtures (used by parameter name), entry points in pyproject.toml.
   - Framework conventions: Next.js `pages/` and `app/` files, route files, migrations, Storybook stories, test fixtures, service workers, files referenced from index.html.
   - Config and tooling: package.json `main`, `bin`, `exports`, `scripts`; tsconfig `paths`; vite, webpack, next, electron-builder configs; Dockerfile; CI workflows.
   - Dependencies: used only from config (ESLint plugins, Babel or PostCSS plugins, Tailwind plugins), CLIs used in scripts (`rimraf`, `cross-env`), `@types/*` paired with a used package, peer dependencies.
   - Public API: if the package is published (`private` is not true, has `exports` or `main`), exported symbols may be used by consumers. Do not remove them without `ask_user`.
   - Used only by tests: dead in production. `ask_user` whether to delete both or keep.
   Classify each as **dead** (evidence of no use), **keep** (with the reason) or **unsure** (ask).
5. Remove confirmed dead items in small batches (one module, or 5 to 10 items):
   - Unused exports and functions: `edit_file`.
   - Whole files: `run_command` with `Remove-Item -LiteralPath src/legacy/old.ts`.
   - Dependencies: `npm uninstall <pkg>` (updates the lockfile); Python: remove the line from requirements.txt or pyproject.toml.
6. After each batch run the build, type check and tests again. Green: next batch. Red: restore that batch (for a deleted tracked file, read the old content with `git` `show` and `write_file` it back) and mark the item as keep, with the reason.
7. Rerun the detector at the end to show the count dropped.

## Verify (required before saying done)
- After the last batch: build, type check and tests pass with the same commands as the baseline. Show exit codes.
- Detector before and after counts (for example "knip: 14 unused exports, now 3, all kept with reasons").
- `git` `diff` summary of what was removed.
- Never say code is unused without the search evidence from step 4. State anything you could not verify (for example consumers of a published package).

## Output
- **Removed:** table with item, kind (file, export, dependency), evidence of no use.
- **Kept:** table with item and the reason (dynamic import, config reference, public API, user decision).
- **Checks:** build, type check, tests before and after; detector counts before and after.
- **Unsure:** items waiting for the user's decision.

## Pitfalls
- Trusting the detector without searching: dynamic imports, string registries and framework conventions look unused.
- Deleting framework entry files, migrations, pytest fixtures or Storybook stories.
- Removing a dependency that is only referenced from a config file or an npm script.
- Removing exports of a published library.
- Huge batches: when the build breaks you cannot tell which removal caused it.
- Deleting untracked files that git cannot restore.
- Code behind a feature flag the team still plans to turn on: ask before removing it.
- Chaining commands with `&&`: commands run in PowerShell, use `;`.
