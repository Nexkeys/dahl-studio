---
name: refactor
description: Restructures a file or module without changing behaviour. Keeps tests green before and after, adds characterization tests when coverage is thin, works in small steps and changes no API without asking. Use when the user asks to clean up, split, simplify or reorganize code.
argument-hint: "<file or module, and the goal, e.g. split src/api.ts by resource>"
metadata:
  dahl-mode: build
  dahl-icon: wand
---

# Refactor without changing behaviour

Target and goal: $ARGUMENTS

If no target is given, call `ask_user` once with 2 to 4 candidate files (the longest or most tangled ones you find with `list_dir` and `read_file`). If a target is given but no goal, pick the goal from what hurts most in the code (duplication, a very long function, mixed responsibilities) and state it before starting.

## When to use
- "Clean up src/report.js", "split this 800-line file", "remove the duplication in the handlers", "simplify these nested ifs".
- Preparing code for a change: make the change easy first, then make the change (the second part is not this skill).

## When not to use
- The behaviour should change (bug or feature): use `fix`, or build the feature normally.
- Removing unused exports, files or packages: use `dead-code`. Type or lint errors: use `fix-types-and-lint`.
- Making code faster: use `perf`. Upgrading a library or framework: use `dependency-upgrade`.
- Choosing between architectures before writing code: use `architecture-decision`.

## Mode
Needs Build mode (edits files and runs tests). In Plan or Review mode, do steps 1 to 5 and report the baseline you would need, the public API you will keep, and the numbered list of refactoring steps, then ask the user to switch to Build.

## Checklist
1. `update_plan` with: map usage, baseline, safety net, refactor steps, verify.
2. Map the target and its users:
   - `read_file` the whole target.
   - `search` for its exported names and its import path (`from './report'`, `require('./report')`, `from app.report import`) to find every caller.
   - Write down the public API: exported names and signatures, default exports, package.json `exports` and `main`, CLI flags, HTTP routes, files imported by path from other packages.
3. Baseline: run the tests, type check and lint with `run_command` and record the counts.
   - Node: `npm test` (or `npx vitest run`, `node --test`), `npx tsc --noEmit`, `npm run lint`.
   - Python: `python -m pytest -q`, `ruff check .`, `python -m mypy .` when configured.
   - If anything is red before you start, stop and report it; `ask_user` whether to continue on top of the failures.
4. Safety net: `search` the tests for imports of the target. If nothing tests it, or only the happy path, write characterization tests first that pin the current behaviour, including odd behaviour you suspect is a bug (note it, do not fix it). Run them green before touching the code.
5. Plan the steps in `update_plan`. Each step is one move: extract function, extract module (with a re-export from the old path), rename a local, inline a needless wrapper, replace a conditional chain with a lookup table, merge duplicated code, introduce a parameter object.
6. Do one step at a time with `edit_file`, then run the narrow tests (and `npx tsc --noEmit` for TypeScript).
   - Green: next step.
   - Red: undo that step with `edit_file` and take a smaller step. Do not stack fixes on a broken step.
7. Keep the public API. When moving code to a new file, keep exporting it from the old path unless every caller is updated in the same step. Any signature, name or route change needs `ask_user` first.
8. Do not mix concerns: no bug fixes, no behaviour tweaks, no dependency changes, no reformatting of lines you did not touch. List any bugs you noticed in the answer.

## Verify (required before saying done)
- Same commands as the baseline: tests pass with at least the baseline count, type check and lint exit 0 (or show the same pre-existing errors only).
- Run the build if the project has a build script (`npm run build`).
- Existing tests needed no changes other than import paths. If you had to change an assertion, behaviour changed: undo it or `ask_user`.
- `search` for the old names and paths you moved to make sure no import is left dangling.
- `git` `diff` and read it once: no unrelated hunks.
- Never claim the refactor is safe without before and after test output. State anything that is not covered by tests.

## Output
- **Goal:** one sentence.
- **Steps done:** numbered list of the moves.
- **Before / after:** table with tests passed, type check, lint, and line counts of the touched files.
- **API changes:** "none", or each change and who approved it.
- **Noticed, not changed:** bugs or smells left for `fix` or a later refactor.

## Pitfalls
- Big-bang rewrites: one huge edit that cannot be bisected when a test fails.
- Silent behaviour changes: reordered side effects, different error messages or types, `==` turned into `===`, changed default parameters, sync turned async, iteration order of objects or sets.
- Breaking import paths: barrel `index.ts` files, tsconfig `paths` aliases, Python `__init__.py` re-exports.
- Circular imports after splitting a module.
- Editing tests to fit the new code. A refactor should leave assertions alone.
- Removing code that looks unused but is loaded dynamically. That is `dead-code` work, with its own checks.
- Chaining commands with `&&`: commands run in PowerShell, use `;`.
