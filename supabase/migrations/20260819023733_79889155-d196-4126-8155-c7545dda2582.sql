create table if not exists public.project_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Snapshot',
  reason text not null default '',
  summary text not null default '',
  file_count integer not null default 0,
  files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists project_snapshots_project_idx on public.project_snapshots(project_id, created_at desc);
grant select, insert, update, delete on public.project_snapshots to authenticated;
grant all on public.project_snapshots to service_role;
alter table public.project_snapshots enable row level security;
create policy "Users manage own project snapshots"
on public.project_snapshots for all to authenticated
using (auth.uid() = user_id and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
with check (auth.uid() = user_id and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));

create table if not exists public.project_memory (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'fact',
  content text not null,
  pinned boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_memory_project_idx on public.project_memory(project_id, created_at desc);
grant select, insert, update, delete on public.project_memory to authenticated;
grant all on public.project_memory to service_role;
alter table public.project_memory enable row level security;
create policy "Users manage own project memory"
on public.project_memory for all to authenticated
using (auth.uid() = user_id and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
with check (auth.uid() = user_id and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));
create trigger project_memory_touch before update on public.project_memory
for each row execute function public.touch_updated_at();

create table if not exists public.project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  detail text not null default '',
  status text not null default 'info',
  created_at timestamptz not null default now()
);
create index if not exists project_events_project_idx on public.project_events(project_id, created_at desc);
grant select, insert, update, delete on public.project_events to authenticated;
grant all on public.project_events to service_role;
alter table public.project_events enable row level security;
create policy "Users manage own project events"
on public.project_events for all to authenticated
using (auth.uid() = user_id and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
with check (auth.uid() = user_id and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));

alter table public.project_tasks add column if not exists attempts integer not null default 0;
alter table public.project_tasks add column if not exists error text not null default '';
alter table public.project_tasks add column if not exists result text not null default '';