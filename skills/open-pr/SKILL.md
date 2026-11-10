---
name: open-pr
description: Opens a GitHub pull request for the current work. Moves it off the default branch, runs tests and build, commits with a clear message, pushes, creates the PR with a description of what, why, how it was tested and the risks, then checks CI. Use when the user asks to open, create or send a pull request.
argument-hint: "<optional: title, base branch, or draft>"
metadata:
  dahl-mode: build
  dahl-icon: git-pull-request
---

# Open a pull request

Request: $ARGUMENTS

If the request is empty, take the title and description from the changes. The word "draft" opens a draft PR. A branch name is the base to merge into (default: the repository's default branch).

## When to use
- "Open a PR", "send this for review", "create a pull request for this change".
- A feature or fix is done and the user wants it reviewed on GitHub.

## When not to use
- Only a local commit: use `commit`.
- Reviewing someone else's pull request: use `review-pr`.
- The PR's CI is failing: use `fix-ci`.
- The branch conflicts with its base: use `resolve-conflicts`.
- Publishing a version: use `release`.

## Mode
Needs Build mode (branch, commit, push and PR creation, each approved by the user). In Plan or Review mode, do steps 2 and 3, draft the branch name, commit message, PR title and description, and ask the user to switch to Build.

## Checklist
1. `update_plan` with: state, branch, test and build, commit, push, open PR, check CI.
2. State: `git` `status` (branch, changed files, ahead and behind) and the default branch (`github` `repo_info`, or `git` `branches`). No changes and no commits ahead of the base: there is nothing to open; say so and stop.
3. Read the change you will describe: `git` `diff`, `git` `diff` with `staged: true`, and `git` `log` with `count` 10 for commits already on the branch.
4. Branch: on the default branch, `git` `create_branch` with a short name from the change, such as `feat/csv-export`, `fix/login-redirect`, `docs/setup-guide`. Uncommitted changes move with you. Already on a feature branch: stay on it.
5. Tests and build with `run_command`, using the project's commands: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`; `python -m pytest -q`, `ruff check .`.
   - A failure caused by this change: fix it first (or use `fix`).
   - A failure that existed before this change: stop and tell the user. Open the PR only if they want it, as a draft, with the failure written in the description.
6. Commit: `git` `commit` with `files` (this change only; never `.env` or build output) and a Conventional Commit message, for example `feat(export): add CSV export for invoices`. Several unrelated changes: group them as the `commit` skill describes.
7. Push: `git_push` (the current branch to origin). No origin: ask the user for the repository link and pass it as `remote_url`. A declined or failed push ends here: report it and give the drafted PR text.
8. Open the PR: `github` `create_pr` with
   - `title`: the main commit subject, under 72 characters;
   - `base`: the target branch if the user named one;
   - `draft: true` when the user said draft, the work is unfinished, or a check fails;
   - `body` in this shape:
     ```markdown
     ## What
     One to three sentences on the change.

     ## Why
     The problem or request it answers. Closes #123 (only when the user or a commit names the issue).

     ## How tested
     - `npm test`: 48 passed
     - Manually: opened /invoices, exported a CSV, opened it in Excel

     ## Screenshots
     UI changes only: before and after.

     ## Risks
     Migrations, config or environment changes, breaking API changes, rollout notes. "Low" with a reason if none.
     ```
9. CI: `github` `ci_status` for the branch. Still running: report that. Failed: `github` `ci_logs` with the failed `job_id`, summarise the first error and offer `fix-ci`.

## Verify (required before saying done)
- The test and build commands from step 5 with their exit codes.
- The `git_push` result naming the branch.
- The `create_pr` result with the PR number and URL.
- The `ci_status` result after opening (passed, failed or still running).
- Never say the PR is open without the URL from `create_pr`. If a step was declined or failed, say which one and include the drafted title and description so the user can finish by hand.

## Output
- **PR:** number, title, URL, draft or ready, `head -> base`.
- **Branch and commits:** branch name and commit subjects.
- **Checks:** local commands with exit codes; CI status.
- **Description:** the body as sent, or as drafted when the PR was not created.

## Pitfalls
- Opening a PR from the default branch, or committing straight to it.
- `create_pr` before `git_push`: GitHub does not know the branch yet.
- Descriptions that list files or say "various fixes" instead of what, why and how it was tested.
- Claiming tests pass without running them, or marking a PR ready while a check fails.
- Pulling unrelated local changes into the PR by committing without `files`.
- Adding `Closes #N` for an issue nobody mentioned.
- Running git through `run_command`: use `git`, `git_push` and `github`.
