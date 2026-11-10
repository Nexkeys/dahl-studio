---
name: tests
description: Adds meaningful tests for the most important untested behaviour of a project or a named target, using the existing framework (vitest, jest, node:test, pytest, go test), runs them and fixes test-caused failures. Use when the user asks to add tests or write unit tests.
argument-hint: "<file, module or behaviour to test; empty to pick the riskiest gap>"
metadata:
  dahl-mode: build
  dahl-icon: flask
---

# Add tests

Target: $ARGUMENTS

If the target is empty, pick the most important untested behaviour yourself (step 3) and say which one you chose and why.

## When to use
- "Add tests for src/pricing.ts", "write unit tests for the parser", "this module has no tests".
- A feature landed without tests and the user wants it covered.

## When not to use
- The user wants coverage numbers and the biggest gaps across the project: use `coverage-gaps`.
- HTTP endpoints (status codes, auth, validation): use `api-tests`. Browser user flows: use `web-e2e-tests`.
- A test fails only sometimes: use `flaky-test`. A known bug needs fixing: use `fix` (it writes its own regression test).
- The type checker or linter is red: use `fix-types-and-lint`.

## Mode
Needs Build mode (writes test files and runs them). In Plan or Review mode, do steps 1 to 4, list the test cases you would write (name and expected behaviour, with the file they go in) and ask the user to switch to Build.

## Checklist
1. `update_plan` with: detect framework, choose behaviours, write tests, run, report.
2. Detect the framework and conventions; never add a second framework:
   - Node: `read_file` package.json (`scripts.test`, devDependencies: vitest, jest, mocha). Look for vitest.config.*, jest.config.*, or `node --test` in scripts. `search` with glob `**/*.{test,spec}.{ts,tsx,js,jsx,mjs}` and read one or two existing tests to copy imports, `describe`/`it` vs `test`, file location and helpers.
   - Python: pyproject.toml `[tool.pytest.ini_options]`, pytest.ini, conftest.py, a `tests/` folder. Plain unittest only if that is what exists.
   - Go: `*_test.go` next to the code, table-driven tests.
   - No framework yet: Node 18+ can use `node:test` with no install. A Vite or TypeScript project usually wants vitest (`npm i -D vitest`), Python wants pytest (`python -m pip install pytest`). Call `ask_user` before adding a dependency.
3. Choose what to test. `read_file` the target and rank behaviours by risk:
   - Public functions with branches; money, dates, parsing, validation, permissions; error paths.
   - Code with bug history: `git` `log` with the path.
   - Skip trivial getters, framework glue, generated files and type-only modules.
4. Write the case list before the code. For each function: the main path, boundaries (empty, zero, one, max, negative, unicode, null, undefined, None), error cases (throws, raises, rejected promise) and any documented contract.
5. Write the tests where the project keeps them, with its naming (`src/x.test.ts` next to the code, or `tests/test_x.py`). Use `write_file` for new files, `edit_file` to add to existing ones.
   - Test through the public API. Assert on return values and observable effects, not on internal calls.
   - Mock only at boundaries: network, clock, filesystem, randomness. Clock: `vi.useFakeTimers()` with `vi.setSystemTime(...)`, `jest.useFakeTimers()`, pytest `monkeypatch` or freezegun. Files: `fs.mkdtemp`, pytest `tmp_path`.
   - One behaviour per test, named as a sentence: "returns 0 for an empty cart".
6. Run the new file first, without watch mode:
   - `npx vitest run src/pricing.test.ts`
   - `npx jest src/pricing.test.ts --ci`
   - `node --test test/pricing.test.js`
   - `python -m pytest tests/test_pricing.py -q`
   - `go test ./pricing/ -run TestPrice -v`
7. Triage each failure:
   - The test is wrong (bad setup, wrong expectation from misreading the code): fix the test.
   - The test found a real bug: do not change the expectation to match the bug. Report it, then `ask_user` whether to fix it now (with the `fix` skill) or keep the test marked as a known failure (`it.fails` in vitest, `test.failing` in jest, `@pytest.mark.xfail(reason="...", strict=True)`), with a comment naming the bug.
8. Run the whole suite once (`npm test`, `python -m pytest -q`, `go test ./...`) to make sure nothing else broke.
9. `remember` the test command if it was not saved yet.

## Verify (required before saying done)
- The new tests run and pass: show the command, exit code and number of new tests.
- The full suite exits 0, or every failure is listed and shown to have failed before your change.
- Check that the key tests can fail: for at least one, name the line in the source whose change would break it, or briefly run it against a deliberately wrong expected value and revert.
- Never say tests were added without the passing run. If something could not be run, say what is unverified.

## Output
- **Framework:** what was detected and the command used.
- **Added:** table with file, number of tests, behaviours covered.
- **Run:** command, passed and failed counts, exit code.
- **Found:** bugs the tests exposed and how they are marked.
- **Still untested:** the next most important gaps.

## Pitfalls
- Snapshot spam: `toMatchSnapshot` on large objects asserts nothing a reader can check.
- Testing implementation details: spying on private helpers, asserting how often internal functions were called.
- Tests that pass even when the code is wrong: `expect(result).toBeDefined()`, mocking the function under test.
- Changing source code to make a test pass without saying so.
- Watch mode hangs the command: use `npx vitest run`, `jest --ci`, never `--watch`.
- Real network, real time or random data in unit tests.
- Chaining commands with `&&`: commands run in PowerShell, use `;`.
