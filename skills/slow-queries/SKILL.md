---
name: slow-queries
description: Finds and fixes slow database queries (N+1 patterns, missing indexes, over-fetching), checked with EXPLAIN on a local or dev database only and fixed by query rewrites or index migrations with before and after evidence. Use when the database makes something slow.
argument-hint: "<slow endpoint, query, job or table>"
metadata:
  dahl-mode: build
  dahl-icon: database
---

# Find and fix slow database queries

Slow path: $ARGUMENTS

If this is empty, call `ask_user` once with options for where it is slow (an API endpoint, a page, a background job, a specific query), then continue.

## When to use
- "The dashboard runs hundreds of queries", "this endpoint is slow and the database CPU is high", "this query takes 3 seconds".
- After the `perf` skill shows the time is spent in the database.

## When not to use
- The slowness is in application code, not queries: `perf`.
- Designing a new schema or writing a migration for a feature: `db-migration`.
- Supabase project setup, policies and functions: `supabase-backend`.
- Wrong query results rather than slow ones: `fix`.

## Mode
Needs Build mode (runs EXPLAIN and tests, edits code, adds migrations). In Plan or Review mode, do steps 1 to 5 (locate, static detection), report each suspect with `file:line`, the EXPLAIN you would run and the fix, and ask the user to switch to Build.

## Checklist
1. `update_plan` with: locate queries, check database target, baseline, diagnose, fix, re-measure.
2. Access layer and engine: Prisma (`schema.prisma`), Drizzle, TypeORM, Sequelize, Knex, Mongoose, raw `pg`, `mysql2`, `better-sqlite3`; Python: SQLAlchemy, Django ORM, psycopg, `sqlite3`. Engine from the connection config (Postgres, MySQL, SQLite, MongoDB).
3. Database safety: find where the connection string comes from (`.env`, settings, docker-compose). Run EXPLAIN only against a local or development database (localhost, a Docker container, a SQLite file, a dev branch). If it points at production, or you cannot tell, stop and `ask_user` (recommended option: use a local or dev database). Never print the connection password. `EXPLAIN ANALYZE` executes the statement: for INSERT, UPDATE or DELETE wrap it in `BEGIN; ... ROLLBACK;`.
4. Locate the queries on the slow path: start at the route or job and `read_file` it end to end. `search` for ORM calls (`findMany`, `findUnique`, `findAll`, `.objects.filter`, `session.query`, `select(`, `.find(`) and raw SQL (`SELECT`, `` sql` ``, `query(`, `execute(`).
5. Static detection:
   - N+1: a query inside a loop or `map` (`for (const u of users) await db.post.findMany({ where: { userId: u.id } })`, `Promise.all(ids.map(id => db.x.findUnique(...)))`), Django access to related objects in a loop or template without `select_related` or `prefetch_related`, SQLAlchemy lazy loads in a loop, GraphQL resolvers that query per parent row.
   - Missing index: columns in `WHERE`, `JOIN` and `ORDER BY` with no index in the schema or migrations (Prisma `@@index`, `CREATE INDEX`). Postgres does not index foreign keys automatically.
   - Over-fetching: `SELECT *` or no `select` on wide tables, loading all rows then filtering in code, no `LIMIT`, deep `OFFSET` pagination (use keyset pagination), `COUNT(*)` on large tables on every request.
   - Non-sargable filters: `lower(email) = ?` without an expression index, `LIKE '%term'`, functions or casts on indexed columns, `OR` across different columns.
6. Baseline (Build mode):
   - Count queries for one request: Prisma `new PrismaClient({ log: ['query'] })`, Sequelize `logging: console.log`, Knex `debug: true`, SQLAlchemy `echo=True`, Django `assertNumQueries` or `connection.queries` with `DEBUG=True`. N similar queries for N rows is an N+1.
   - Plans: Postgres `psql "$env:DATABASE_URL" -c "EXPLAIN (ANALYZE, BUFFERS) SELECT ..."`; MySQL 8 `mysql -e "EXPLAIN ANALYZE SELECT ..."`; SQLite `sqlite3 dev.db "EXPLAIN QUERY PLAN SELECT ..."`, or without the CLI `python -c "import sqlite3; c = sqlite3.connect('dev.db'); print(c.execute('EXPLAIN QUERY PLAN SELECT ...').fetchall())"`; MongoDB `db.orders.find({...}).explain('executionStats')`.
   - Read the plan: Seq Scan or `SCAN table` with a selective filter, estimated vs actual rows off by 10x or more (run `ANALYZE`), Nested Loop with thousands of loops, Sort spilling to disk, high shared buffer reads. SQLite: `SEARCH ... USING INDEX` is good, `SCAN` on a big table is not.
   - Endpoint timing, median of 5: `Measure-Command { Invoke-WebRequest http://localhost:3000/api/orders -UseBasicParsing } | Select-Object TotalMilliseconds`.
   - On an empty dev database the planner prefers sequential scans. Seed realistic volume (ask before inserting large amounts of data) or state the limitation.
7. Fix the cause:
   - N+1: eager loading (Prisma `include` or nested `select`, Sequelize `include`, Django `select_related` or `prefetch_related`, SQLAlchemy `selectinload` or `joinedload`), or one batched query (`WHERE id IN (...)`, `findMany({ where: { userId: { in: ids } } })`, a `JOIN` with `GROUP BY`) then group in memory; DataLoader for GraphQL. `Promise.all` over N queries is still N queries.
   - Index: add it through a migration, never by hand on the dev database only. Load the `db-migration` skill with `use_skill` for the migration (for example Prisma `@@index([userId, createdAt])` then `npx prisma migrate dev --name add_orders_user_created_idx`). Composite order: equality columns first, then range or sort columns. For large production Postgres tables note `CREATE INDEX CONCURRENTLY` (outside a transaction).
   - Rewrite: select only needed columns, push filters and aggregation into SQL, keyset pagination, expression or trigram index (`pg_trgm`) for case-insensitive or contains search.
8. Re-measure with the same EXPLAIN, query count and endpoint timing. Run the tests (`npm test`, `python -m pytest -q`).

## Verify (required before saying done)
- Before and after evidence for each fix: query count, plan (scan type and execution time), or endpoint median, from the same commands.
- Tests pass after the change (command and exit code), and the migration file exists and was applied to the local or dev database only.
- Production was not touched. Never claim a speedup without the numbers; production data distribution and lock time of index creation remain unverified unless measured there by the user.

## Output
- **Query:** `file:line` and the ORM call or SQL.
- **Problem:** N+1, missing index, over-fetching or non-sargable filter, with evidence (query count or plan excerpt).
- **Fix:** code change and migration file.
- **Results:**

| Metric | Before | After |
|---|---|---|
| Queries per request | | |
| Plan node | | |
| Execution time | | |
| Endpoint median | | |

- **Rollout notes:** index build on large tables, `CONCURRENTLY`, what to watch in production.

## Pitfalls
- Running EXPLAIN ANALYZE on production, or on a write statement without rolling it back.
- Adding an index for every column: each one slows writes; check existing indexes and their prefixes first.
- Concluding an index is useless from a plan on a tiny table.
- Replacing a loop of queries with `Promise.all` and calling the N+1 fixed.
- Eager loading huge relations (`include` everything) and trading N+1 for over-fetching.
- Creating the index directly in the dev database without a migration, so nobody else gets it.
