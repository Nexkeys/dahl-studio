---
name: find
description: Locates where a feature or behaviour is implemented by searching UI strings, routes, symbols and config keys, and lists the files and functions with file:line and how they connect. Use for "where is X handled" or "which file does Y" questions.
argument-hint: "<feature, behaviour, UI text or error to locate>"
metadata:
  dahl-mode: plan
  dahl-icon: search
---

# Find where something is implemented

Looking for: $ARGUMENTS

If this is empty, call `ask_user` once with 2 to 4 likely options (main features you see in the project) for what to locate. Keep the whole run fast: a handful of searches and short reads, then answer.

## When to use
- "Where do we send the reset email?", "which component renders the pricing table?", "what handles POST /api/orders?"
- Before a change, to know which files are involved.

## When not to use
- The user wants to understand how it works in depth: `explain`.
- A tour of the whole project: `onboard-project`.
- A stack trace points somewhere and it is failing: `debug-stack-trace`. It is broken: `fix`.
- Finding code nobody uses: `dead-code`.

## Mode
Read-only: works in any mode. Uses only `list_dir`, `search` and `read_file`. Never edits files.

## Checklist
1. Orient in at most two calls: `list_dir` on the root, then `read_file` package.json (or pyproject.toml, go.mod, Cargo.toml) to learn the framework and source folders. Always exclude node_modules, dist, build, .next, coverage, vendor and lockfiles from searches (use the `glob` argument, for example `src/**/*.{ts,tsx,js,jsx}`).
2. Turn the request into search anchors, most precise first:
   - Exact UI text or error message from the request. If it lives in a locale file (`locales/*.json`, `*.po`, `messages/*.ts`), take the key and search for the key.
   - Route or URL path (`/api/orders`, `path: 'orders'`, `@app.post("/orders")`), CLI command names, event or queue names.
   - Likely symbol names in several casings: `exportCsv`, `ExportCsv`, `export_csv`, `export-csv`, `EXPORT_CSV`.
   - Config, env or feature flag keys (`STRIPE_`, `featureFlags.newCheckout`).
   - Domain nouns last, only if everything else misses (broad, noisy).
3. Search narrow to broad. Start with the exact string; widen with a regex (`toCsv|exportCsv|downloadCsv`) only if needed. Stop when the hits answer the question; do not read every match.
4. Follow the chain from the best hit: `read_file` around the hit (a range, not the whole file when it is long), then `search` for the function or component name to find callers and callees. Typical chain: UI element -> handler -> API client -> route -> service -> database or external call. Go at most 3 hops each way unless asked.
5. Note what gates or tests the behaviour: feature flags, permission checks, config, and the tests that cover it (search the function name in test files).
6. If 5 or 6 searches find nothing, stop and report what you searched, plus likely explanations: generated code, an external package, a backend outside this repo, text built at runtime.

## Verify (required before saying done)
- Every `file:line` in the answer came from a `search` hit or a `read_file` in this session. No guessed paths.
- Links you inferred without seeing a direct call (dynamic imports, string-based routing, dependency injection) are labelled "inferred".
- No files changed.
- If the answer is partial, say which part of the chain is missing.

## Output
Keep it under about 25 lines. No essays.
- **Answer:** one sentence naming where it lives.
- **Files:**

| Location | Symbol | Role |
|---|---|---|
| `src/components/Toolbar.tsx:18` | `ExportButton` | renders the button, calls `onExport` |

- **Flow:** one line, for example `Toolbar.tsx:18 onExport -> Report.tsx:42 handleExport -> lib/export.ts:5 toCsv`.
- **Also relevant:** tests, flags, config (only if found).

## Pitfalls
- Searching node_modules or build output and drowning in matches.
- Stopping at the first string match when it is a test, a story, a mock or a translation file, not the implementation.
- Missing i18n indirection: the visible text is in a locale file, the component uses a key.
- Reading whole large files instead of the lines around the hit.
- Writing an explanation of the code instead of locations.
