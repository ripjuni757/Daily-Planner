-- DAYMARK v5 COLLABORATION MIGRATION
-- Run ONCE in the Supabase SQL Editor (safe to re-run).
-- Does NOT alter or delete your private daymark_tasks rows.
-- No service-role key belongs in browser code.

create schema if not exists private;

create table if not exists public.daymark_spaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 70),
  created_at timestamptz not null default now()
);
create index if not exists daymark_spaces_owner_idx on public.daymark_spaces(owner_id);

create table if not exists public.daymark_space_members (
  space_id uuid not null references public.daymark_spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_by uuid not null default auth.uid() references auth.users(id),
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index if not exists daymark_members_user_idx on public.daymark_space_members(user_id);

create table if not exists public.daymark_space_tasks (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.daymark_spaces(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  due_date date not null,
  notes text not null default '' check (char_length(notes) <= 4000),
  completed boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists daymark_space_tasks_by_space_idx on public.daymark_space_tasks(space_id,due_date);

-- A private helper prevents recursive RLS checks between spaces and memberships.
-- This function is NOT in an API-exposed schema, takes no caller input and
-- returns only IDs that the authenticated current user belongs to.
create or replace function private.daymark_member_space_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.space_id from public.daymark_space_members m
  where m.user_id = (select auth.uid());
$$;
revoke all on function private.daymark_member_space_ids() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.daymark_member_space_ids() to authenticated;

alter table public.daymark_spaces enable row level security;
alter table public.daymark_space_members enable row level security;
alter table public.daymark_space_tasks enable row level security;

revoke all on public.daymark_spaces from anon, authenticated;
revoke all on public.daymark_space_members from anon, authenticated;
revoke all on public.daymark_space_tasks from anon, authenticated;

-- No table access at all for signed-out visitors.
grant select, insert, delete on public.daymark_spaces to authenticated;
grant update(name) on public.daymark_spaces to authenticated;
grant select, insert, delete on public.daymark_space_members to authenticated;
grant select, insert, delete on public.daymark_space_tasks to authenticated;
grant update(title, due_date, notes, completed, updated_at) on public.daymark_space_tasks to authenticated;

drop policy if exists "Daymark spaces select members" on public.daymark_spaces;
drop policy if exists "Daymark spaces owner insert" on public.daymark_spaces;
drop policy if exists "Daymark spaces owner update" on public.daymark_spaces;
drop policy if exists "Daymark spaces owner delete" on public.daymark_spaces;
create policy "Daymark spaces select members" on public.daymark_spaces for select to authenticated
  using (owner_id = (select auth.uid()) or id in (select private.daymark_member_space_ids()));
create policy "Daymark spaces owner insert" on public.daymark_spaces for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "Daymark spaces owner update" on public.daymark_spaces for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Daymark spaces owner delete" on public.daymark_spaces for delete to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "Daymark members select" on public.daymark_space_members;
drop policy if exists "Daymark members insert by owner" on public.daymark_space_members;
drop policy if exists "Daymark members leave or removed by owner" on public.daymark_space_members;
create policy "Daymark members select" on public.daymark_space_members for select to authenticated
  using (user_id = (select auth.uid()) or exists (
    select 1 from public.daymark_spaces s where s.id = space_id and s.owner_id = (select auth.uid())
  ));
create policy "Daymark members insert by owner" on public.daymark_space_members for insert to authenticated
  with check (added_by = (select auth.uid()) and user_id <> (select auth.uid()) and exists (
    select 1 from public.daymark_spaces s where s.id = space_id and s.owner_id = (select auth.uid())
  ));
create policy "Daymark members leave or removed by owner" on public.daymark_space_members for delete to authenticated
  using (user_id = (select auth.uid()) or exists (
    select 1 from public.daymark_spaces s where s.id = space_id and s.owner_id = (select auth.uid())
  ));

drop policy if exists "Daymark shared task read" on public.daymark_space_tasks;
drop policy if exists "Daymark shared task insert" on public.daymark_space_tasks;
drop policy if exists "Daymark shared task update" on public.daymark_space_tasks;
drop policy if exists "Daymark shared task delete" on public.daymark_space_tasks;
create policy "Daymark shared task read" on public.daymark_space_tasks for select to authenticated
  using (exists (select 1 from public.daymark_spaces s where s.id = space_id));
create policy "Daymark shared task insert" on public.daymark_space_tasks for insert to authenticated
  with check (created_by = (select auth.uid()) and exists (
    select 1 from public.daymark_spaces s where s.id = space_id
  ));
create policy "Daymark shared task update" on public.daymark_space_tasks for update to authenticated
  using (exists (select 1 from public.daymark_spaces s where s.id = space_id))
  with check (exists (select 1 from public.daymark_spaces s where s.id = space_id));
create policy "Daymark shared task delete" on public.daymark_space_tasks for delete to authenticated
  using (exists (select 1 from public.daymark_spaces s where s.id = space_id));

-- No policies expose daymark_tasks: its existing personal-only RLS remains unchanged.
-- Test with TWO distinct real accounts before public launch (see SECURITY.md).
