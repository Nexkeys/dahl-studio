---
name: security
description: Performs an authorised offensive security assessment of this project's code: maps the attack surface, finds exploitable vulnerabilities with proof-of-concept inputs, rates severity and gives fixes. Use for security audits, pentest-style reviews or "is my app safe" questions.
argument-hint: "<area, folder or feature to assess (default: whole project)>"
metadata:
  dahl-mode: review
  dahl-icon: shield
---

# Security assessment

Scope: $ARGUMENTS

If the scope is empty, assess the whole project, network-facing entry points first. Rules of engagement: this project's source code only. Proof-of-concept inputs are written for the user to run against their own local dev instance. Never send requests to production, to live third-party systems, or to any host the user names in passing; for scanning a deployed target use the `sekudo-assessment` skill, which has an authorisation gate.

## When to use
- "Do a security audit", "find vulnerabilities", "could someone hack this?", before a launch or a public release.
- After adding uploads, webhooks, file access, shell calls or new API routes.

## When not to use
- General review of a diff: `review` (it includes a security reviewer).
- Login, sessions, roles and per-route access control in depth: `auth-review`.
- Keys and passwords committed to the repo: `secrets-scan`. Known-vulnerable package versions: `dependency-audit`.
- Scanning a live domain, URL or IP: `sekudo-assessment`.
- One known vulnerability to patch: `fix`.

## Mode
Read-only by default: works in any mode. Apply fixes only when the user asks; that needs Build mode (`edit_file`, then run the tests). In Plan or Review mode, report and ask the user to switch to Build if they want fixes applied.

## Checklist
1. `update_plan` with: stack, attack surface, hunt per class, confirm data flow, proof of concept, report.
2. Stack: `read_file` package.json, requirements.txt or pyproject.toml, framework config (next.config.*, vite.config.*, settings.py, Electron main file). Note framework versions and auth library.
3. Attack surface map with `search` (regex), excluding node_modules, dist and tests:
   - HTTP routes: `app\.(get|post|put|patch|delete|use)\(`, `router\.(get|post|put|patch|delete)\(`, `export (async )?function (GET|POST|PUT|PATCH|DELETE)` (Next.js route handlers), `"use server"`, `@app\.(route|get|post)`, `@router\.(get|post)`, `path\(` in urls.py.
   - Other inputs: uploads (`multer`, `formidable`, `UploadFile`), webhooks, `ipcMain\.(on|handle)`, `addEventListener\('message'`, CLI args, queue consumers, deep links, files read from user-chosen paths.
   - For each entry point record: input, auth required, which sinks it reaches.
4. Hunt by class (source to sink). Search the sink, then trace back to user input:
   - SQL or NoSQL injection: string concatenation or template literals in `query(`, `raw(`, `$queryRawUnsafe`, `execute(`, `f"SELECT`, `.format(` on SQL; `find(req.body)` or `$where` (operator injection).
   - Command injection: `exec(`, `execSync(`, `spawn(` with `shell: true`, `os.system`, `subprocess.*shell=True`.
   - Path traversal: `path.join` or `res.sendFile` or `open(` with user input and no `path.resolve` plus prefix check; archive extraction without entry name checks (zip slip).
   - SSRF: `fetch(`, `axios`, `got(`, `requests.get(` with a user-supplied URL and no allow-list (cloud metadata at 169.254.169.254, localhost services).
   - Unsafe eval or deserialisation: `eval(`, `new Function(`, `vm.runIn`, `pickle.loads`, `yaml.load(` without `SafeLoader`, `node-serialize`.
   - XSS: `dangerouslySetInnerHTML`, `innerHTML =`, `v-html`, `|safe`, `mark_safe`, `res.send(` with unescaped input.
   - Authz: routes using `req.params.id` without an ownership check (IDOR), admin routes without a server-side role check (deep dive with `auth-review`).
   - Secrets in source: note file:line and mask values to the first 4 characters (deep dive with `secrets-scan`).
   - Misc: open redirect (`res.redirect(req.query.next)`), CORS `origin: '*'` or reflected origin with credentials, prototype pollution (deep merge of request JSON), mass assignment (`create(req.body)`), ReDoS on user input, missing upload size or type limits.
   - Electron: `nodeIntegration: true`, `contextIsolation: false`, `webSecurity: false`, `shell.openExternal` with untrusted URLs, IPC handlers that accept arbitrary paths or commands.
5. Confirm each candidate with `read_file`: follow the data from source to sink through every function. If validation, escaping or a parameterised call happens on the way, drop it. If you cannot follow the flow, list it under "Needs verification", not as a finding.
6. Proof of concept: a concrete input that shows impact against a local dev instance, for example `curl.exe "http://localhost:3000/api/file?name=..%2F..%2F.env"` or a unit test call. Do not run it during the assessment.
7. Rate each finding (CVSS-like): attack vector, auth needed, user interaction, impact on confidentiality, integrity, availability.
   - Critical: unauthenticated RCE, SQL injection with data access, auth bypass.
   - High: authenticated RCE, IDOR on sensitive data, stored XSS, arbitrary file read.
   - Medium: reflected XSS, limited SSRF, CSRF on a state-changing action, open redirect.
   - Low: verbose errors, missing hardening headers, weak defaults with no direct exploit.
8. Fix: the specific change (parameterised query, `execFile` with an argument array, `path.resolve` plus `startsWith(baseDir)`, URL allow-list, output escaping, ownership filter in the query, `yaml.safe_load`).
9. Only if the user asked for fixes (Build mode): fix Critical and High first with `edit_file`, add a regression test that uses the PoC input, run the tests with `run_command`.

## Verify (required before saying done)
- Every finding has a source-to-sink path you read in this session, with `file:line` for both ends.
- Each PoC matches the real code: route path, parameter names, HTTP method.
- No files changed unless the user asked for fixes; if fixes were applied, the tests ran and passed (command and exit code shown).
- Never say "secure" or "no vulnerabilities". Say what was covered and list what was not (classes skipped, folders not read, runtime config not visible).

## Output
- **Attack surface:** table `Entry point | Input | Auth | Sinks reached`.
- **Findings** (most severe first), for each:
  - `[Severity] Title` and `file:line`
  - Class, data flow (source -> sink), PoC input, impact, fix.
- **Needs verification:** suspicious spots you could not confirm.
- **Not covered:** what this pass did not check, and which skill covers it.

## Pitfalls
- Reporting grep hits without a data flow (an `exec` on a constant string is not command injection).
- Rating theoretical issues as Critical; severity must match a realistic exploit.
- Running a PoC against production or any host other than the user's local instance.
- Printing secrets found along the way.
- Ignoring non-HTTP inputs: IPC, uploaded file contents, environment, message queues.
- Editing code when the user only asked for an assessment.
