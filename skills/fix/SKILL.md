---
name: fix
description: Finds and fixes a reported bug from evidence. Reproduces it, traces the root cause, makes the smallest correct change and proves it with a test or command. Use when the user says something is broken, wrong or crashing; not for new features.
argument-hint: "<what is broken and how to see it>"
metadata:
  dahl-mode: build
  dahl-icon: bug
---

# Fix a bug

Bug report: $ARGUMENTS

If the report above is empty or too vague to act on (no symptom, no place to look), call `ask_user` once with 2 to 4 options for what is broken, then continue.

## When to use
- Something that used to work is broken, gives a wrong result, throws, or crashes.
- The user names a symptom ("the total is off by one", "login returns 500").

## When not to use
- The user pasted a stack trace and nothing else: use the `debug-stack-trace` skill (call `use_skill`).
- The bug cannot be reproduced yet and the cause is unclear: use `reproduce-first`.
- A test fails only sometimes: use `flaky-test`. CI is red: use `fix-ci`.
- It is a feature request or a redesign. Say so and ask before building it.

## Mode
Needs Build mode (edits files and runs commands). In Plan or Review mode, do steps 1 to 4, report the root cause and the exact fix you would make, and ask the user to switch to Build.

## Checklist
1. `update_plan` with: reproduce, root cause, fix, regression test, verify.
2. Find the code: `search` for the error text, function, route or UI label from the report; `read_file` the hits and their callers. Read before you edit, always.
3. Reproduce with evidence before changing anything:
   - Find the test command (`read_file` package.json scripts, pyproject.toml, Makefile, Cargo.toml).
   - Run the narrowest existing test that covers the area with `run_command` (for example `npx vitest run src/cart.test.ts`, `python -m pytest tests/test_cart.py -q`).
   - If no test shows the bug, write a failing test first (`write_file` or `edit_file`) that encodes the expected behaviour, and run it. It must fail for the reported reason, not for a typo in the test.
4. Root cause: explain in one or two sentences why the code does the wrong thing (which line, which assumption). If two causes are plausible, check each with `read_file` or a quick command instead of guessing. Use `git` `log` with `path` to see whether a recent change introduced it.
5. Fix: the smallest change that addresses the cause, with `edit_file`. Do not refactor, rename or reformat unrelated code. If the fix needs a decision the user should make (behaviour change, API change), call `ask_user`.
6. Look for siblings: `search` for the same pattern elsewhere (copy-pasted logic, the same wrong assumption). Fix them only if they are clearly the same bug; otherwise list them.
7. Keep the failing test from step 3 as a regression test.

## Verify (required before saying it is fixed)
- Run the test from step 3 with `run_command`: it must now pass (exit code 0).
- Run the wider suite or at least the test files for the touched modules, plus the type check or linter if the project has one (`npm run typecheck`, `npx tsc --noEmit`, `ruff check`). Exit code 0, or explain each failure and show it existed before your change (`git` `stash` is not needed: compare with the failing output you captured in step 3).
- If there is no test runner at all, show the behaviour with a command (for example `node -e "..."`) before and after the fix.
- Never say "fixed" without command output that proves it. If you could not verify, say exactly what is unverified.

## Output
- **Cause:** one or two sentences, with `file:line`.
- **Fix:** what changed and why it is enough.
- **Proof:** the command(s) run and their result (pass counts, exit codes).
- **Also seen:** similar spots found in step 6, fixed or not.

## Pitfalls
- Patching the symptom (a special case, a try/catch that hides the error) instead of the cause.
- Changing the test to match the buggy behaviour.
- Editing before reproducing, then being unable to show the fix did anything.
- Chaining commands with `&&`: commands run in PowerShell, use `;`.
- Large unrelated diffs: they hide the fix and make review harder.
