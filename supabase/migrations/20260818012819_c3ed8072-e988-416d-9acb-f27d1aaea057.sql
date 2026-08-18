-- Ownership helper: does this project belong to the caller?
create or replace function public.owns_project(_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _project_id is null or exists (
    select 1 from public.projects p
    where p.id = _project_id and p.user_id = auth.uid()
  )
$$;

revoke all on function public.owns_project(uuid) from public, anon;
grant execute on function public.owns_project(uuid) to authenticated, service_role;

-- Tighten workspace tables: row must be owned AND belong to a project the caller owns.
drop policy if exists "Users manage own project files" on public.project_files;
create policy "Users manage own project files"
on public.project_files for all to authenticated
using (auth.uid() = user_id and public.owns_project(project_id))
with check (auth.uid() = user_id and public.owns_project(project_id));

drop policy if exists "Users manage own project tasks" on public.project_tasks;
create policy "Users manage own project tasks"
on public.project_tasks for all to authenticated
using (auth.uid() = user_id and public.owns_project(project_id))
with check (auth.uid() = user_id and public.owns_project(project_id));

drop policy if exists "Users manage own project checks" on public.project_checks;
create policy "Users manage own project checks"
on public.project_checks for all to authenticated
using (auth.uid() = user_id and public.owns_project(project_id))
with check (auth.uid() = user_id and public.owns_project(project_id));

drop policy if exists "own conversations" on public.conversations;
create policy "own conversations"
on public.conversations for all to authenticated
using (auth.uid() = user_id and public.owns_project(project_id))
with check (auth.uid() = user_id and public.owns_project(project_id));

grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_files to authenticated;
grant select, insert, update, delete on public.project_tasks to authenticated;
grant select, insert, update, delete on public.project_checks to authenticated;
grant all on public.projects, public.project_files, public.project_tasks, public.project_checks to service_role;