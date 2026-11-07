# RLS templates

Replace `todos` and the columns with the real table. Keep one policy per operation and role so each rule is easy to read and test.

## Owner-only table

```sql
create table public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  done boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.todos enable row level security;

create index todos_user_id_idx on public.todos (user_id);

create policy "todos_select_own" on public.todos
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "todos_insert_own" on public.todos
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "todos_update_own" on public.todos
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "todos_delete_own" on public.todos
  for delete to authenticated
  using ((select auth.uid()) = user_id);
```

## Public read, owner write

```sql
create policy "posts_select_published" on public.posts
  for select to anon, authenticated
  using (published = true or (select auth.uid()) = author_id);
```

## Team membership

```sql
create policy "projects_select_member" on public.projects
  for select to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.project_id = projects.id and m.user_id = (select auth.uid())
  ));
```
Index `memberships (user_id, project_id)`. Add RLS and policies on `memberships` too.

## Storage: private per-user folder

```sql
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', false);

create policy "avatars_read_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
```
Clients upload to `<user id>/<file name>`.

## pgTAP test (supabase/tests/todos_rls.test.sql)

Run with `npx supabase test db`. The test runs as `postgres`, inserts fixtures, then switches role.

```sql
begin;
select plan(4);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.local');
insert into public.todos (user_id, title) values
  ('11111111-1111-1111-1111-111111111111', 'a1'),
  ('22222222-2222-2222-2222-222222222222', 'b1');

set local role anon;
select is_empty('select * from public.todos', 'anon sees no todos');

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select results_eq('select title from public.todos', $$values ('a1'::text)$$, 'user A sees only own todos');

select throws_ok(
  $$insert into public.todos (user_id, title) values ('22222222-2222-2222-2222-222222222222', 'x')$$,
  '42501', null, 'user A cannot insert for user B');

update public.todos set title = 'hacked' where user_id = '22222222-2222-2222-2222-222222222222';
reset role;
select results_eq(
  $$select title from public.todos where user_id = '22222222-2222-2222-2222-222222222222'$$,
  $$values ('b1'::text)$$, 'user A cannot update user B rows');

select * from finish();
rollback;
```

## Quick manual check (local database or connector `execute_sql`)

```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public';
select tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public';
```
