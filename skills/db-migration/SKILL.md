---
name: db-migration
description: Creates a safe schema migration with the project's tool (Prisma, Drizzle, Knex, Alembic, Django, SQL), with forward and rollback steps and safe patterns for large tables, applied to a local database only. Use when a table, column, index or constraint must change.
argument-hint: "<the schema change, e.g. add a role column to users>"
metadata:
  dahl-mode: build
  dahl-icon: database
---

# Database migration

Change: $ARGUMENTS

If the change above is empty or ambiguous (which table, nullable or not, default value, what happens to existing rows), call `ask_user` once with 2 to 4 concrete options, then continue.

## When to use
- Add, change or drop a table, column, index, constraint, enum or foreign key.
- Backfill or reshape existing data as part of a schema change.

## When not to use
- Supabase projects where the change also needs RLS policies, storage or auth: use `supabase-backend` (call `use_skill`).
- Slow queries that may need an index: start with `slow-queries`, then come back here for the migration.
- Applying already-written migrations in a deploy pipeline: use `deploy-web` or `github-actions-ci`.

## Mode
Needs Build mode (writes migration files and runs the migration tool). In Plan or Review mode, do steps 2 to 5, report the migration plan with the SQL you would write and its risks, and ask the user to switch to Build.

## Checklist
1. `update_plan` with: identify tool and database, read schema, design, write migration, apply locally, regenerate and test.
2. Identify the tool from the files: `prisma/schema.prisma` (Prisma), `drizzle.config.*` (Drizzle), `knexfile.*` (Knex), `alembic.ini` (Alembic), `manage.py` plus `*/migrations/` (Django), `supabase/migrations/` (Supabase CLI), `db/migrate/` (Rails), or a folder of numbered `.sql` files. `read_file` package.json scripts for existing `db:*` commands and use them.
3. Identify the target database without printing secrets: read `.env.example`, the config module or `docker-compose.yml` to see where `DATABASE_URL` points. Proceed only if it is local or a dev database (`localhost`, `127.0.0.1`, a docker service, `file:./dev.db`). If it points to a hosted or production database, or you cannot tell, stop and `ask_user` before running anything.
4. Read the current state: the schema file or models, the latest 2 or 3 migrations, and the migration status (`npx prisma migrate status`, `alembic current`, `python manage.py showmigrations`, `npx knex migrate:status`). Note drift or unapplied migrations and report them before adding more.
5. Design the change and classify it:
   - Additive (new table, nullable column, new index on a small table): safe in one step.
   - Risky (NOT NULL on existing rows, type change, rename, drop, unique constraint on existing data, index on a large table): use expand and contract.
   - Expand and contract for a required column: add it nullable (or with a constant default, cheap on Postgres 11+), deploy code that writes it, backfill in batches, then add the NOT NULL constraint in a later migration. On Postgres: `ADD CONSTRAINT ... CHECK (col IS NOT NULL) NOT VALID`, then `VALIDATE CONSTRAINT`, then `SET NOT NULL`.
   - Renames: add the new column, copy, switch reads, drop the old one later. Tools often generate a rename as drop plus add, which loses data: read the generated SQL.
   - Indexes on large Postgres tables: `CREATE INDEX CONCURRENTLY`, which cannot run inside a transaction (Prisma: put it alone in a migration created with `--create-only`; Knex: `exports.config = { transaction: false }`; Alembic: `with op.get_context().autocommit_block():`; Django: `AddIndexConcurrently` with `atomic = False`).
   - Foreign keys on large Postgres tables: add `NOT VALID`, then `VALIDATE CONSTRAINT` separately. Set `SET lock_timeout = '5s'` for DDL on busy tables.
   - MySQL: prefer `ALGORITHM=INPLACE, LOCK=NONE` where supported.
6. Write the migration with the tool, never by hand-editing an already applied migration:
   - Prisma: edit `schema.prisma`, run `npx prisma migrate dev --name add_user_role --create-only`, `read_file` the generated SQL and adjust it, then `npx prisma migrate dev`.
   - Drizzle: edit the schema, `npx drizzle-kit generate --name add_user_role`, read the SQL, then `npx drizzle-kit migrate`.
   - Knex: `npx knex migrate:make add_user_role`, write `up` and `down`, then `npx knex migrate:latest`.
   - Alembic: `alembic revision --autogenerate -m "add user role"`, read and fix the file (autogenerate misses renames and some server defaults), then `alembic upgrade head`.
   - Django: `python manage.py makemigrations <app>`, `python manage.py sqlmigrate <app> <number>` to read the SQL, then `python manage.py migrate`.
   - Supabase: `npx supabase migration new add_user_role`, write the SQL, `npx supabase migration up` (or `npx supabase db reset` for a clean local rebuild).
   - Raw SQL: a new file following the existing numbering and naming, with an up and a down section if the project uses them.
7. Rollback: write `down` / `downgrade` when the tool supports it and test it (`npx knex migrate:rollback` then `migrate:latest`; `alembic downgrade -1` then `upgrade head`). Prisma and Drizzle have no automatic down: describe the manual rollback SQL in the answer. Mark irreversible steps (dropped columns, lost data) clearly.
8. Regenerate client and types: `npx prisma generate` (migrate dev does it), `npx supabase gen types typescript --local | Out-File -Encoding utf8 src/types/database.ts`. Update code that reads or writes the changed columns, and seed files.
9. Run the tests and the type check.

## Verify (required before saying done)
- The migration applied to the local or dev database: status command shows it applied (`npx prisma migrate status` exit 0, `alembic current` shows head), with output.
- Rollback tested where the tool supports it (down then up, both exit 0).
- The generated SQL was read back (`read_file`) and contains no unintended `DROP`.
- Type check and tests pass (`npx tsc --noEmit`, `npm test`, `python -m pytest -q`): exit codes and counts.
- Never say done without this evidence. Never claim it is safe for production; say what you tested locally and what remains for the production rollout.

## Output
- **Migration:** file path(s) and the SQL in a code block (or a summary if long).
- **Risk:** additive or risky, locks taken, expected impact on large tables.
- **Applied to:** which database (local or dev) and the status output.
- **Rollback:** how to undo, tested or not.
- **Code changes:** regenerated types and updated call sites.
- **Production steps:** the ordered steps for the user to run, including deploy order for expand and contract.

## Pitfalls
- Running `prisma migrate deploy`, `prisma db push`, `supabase db push` or any migration against production without explicit user approval.
- `prisma migrate reset` and `supabase db reset` drop all data: only on a local database the user does not care about, and say so.
- `prisma db push` in a project that uses migration files: it skips migration history.
- Editing a migration that was already applied somewhere: write a new one.
- Adding NOT NULL without a default or backfill: fails on tables with rows.
- In PowerShell 5.1, `>` writes UTF-16; use `| Out-File -Encoding utf8` for generated files.
- Chaining commands with `&&`: commands run in PowerShell, use `;`.
