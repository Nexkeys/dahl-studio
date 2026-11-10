---
name: fix-types-and-lint
description: Runs the type checker and linter (tsc, eslint, ruff, mypy), fixes errors by category without silencing them with any, @ts-ignore or eslint-disable, and reruns to zero errors. Use when the user asks to fix type errors, lint errors or a red typecheck.
argument-hint: "<optional: path or tool to focus on, e.g. src/ or eslint only>"
metadata:
  dahl-mode: build
  dahl-icon: list-checks
---

# Fix type and lint errors

Scope: $ARGUMENTS

If the scope is empty, run every type checker and linter the project has configured, on the whole project.

## When to use
- "Fix the TypeScript errors", "eslint is red", "make ruff and mypy pass", "npm run typecheck fails".
- After a dependency upgrade or a strictness change produced a wave of errors.

## When not to use
- The errors appear only in CI and you have not seen them locally: start with `fix-ci`.
- Runtime errors or wrong behaviour: use `fix`, or `debug-stack-trace` for a pasted trace.
- Unused exports and files reported by knip or similar: use `dead-code`.
- Restructuring code while you are at it: finish here first, then `refactor`.

## Mode
Needs Build mode (runs the tools and edits files). In Plan or Review mode, read the configs and the files in scope, report the errors you can see by reading (with the rule and the correct fix for each category), and ask the user to switch to Build to run the tools and apply the fixes.

## Checklist
1. `update_plan` with: find commands, baseline, autofix, fix by category, rerun, tests.
2. Find the exact commands CI uses. Prefer the project's scripts over raw tools so the flags match:
   - package.json scripts: `typecheck`, `lint`, `check`. Config: tsconfig.json (and `references` or tsconfig.*.json), eslint.config.js or .eslintrc*, biome.json.
   - Python: pyproject.toml `[tool.ruff]`, `[tool.mypy]`, mypy.ini, pyrightconfig.json.
3. Baseline with `run_command`, and record counts per tool:
   - `npx tsc --noEmit --pretty false` (with project references: `npx tsc -b`; one config: `npx tsc --noEmit -p tsconfig.app.json`).
   - `npx eslint .` (or `npm run lint`), `npx biome check .`.
   - `ruff check .`, `python -m mypy .` (or the configured paths), `npx pyright`.
   - Group TypeScript errors by code:
     `npx tsc --noEmit --pretty false | Select-String "error (TS\d+)" | ForEach-Object { $_.Matches[0].Groups[1].Value } | Group-Object | Sort-Object Count -Descending | Select-Object Count, Name`
4. Safe autofix first, as its own step: `npx eslint . --fix`, `ruff check . --fix`, `npx biome check --write .`. Review the result with `git` `diff` before going on; revert anything that changed behaviour.
5. Fix the rest by category, most frequent first. `read_file` each file before `edit_file`. Correct fixes for common categories:
   - TS18048 / TS2532 possibly undefined: narrow with a check, an early return or `??` with a real default. Use `!` only when an invariant guarantees the value, with a comment saying which.
   - TS7006 implicit any: give the real type, taken from the callers and the data.
   - TS2322 / TS2345 not assignable: decide whether the value or the declared type is wrong; fix the wrong one.
   - TS2307 cannot find module: missing `@types/*` package, a tsconfig `paths` alias, or a missing `.js` extension under NodeNext ESM.
   - `no-unused-vars`: remove it; prefix with `_` only for required but unused parameters when the config allows it.
   - `react-hooks/exhaustive-deps`: add the dependency or restructure (`useCallback`, move the function inside the effect). This changes behaviour, so run the tests.
   - `@typescript-eslint/no-explicit-any`: the real type, or `unknown` plus narrowing.
   - ruff F401 unused import: remove; F841 unused variable: remove; E722 bare `except:`: catch the specific exception.
   - mypy `Item "None" of "Optional[...]" has no attribute`: guard the `None` case.
6. Suppressions are a last resort: `any`, `as unknown as`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `# type: ignore`, `# noqa`. Allowed only when the correct fix is impossible (for example wrong third-party types), on one line, naming the rule, with a reason:
   `// @ts-expect-error -- upstream types lack the 'signal' option (lib v2.1)`
   Prefer `@ts-expect-error` over `@ts-ignore`. Never turn off `strict`, disable a rule in the config, or exclude files from tsconfig or the linter to reach zero, unless the user agrees through `ask_user`.
7. Large counts: work in batches by rule or folder and rerun after each batch. If more than about 300 errors remain after autofix, `ask_user` to agree the scope first (for example `src/` only, or errors before warnings). For several independent folders you may `delegate_agents` with `implementer` roles, one folder each.
8. Run the tests after the fixes; type and lint fixes can change runtime behaviour.

## Verify (required before saying done)
- Rerun exactly the commands from step 3: every tool exits 0 (or the agreed scope is clean). Show the before and after counts.
- `search` for suppressions (`@ts-ignore|@ts-expect-error|eslint-disable|noqa|type: ignore|as any`) and compare with the start: report each one you added and its reason.
- The test suite passes (`npm test`, `python -m pytest -q`), or failures are shown to predate your changes.
- Never claim zero errors without the final command output. State anything left out of scope.

## Output
- **Results:** table with tool, errors before, errors after, exit code.
- **Fixed by category:** rule or code, count, how it was fixed.
- **Suppressions added:** each with file, line and reason, or "none".
- **Tests:** command and result.
- **Left:** anything out of scope or needing a decision.

## Pitfalls
- Sprinkling `as any` or `!` to make errors disappear.
- Setting `"strict": false`, adding `skipLibCheck` to hide project errors, or disabling rules in the config.
- File-level `/* eslint-disable */` or `# ruff: noqa`.
- Running a global `tsc` instead of the project's version: use `npx tsc`.
- Forgetting `-b` for project references, so half the code is never checked.
- Fixing errors in generated files or `dist/` instead of excluding generated output properly.
- Autofix or a formatter rewriting hundreds of untouched lines: keep formatting changes separate.
- Chaining commands with `&&`: commands run in PowerShell, use `;`.
