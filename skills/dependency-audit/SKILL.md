---
name: dependency-audit
description: Audits dependencies for known vulnerabilities with npm audit, pip-audit or osv-scanner, ranks them by severity and reachability, separates prod from dev and proposes minimal non-breaking fixes. Use for vulnerable packages, CVEs or audit warnings.
argument-hint: "<optional: package, workspace or 'prod only'>"
metadata:
  dahl-mode: build
  dahl-icon: shield-check
---

# Audit dependencies for known vulnerabilities

Scope: $ARGUMENTS

If the scope is empty, audit every ecosystem in the project (all workspaces), production and dev dependencies, and report them separately.

## When to use
- "npm says 12 vulnerabilities", "are our packages safe?", "check for CVEs", a Dependabot or audit alert.
- Before a release or a security review.

## When not to use
- Upgrading a package for features or a planned major: `dependency-upgrade` (also the place for fixes that need a major).
- Vulnerabilities in this project's own code: `security`. Leaked keys: `secrets-scan`.

## Mode
Needs Build mode to run the audit commands. The audit itself changes no files; apply fixes only when the user asks. In Plan or Review mode, read the manifests and lockfiles, list the commands you would run, point out obviously old packages, and ask the user to switch to Build. Audit tools contact the package registry or the OSV database.

## Checklist
1. `update_plan` with: detect ecosystems, run audits, reachability, prioritise, fix (if asked), re-run.
2. Detect ecosystems and workspaces: package-lock.json, pnpm-lock.yaml, yarn.lock, bun.lock; requirements*.txt, poetry.lock, uv.lock, Pipfile.lock; go.sum; Cargo.lock. `read_file` package.json `workspaces` or pnpm-workspace.yaml. npm audit needs a lockfile; if there is none, say so (creating one with `npm install --package-lock-only` changes files: ask first).
3. Check tools: `npm --version`, `pip-audit --version`, `osv-scanner --version`. Do not install a missing tool without asking; offer `python -m pip install pip-audit` for Python.
4. Run the audits. A non-zero exit code means vulnerabilities were found, not that the tool failed:
   - npm: `npm audit --json` and production only `npm audit --omit=dev --json`. Summary: `(npm audit --json | ConvertFrom-Json).metadata.vulnerabilities`.
   - pnpm: `pnpm audit --json` and `pnpm audit --prod --json`.
   - yarn 1: `yarn audit --json` (one JSON object per line). yarn 2+: `yarn npm audit --all --recursive --json`.
   - Python: inside the project's virtualenv `pip-audit -f json`, or `pip-audit -r requirements.txt -f json`.
   - Any lockfile: `osv-scanner scan source -r .` (osv-scanner v2; v1 uses `osv-scanner -r .`).
5. For each vulnerable package record: severity, advisory id (GHSA or CVE), vulnerable range, first fixed version, direct or transitive (`npm explain <pkg>` or `npm ls <pkg>` shows the path), production or dev.
6. Reachability, so the ranking reflects real risk:
   - Read the advisory to learn the vulnerable function or condition (`web_fetch` the GHSA page when Web is on; otherwise use the title from the audit output).
   - `search` the code for imports of the package and calls to that function (for example `_.template(`, `merge(`, `yaml.load(`, `follow-redirects` with user URLs, `xml2js` on uploaded files).
   - Classify: **Reachable** (called with input an attacker can influence, cite `file:line`), **Possible** (package used, path not confirmed), **Not reachable** (function unused, or a build-time tool that never sees untrusted input).
7. Prioritise: production and reachable first, then production and possible, then dev-only. Dev-only issues still matter when the tool handles untrusted input (a dev server exposed on the network, a parser run on downloaded files).
8. Fixes, smallest first. Apply only if the user asked; otherwise propose them (offer with `ask_user`: apply safe fixes now, or report only):
   - Preview: `npm audit fix --dry-run --json`. Apply: `npm audit fix` (semver-compatible updates only, never `--force` by default).
   - Direct dependency: `npm install pkg@<fixed version>` within the same major; `pip install -U "pkg>=<fixed>"` and update the pin.
   - Transitive: update the parent that pulls it in; if the parent has no fixed release, pin with `overrides` (npm), `pnpm.overrides` or `resolutions` (yarn) to a fixed version in a compatible range, and say why in the answer.
   - `npm audit fix --force` installs breaking majors and sometimes downgrades (it is known to move `react-scripts` to an ancient version). Explain exactly which packages would change major before suggesting it, and get explicit consent. Prefer handing majors to `dependency-upgrade`.
   - No fix available: mitigation (validate input before the vulnerable call, an alternative package, remove the dependency if unused).
9. After any fix: build and tests (`npm run build; npm test`), then re-run the same audit commands and compare counts.

## Verify (required before saying done)
- The audit command output (counts by severity, production and all) is quoted from this session.
- If fixes were applied: the re-run audit shows the new counts, build and tests exit 0, and `git` `diff` shows only manifest, lockfile or overrides changes.
- If nothing was applied: no files changed.
- Reachability claims cite `file:line` or are labelled "not verified". Never claim the project is "safe": say what was audited.

## Output
- **Summary:** counts by severity, production vs dev, before and after (if fixed).
- **Findings** (highest priority first):

| Package | Severity | Advisory | Prod or dev | Direct or via | Reachable | Fix |
|---|---|---|---|---|---|---|

- **Applied:** commands run and their results (only if the user asked).
- **Needs a major upgrade:** packages to hand to `dependency-upgrade`, with the breaking version.
- **No fix available / accepted risk:** with the mitigation.

## Pitfalls
- Running `npm audit fix --force` and silently installing breaking majors or downgrades.
- Treating the audit's non-zero exit code as a tool failure.
- Panicking about dev-only advisories in build tools while missing one reachable production issue.
- Deleting the lockfile to make warnings go away.
- Overrides that force a transitive package across a major and break its parent.
- Auditing only the root when the project is a monorepo with several workspaces.
