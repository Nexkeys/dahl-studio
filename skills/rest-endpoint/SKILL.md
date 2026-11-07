---
name: rest-endpoint
description: Adds a REST endpoint to an existing backend (Express, Fastify, Next.js, FastAPI, Flask and others) following its routing, validation, auth and error patterns, with tests and a real request. Use when the user asks for a new API route or method.
argument-hint: "<METHOD /path and what it should do>"
metadata:
  dahl-mode: build
  dahl-icon: server
---

# Add a REST endpoint

Endpoint: $ARGUMENTS

If the request above is empty, or the method, path or behaviour is unclear, call `ask_user` once with 2 to 4 concrete options (for example "POST /api/notes creates a note for the signed-in user"), then continue.

## When to use
- "Add an endpoint that ...", "we need GET /api/orders/:id", "expose X over the API".
- Adding a method (update, delete, list with filters) to an existing resource.

## When not to use
- A whole test suite for existing endpoints: use `api-tests` (call `use_skill`).
- The endpoint needs a new table or column first: run `db-migration` (or `supabase-backend`) before this skill.
- An existing endpoint returns errors: use `fix`. Reviewing auth on existing routes: use `auth-review`.
- GraphQL, tRPC or RPC-style APIs: follow the project's pattern; this skill is for REST routes.

## Mode
Needs Build mode (edits files, runs tests and the server). In Plan or Review mode, do steps 2 and 3, report the contract (method, path, schema, status codes, auth) and the files you would touch, and ask the user to switch to Build.

## Checklist
1. `update_plan` with: read patterns, contract, implement, tests, docs, real request.
2. Learn the existing patterns before writing:
   - `read_file` package.json or pyproject.toml / requirements.txt to identify the framework.
   - `search` for an existing route on a similar resource (`router.get(`, `app.post(`, `fastify.route`, `export async function GET`, `@router.get`, `@app.route`, `path(` in urls.py) and read it end to end: registration, validation library (zod, valibot, joi, yup, express-validator, pydantic, marshmallow, DRF serializers), auth middleware or dependency, data access layer, error handler, response shape (`{ data }`, `{ error: { code, message } }`), logging.
3. Define the contract and write it in your notes:
   - Method and path: plural nouns, ids in the path (`/api/notes/:id`), filters in the query string, at most one level of nesting.
   - Request schema (body, params, query) with types, required fields, limits (string max length, number ranges, page size cap).
   - Status codes: 200 for reads and updates with a body, 201 plus a `Location` header for creates, 204 for deletes without a body, 400 for invalid input (422 is FastAPI's default; keep the project's convention), 401 not signed in, 403 signed in but not allowed, 404 missing, 409 conflict (duplicate), 500 only for unexpected errors and without stack traces in the body.
   - Who may call it. If that is unclear, `ask_user`; never ship an unauthenticated write by default.
4. Implement, matching the patterns from step 2:
   - Validate at the edge with the project's library: zod `schema.safeParse(req.body)` and return 400 with the issues; FastAPI a pydantic model in the signature; Flask or Django the project's serializer or form.
   - Auth with the existing middleware or dependency, plus an ownership check for single resources (load the row, compare its owner with the current user, 404 or 403 per project convention).
   - Parameterised queries or the ORM only; never build SQL from strings.
   - Config and secrets from the existing config module or environment variables. Add new variables to `.env.example` with a placeholder value, never a real one.
   - Next.js App Router: `app/api/notes/route.ts` exporting `GET` / `POST`, `return NextResponse.json(note, { status: 201 })`; dynamic segments in `app/api/notes/[id]/route.ts`.
   - FastAPI: `@router.post("/notes", status_code=201, response_model=NoteOut)`, `raise HTTPException(status_code=404, detail="Note not found")`.
   - Register the route where the others are registered (router index, `app.include_router`, urls.py).
5. Tests with the project's setup (supertest, `fastify.inject`, `app.request` in Hono, FastAPI `TestClient`, Flask `app.test_client()`, DRF `APIClient`). Cover at least: success with the right status and body, invalid input (400 or 422), unauthenticated (401) and, if relevant, not found (404) and forbidden (403). For a broader suite, hand off to `api-tests`.
6. Docs: if the project has OpenAPI (`openapi.yaml`, `swagger.json`, `@nestjs/swagger` decorators, zod-to-openapi) or an API section in the README, update it. FastAPI generates docs; make sure `response_model` and status codes are set.
7. Real request against the running dev server (start it with `run_command`, for example `npm run dev` or `uvicorn app.main:app --reload`):
   - GET: `curl.exe -s -i http://localhost:3000/api/notes/1`
   - JSON body: write it to a temp file first, then `curl.exe -s -i -X POST http://localhost:3000/api/notes -H "Content-Type: application/json" --data-binary "@$env:TEMP/body.json"` (avoids PowerShell quote mangling), or `Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/notes -ContentType 'application/json' -Body '{"title":"Hello"}'` for the success path.
   - Send one invalid request too and check the error status and shape.

## Verify (required before saying done)
- New tests pass and the existing suite still passes (`npm test`, `npx vitest run`, `python -m pytest -q`): exit code and counts.
- Type check or lint exit 0 if the project has them (`npx tsc --noEmit`, `ruff check`, `mypy`).
- The real request shows the expected status line and body for one valid and one invalid call (paste the status lines).
- `search` your diff for hardcoded keys, tokens or connection strings: none.
- Never say done without this evidence. If the server could not start (missing database or env), say the real request is unverified and why.

## Output
- **Endpoint:** method, path, auth requirement.
- **Contract:** request schema and a table of status codes with when each is returned.
- **Files:** route, registration, tests, docs.
- **Proof:** test command and counts, the real request status lines.
- **Follow-ups:** for example rate limiting, pagination, or a migration that is still needed.

## Pitfalls
- Inventing a new validation or error style when the project already has one.
- Returning 200 for everything, or 500 for invalid input.
- Checking that a user is signed in but not that they own the resource (IDOR).
- Echoing internal errors or stack traces in responses.
- Unbounded list endpoints without a page size limit.
- `curl` in PowerShell 5.1 is an alias for `Invoke-WebRequest`: call `curl.exe`.
- Chaining commands with `&&`: commands run in PowerShell, use `;`.
