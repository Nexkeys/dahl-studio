---
name: flaky-test
description: Diagnoses a test that passes and fails at random. Measures the failure rate over many runs, finds the cause (timing, shared state, order, network, randomness, time zones, parallelism), fixes it without retries and proves it. Use when a test is flaky or intermittent.
argument-hint: "<test name or file, plus any failing output>"
metadata:
  dahl-mode: build
  dahl-icon: shuffle
---

# Fix a flaky test

Flaky test: $ARGUMENTS

If no test is named, ask for it with `ask_user`, or, when CI shows it, read the failing job with `github` `ci_logs` and take the test name from there.

## When to use
- "This test fails about one run in ten", "passes locally, fails in CI sometimes", "fails only when the whole suite runs".
- A test that started failing intermittently after an unrelated change.

## When not to use
- The test fails every time: use `fix` (or `debug-stack-trace` with the error output).
- The whole CI job is red for a known reason: use `fix-ci`.
- A product bug happens only sometimes and no test shows it yet: use `reproduce-first`.

## Mode
Needs Build mode (runs tests many times and edits files). In Plan or Review mode, read the test, its setup and the code under test, report the most likely cause category with the evidence lines, the fix you would make and the commands you would use to prove it, then ask the user to switch to Build.

## Checklist
1. `update_plan` with: locate, measure, classify, reproduce, fix, prove.
2. Locate: `search` for the test name; `read_file` the test file, its hooks (`beforeAll`, `beforeEach`, `afterEach`), shared setup (vitest `setupFiles`, jest `setupFilesAfterEnv`, conftest.py) and the code under test. If CI output exists, collect the exact failure message.
3. Measure the failure rate, alone and in context. Use `run_command` with a high `timeout_seconds` (up to 900).
   - PowerShell loop, works for any runner:
     `$fail = 0; 1..30 | ForEach-Object { npx vitest run src/cart.test.ts -t "adds item" *> $null; if ($LASTEXITCODE -ne 0) { $fail++ } }; "failed $fail of 30"`
     Swap the inner command for `npx jest src/cart.test.ts -t "adds item" --ci`, `node --test test/cart.test.js` or `python -m pytest tests/test_cart.py::test_adds_item -q`.
   - vitest: temporarily add `{ repeats: 50 }` as the options argument of the test (`test('adds item', { repeats: 50 }, ...)`) and remove it afterwards.
   - pytest: `--count=50 -x` when pytest-repeat is installed (`python -m pip show pytest-repeat`).
   - Go: `go test ./cart -run TestAddsItem -count=100 -race`.
   - Then run the whole file and the whole suite a few times. Fails only with the suite: shared state or order. Fails alone too: timing, randomness, clock or environment.
4. Vary order and parallelism to confirm the category:
   - Order: vitest `--sequence.shuffle --sequence.seed=123`, jest `--randomize --seed=123`, pytest-randomly `-p randomly --randomly-seed=123` (or `-p no:randomly` to turn it off), Go `-shuffle=on`.
   - Parallelism: vitest `--no-file-parallelism`, jest `--runInBand`, pytest-xdist `-n 0`, Go `-p 1 -parallel 1`.
5. Classify the cause with evidence (a line of code, a seed, a time):
   - Timing and async: missing `await`, fixed `setTimeout` waits, assertions before a promise settles, debounce. Fix: await the real promise, use fake timers (`vi.useFakeTimers`, `jest.useFakeTimers`), or wait for a condition (`vi.waitFor`, `expect.poll`, Testing Library `waitFor`).
   - Shared state: module-level arrays or caches, singletons, env vars, mocks not restored, fixed temp file names, database rows. Fix: reset in `beforeEach`/`afterEach`, `vi.restoreAllMocks()`, fresh instances, unique temp dirs (`fs.mkdtemp`, pytest `tmp_path`).
   - Order dependence: a test relies on another test's side effect. Fix: each test arranges its own state.
   - Real network or services: HTTP calls, DNS, third-party APIs. Fix: mock at the boundary (msw, nock, respx, responses) or a local fake.
   - Randomness: `Math.random`, uuids, faker without a seed. Fix: fixed inputs or a seeded generator, including the boundary values.
   - Clock and time zones: `Date.now()`, `new Date()`, `date.today()`, month ends, DST, CI running in UTC. Fix: inject or freeze the clock (`vi.setSystemTime`, freezegun), compare in one explicit zone.
   - Parallel resources: same port, file or database across workers. Fix: port 0, unique names, per-worker resources.
   - Unordered results: object key or Set order, SQL without `ORDER BY`, `Promise.all` side effects. Fix: sort, or assert on membership.
6. Make the failure deterministic when you can (force the seed, clock, time zone or order that fails), so the fix can be proven rather than hoped.
7. Fix the cause with `edit_file`. If the code under test has a real race or time zone bug, the fix belongs in the code: say so, because users hit it too.
8. Retries, longer timeouts and `.skip` are not fixes. Use them only when the nondeterminism is outside the project's control, with a comment explaining why, and after `ask_user`.
9. Remove temporary `repeats`, `.only` and debug logging.

## Verify (required before saying done)
- The forced failing condition from step 6 now passes.
- The loop from step 3 shows zero failures over at least 30 runs, or three times the number of runs it took to see a failure, whichever is larger. Show before and after ("failed 4 of 30" then "failed 0 of 60").
- The full file and suite pass, including one shuffled run when the runner supports it.
- If you never saw it fail, say so. Present the likely cause from code reading and your change as unverified; do not claim the flake is fixed.

## Output
- **Test:** name and file.
- **Failure rate before:** N of M, alone and in the suite.
- **Cause:** category and the evidence (line, seed, time, order).
- **Fix:** what changed, in the test or in the code, and why.
- **Failure rate after:** N of M, plus the suite result.
- **Remaining risk:** anything still nondeterministic.

## Pitfalls
- Calling it fixed after one green run.
- Adding `retry`, raising timeouts or adding sleeps to hide the cause.
- Turning off parallelism for the whole suite to hide shared state.
- Fixing the test when the code has the race.
- Leaving `.only`, `repeats` or a forced seed in the committed test.
- Counting failures wrongly: read `$LASTEXITCODE` right after the command inside the loop.
- Chaining commands with `&&`: commands run in PowerShell, use `;`.
