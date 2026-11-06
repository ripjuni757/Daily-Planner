-- SOLENARY | Administration analytics and approximate active-use minutes.
-- Run in Supabase SQL Editor AFTER the original admin-feedback.sql and SET-ADMIN.sql.
-- Preserves existing users, tasks, shared spaces, feedback and account permissions.
-- Signed-in usage is collected automatically. Clearly disclose collection on the website.
-- It is approximate; users can request erasure and compliance review as applicable.

create schema if not exists private;

-- Aggregate only daily minutes. No pages visited, clicks, keystrokes, task content,
-- location, IP address, or full browsing timeline is stored here.
-- Private schema is NOT exposed through the Supabase Data API.
create table if not exists private.solenary_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null, -- UTC day
  active_minutes integer not null default 0 check (active_minutes between 0 and 1440),
  primary key (user_id, usage_date)
);
create index if not exists solenary_usage_daily_date_idx on private.solenary_usage_daily (usage_date);

-- One shared gate for all browser tabs/devices: a user can register at most
-- one minute per real server minute, even if multiple tabs call simultaneously.
create table if not exists private.solenary_usage_gate (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_minute timestamptz not null
);
revoke all on private.solenary_usage_daily from public, anon, authenticated;
revoke all on private.solenary_usage_gate from public, anon, authenticated;
alter table private.solenary_usage_daily enable row level security;
alter table private.solenary_usage_gate enable row level security;

-- When an authenticated user has accumulated roughly one minute
-- of visible, non-idle activity in the browser, record one server-minute.
-- The server chooses user_id, date and minute; the client cannot spoof those fields.
create or replace function public.solenary_record_usage_minute()
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_minute timestamptz := pg_catalog.date_trunc('minute', pg_catalog.clock_timestamp());
  v_awarded integer;
begin
  if v_user is null then
    raise exception 'Sign in required' using errcode='42501';
  end if;
  insert into private.solenary_usage_gate (user_id, last_minute)
  values (v_user, v_minute)
  on conflict (user_id) do update
    set last_minute = excluded.last_minute
    where private.solenary_usage_gate.last_minute < excluded.last_minute
  returning 1 into v_awarded;

  if v_awarded is null then
    return false; -- another tab/device already recorded this minute
  end if;

  insert into private.solenary_usage_daily (user_id, usage_date, active_minutes)
  values (v_user, (v_minute at time zone 'UTC')::date, 1)
  on conflict (user_id, usage_date) do update
    set active_minutes = least(1440, private.solenary_usage_daily.active_minutes + 1);
  return true;
end;
$$;
revoke all on function public.solenary_record_usage_minute() from public, anon, authenticated;
grant execute on function public.solenary_record_usage_minute() to authenticated;

-- People can erase their own collected usage data at any time. This does not
-- affect their account, planner tasks, feedback or other members' analytics.
create or replace function public.solenary_delete_my_usage()
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign in required' using errcode='42501';
  end if;
  delete from private.solenary_usage_daily where user_id = v_user;
  delete from private.solenary_usage_gate where user_id = v_user;
  return true;
end;
$$;
revoke all on function public.solenary_delete_my_usage() from public, anon, authenticated;
grant execute on function public.solenary_delete_my_usage() to authenticated;

-- Admin access: account emails, creation dates, last sign-in and usage sums.
-- This privileged function NEVER returns data to a non-admin. The email filter
-- and pagination are bound parameters, not raw SQL, and queries are capped.
-- Safe to rerun if a prior pre-release prototype used an older return schema.
-- This drops only the analytics reporting function, not any data table.
drop function if exists public.solenary_admin_users(integer,integer,text);
create or replace function public.solenary_admin_users(
  p_limit integer default 50,
  p_offset integer default 0,
  p_search text default ''
)
returns table (
  user_id uuid,
  email text,
  registered_at timestamptz,
  last_sign_in_at timestamptz,
  last_usage_date date,
  minutes_7d bigint,
  minutes_total bigint
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.solenary_admins a where a.user_id = auth.uid()
  ) then
    raise exception 'Administrator access required' using errcode='42501';
  end if;

  return query
  select u.id, u.email::text, u.created_at, u.last_sign_in_at,
    usage.last_usage_date,
    coalesce(usage.minutes_7d,0)::bigint,
    coalesce(usage.minutes_total,0)::bigint
  from auth.users u
  left join lateral (
    select
      coalesce(sum(d.active_minutes) filter (
        where d.usage_date >= ((pg_catalog.now() at time zone 'UTC')::date - 6)
      ),0)::bigint as minutes_7d,
      coalesce(sum(d.active_minutes),0)::bigint as minutes_total,
      max(d.usage_date) as last_usage_date
    from private.solenary_usage_daily d
    where d.user_id = u.id
  ) usage on true
  where coalesce(p_search,'') = ''
     or pg_catalog.strpos(pg_catalog.lower(coalesce(u.email,'')),
           pg_catalog.lower(pg_catalog.left(p_search,120))) > 0
  order by u.created_at desc, u.id
  limit least(greatest(coalesce(p_limit,50),1),100)
  offset least(greatest(coalesce(p_offset,0),0),1000000);
end;
$$;
revoke all on function public.solenary_admin_users(integer,integer,text) from public, anon, authenticated;
grant execute on function public.solenary_admin_users(integer,integer,text) to authenticated;

-- Overview metrics for all users, not only the current paginated user list.
create or replace function public.solenary_admin_usage_overview()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.solenary_admins a where a.user_id = auth.uid()
  ) then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  return pg_catalog.jsonb_build_object(
    'active_users_7d', (
      select count(distinct d.user_id) from private.solenary_usage_daily d
      where d.usage_date >= ((pg_catalog.now() at time zone 'UTC')::date - 6)
    ),
    'minutes_7d', (
      select coalesce(sum(d.active_minutes),0) from private.solenary_usage_daily d
      where d.usage_date >= ((pg_catalog.now() at time zone 'UTC')::date - 6)
    ),
    'minutes_total', (
      select coalesce(sum(d.active_minutes),0) from private.solenary_usage_daily d
    )
  );
end;
$$;
revoke all on function public.solenary_admin_usage_overview() from public, anon, authenticated;
grant execute on function public.solenary_admin_usage_overview() to authenticated;

-- Tell Supabase/PostgREST about the new RPC endpoints.
notify pgrst, 'reload schema';

-- Consider a documented retention schedule and lawful requests before public launch.
-- Run this security verification as a non-admin browser session to confirm no access.
