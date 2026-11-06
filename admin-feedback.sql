-- SOLENARY v7: Admin-only statistics + user feedback. Safe to run after existing Daymark SQL.
-- Keeps existing daymark_tasks and collaboration tables unchanged.
-- Run this file in Supabase > SQL Editor as your project owner.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.solenary_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.solenary_admins enable row level security;
revoke all on table public.solenary_admins from public, anon, authenticated;
grant select on public.solenary_admins to authenticated;
drop policy if exists "Admins can see their own role" on public.solenary_admins;
create policy "Admins can see their own role" on public.solenary_admins
  for select to authenticated using ((select auth.uid()) = user_id);
-- NO client-side INSERT/UPDATE/DELETE grant. Only dashboard/SQL owner can appoint admins.

create or replace function private.solenary_is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.solenary_admins
    where user_id = (select auth.uid())
  );
$$;
revoke all on function private.solenary_is_admin() from public, anon, authenticated;
grant execute on function private.solenary_is_admin() to authenticated;

create or replace function public.solenary_am_i_admin()
returns boolean language sql stable security invoker set search_path = ''
as $$ select private.solenary_is_admin(); $$;
revoke all on function public.solenary_am_i_admin() from public, anon, authenticated;
grant execute on function public.solenary_am_i_admin() to authenticated;

create table if not exists public.solenary_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check(category in ('idea','bug','design','other')),
  message text not null check (char_length(btrim(message)) between 10 and 2000),
  status text not null default 'new' check(status in ('new','reviewed','resolved')),
  created_at timestamptz not null default now()
);
create index if not exists solenary_feedback_created_at_idx on public.solenary_feedback (created_at desc);
create index if not exists solenary_feedback_user_id_idx on public.solenary_feedback (user_id);
alter table public.solenary_feedback enable row level security;
revoke all on public.solenary_feedback from public, anon, authenticated;
-- Clients can only provide the user_id, category and message, not admin-controlled fields.
grant select on public.solenary_feedback to authenticated;
grant insert (user_id, category, message) on public.solenary_feedback to authenticated;
grant update (status) on public.solenary_feedback to authenticated;

drop policy if exists "Members can submit feedback" on public.solenary_feedback;
create policy "Members can submit feedback" on public.solenary_feedback
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Admins can read feedback" on public.solenary_feedback;
create policy "Admins can read feedback" on public.solenary_feedback
  for select to authenticated using ((select private.solenary_is_admin()));
drop policy if exists "Admins can update feedback status" on public.solenary_feedback;
create policy "Admins can update feedback status" on public.solenary_feedback
  for update to authenticated using ((select private.solenary_is_admin()))
  with check ((select private.solenary_is_admin()));
-- No delete policy; users cannot erase other people's submissions.

-- Server-enforced basic feedback spam protection (not a substitute for bot defenses).
-- The function runs with the table owner's privileges so it can inspect prior
-- submissions without giving regular users access to the inbox.
create or replace function private.solenary_feedback_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare recent_count integer;
begin
  if exists (
    select 1 from public.solenary_feedback
    where user_id = new.user_id and created_at > pg_catalog.now() - interval '30 seconds'
  ) then
    raise exception 'Wait 30 seconds between feedback submissions' using errcode = 'P0001';
  end if;
  select count(*) into recent_count from public.solenary_feedback
    where user_id = new.user_id and created_at > pg_catalog.now() - interval '24 hours';
  if recent_count >= 20 then
    raise exception 'Daily feedback submission limit reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.solenary_feedback_limit() from public, anon, authenticated;
drop trigger if exists solenary_feedback_limit_trigger on public.solenary_feedback;
create trigger solenary_feedback_limit_trigger
before insert on public.solenary_feedback
for each row execute function private.solenary_feedback_limit();

-- Administrative aggregate lives in an UNEXPOSED schema. The public wrapper
-- remains invoker-only; the privileged implementation verifies admin rights.
create or replace function private.solenary_admin_stats()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.solenary_is_admin() then
    raise exception 'Access denied' using errcode='42501';
  end if;
  return pg_catalog.jsonb_build_object(
    'total_users', (select count(*) from auth.users),
    'total_feedback', (select count(*) from public.solenary_feedback),
    'new_feedback', (select count(*) from public.solenary_feedback where status = 'new')
  );
end;
$$;
revoke all on function private.solenary_admin_stats() from public, anon, authenticated;
grant execute on function private.solenary_admin_stats() to authenticated;

create or replace function public.solenary_admin_stats()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.solenary_admin_stats(); $$;
revoke all on function public.solenary_admin_stats() from public, anon, authenticated;
grant execute on function public.solenary_admin_stats() to authenticated;

-- IMPORTANT: Nobody is an admin by default. Assign your own user separately:
-- See SET-ADMIN.sql. Never add an admin assignment to browser JavaScript.
