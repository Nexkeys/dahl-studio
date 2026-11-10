---
name: coverage-gaps
description: Measures test coverage (vitest, jest, node:test, pytest-cov, go), finds risky untested code such as error paths and branches, adds tests for the top gaps and reports the coverage change with numbers. Use when the user asks about coverage or untested code.
argument-hint: "<optional: folder to focus on, or a target percentage>"
metadata:
  dahl-mode: build
  dahl-icon: target
---

# Close the riskiest coverage gaps

Focus: $ARGUMENTS

If no focus is given, measure the whole project and pick the gaps by risk. If a target percentage is given, treat it as a guide, not a goal to reach with meaningless tests.

## When to use
- "What is our test coverage?", "which code has no tests?", "improve coverage in src/billing".
- Before a risky change, to find out what is not protected by tests.

## When not to use
- The user names a specific module to test and does not care about numbers: use `tests`.
- Endpoint behaviour (status codes, auth): use `api-tests`. User flows in a browser: use `web-e2e-tests`.
- A test fails at random: use `flaky-test`.

## Mode
Needs Build mode (runs coverage, may install a coverage package, writes tests). In Plan or Review mode, read the source and the tests, list the likely gaps by risk with `file:line` and the tests you would add, and ask the user to switch to Build to measure and add them.

## Checklist
1. `update_plan` with: detect tooling, baseline, rank gaps, add tests, rerun, report.
2. Detect the runner and coverage tool (ask with `ask_user` before installing anything):
   - vitest: needs `@vitest/coverage-v8` at the same major version as vitest (`npm ls vitest`), installed with `npm i -D @vitest/coverage-v8@<major>`. Run `npx vitest run --coverage --coverage.reporter=text --coverage.reporter=json-summary`.
   - jest: built in. `npx jest --coverage --ci --coverageReporters=text --coverageReporters=json-summary`.
   - node:test (Node 20+): `node --test --experimental-test-coverage`. Alternative: `npx c8 --reporter=text node --test`.
   - pytest: needs pytest-cov (`python -m pip show pytest-cov`, install with `python -m pip install pytest-cov`). Run `python -m pytest --cov=<package> --cov-branch --cov-report=term-missing -q`.
   - Go: `go test ./... -coverprofile=coverage.out` then `go tool cover -func=coverage.out`.
3. Baseline: run it with `run_command` and record total lines, branches and functions, plus the per-file table. Note the uncovered line ranges ("Uncovered Line #s" in istanbul output, "Missing" in pytest-cov). Make sure coverage output folders (`coverage/`, `.coverage`, `htmlcov/`) are in .gitignore.
4. Rank the gaps by risk, not by lowest percentage. `read_file` the uncovered ranges and score them:
   - High: money and pricing, auth and permissions, parsing and validation of external input, data deletion and migrations, error handling (catch blocks, error responses, retries), branches that decide user-visible outcomes.
   - Low: generated code, type-only files, config, trivial re-exports, logging, UI glue already covered by E2E tests.
5. Pick the top 3 to 5 gaps. For each, write the behaviour to test, not the line to hit: "rejects an expired token" rather than "cover line 42".
6. Write the tests in the project's style (same framework, location and naming as existing tests):
   - Test through the public API and assert on outcomes. Executing code without asserting raises coverage and proves nothing.
   - Reach error paths through inputs, or by mocking the boundary (a rejecting `fetch`, a failing file read, `vi.spyOn(fs, 'readFile')`, pytest `monkeypatch`).
   - No snapshot tests of large objects.
7. Run the new tests, then rerun the full coverage command from step 3.
8. Optional: propose a threshold at the new level so coverage cannot silently drop (vitest `coverage.thresholds`, jest `coverageThreshold`, pytest `--cov-fail-under`). Ask before adding it.

## Verify (required before saying done)
- All tests pass (exit code 0) with the new tests included.
- Before and after numbers come from real runs of the same command: show both.
- Each new test asserts the behaviour it claims; for at least one, name the line whose change would make it fail.
- Never report coverage numbers you did not measure. If the coverage tool could not be installed or run, say so and report the gaps from reading only, marked as unmeasured.

## Output
- **Coverage:** table with metric (lines, branches, functions), before, after.
- **Gaps closed:** table with `file:lines`, risk, behaviour tested, test file.
- **Remaining gaps:** ranked list with `file:lines` and why they matter.
- **Commands:** the coverage command used, so the user can rerun it.

## Pitfalls
- Chasing 100 percent with tests that execute code but assert nothing.
- Testing the easiest files to move the number instead of the riskiest code.
- Mismatched `@vitest/coverage-v8` and `vitest` versions.
- Counting test files, config or `dist/` in the coverage report: set `include`/`exclude` (or `--cov=<package>`) to the source.
- Looking only at line coverage: branch coverage shows the untested `else` and `catch`.
- Committing `coverage/` or `htmlcov/` output.
- Chaining commands with `&&`: commands run in PowerShell, use `;`.
