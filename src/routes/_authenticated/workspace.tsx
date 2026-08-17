import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { modeConfig } from "@/lib/workspace-modes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { FolderPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/workspace")({
  component: WorkspaceLayout,
});

export type ProjectSummary = {
  id: string;
  name: string;
  mode: string;
  updated_at: string;
};

function WorkspaceLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams({ strict: false }) as { projectId?: string };

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<ProjectSummary[]> => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, mode, updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as ProjectSummary[];
    },
  });

  const removeProject = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("projects").delete().eq("id", id);
      if (error) throw new Error(error.message);
      return id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      if (params.projectId === id) navigate({ to: "/workspace" });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
        <div className="p-3">
          <Button className="w-full gap-1.5" onClick={() => navigate({ to: "/workspace" })}>
            <FolderPlus className="size-4" /> New project
          </Button>
        </div>
        <div className="scroll-slim min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          <p className="px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            Projects
          </p>
          {(projects.data ?? []).map((project) => (
            <div
              key={project.id}
              className={cn(
                "group flex items-center gap-1 rounded-md px-2 py-1.5 transition-colors hover:bg-sidebar-accent",
                params.projectId === project.id && "bg-sidebar-accent",
              )}
            >
              <Link
                to="/workspace/$projectId"
                params={{ projectId: project.id }}
                className="min-w-0 flex-1"
              >
                <span className="block truncate text-xs">{project.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {modeConfig(project.mode).label}
                </span>
              </Link>
              <button
                className="opacity-0 transition-opacity group-hover:opacity-100"
                aria-label={`Delete ${project.name}`}
                onClick={() => removeProject.mutate(project.id)}
              >
                <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          ))}
          {projects.data?.length === 0 && (
            <p className="px-2 text-xs text-muted-foreground">No projects yet.</p>
          )}
        </div>
      </aside>
      <main className="min-h-0 min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
