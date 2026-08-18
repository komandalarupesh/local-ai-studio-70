-- Replace the security-definer helper with an inline ownership check so no
-- extra callable function is exposed. RLS on projects still applies and owners
-- can see their own project rows.
drop policy if exists "Users manage own project files" on public.project_files;
create policy "Users manage own project files"
on public.project_files for all to authenticated
using (auth.uid() = user_id and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
with check (auth.uid() = user_id and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));

drop policy if exists "Users manage own project tasks" on public.project_tasks;
create policy "Users manage own project tasks"
on public.project_tasks for all to authenticated
using (auth.uid() = user_id and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
with check (auth.uid() = user_id and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));

drop policy if exists "Users manage own project checks" on public.project_checks;
create policy "Users manage own project checks"
on public.project_checks for all to authenticated
using (auth.uid() = user_id and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
with check (auth.uid() = user_id and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));

drop policy if exists "own conversations" on public.conversations;
create policy "own conversations"
on public.conversations for all to authenticated
using (auth.uid() = user_id and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())))
with check (auth.uid() = user_id and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())));

drop function if exists public.owns_project(uuid);