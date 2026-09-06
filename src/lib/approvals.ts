import { supabase } from "@/integrations/supabase/client";

/** Actions that must never run without an explicit human decision. */
export const SENSITIVE_ACTIONS = [
  "github_push",
  "github_pull_request",
  "database_write",
  "deployment",
  "file_delete",
  "external_side_effect",
] as const;
export type SensitiveAction = (typeof SENSITIVE_ACTIONS)[number];

export const ACTION_LABEL: Record<SensitiveAction, string> = {
  github_push: "Push commit to GitHub",
  github_pull_request: "Open a pull request",
  database_write: "Write to the database",
  deployment: "Deploy",
  file_delete: "Delete files",
  external_side_effect: "Call an external service",
};

export type Approval = {
  id: string;
  action: string;
  target: string;
  summary: string;
  status: string;
  created_at: string;
  decided_at: string | null;
  result: string;
};

const COLUMNS = "id, action, target, summary, status, created_at, decided_at, result";

export async function listApprovals(projectId?: string): Promise<Approval[]> {
  let query = supabase.from("action_approvals").select(COLUMNS).order("created_at", { ascending: false }).limit(50);
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Approval[];
}

/** Creates a pending request. Nothing happens until the owner approves it. */
export async function requestApproval(args: {
  action: SensitiveAction;
  target: string;
  summary: string;
  projectId?: string;
  payload?: Record<string, unknown>;
}): Promise<Approval> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Your session expired. Sign in again.");
  const { data, error } = await supabase
    .from("action_approvals")
    .insert({
      user_id: userId,
      project_id: args.projectId ?? null,
      action: args.action,
      target: args.target,
      summary: args.summary,
      payload: args.payload ?? {},
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as Approval;
}

export async function decideApproval(id: string, decision: "approved" | "rejected"): Promise<void> {
  const { error } = await supabase
    .from("action_approvals")
    .update({ status: decision, decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
}

export async function recordApprovalResult(id: string, result: string): Promise<void> {
  await supabase.from("action_approvals").update({ result: result.slice(0, 2000) }).eq("id", id);
}
