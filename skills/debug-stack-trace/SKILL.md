---
name: debug-stack-trace
description: Turns a pasted stack trace or crash log into a fix. Maps frames to project files, skips library frames, reproduces the error, fixes the root cause and adds a regression test. Use when the user pastes a traceback, exception or crash log.
argument-hint: "<paste the stack trace or error output>"
metadata:
  dahl-mode: build
  dahl-icon: bug
---

# Debug from a stack trace

Trace and context: $ARGUMENTS

If no trace was pasted, ask the user to paste the full error output (including any "Caused by" or "During handling" parts) and how they triggered it. If they only describe a symptom, use the `fix` skill instead.

## When to use
- The user pastes a Node, browser, Python, Java/Kotlin, Go, .NET or Rust error with frames.
- A crash log or uncaught exception output from the app or a script.

## When not to use
- Only a symptom, no trace: use `fix`.
- The error cannot be triggered on demand and you do not know the inputs: use `reproduce-first`.
- The trace comes from a red CI job: use `fix-ci` (it reads the job log first).
- A test fails only sometimes: use `flaky-test`. Compiler or type checker output: use `fix-types-and-lint`.

## Mode
Needs Build mode (runs the reproduction, edits files). In Plan or Review mode, do steps 1 to 6, report the first project frame, the root cause and the exact fix you would make, and ask the user to switch to Build.

## Checklist
1. `update_plan` with: parse trace, locate frame, reproduce, fix, regression test, verify.
2. Parse the trace. Write down the error type, the message and the innermost cause (`Caused by:`, `[cause]:`, Python "The above exception was the direct cause" or "During handling of the above exception"). Frame order differs by language:
   - Node and browser: `at fn (C:\path\file.js:12:5)` or `at file:///.../file.js:12:5`; the throw site is the first frame. Async frames show as `at async fn`.
   - Python: "most recent call last"; the throw site is the last frame.
   - Java and Kotlin: `at com.acme.Foo.bar(Foo.java:42)`, throw site first; read the last `Caused by:` block.
   - Go: `panic:` then goroutine frames, `file.go:42 +0x1d`, throw site first.
   - .NET: `at Ns.Class.Method() in C:\src\File.cs:line 42`. Rust: set `$env:RUST_BACKTRACE=1` to get frames.
3. Classify frames. Library frames: `node_modules`, `node:internal`, `<anonymous>`, `site-packages`, `dist-packages`, `<frozen ...>`, `java.`, `kotlin.`, `runtime/`, `System.`. Project frames: paths inside this repo. Find the first project frame counted from the throw site; that is where to start. Also note the outermost project frame (the entry point of the call) for context.
4. Map paths to this checkout:
   - Paths from CI or another machine (`/home/runner/work/app/app/src/x.ts`, `D:\a\app\src\x.ts`) become repo-relative (`src/x.ts`).
   - Built output (`dist/`, `build/`, `.next/`, minified `chunk-abc123.js`) is not the source: `search` for the function name or the error message text to find the source file. Line numbers in compiled output do not match the source.
5. `read_file` the first project frame with about 30 lines of context, then the caller frame. Work out which value is wrong: which variable is undefined, which key is missing, which argument has the wrong type, and where that value came from.
6. If the throw is inside a library, the cause is usually how the project called it (wrong argument, missing await, version mismatch). Check the installed version with `npm ls <pkg>` or `python -m pip show <pkg>` and compare with the API you see being used. Read library source only when needed.
7. Reproduce before fixing. The smallest command that produces the same error type and message:
   - An existing test (`npx vitest run src/x.test.ts`, `node --test test/x.test.js`, `python -m pytest tests/test_x.py -q`).
   - A new failing test with the input that triggers it (preferred, it becomes the regression test).
   - A one-off script: `node -e "..."` or `python -c "..."`.
   If you cannot reproduce after two or three focused attempts, stop guessing and switch to `reproduce-first` with what you learned.
8. Fix the root cause with `edit_file`: the smallest change that makes the bad value impossible or handled correctly. Do not wrap the call in a try/catch that hides the error. If the right behaviour is a product decision (skip the row? show an error?), call `ask_user`.
9. `search` for the same pattern elsewhere (other callers passing the same shape). Fix clear duplicates; list the rest.
10. Keep the failing test from step 7 as the regression test.

## Verify (required before saying it is fixed)
- The reproduction from step 7 now passes, and the original error message no longer appears in the output. Show the command and exit code.
- Run the test files for the touched modules, plus the type check or linter if the project has one (`npx tsc --noEmit`, `ruff check .`).
- Never say "fixed" without command output. If the error only happens in production or with data you do not have, say what is unverified and how the user can confirm.

## Output
- **Error:** type and message, one line.
- **First project frame:** `file:line` and function; the library frames you skipped, in one line.
- **Cause:** one or two sentences: which value was wrong and why.
- **Fix:** what changed.
- **Proof:** reproduction command before (failing) and after (passing), plus the wider test run.
- **Also seen:** similar call sites.

## Pitfalls
- "Fixing" the top frame when it is inside `node_modules` or `site-packages`.
- Reading a Python traceback top-down as if the first frame threw.
- Ignoring the `Caused by` chain and fixing the wrapper exception.
- Trusting line numbers from compiled or minified output.
- Swallowing the error with try/catch, `?.` everywhere, or `except Exception: pass`.
- Paths with a different drive or user folder: map them, do not conclude the file is missing.
- Chaining commands with `&&`: commands run in PowerShell, use `;`.
