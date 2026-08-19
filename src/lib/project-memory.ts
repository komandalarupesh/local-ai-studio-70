import { supabase } from "@/integrations/supabase/client";

export const MEMORY_KINDS = ["requirement", "decision", "constraint", "fact"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export type MemoryEntry = {
  id: string;
  kind: string;
  content: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

export const MEMORY_LABEL: Record<string, string> = {
  requirement: "Requirement",
  decision: "Decision",
  constraint: "Constraint",
  fact: "Fact",
};

export async function listMemory(projectId: string): Promise<MemoryEntry[]> {
  const { data, error } = await supabase
    .from("project_memory")
    .select("id, kind, content, pinned, created_at, updated_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as MemoryEntry[];
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const id = data.user?.id;
  if (!id) throw new Error("Your session expired. Sign in again.");
  return id;
}

export async function addMemory(args: {
  projectId: string;
  kind: MemoryKind;
  content: string;
}): Promise<void> {
  const content = args.content.trim().slice(0, 4000);
  if (!content) throw new Error("Write something to remember first.");
  const userId = await currentUserId();
  const { error } = await supabase.from("project_memory").insert({
    project_id: args.projectId,
    user_id: userId,
    kind: args.kind,
    content,
  });
  if (error) throw new Error(error.message);
}

export async function updateMemory(
  id: string,
  patch: { content?: string; kind?: MemoryKind; pinned?: boolean },
): Promise<void> {
  const { error } = await supabase.from("project_memory").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteMemory(id: string): Promise<void> {
  const { error } = await supabase.from("project_memory").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Renders pinned memory as a compact prompt block sent with every turn. */
export function memoryPrompt(entries: MemoryEntry[]): string {
  const pinned = entries.filter((e) => e.pinned);
  if (pinned.length === 0) return "";
  const groups = MEMORY_KINDS.map((kind) => {
    const items = pinned.filter((e) => e.kind === kind);
    if (items.length === 0) return "";
    return `${MEMORY_LABEL[kind]}s:\n${items.map((i) => `- ${i.content}`).join("\n")}`;
  }).filter(Boolean);
  return `Project memory — these were set by the user and must be respected in every step:\n\n${groups.join("\n\n")}`;
}
