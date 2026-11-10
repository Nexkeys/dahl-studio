---
name: release
description: Cuts a versioned release. Confirms the semver bump, checks for a clean default branch with passing tests and build, updates the version and CHANGELOG from the commits since the last tag, then commits, tags, pushes and publishes a GitHub release after the user approves. Use when the user starts a release of a new version.
argument-hint: "<patch | minor | major | x.y.z>"
disable-model-invocation: true
metadata:
  dahl-mode: build
  dahl-icon: tag
---

# Cut a release

Version: $ARGUMENTS

If the version is empty, propose a bump from the commits (step 5) and confirm it with `ask_user` before changing anything. This skill has side effects outside the computer (tags, a public release), so it only runs when the user starts it.

## When to use
- The user runs `/release` to publish a new version: version bump, changelog, tag and GitHub release.

## When not to use
- Only committing work: use `commit`. Opening a pull request: use `open-pr`.
- Deploying a website: use `deploy-web` (a release does not deploy anything).
- Updating dependencies before the release: use `dependency-upgrade`.
- CI is red on the default branch: use `fix-ci` first. Never release over a failing check.

## Mode
Needs Build mode (edits files, commits, tags, pushes, publishes). In Plan or Review mode, do steps 1 to 5 and report the checks, the last tag, the proposed version and the changelog section; ask the user to switch to Build to cut it.

## Checklist
1. `update_plan` with: preflight, tests and build, last tag, version, changelog, commit and tag, push, GitHub release, verify.
2. Preflight. Stop at the first real failure and report it; never skip a check.
   - `git` `status`: the working tree must be clean. If not, stop and ask the user to commit (`commit` skill) or stash first.
   - Default branch: `github` `repo_info` (or `git` `branches`). On another branch: stop and ask.
   - Up to date: `git` `fetch`, then `git` `status` must show behind 0. Behind: `git` `pull` first (approved by the user).
   - CI: `github` `ci_status` for the default branch must show no failed checks.
   - No origin remote or no GitHub token: say so, do the local steps 3 to 10, and report push and release as not done.
3. Tests and build with `run_command`, using the project's commands: `npm ci; npm test; npm run build`, or `python -m pytest -q; python -m build`. Every command must exit 0, or stop.
4. Last release and changes:
   - Last tag: `github` `list_releases`, and `git` `log` with `count` 50 (tags show in the decorations as `(tag: v1.2.0)`). No tag yet: this release covers all commits.
   - Commits since then: `git` `log` with `ref` `v1.2.0..HEAD` and `count` 100.
5. Version:
   - The argument wins: `patch`, `minor`, `major` or an exact `x.y.z` (it must be higher than the current version).
   - No argument: propose one from the commits. `BREAKING CHANGE` or `type!:` means major (minor while the version is 0.x), any `feat` means minor, otherwise patch. Confirm with `ask_user`, recommended option first: the version is the user's decision.
   - The tag for the new version must not exist yet. Follow the existing tag style (with or without the `v` prefix).
6. Update the version everywhere it is declared (`search` for the current version string to find them all):
   - Node: `npm version 1.3.0 --no-git-tag-version` updates `package.json` and the lock file without committing or tagging.
   - Python: `version = "1.3.0"` in `pyproject.toml`, plus `__version__` if the package defines one.
   - Others: `Cargo.toml`, `app.json` (`expo.version`), `tauri.conf.json`, `<Version>` in `*.csproj`.
7. CHANGELOG.md, newest section on top (create the file if missing, Keep a Changelog style):
   ```markdown
   ## [1.3.0] - 2026-11-07
   ### Added
   - Export invoices as CSV (#42)
   ### Fixed
   - Rounding of totals for zero-quantity lines
   ```
   Map commit types: feat to Added, fix to Fixed, perf and refactor that users notice to Changed, security fixes to Security, breaking changes first under "Breaking". Write for users, not commit hashes; leave out chore, ci, test and internal docs commits. Date: `Get-Date -Format yyyy-MM-dd`.
8. Rebuild after the bump if the version is compiled into the output (installers, bundles, `--version` output): `npm run build`.
9. Commit: `git` `commit` with `files` (manifests, lock file, CHANGELOG.md, other version files) and the message `chore(release): v1.3.0`.
10. Tag: `git` `tag` with `name` `v1.3.0` and no `message`. A lightweight tag on the release commit matches the tag GitHub creates in step 12; an annotated tag with the same name makes later fetches fail with "would clobber existing tag".
11. Push: `git_push` (the current branch). It pushes the branch, not tags; the tag reaches GitHub through step 12. Note the release commit hash from `git` `log` with `count` 1.
12. GitHub release: `github` `create_release` with `tag` `v1.3.0`, `target` the release commit hash, `name` `v1.3.0`, `notes` the new CHANGELOG section, `files` the built assets the project ships (installer, zip, wheel from `dist/`), and `prerelease: true` for versions like `2.0.0-beta.1`. The user always approves this call.

## Verify (required before saying done)
- Preflight results: clean status, branch name, CI status, test and build exit codes.
- `read_file` the manifest(s) back: the new version. `read_file` CHANGELOG.md: the new section.
- `git` `log` with `count` 1: the release commit with `(tag: v1.3.0)`.
- The `git_push` result, the `create_release` result URL, then `github` `list_releases` showing the new tag.
- Never say "released" without the release URL. If a step was declined or failed, say exactly which steps are done ("committed and tagged locally, not pushed") and how to finish.

## Output
- **Version:** old -> new, bump type and why.
- **Checks:** table of check and result.
- **Changelog:** the new section.
- **Done:** commit hash, tag, push result, release URL, attached assets.
- **Not done:** remaining steps and how to finish them.

## Pitfalls
- Releasing from a dirty tree or a feature branch: the tag points at code nobody reviewed.
- Skipping or overriding failing tests "just for this release".
- Bumping `package.json` but not the lock file, `app.json` or a hard-coded `__version__`.
- A changelog pasted from raw commit subjects ("wip", "fix typo") instead of written for users.
- Building the assets before the bump, so the installer reports the old version.
- Reusing a tag that already exists, or breaking the repository's tag naming style.
- Running git through `run_command`: use `git`, `git_push` and `github`.
