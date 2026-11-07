---
name: resolve-conflicts
description: Resolves merge or rebase conflicts. Lists the conflicted files, reads both sides and the commits behind them, writes a resolution that keeps both intents, removes every marker, runs the build and tests, then commits (or aborts if the user prefers) and explains each resolution. Use when a merge, pull or rebase stops with conflicts or files contain conflict markers.
argument-hint: "<optional: branch being merged, or files to resolve>"
metadata:
  dahl-mode: build
  dahl-icon: git-merge
---

# Resolve merge conflicts

Context: $ARGUMENTS

If the context is empty, find the conflicts yourself (step 2).

## When to use
- `git pull`, `git merge` or a rebase stopped with "conflicts in ...".
- Files contain `<<<<<<<`, `=======` and `>>>>>>>` markers, including markers that were committed by mistake.
- GitHub says "This branch has conflicts that must be resolved" (merge the base into the branch locally with `git` `merge`, then resolve here).

## When not to use
- No conflicts, the user just wants to commit: use `commit`.
- The merge went through but tests now fail: use `fix`. CI fails: use `fix-ci`.
- The user wants to undo a merge that is already committed: explain the options; the git tool does not rewrite history.

## Mode
Needs Build mode (edits files, runs tests, commits). In Plan or Review mode, do steps 1 to 4, give the proposed resolution for each conflict (the final code and why), and ask the user to switch to Build.

## Checklist
1. `update_plan` with: list conflicts, understand both sides, resolve each file, check for markers, build and test, finish.
2. List the conflicts:
   - `git` `status`: its "Unresolved conflicts:" line names the files.
   - `search` with `regex: true` for `^(<{7}|>{7})( |$)` to catch markers git does not flag (committed by mistake, or in files git treats as resolved).
   - What is in progress: `read_file` `.git/MERGE_MSG` (exists during a merge and names the branch). In Build mode: `run_command` `Test-Path .git/MERGE_HEAD, .git/rebase-merge, .git/rebase-apply`.
3. Understand each side before editing:
   - Merge: the block from `<<<<<<< HEAD` to `=======` is the current branch (ours); from `=======` to `>>>>>>> <branch>` is the incoming branch (theirs). A `|||||||` block (diff3 style) is the common ancestor and shows what each side changed.
   - Rebase: the labels flip. `HEAD` is the branch you are rebasing onto; the other side is your own commit being replayed.
   - The why: `git` `log` with `path` (our commits on that file), `git` `log` with `ref` `MERGE_HEAD` and `path` (their commits), and `git` `show` with a commit hash for the full change.
4. Decide each hunk so both intents survive: both new functions, both new config keys, both imports (once each), a renamed function plus the other side's new calls updated to the new name. Take one side wholesale only when the other side's change is truly superseded, and say why. When both sides changed the same value and the right answer is a product decision (timeout 5000 or 10000), ask with `ask_user`.
5. Lock files and generated files: never hand-merge `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` or `poetry.lock`. Resolve the manifest first, then regenerate (`npm install`, `pnpm install`, `yarn install`, `poetry lock --no-update`). Rebuild generated files instead of merging them.
6. Edit with `edit_file`, replacing the whole block from `<<<<<<<` through `>>>>>>>` with the resolved code. `read_file` the result to check syntax, indentation and duplicates.
7. No markers left: `search` with `regex: true` for `^(<{7}|={7}|>{7})( |$)`. No hits in source files. (A line of seven `=` can be a Markdown heading underline; check those by eye.)
8. Build and test with `run_command`: `npm run build; npm test`, `npx tsc --noEmit`, `python -m pytest -q`. Resolved JSON files: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"`.
9. Finish:
   - Merge in progress: `git` `commit` with `files` listing the resolved files and a message such as `merge: feature/logging into main` (or the default text from `.git/MERGE_MSG`).
   - Markers committed by mistake (nothing in progress): `git` `commit` with `files` and a message such as `fix: resolve leftover merge conflict in src/config.js`.
   - Rebase in progress: the git tool has no rebase action. Ask the user to run `git add -A; git rebase --continue` in the terminal, or `git rebase --abort` to undo the rebase.
   - The user prefers to give up the merge: `git` `merge_abort`.

## Verify (required before saying done)
- The marker search from step 7 returns no hits in source files.
- `git` `status` shows no "Unresolved conflicts".
- Build and test commands with exit codes: 0, or failures shown to exist on one of the sides before the merge.
- The new commit from `git` `log` with `count` 1, or the rebase or abort step the user still has to run.
- Never say "resolved" with markers left or tests not run. Name the resolutions that were judgment calls.

## Output
- **Operation:** merge or rebase, which branch into which (or "leftover markers").
- **Resolutions:** table with file, conflict in one line, what was kept and why.
- **Judgment calls:** decisions the user should double-check.
- **Proof:** marker search result, build and test exit codes, commit hash.

## Pitfalls
- Taking ours or theirs for the whole file and silently dropping the other side's work.
- Keeping both sides verbatim: duplicate imports, two definitions of one function, invalid JSON from a missing or extra comma.
- A stray `=======` or `>>>>>>>` line left in a file type that still parses (Markdown, YAML strings) and ships.
- Hand-merging lock files.
- Mixing up ours and theirs during a rebase.
- Committing before running the build and tests.
- Running git through `run_command`: use the `git` tool. Rebase continue and abort are for the user to run.
