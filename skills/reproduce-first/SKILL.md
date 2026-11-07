---
name: reproduce-first
description: Builds a minimal, reliable reproduction (failing test or script) of a vague or intermittent bug before any code changes, reports repro steps and hands off to fix. Does not fix unless asked. Use when a bug is unclear or happens only sometimes.
argument-hint: "<the bug report as you have it>"
metadata:
  dahl-mode: build
  dahl-icon: repeat
---

# Reproduce first

Bug report: $ARGUMENTS

If the report is empty, call `ask_user` once: what happens, what was expected, and where (2 to 4 options based on the main areas of the app). If details are missing but there is enough to start, do not block: try the most likely variant first and list the open questions in the answer.

## When to use
- "Sometimes the total is off by a cent", "users say export dates are wrong", "it crashed once for a customer".
- Before fixing anything where the trigger is unknown, so the fix can be proven later.

## When not to use
- The bug is clear and reproduces on demand: use `fix` directly.
- The user pasted a stack trace: use `debug-stack-trace` (it reproduces as part of its work).
- An existing test passes and fails at random: use `flaky-test`. Only CI is red: use `fix-ci`.
- Slowness rather than wrong behaviour: use `perf`.

## Mode
Needs Build mode (writes a repro test or script and runs it). In Plan or Review mode, do steps 1 to 4, write the proposed repro test in the answer as a code block with the command to run it, and ask the user to switch to Build.

## Checklist
1. `update_plan` with: facts, code paths, hypotheses, probe, minimize, report.
2. Pull the facts out of the report: observed behaviour, expected behaviour, where (screen, route, function, file), since when, how often, environment (OS, browser, Node or Python version, time zone, locale, data). Mark each unknown.
3. Find the code path: `search` for UI labels, route paths, error text and function names from the report; `read_file` the hits and the data they consume. `git` `log` on those paths for recent changes.
4. List 2 to 4 concrete hypotheses for the trigger and rank them. Common triggers:
   - Input shape: empty, one item, very large, unicode and accents, whitespace, decimal comma, negative numbers, floating point values like 1.005.
   - Time: time zones, DST changes, month ends, leap days, `Date.now()` near midnight UTC vs local.
   - State and order: cache warm vs cold, second call, retries, concurrent requests, event order.
   - Environment: Windows paths with spaces or backslashes, CRLF line endings, case-insensitive file names, locale.
5. Probe each hypothesis with the cheapest check that runs real code:
   - A new test next to the existing ones, named for the bug (`src/total.repro.test.ts`, `tests/test_export_repro.py`), or a case added to an existing test file.
   - A script when there is no test setup: `scripts/repro-<slug>.mjs` run with `node`, or `scripts/repro_<slug>.py` run with `python`.
   - Make hidden variables explicit: fixed seeds, fake clocks (`vi.setSystemTime('2024-03-31T23:30:00Z')`, freezegun), a time zone (`$env:TZ='America/New_York'; node --test`), `Promise.all` for concurrency.
   - Run with `run_command`, for example `npx vitest run src/total.repro.test.ts`, `node --test test/total.repro.test.js`, `python -m pytest tests/test_export_repro.py -q`.
6. For intermittent bugs, measure the rate instead of trusting one run:
   `$fail = 0; 1..30 | ForEach-Object { node scripts/repro-total.mjs *> $null; if ($LASTEXITCODE -ne 0) { $fail++ } }; "failed $fail of 30"`
   Then remove the randomness (seed, clock, order) until it fails every time, or report the measured rate.
7. Minimize: strip the repro to one input and one call that still fails. Confirm it fails for the reported reason (same wrong value or same error message), not because of a typo, import error or missing fixture.
8. Do not change source code. Leave the repro as a plain failing test or script and say so. Only if the user wants to commit before a fix, mark it as a known failure (`it.fails`, `test.failing`, `@pytest.mark.xfail(strict=True, reason="...")`).
9. Hand off: offer to fix it now with the `fix` skill (`ask_user`), passing the repro path and the command. Fix only if the user says yes.

## Verify (required before reporting)
- Run the final repro with `run_command` and show the failing output: exit code and the assertion or error that matches the report.
- For intermittent bugs, show the rate from the loop (for example "failed 30 of 30 with TZ=America/New_York, 0 of 30 with UTC").
- `git` `diff` shows only new repro files or added test cases, no source changes.
- If nothing reproduced, say "not reproduced", list each hypothesis and its result, and name the information that would help (logs, input file, time zone). Never claim a reproduction you did not run.

## Output
- **Reproduced:** yes, no, or partly (rate N of M).
- **Steps:** numbered, with the exact command to run.
- **Repro file:** path.
- **Observed vs expected:** values or messages.
- **Likely cause (not confirmed):** `file:line` and one sentence.
- **Next:** offer to run `fix` with this repro.

## Pitfalls
- Fixing the bug in passing. This skill stops at a proven reproduction.
- A repro that fails for the wrong reason (import error, wrong path) and is reported as success.
- Declaring an intermittent bug reproduced from a single run.
- Copying real customer data into a repro. Build synthetic data with the same shape.
- Depending on the network or a third-party service in the repro.
- Chaining commands with `&&`: commands run in PowerShell, use `;`.
