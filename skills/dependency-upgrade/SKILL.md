---
name: dependency-upgrade
description: Upgrades dependencies safely: reads changelogs and migration guides, upgrades in small steps with majors one at a time, fixes breaking changes and runs build and tests after each step. Use when the user asks to update, bump or migrate a package version.
argument-hint: "<package(s) and target version, e.g. react@19 or 'all minor updates'>"
metadata:
  dahl-mode: build
  dahl-icon: package
  dahl-web: "true"
---

# Upgrade dependencies

Upgrade: $ARGUMENTS

If this is empty, list outdated packages (step 4) and call `ask_user` with options such as "patch and minor updates of production dependencies (recommended)", "one specific major upgrade", "everything outdated, one step at a time".

## When to use
- "Upgrade React to 19", "bump all minor versions", "move to Next 15", "update pydantic to v2".
- A dependency audit found a fix that needs a major version.

## When not to use
- Find and patch known vulnerabilities: `dependency-audit` (it hands majors back to this skill).
- Replace one library with a different one: `refactor`.
- CI broke after someone else's upgrade: `fix-ci`. Lockfile merge conflict: `resolve-conflicts`.

## Mode
Needs Build mode (installs packages, edits files, runs commands). In Plan or Review mode, do steps 1 to 5 (package manager, baseline plan, inventory, changelog reading, step plan), report the plan with the breaking changes that affect this code, and ask the user to switch to Build.

## Checklist
1. `update_plan` with: detect manager, baseline, inventory, read changes, upgrade step by step, verify.
2. Package manager from the lockfile, and use only that one: package-lock.json -> npm, pnpm-lock.yaml -> pnpm, yarn.lock -> yarn, bun.lock or bun.lockb -> bun. Python: uv.lock -> uv, poetry.lock -> poetry, requirements*.txt -> pip. Check the runtime with `node --version` or `python --version`.
3. Baseline before touching anything: `git` `status` (if there are uncommitted changes, tell the user and ask before mixing them with the upgrade), then run build, type check and tests with `run_command` (for example `npm run build; npx tsc --noEmit; npm test`). Record pass counts. Failures that exist now are pre-existing, not caused by the upgrade.
4. Inventory: `npm outdated --json` (Current, Wanted, Latest), `pnpm outdated`, `yarn outdated`, `pip list --outdated --format=json`, `poetry show --outdated`, `uv pip list --outdated`. Read the declared ranges in package.json or the pins in requirements.txt.
5. Plan the steps:
   - Patch and minor updates of unrelated packages: one batch.
   - Each major: its own step. Crossing several majors (v2 to v5): follow each major's migration notes in order; step through intermediate majors when the guides are per-major.
   - Move coupled packages together: `react` + `react-dom` + `@types/react` + `@types/react-dom`; `next` + `eslint-config-next`; `vite` + `@vitejs/plugin-*`; `eslint` + its plugins and configs; `typescript` + `typescript-eslint`; `@babel/*`; `jest` + `ts-jest` + `@types/jest`; `fastapi` + `pydantic` (FastAPI before 0.100 needs pydantic v1).
6. Read the changes before each major:
   - With Web on: `web_fetch` the official migration guide, the GitHub releases page or CHANGELOG.md for every version crossed.
   - Without Web: after installing, `read_file` `node_modules/<pkg>/CHANGELOG.md` or the README; for Python, the package docs URL in its metadata (`pip show <pkg>`).
   - Note: required Node or Python version (`engines`, `requires-python`), peer dependency changes, removed or renamed APIs, ESM-only packages, config format changes, official codemods (`npx @next/codemod@latest`, `npx types-react-codemod@latest`, `bump-pydantic`).
   - `search` this project for every removed or renamed API from the notes, so you know the work before you start.
7. Upgrade one step, keeping the existing range style:
   - `npm install react@^19 react-dom@^19`, dev packages with `npm install -D @types/react@^19`.
   - `pnpm add pkg@^X`, `yarn add pkg@^X`, `bun add pkg@^X`.
   - `pip install -U "pkg==X.Y.Z"` then update the pin in requirements.txt by hand; `poetry add pkg@^X`; `uv add "pkg>=X,<X+1"`.
   - Run an official codemod only if the notes recommend it, and review its diff with `git` `diff`.
8. Fix breaking changes with `read_file` and `edit_file`, guided by the changelog and the compiler or test errors. Do not silence errors with `any`, `@ts-ignore`, `# type: ignore` or by deleting tests.
9. After each step: build, type check, lint and tests again. All must be back to the baseline before the next step. If a step cannot be made green, revert it (`npm install pkg@<old version>`) and report what blocks it.
10. Lockfile: the manifest and the lockfile must change together. Check with `git` `diff` (stat) and `npm ls <pkg>` that the new version is installed and there are no `invalid` or `UNMET PEER` entries. Never delete the lockfile, and never use `--force` or `--legacy-peer-deps` unless you explain why and the user agrees.
11. `remember` durable facts the upgrade introduced (for example "Project requires Node 20+ since Vite 6").

## Verify (required before saying done)
- For every step: build, type check and test commands with exit code 0 and pass counts equal to or better than the baseline.
- `npm ls <pkg>` (or `pip show <pkg>`) shows the target version actually installed.
- Manifest and lockfile both changed; nothing unrelated changed.
- Never claim the upgrade is done without that output. State what is untested: code paths without tests, UI behaviour not checked in the Preview pane, runtime warnings.

## Output
- **Upgraded:**

| Package | From | To | Type | Notes |
|---|---|---|---|---|

- **Breaking changes handled:** `file:line` and what changed, per package.
- **Verification:** per step, the commands run and their results.
- **Lockfile:** what changed, including notable transitive updates or duplicates.
- **Skipped or deferred:** majors not done and why, with the blocker.

## Pitfalls
- Upgrading everything at once (`npx npm-check-updates -u`) and then facing 40 errors with no idea which upgrade caused them.
- Forgetting the coupled packages and `@types/*`, leaving peer warnings or type mismatches.
- Using `--force` or `--legacy-peer-deps` to hide a real peer conflict.
- Editing package.json without installing, so the lockfile is out of sync.
- Mixing package managers (running `npm install` in a pnpm repo creates a second lockfile).
- Relying on a search snippet instead of reading the actual migration guide.
- Ignoring a new minimum Node or Python version that CI or production does not have.
