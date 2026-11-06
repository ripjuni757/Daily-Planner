-- DAYMARK database: copy into Supabase > SQL Editor and click Run.
-- Safe to re-run without deleting task data; policies are replaced in place.
create table if not exists public.daymark_tasks (
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id text not null,
  task jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

alter table public.daymark_tasks enable row level security;

revoke all on table public.daymark_tasks from anon, authenticated;
grant select, insert, update, delete on table public.daymark_tasks to authenticated;

drop policy if exists "Read only own tasks" on public.daymark_tasks;
drop policy if exists "Create only own tasks" on public.daymark_tasks;
drop policy if exists "Edit only own tasks" on public.daymark_tasks;
drop policy if exists "Delete only own tasks" on public.daymark_tasks;

create policy "Read only own tasks" on public.daymark_tasks
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Create only own tasks" on public.daymark_tasks
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Edit only own tasks" on public.daymark_tasks
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Delete only own tasks" on public.daymark_tasks
  for delete to authenticated using ((select auth.uid()) = user_id);
