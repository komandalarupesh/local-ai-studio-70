create table if not exists public.presentations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled deck',
  topic text not null default '',
  theme text not null default 'midnight',
  slides jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists presentations_user_idx on public.presentations(user_id, updated_at desc);
grant select, insert, update, delete on public.presentations to authenticated;
grant all on public.presentations to service_role;
alter table public.presentations enable row level security;
create policy "Users manage own presentations"
on public.presentations for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger presentations_touch before update on public.presentations
for each row execute function public.touch_updated_at();

create table if not exists public.scenes_3d (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled scene',
  prompt text not null default '',
  code text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scenes_3d_user_idx on public.scenes_3d(user_id, updated_at desc);
grant select, insert, update, delete on public.scenes_3d to authenticated;
grant all on public.scenes_3d to service_role;
alter table public.scenes_3d enable row level security;
create policy "Users manage own 3d scenes"
on public.scenes_3d for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger scenes_3d_touch before update on public.scenes_3d
for each row execute function public.touch_updated_at();