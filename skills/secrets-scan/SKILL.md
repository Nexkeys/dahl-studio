---
name: secrets-scan
description: Finds committed secrets (API keys, tokens, private keys, .env files, connection strings with passwords) in the working tree and git history, masks every value and recommends rotation, then removal. Use before a repo goes public or after a suspected leak.
argument-hint: "<path or scope (default: whole repo and its history)>"
metadata:
  dahl-mode: review
  dahl-icon: key
---

# Scan for committed secrets

Scope: $ARGUMENTS

If the scope is empty, scan the whole working tree plus the git history of every suspicious path.

**Masking rule:** never print, write, `remember` or pass to another agent a full secret value. Show only the first 4 characters followed by `****` (for example `AKIA****`, `ghp_****`). For connection strings, keep scheme, user and host and mask the password the same way: `postgres://app:Tr0u****@db.example.com`. Check your final answer for unmasked values before sending it.

## When to use
- "Did we commit any keys?", "is it safe to make this repo public?", "I think I pushed my .env".
- After a credential leak alert from GitHub, a provider or a teammate.

## When not to use
- Code vulnerabilities in general: `security`. Login and access control: `auth-review`.
- Vulnerable package versions: `dependency-audit`.

## Mode
Read-only: works in any mode. Never rotates keys, deletes files, edits history or force-pushes. Dahl cannot rewrite git history; history cleanup is advice for the user. Moving secrets into environment variables is a separate change the user can ask for afterwards (Build mode).

## Checklist
1. `update_plan` with: inventory, pattern search, triage, history, visibility, report.
2. Inventory: `list_dir` the root, `read_file` .gitignore and check it ignores `.env`, `.env.*` (but not `.env.example`), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `*credentials*.json`, `service-account*.json`, `.npmrc` with tokens, `.pypirc`. Use `search` with a `glob` to find such files that are present in the tree. `git` `status` tells you whether the folder is a repository.
3. Pattern search with `search` (regex), excluding node_modules, dist, build, vendor and lockfiles:
   - AWS access key id: `(AKIA|ASIA)[0-9A-Z]{16}`. AWS secret key: `aws_secret_access_key\s*[=:]\s*\S{40}`.
   - GitHub token: `gh[pousr]_[A-Za-z0-9]{36}` and `github_pat_[A-Za-z0-9_]{60,}`.
   - Slack: `xox[baprs]-[A-Za-z0-9-]{10,}` and `hooks\.slack\.com/services/`.
   - Stripe: `(sk|rk)_live_[A-Za-z0-9]{16,}` (also note `sk_test_`).
   - Google API key: `AIza[0-9A-Za-z_-]{35}`.
   - OpenAI or Anthropic: `sk-(proj-|ant-)?[A-Za-z0-9_-]{20,}`.
   - SendGrid: `SG\.[\w-]{22}\.[\w-]{43}`. Twilio API key: `SK[0-9a-fA-F]{32}`.
   - Private key: `-----BEGIN ([A-Z]+ )?PRIVATE KEY`.
   - JWT: `eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.`.
   - URL with password: `(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqps?)://[^:\s/]+:[^@\s]+@`.
   - Generic assignment (many false positives, check each): `(password|passwd|secret|api[_-]?key|token|client_secret)\s*[:=]\s*['"][^'"\s]{8,}['"]`.

4. Triage every hit with `read_file`:
   - Real: high-entropy value, live prefix, used in code or config.
   - Placeholder or example: `changeme`, `xxx`, `<your-key>`, `your_key_here`, values in `.env.example`, and documented examples such as `AKIAIOSFODNN7EXAMPLE`. List them as not a finding.
   - Public by design: Stripe `pk_` keys, Firebase web config `apiKey`, Supabase anon key. Note them as low, and check that no service-role or secret key sits next to them.
   - Record where each real secret is used (`search` for the variable name).
5. History: for every suspicious path (secret files found, and paths .gitignore lists such as `.env`), call `git` `log` with that `path`. A file that is ignored or deleted now can still be in old commits. For each hit, `git` `show` the commit to confirm the content (mask values). A secret removed from the tree but present in history is still leaked.
6. Exposure: `github` `repo_info` (when there is a GitHub remote) to see whether the repository is public, and `git` `log` to see whether the commits were pushed. Public or shared exposure raises urgency.
7. Severity:
   - Critical: live cloud, payment, production database credentials or private keys in a public or shared repository.
   - High: the same in a private repository, or only in history.
   - Medium: test-mode keys, internal tokens with narrow scope.
   - Low: public-by-design keys, placeholders that look real.
8. Remediation, in this order:
   1. Rotate or revoke at the provider now (AWS IAM, GitHub token settings, Stripe dashboard "roll key", database password change). Treat any secret that was ever pushed as compromised, even if the repository is private.
   2. Remove from the code: read it from the environment (`process.env.STRIPE_SECRET_KEY`, `os.environ["STRIPE_SECRET_KEY"]`), add the file pattern to .gitignore, keep a `.env.example` with placeholders, and stop tracking the file (the user runs `git rm --cached .env`).
   3. History cleanup is optional and is done by the user, never by Dahl: `git filter-repo --invert-paths --path .env` or BFG, followed by a coordinated force-push and fresh clones for every collaborator. Rotation is what actually protects; forks, caches and clones may keep the old commits.
   4. Prevention: a pre-commit secret scanner (gitleaks, detect-secrets) and GitHub push protection.

## Verify (required before saying done)
- Every finding was re-read with `read_file` or `git` `show` in this session and has a location (`file:line`, or commit plus path).
- The answer contains no unmasked secret: scan it for any value longer than 4 characters after a known prefix or after `:` in a connection string.
- No files changed.
- State what was not scanned: binary files, files over the search limits, history of paths you did not check, submodules, other branches.

## Output
- **Verdict:** number of real findings by severity, and whether the repository is public.
- **Findings:**

| Severity | Type | Location | Value (masked) | In tree or history only | Used by |
|---|---|---|---|---|---|

- **Rotate now:** one line per credential with the provider and where to roll it.
- **Then remove:** the code and .gitignore changes, as steps.
- **History:** whether a rewrite is worth it, as advice for the user.
- **Not secrets:** placeholders and public-by-design keys you checked.
- **Not scanned:** gaps.

## Pitfalls
- Printing the secret in the answer, the plan, a memory or a delegated task.
- Deleting the file and calling it fixed: the secret is still valid and still in history.
- Attempting a history rewrite or a force-push; Dahl must not do it.
- Reporting `.env.example` placeholders or AWS documentation example keys as leaks.
- Skipping history because the current tree is clean.
- Searching node_modules and lockfiles, which floods the results with false positives.
