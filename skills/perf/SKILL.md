---
name: perf
description: Finds the most likely performance bottlenecks in slow code, measures them first and proposes or applies improvements backed by before and after numbers. Use when the user says something is slow, uses too much CPU or memory, or should be faster.
argument-hint: "<what is slow and how to trigger it>"
metadata:
  dahl-mode: review
  dahl-icon: gauge
---

# Find and fix a performance problem

Slow thing: $ARGUMENTS

If this is empty or does not say what is slow, call `ask_user` once with options such as "an API endpoint", "a page or UI interaction", "a script or build step", "the test suite", then continue.

## When to use
- "This endpoint takes 4 seconds", "the import script is slow on big files", "CPU is pegged", "memory keeps growing".
- Before optimising anything, to find where the time actually goes.

## When not to use
- Page load metrics (LCP, CLS, INP) and Lighthouse scores: `web-vitals`.
- The JavaScript download is too big: `bundle-size`.
- The time is spent in database queries (N+1, missing index): `slow-queries`.
- It is wrong, not slow: `fix`. A test is slow only sometimes or times out randomly: `flaky-test`.

## Mode
Static analysis works in any mode. Measuring and changing code needs Build mode (`run_command`, `write_file`, `edit_file`). In Plan or Review mode, do steps 1 to 3, give ranked hypotheses with `file:line` and the exact commands that would measure them, and ask the user to switch to Build. Do not present an unmeasured idea as a speedup.

## Checklist
1. `update_plan` with: metric, static pass, baseline, profile, change, re-measure.
2. Define the metric and the workload: which operation, which input size, which number (ms per call, requests per second, p50 and p95, total runtime, peak memory). Find or build a repeatable trigger: an existing test, a CLI command, a URL, or a small bench script.
3. Static pass: `search` and `read_file` the hot path from the entry point down. Look for:
   - Work repeated inside loops: queries, HTTP calls, file reads, `JSON.parse`, regex construction, sorting.
   - Quadratic patterns: nested loops over the same data, `array.includes`, `indexOf` or `find` inside a loop (use a `Set` or `Map`).
   - Synchronous IO on a request path: `readFileSync`, `execSync`, `fs.*Sync` in handlers.
   - Serial `await` in a loop where calls are independent (use `Promise.all` with a concurrency limit).
   - Loading everything then filtering in memory; no pagination or streaming.
   - Missing caching of a pure, expensive result that is recomputed per request.
   - React: state high in the tree causing large re-renders, new object or function props every render, expensive work in render without `useMemo`, long lists without virtualisation.
   Rank hypotheses by expected impact. Database-shaped problems go to `slow-queries`.
4. Baseline (Build mode). Run each measurement 3 to 5 times and use the median:
   - Node script: `Measure-Command { node scripts/report.js } | Select-Object TotalMilliseconds`.
   - Node function: a bench script with warm-up and `performance.now()` over N iterations, printing the median.
   - Node profile: `node --cpu-prof --cpu-prof-dir=.prof scripts/report.js`, then read the top self-time functions from the `.cpuprofile` (or `node --prof` plus `node --prof-process`).
   - HTTP endpoint: `npx autocannon -c 10 -d 10 http://localhost:3000/api/report` (p50, p99, req/s), or `Measure-Command { Invoke-WebRequest http://localhost:3000/api/report -UseBasicParsing }`.
   - Python: `python -m cProfile -s cumtime scripts/report.py`, `python -m timeit -s "from m import f" "f()"`, `py-spy record -o profile.svg -- python script.py` if installed.
   - Tests: `npx vitest run --reporter=verbose`, `python -m pytest --durations=10`.
5. Match the profile to the hypotheses. Drop hypotheses the data does not support; add new ones the profile reveals.
6. Change one thing at a time with `edit_file`, the smallest change that removes the cost: hoist work out of the loop, `Set` or `Map` lookups, batch calls, cache with a clear invalidation rule, stream instead of loading whole files, async IO. Behaviour must stay identical (same output, same order).
7. Re-measure with the same command, input and number of runs. Keep the change only if the gain is clearly larger than run-to-run variance; otherwise revert it. Run the tests after every kept change.
8. Repeat for the next bottleneck until the target is met or the remaining gains are small. Delete throwaway bench files and profile output you created, or tell the user where they are.

## Verify (required before saying done)
- A before and after number for every claimed improvement, from the same command and input, with the number of runs.
- Tests pass after the changes: command and exit code.
- Never claim a speedup without measured numbers. Ideas you did not measure go under "Unmeasured ideas" and are labelled as expectations.
- State the environment limits: local machine, dataset size, cold or warm cache.

## Output
- **Bottleneck:** `file:line`, what it does, and the evidence (profile entry or timing).
- **Results:**

| Change | Command | Before (median) | After (median) | Delta |
|---|---|---|---|---|

- **Tests:** command and result.
- **Unmeasured ideas:** next candidates, ranked, with how to measure each.

## Pitfalls
- Optimising code the profile shows is cold.
- Measuring a debug or dev build, or comparing a cold first run with a warm second run.
- Single-run comparisons inside normal noise.
- Changing behaviour while optimising: stale caches, lost ordering from `Promise.all`, dropped error handling.
- Unbounded `Promise.all` over thousands of items that overloads the database or an API.
- Reporting "3x faster" from reasoning instead of measurement.
