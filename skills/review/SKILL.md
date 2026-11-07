---
name: review
description: Reviews code changes or a named target for bugs, security holes and risky design, using parallel code and security reviewers for large diffs, and returns one prioritised list with file:line and fixes. Use when the user asks for a review before merging or committing.
argument-hint: "<files, folder, branch or commit (default: uncommitted changes)>"
metadata:
  dahl-mode: review
  dahl-icon: users
---

# Review code

Target: $ARGUMENTS

If the target is empty, review the uncommitted changes (`git` `status` and `diff`). If there are none, review the last commit (`git` `show`). If the folder is not a git repository and no target was given, call `ask_user` once with 2 to 4 options (likely folders or files) for what to review.

## When to use
- "Review my changes", "look over this before I merge", "anything wrong with this file?"
- A second pass after a large change, before committing or opening a PR.

## When not to use
- A GitHub pull request by number or URL: use the `review-pr` skill (call `use_skill`).
- A full security assessment of the project: `security`. Login and permissions only: `auth-review`. Leaked keys: `secrets-scan`.
- Only speed matters: `perf`. Something is already known to be broken: `fix`. The user wants to understand code, not judge it: `explain`.
- The user wants the cleanup applied, not listed: `refactor`.

## Mode
Read-only: works in any mode. Do not edit files or run commands during the review, even in Build mode. If the user then asks to apply findings, apply only the ones they pick (Build mode, `edit_file`, then run the tests).

## Checklist
1. `update_plan` with: scope, read context, review, verify findings, report.
2. Scope the change:
   - Uncommitted: `git` `status`, then `git` `diff` (staged and unstaged).
   - Branch or commit: `git` `log` to find the commits, `git` `show` or `git` `diff` against the base branch.
   - Path: `list_dir`, then `read_file` each file.
   Count files and changed lines. Skip lockfiles, generated code, snapshots and build output; list them as not reviewed.
3. Read context, not just hunks: `read_file` the whole function around each change, `search` for callers of changed functions and for the types they use. Note project conventions from package.json, tsconfig.json, lint config, and nearby tests.
4. Pick the approach by size:
   - Small (about 5 files and 300 changed lines or fewer): review directly with the checklist in step 5.
   - Larger: one `delegate_agents` call with exactly two agents, both scoped to the changed files only:
     - `code_reviewer`: "Review only these changes for correctness, edge cases, error handling, async misuse, API or behaviour changes, missing tests. For each issue give severity, file:line, why it is wrong, and the fix."
     - `security_reviewer`: "Review only these changes for injection (SQL, command, template), missing authn or authz, IDOR, input validation, path traversal, SSRF, XSS, unsafe eval or deserialisation, secrets, risky dependency changes. Same output fields."
     Pass the file list in `files` and describe the diff scope (commit range or "uncommitted") in `task`.
5. What to look for (direct review, and to check delegated output):
   - Correctness: off-by-one, null or undefined access, wrong operator or comparison, missing `await`, unhandled promise rejection, mutated shared state, wrong default, timezone and float money math.
   - Errors: swallowed exceptions, empty `catch`, error paths that leave partial writes, missing transaction.
   - Boundaries: unvalidated request input, missing auth or ownership check on new routes, string-built SQL or shell commands.
   - Data: migrations that lock or drop data, schema changes without a migration, breaking API response shape.
   - Tests: is the changed behaviour covered? Did a test get weakened or deleted?
   - Performance hot spots: query or network call inside a loop, synchronous file IO in a request handler.
   - Low priority: naming, dead code, duplication. Report at most 5 of these.
6. Verify every finding yourself with `read_file` on the cited lines and the code that calls them. Drop findings that do not hold (input already validated upstream, line does not exist, behaviour intended per a comment or test). Delegated output is a draft, not a result.
7. Merge and rank: remove duplicates (same root cause reported twice), then assign severity:
   - Critical: exploitable security hole, data loss or corruption.
   - High: a bug users will hit, broken contract for callers.
   - Medium: edge case, missing test for risky logic, error handling gap.
   - Low: readability, naming, small duplication.

## Verify (required before saying done)
- Every finding cites a `file:line` you read in this session, and the fix is concrete (code or exact change), not "consider improving".
- No files changed: the review is read-only. If you are unsure, `git` `status` must look the same as at the start.
- Tests, type checks and linters were not run by this skill: say so, and name the command the user can run (for example `npm test`, `npx tsc --noEmit`, `python -m pytest -q`).
- Never claim "no issues" without listing what you read. State what was skipped.

## Output
- **Verdict:** one line (for example "Fix 2 issues before merging" or "Ready to merge"), with counts per severity.
- **Findings** (most severe first), one table:

| Severity | Location | Problem | Why it matters | Fix |
|---|---|---|---|---|
| High | `src/api/orders.ts:42` | ... | ... | ... |

- **Questions for the author:** behaviour you could not judge from the code (optional).
- **Not reviewed:** skipped files, unread areas, commands not run.

## Pitfalls
- Reviewing the whole repository when the user asked about a diff.
- Pasting both delegated reports unmerged and unverified; they overlap and sometimes cite lines that do not exist.
- Delegating for a 30-line change: slower and no better than reading it yourself.
- Flagging missing validation that already happens in middleware or a schema you did not read.
- Burying one real bug under twenty style nits.
- Editing files during a review the user did not ask to have applied.
