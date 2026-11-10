---
name: api-tests
description: Writes HTTP API tests for status codes, validation errors, auth (401/403) and edge cases with supertest, Fastify inject or FastAPI TestClient, mocking external services, and runs them. Use when the user asks to test endpoints, routes or a REST API.
argument-hint: "<endpoints or router to test, e.g. POST /api/orders>"
metadata:
  dahl-mode: build
  dahl-icon: network
---

# API tests

Endpoints: $ARGUMENTS

If no endpoint is named, list the routes you find (step 2) and test the ones that change data or check permissions first. Say which ones you chose.

## When to use
- "Write tests for the orders API", "test that /admin returns 403 for normal users", "cover validation on POST /signup".
- After adding or changing endpoints that have no request-level tests.

## When not to use
- Building a new endpoint: use `rest-endpoint` (it includes its own tests).
- Clicking through the UI in a browser: use `web-e2e-tests`. Plain functions with no HTTP layer: use `tests`.
- Reviewing whether the auth design is safe: use `auth-review` or `security`.
- Load or latency testing: use `perf`.

## Mode
Needs Build mode (writes tests, may install a test client, runs them). In Plan or Review mode, do steps 1 to 5 and return the test matrix (endpoint, case, expected status) and one example test in the answer, then ask the user to switch to Build.

## Checklist
1. `update_plan` with: map routes, make app testable, pick tooling, write matrix, write tests, run.
2. Map the API: `search` for `app.get(`, `router.post(`, `fastify.route`, `app.request` (Hono), `export async function (GET|POST)` in `app/**/route.ts` (Next.js), `@app.get`, `@router.post`, `APIRouter`, `Blueprint`, `urlpatterns`. `read_file` each handler, its validation schema (zod, joi, pydantic, marshmallow) and its auth middleware or dependency.
3. Make the app importable without opening a port:
   - Express: the app is exported from one file (`app.js`) and `listen` is called in another (`server.js`). If `listen` runs at import time, do the smallest split and say so.
   - Fastify: a `buildApp()` function returning the instance. FastAPI: `from app.main import app`. Flask: an app factory or module-level `app`.
4. Pick the tool that matches the stack; reuse what is installed:
   - Express, Koa, plain `http`: `supertest` (`npm i -D supertest`, plus `@types/supertest` for TypeScript) with the project's test runner. Without dependencies: `server.listen(0)` and `fetch` to the assigned port, closed in `after`.
   - Fastify: `await app.inject({ method: 'POST', url: '/orders', payload: {...} })`, nothing to install.
   - Hono: `await app.request('/orders', { method: 'POST', body: JSON.stringify({...}) })`.
   - Next.js route handlers: call the exported `POST(new Request('http://localhost/api/orders', {...}))` directly.
   - FastAPI: `fastapi.testclient.TestClient(app)` (needs `httpx`), or `httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")` for async tests.
   - Flask: `app.test_client()`. Django: `django.test.Client` or DRF `APIClient`.
5. Write the case matrix per endpoint before coding:
   - Success: status (200, 201, 204), body shape and key values, important headers (`Content-Type`, `Location` on 201).
   - Validation: missing required field, wrong type, out of range, malformed JSON. Expect 400 or 422 and check the error names the field.
   - Auth: no credentials gives 401; valid credentials without permission give 403; another user's resource gives 403 or 404, whichever the code intends.
   - Not found: unknown id gives 404. Conflicts: duplicate create gives 409 when the code supports it.
   - Edge cases: empty lists, pagination limits, unicode, maximum sizes.
   - Side effects: after POST, PUT or DELETE, read the state back (GET or the repository) to confirm the change.
6. Isolate from the outside world:
   - Outgoing HTTP: mock at the boundary with `vi.mock('./payments')`, `jest.mock`, `mock.method(globalThis, 'fetch', ...)` in node:test, nock or msw; `respx` for httpx, `responses` for requests; FastAPI `app.dependency_overrides[get_client] = fake`.
   - Database: in-memory SQLite or a test database, reset per test (transaction rollback or truncate).
   - Auth: create tokens with the app's own helper and a test secret set inside the test (`process.env.JWT_SECRET = 'test-secret'`, `monkeypatch.setenv`). Never use real credentials from `.env`.
7. Write the tests in the project's test folder and style, then run: `npx vitest run tests/api`, `npx jest tests/api --ci`, `node --test`, `python -m pytest tests/api -q`.
8. A test that exposes a real bug (for example 500 instead of 400 on bad input) stays. Report it and `ask_user` whether to fix it now with `fix`; mark it as a known failure only if the user prefers.

## Verify (required before saying done)
- The run exits 0 (or only the reported known bugs fail): show the command and pass counts.
- Every endpoint in scope has a success case and at least one failure case (validation or auth).
- `search` the new tests for `https?://` hosts other than localhost or test hosts: none may be called for real.
- Never claim coverage of an endpoint you did not run a test against. State what remains untested.

## Output
- **Endpoints:** table with method and path, cases, statuses asserted, result.
- **Mocks:** what was mocked and how.
- **Bugs found:** status or behaviour that contradicts the code's intent.
- **Run:** command, passed, failed, exit code.

## Pitfalls
- Starting the real server on a fixed port: port clashes and flaky runs. Use the app object, `inject`, or port 0.
- Calling real third-party APIs from tests.
- Asserting only the status code and never the body or the stored state.
- Shared database state between tests, so order matters.
- Forgetting `await` on supertest or fetch, so the assertion never runs.
- Reading real secrets from `.env` into tests.
- FastAPI `TestClient` without `httpx` installed: check before writing tests that import it.
- Chaining commands with `&&`: commands run in PowerShell, use `;`.
