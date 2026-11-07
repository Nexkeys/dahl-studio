---
name: auth-review
description: Reviews authentication and authorisation: sessions, JWTs, password hashing, CSRF, object-level access, server-side roles, rate limits, OAuth and cookie flags, with a route-by-route authorisation table. Use when the user asks if login or permissions are secure.
argument-hint: "<area or routes to review (default: all auth code and routes)>"
metadata:
  dahl-mode: review
  dahl-icon: lock
---

# Review authentication and authorisation

Scope: $ARGUMENTS

If the scope is empty, review the whole auth stack and every route or server action in the project.

## When to use
- "Is our login secure?", "can a normal user reach admin endpoints?", "can users see each other's data?"
- After adding roles, teams or multi-tenancy, a new auth provider, or new API routes.

## When not to use
- A full vulnerability hunt across all classes (injection, SSRF, XSS): `security`.
- Keys or JWT secrets committed to the repo: `secrets-scan`.
- Building a new auth feature: that is implementation work; for a Supabase backend use `supabase-backend`, for a new endpoint `rest-endpoint`.
- A general review of a diff: `review`.

## Mode
Read-only: works in any mode. Never edits files. If the user asks for fixes afterwards, that needs Build mode and the tests must run after each fix.

## Checklist
1. `update_plan` with: auth stack, route inventory, authentication checks, authorisation checks, table, report.
2. Auth stack: `read_file` package.json or requirements, then `search` for passport, next-auth or `@auth/`, jsonwebtoken, jose, express-session, cookie-session, lucia, clerk, `@supabase/`, firebase-admin, bcrypt, argon2, csurf, express-rate-limit; Python: django.contrib.auth, flask_login, fastapi.security, jwt (PyJWT), jose, passlib, authlib. Find where the current user is established (middleware, `getServerSession`, `Depends(get_current_user)`).
3. Route inventory with `search`: `app\.(get|post|put|patch|delete)\(`, `router\.(get|post|put|patch|delete)\(`, `export (async )?function (GET|POST|PUT|PATCH|DELETE)`, `"use server"`, `pages/api/`, `@app\.(get|post|put|delete|route)`, `@router\.`, `path\(` in urls.py. For each route `read_file` the handler and its middleware chain, including the order of `app.use(...)` calls relative to route registration.
4. Authentication checks:
   - Passwords: bcrypt (cost 10 or more), argon2id or scrypt. Flag plaintext, md5, sha1 or a single unsalted sha256 (`crypto.createHash` on a password), and comparisons with `===` instead of `bcrypt.compare`.
   - Login and reset flows: the same error for unknown user and wrong password (no enumeration); rate limiting or lockout on login, register, password reset and OTP verification.
   - Reset and magic-link tokens: from `crypto.randomBytes` (32 bytes or more) or `secrets.token_urlsafe`, never `Math.random`; single use; short expiry; stored hashed.
   - JWT: `verify`, not `decode`, on every request; algorithms pinned (`algorithms: ['HS256']`, no `none`); PyJWT with `verify_signature: False` is a bypass; secret from the environment and at least 32 random bytes; `exp` set and short; refresh token rotation; tokens invalidated on logout and password change; stored in an httpOnly cookie rather than localStorage when XSS is a risk.
   - Sessions: session id regenerated on login (`req.session.regenerate`), destroyed on logout, secret from the environment, not the default MemoryStore in production.
   - Cookies: `HttpOnly`, `Secure`, `SameSite=Lax` or `Strict`, narrow `Path` and `Domain`, `__Host-` prefix where possible.
   - CSRF: cookie-authenticated state-changing routes need a CSRF token or SameSite plus an Origin check; GET handlers must not change state.
   - OAuth and OIDC: `state` generated and verified, PKCE with S256 for public clients, exact `redirect_uri` allow-list, id_token signature, `aud`, `iss` and `nonce` checked, no tokens in URLs or logs.
5. Authorisation checks (where most real bugs are):
   - Object level: every handler that takes an id (`req.params.id`, `:userId`, `?accountId=`, a body field) must scope the query to the caller (`where: { id, ownerId: req.user.id }`) or check ownership after loading. Missing check = IDOR.
   - Function level: admin and staff routes check the role on the server, in middleware or the handler. Hidden buttons in the UI are not access control. Roles must come from the session or a verified token, never from the request body, a header or a client-editable claim.
   - Mass assignment: `update(req.body)` or `Model(**data)` that lets a user set `role`, `isAdmin`, `ownerId` or `tenantId`.
   - Default deny: routes registered before the auth middleware, Next.js `middleware.ts` matchers that miss paths, API routes and server actions without their own check.
   - Multi-tenant: tenant id taken from the session, not from the URL or body.
   - Supabase or Firebase: Row Level Security enabled on every table with policies using `auth.uid()`; the service role key never shipped to the client.
6. For each issue, confirm by reading the full chain (middleware, handler, data access) and write a concrete abuse case: "user A sends `GET /api/invoices/42`, owned by user B, and receives it".
7. Rate: Critical (auth bypass, admin takeover, cross-tenant data access), High (IDOR on personal data, weak password hashing, JWT not verified), Medium (missing rate limit, CSRF, long-lived tokens), Low (cookie hardening, enumeration via timing).

## Verify (required before saying done)
- Every route the inventory search found appears in the table, or is listed as "not classified" with the reason.
- Each table row and finding cites `file:line` read in this session.
- No files changed.
- State what could not be checked from code: provider dashboard settings, RLS policies not in the repo, reverse proxy rules, production environment variables.

## Output
- **Auth stack:** 3 to 5 lines (library, session or token, where the user is resolved, password hashing).
- **Route authorisation table:**

| Method | Path | Location | Authn | Authz check | Resource id from | Verdict |
|---|---|---|---|---|---|---|
| GET | /api/invoices/:id | `routes/invoices.js:12` | yes | none | `req.params.id` | IDOR |

- **Findings** (most severe first): title, `file:line`, abuse case, fix (code).
- **Already done well:** at most 3 lines, so nobody removes them.
- **Not covered:** what needs checking outside the code.

## Pitfalls
- Treating a hidden UI element as authorisation.
- Assuming a global middleware protects routes that were registered before it.
- Reviewing only the login form and missing object-level checks, the most common real flaw.
- Missing `jwt.decode` used where `jwt.verify` was intended.
- Trusting role or tenant values that the client sends.
- Calling a cookie-based app CSRF-safe because of SameSite while GET routes change state.
