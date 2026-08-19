import { supabase } from "@/integrations/supabase/client";

export type EventKind =
  | "plan"
  | "implement"
  | "inspect"
  | "check"
  | "fix"
  | "summary"
  | "files"
  | "snapshot"
  | "restore"
  | "memory"
  | "error"
  | "cancel";

export type EventStatus = "info" | "success" | "warning" | "error";

export type ProjectEvent = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  status: string;
  created_at: string;
};

/**
 * Appends one entry to the project activity timeline. Logging is best-effort:
 * a failure here must never abort the work the user actually asked for.
 */
export async function logEvent(args: {
  projectId: string;
  kind: EventKind;
  title: string;
  detail?: string;
  status?: EventStatus;
}): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (!userId) return;
    await supabase.from("project_events").insert({
      project_id: args.projectId,
      user_id: userId,
      kind: args.kind,
      title: args.title.slice(0, 300),
      detail: (args.detail ?? "").slice(0, 8000),
      status: args.status ?? "info",
    });
  } catch {
    // timeline is advisory only
  }
}

export async function listEvents(projectId: string, limit = 120): Promise<ProjectEvent[]> {
  const { data, error } = await supabase
    .from("project_events")
    .select("id, kind, title, detail, status, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectEvent[];
}

export async function clearEvents(projectId: string): Promise<void> {
  const { error } = await supabase.from("project_events").delete().eq("project_id", projectId);
  if (error) throw new Error(error.message);
}
