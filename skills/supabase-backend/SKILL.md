---
name: supabase-backend
description: Builds or changes a Supabase backend with migrations that enable row level security and explicit policies on every table, plus auth, storage and edge functions, verified by RLS tests as anon and authenticated. Use when a Supabase project needs tables, access rules, storage or functions.
argument-hint: "<what to add or change in Supabase>"
metadata:
  dahl-mode: build
  dahl-icon: database
---

# Supabase backend

Request: $ARGUMENTS

If the request above is empty, inspect the project (step 2) and call `ask_user` once with 2 to 4 concrete next steps (for example "add a todos table owned by each user", "add an avatars bucket"), then continue.

## When to use
- New tables, columns or relations in a Supabase project, with who may read and write them.
- Row level security (RLS) policies, auth flows, storage buckets, edge functions, database functions or triggers.
- "Users can see each other's data", "inserts fail with a policy error".

## When not to use
- A schema change in a non-Supabase database: use `db-migration` (call `use_skill`).
- A security review of the whole app: use `security` or `auth-review`.
- Slow queries: use `slow-queries`.
- Only a REST route in a separate backend: use `rest-endpoint`.

## Mode
Needs Build mode (writes migrations, runs the Supabase CLI). In Plan or Review mode, do steps 2 and 3 (read-only connector tools are fine), report the migration SQL and policies you would write, and ask the user to switch to Build.

## Checklist
1. `update_plan` with: inspect, design, migration with RLS, auth/storage/functions, apply locally, test RLS, generate types.
2. Inspect the project:
   - `list_dir` `supabase/` (config.toml, migrations, functions, seed.sql, tests). `read_file` the latest migrations to learn naming and style.
   - Client code: `search` for `createClient(`, `@supabase/supabase-js`, `@supabase/ssr`. Note which key each client uses.
   - The service role key must never reach the client: `search` for `service_role`, `SERVICE_ROLE` in frontend code and in public env prefixes (`NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_`, `PUBLIC_`). If found, flag it, move the privileged call to a server route or edge function, and tell the user to rotate the key.
3. Connector: if a "Supabase" connector is listed and set up, `use_connector` "Supabase" and use it to `list_tables`, run read-only SQL (SELECT) with `execute_sql`, `list_migrations`, and `get_advisors` (security and performance). It uses the user's token and may be read-only. Never apply migrations or write data on the hosted project through it without explicit user approval; changes go through migration files. If it is not set up, work locally with the CLI.
4. Local stack: `npx supabase --version`; `npx supabase status` (needs Docker Desktop running); `npx supabase start` if it is not running. If Docker is missing, say so and ask the user to install and start it.
5. Migration: `npx supabase migration new add_todos`, then write the SQL into the new `supabase/migrations/<timestamp>_add_todos.sql`:
   - Tables in `public` with `id uuid primary key default gen_random_uuid()`, an owner column `user_id uuid not null default auth.uid() references auth.users (id) on delete cascade`, `created_at timestamptz not null default now()`.
   - `alter table public.<table> enable row level security;` for every new table, no exceptions.
   - One explicit policy per operation and role, using `(select auth.uid())` (evaluated once per query, faster). Index the columns used in policies.
   - Views: `with (security_invoker = true)`. Functions: `security invoker` by default; `security definer` only when required, with `set search_path = ''` and fully qualified names.
   - Never base policies on `raw_user_meta_data` / `user_metadata` (users can edit it); use `app_metadata` or a roles table.
   Templates: read `references/rls-templates.md` with `read_skill_file`.
6. Auth: in SSR frameworks use `@supabase/ssr` with cookie handling. On the server, authorise with `supabase.auth.getUser()` (or `getClaims()`), not `getSession()` alone, which is not verified.
7. Storage: create buckets in a migration (`insert into storage.buckets (id, name, public) values ('avatars', 'avatars', false);`) and policies on `storage.objects` scoped by `bucket_id` and the folder, for example `(storage.foldername(name))[1] = (select auth.uid())::text`.
8. Edge functions: `npx supabase functions new <name>`; Deno with `Deno.serve`; keep JWT verification on unless the function is a public webhook that checks its own signature; add CORS headers for browser calls; local secrets in `supabase/functions/.env` (gitignored); `npx supabase functions serve` to run locally. Setting hosted secrets or deploying (`npx supabase secrets set`, `npx supabase functions deploy`) needs the user's approval.
9. Apply locally: `npx supabase migration up`, or `npx supabase db reset` to rebuild the local database from migrations and seed (wipes local data; say so).
10. Test RLS as each role with pgTAP in `supabase/tests/<table>_rls.test.sql` (template in the reference file) and run `npx supabase test db`. Cover: anon sees nothing (or only public rows), a user sees only own rows, a user cannot insert or update rows for someone else.
11. Types: `npx supabase gen types typescript --local | Out-File -Encoding utf8 src/types/database.types.ts` (match the existing path), then update client code and run the type check.

## Verify (required before saying done)
- `npx supabase migration up` or `npx supabase db reset` exit 0 on the local stack.
- `npx supabase test db` passes with the RLS tests (show counts), or RLS queries as `anon` and `authenticated` with their results.
- Every new table has RLS enabled: `select tablename, rowsecurity from pg_tables where schemaname = 'public';` (via the connector's `execute_sql` or the local database), or `get_advisors` shows no RLS warnings.
- `search` the client code for `service_role`: no matches.
- Types regenerated and the type check passes (`npx tsc --noEmit`).
- Never say done without this evidence. If the local stack could not run, say RLS is untested.

## Output
- **Migration:** file path and the SQL (tables, RLS, policies, indexes).
- **Policies:** table with columns Table, Operation, Role, Rule.
- **Auth, storage, functions:** what changed.
- **Proof:** commands with exit codes, RLS test results.
- **For you:** steps that need the user (rotating a leaked key, `npx supabase db push` to the hosted project, setting hosted secrets).

## Pitfalls
- A table without RLS, or RLS enabled with no policies (everything denied) and then "fixed" with `using (true)`.
- An UPDATE policy without `with check`, letting users move rows to another owner.
- The service role key in browser code or a `NEXT_PUBLIC_` / `VITE_` variable.
- Running `npx supabase db push` or connector writes against the hosted project without approval.
- Editing an applied migration instead of adding a new one.
- In PowerShell 5.1, `>` writes UTF-16; use `| Out-File -Encoding utf8` for generated types.
- Chaining commands with `&&`: commands run in PowerShell, use `;`.
