---
name: commit
description: Turns working tree changes into clean commits. Reads the staged and unstaged diff, splits unrelated changes into separate commits, writes Conventional Commit messages that say why, and keeps secrets and build output out. Use when the user asks to commit, save work to git or write a commit message.
argument-hint: "<optional: what the change is about, or a message to use>"
metadata:
  dahl-mode: build
  dahl-icon: git-commit
---

# Commit changes

Hint from the user: $ARGUMENTS

If the hint above is empty, write the message from the diff. If it is a complete message, use it (fix only the format), unless it clearly does not match the diff; then say so and propose a better one.

## When to use
- The user says "commit", "commit this", "save this to git", "write a commit message".
- A task is finished and the user wants it recorded in git.

## When not to use
- The user wants the change pushed and a pull request opened: use `open-pr` (it commits as one of its steps).
- Cutting a version with a tag and release notes: use `release`.
- A merge or rebase stopped with conflicts: use `resolve-conflicts` first.
- The user wants the whole repository scanned for leaked keys: use `secrets-scan`.
- The user wants feedback on the changes before committing: use `review`.

## Mode
Needs Build mode to commit (`git` `commit` is Build only and approved by the user). In Plan or Review mode, do steps 1 to 7 and return the drafted message(s) with the file list for each; do not commit, and tell the user to switch to Build to commit them.

## Checklist
1. `git` `status`: note the branch, staged files (first status column), unstaged files (second column), untracked files (`??`) and any "Unresolved conflicts".
   - Conflicts: stop and use `resolve-conflicts`.
   - "Working tree clean": say there is nothing to commit and stop. Never create an empty commit.
2. Read the changes: `git` `diff` with `staged: true`, then `git` `diff` for unstaged changes. Untracked files do not appear in a diff: `read_file` them (the first 80 lines of long ones). For long diffs, pass `path` to read one file or folder at a time.
3. Keep out what must not be committed:
   - `read_file` `.gitignore`. Never commit: `.env`, `.env.*` (except `.env.example`), `*.pem`, `*.key`, `id_rsa*`, credential JSON files, `node_modules/`, `dist/`, `build/`, `out/`, `coverage/`, `*.log`, `.DS_Store`, `Thumbs.db`, large binaries that are build products.
   - `search` the changed files for secrets, with `regex: true`, for example `AKIA[0-9A-Z]{16}|sk_live_|ghp_[A-Za-z0-9]{20,}|xox[abprs]-|-----BEGIN [A-Z ]*PRIVATE KEY-----|(password|secret|api_?key|token)\s*[:=]\s*['"][^'"]{8,}`.
   - Such a file untracked and not ignored: add its pattern to `.gitignore` with `edit_file` and leave the file out of every commit.
   - A secret inside a source file: do not commit that file. Tell the user, suggest an environment variable instead, and suggest `secrets-scan`.
4. Group the changes: one commit per logical change (a feature, a bug fix, a docs edit, a dependency bump, a formatting pass). A change and its tests go in the same commit. If everything is one change, make one commit. If one file holds two unrelated changes, keep it in one commit and mention both in the body (the git tool cannot stage part of a file).
5. House style: `git` `log` with `count` 10. If recent commits consistently follow another convention (ticket prefixes, plain sentences), follow it. Otherwise use Conventional Commits.
6. Draft each message:
   - Subject: `type(scope): summary`, imperative mood ("add", not "added"), under 72 characters, no trailing period. Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert. The scope is the area (`cart`, `auth`, `deps`) and is optional.
   - A blank line, then a body of 1 to 4 lines on why the change was made and what a reviewer must know. Not a list of files: the diff shows those.
   - Footer when it applies: `BREAKING CHANGE: <what breaks>`, `Closes #12` (only for issues the user or the code names).
7. Show the plan before committing: each group with its full message and its files.
8. Commit each group with `git` action `commit`, the `message` (subject, blank line, body) and `files` listing exactly that group's paths. Include deleted paths and both the old and new path of a rename.
   - Without `files` the tool stages everything (`git add -A`), so always pass `files` when there is more than one group or anything was left out.
   - `git commit` also records whatever was already staged. If the user staged files before you started and they belong to different groups, commit the group that contains them first, or ask with `ask_user`.
9. `git` `status` again: only the files you deliberately left out remain.

## Verify (required before saying done)
- `git` `log` with `count` equal to the number of commits you made: each new commit appears with the expected subject.
- `git` `show` with `ref` set to each new commit hash: its file list matches the group, and no `.env`, key file, build output or `node_modules` path is in it.
- `git` `status`: list what is still uncommitted and why.
- Never say "committed" without that `git log` output. If a commit was declined or failed, say which groups are still uncommitted.

## Output
- **Commits:** table with hash, subject, files.
- **Left out:** files not committed and why (secret, build output, unrelated work in progress).
- **Not done:** nothing was pushed. Offer `open-pr`, or `git_push`, if the user wants it on GitHub.

In Plan or Review mode: **Proposed commits**, each with the full message in a code block and its file list, then a line asking the user to switch to Build to commit.

## Pitfalls
- Committing without `files` and sweeping in `.env`, build output or unrelated half-finished work.
- Messages that say what ("update files", "changes", "fix stuff") instead of why.
- Subjects over 72 characters, in past tense, or ending with a period.
- One commit that mixes a refactor, a bug fix and a dependency bump, so none of them can be reverted alone.
- Adding a secret to `.gitignore` after an earlier commit already contains it: it stays in history. Tell the user to rotate the secret.
- Running git through `run_command`: always use the `git` tool.
- Pushing when the user only asked to commit.
