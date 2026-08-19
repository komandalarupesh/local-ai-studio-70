import { supabase } from "@/integrations/supabase/client";
import { safePath, type ProjectFile } from "@/lib/project-files";

export type SnapshotFile = { path: string; content: string; language: string };

export type Snapshot = {
  id: string;
  label: string;
  reason: string;
  summary: string;
  file_count: number;
  created_at: string;
};

export type SnapshotWithFiles = Snapshot & { files: SnapshotFile[] };

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const id = data.user?.id;
  if (!id) throw new Error("Your session expired. Sign in again.");
  return id;
}

/** Human-readable diff between two file sets, used as a snapshot change summary. */
export function changeSummary(
  before: { path: string; content: string }[],
  after: { path: string; content: string }[],
): string {
  const beforeMap = new Map(before.map((f) => [f.path, f.content]));
  const afterMap = new Map(after.map((f) => [f.path, f.content]));
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [path, content] of afterMap) {
    const prev = beforeMap.get(path);
    if (prev === undefined) added.push(path);
    else if (prev !== content) changed.push(path);
  }
  for (const path of beforeMap.keys()) if (!afterMap.has(path)) removed.push(path);
  const parts: string[] = [];
  if (added.length) parts.push(`added ${added.length} (${added.slice(0, 6).join(", ")})`);
  if (changed.length) parts.push(`changed ${changed.length} (${changed.slice(0, 6).join(", ")})`);
  if (removed.length) parts.push(`removed ${removed.length} (${removed.slice(0, 6).join(", ")})`);
  return parts.length ? parts.join("; ") : "no file changes";
}

export async function createSnapshot(args: {
  projectId: string;
  files: ProjectFile[];
  label: string;
  reason?: string;
  summary?: string;
}): Promise<string> {
  const userId = await currentUserId();
  const files: SnapshotFile[] = args.files.map((f) => ({
    path: f.path,
    content: f.content,
    language: f.language,
  }));
  const { data, error } = await supabase
    .from("project_snapshots")
    .insert({
      project_id: args.projectId,
      user_id: userId,
      label: args.label.slice(0, 160),
      reason: (args.reason ?? "").slice(0, 400),
      summary: (args.summary ?? "").slice(0, 4000),
      file_count: files.length,
      files,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function listSnapshots(projectId: string): Promise<Snapshot[]> {
  const { data, error } = await supabase
    .from("project_snapshots")
    .select("id, label, reason, summary, file_count, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) throw new Error(error.message);
  return (data ?? []) as Snapshot[];
}

export async function deleteSnapshot(id: string): Promise<void> {
  const { error } = await supabase.from("project_snapshots").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Restores a snapshot: current files are captured as a safety snapshot first,
 * then the project file set is replaced with the snapshot contents.
 */
export async function restoreSnapshot(args: {
  projectId: string;
  snapshotId: string;
  currentFiles: ProjectFile[];
}): Promise<{ restored: number; summary: string }> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("project_snapshots")
    .select("id, label, files")
    .eq("id", args.snapshotId)
    .single();
  if (error) throw new Error(error.message);
  const snapshot = data as { id: string; label: string; files: SnapshotFile[] };
  const files = (Array.isArray(snapshot.files) ? snapshot.files : []).filter((f) =>
    safePath(f.path),
  );

  await createSnapshot({
    projectId: args.projectId,
    files: args.currentFiles,
    label: "Before restore",
    reason: `Automatic safety snapshot taken before restoring “${snapshot.label}”.`,
    summary: changeSummary(files, args.currentFiles),
  });

  const summary = changeSummary(args.currentFiles, files);

  const { error: deleteError } = await supabase
    .from("project_files")
    .delete()
    .eq("project_id", args.projectId);
  if (deleteError) throw new Error(deleteError.message);

  if (files.length > 0) {
    const { error: insertError } = await supabase.from("project_files").insert(
      files.map((f) => ({
        project_id: args.projectId,
        user_id: userId,
        path: safePath(f.path)!,
        content: f.content,
        language: f.language || "text",
      })),
    );
    if (insertError) throw new Error(insertError.message);
  }

  return { restored: files.length, summary };
}
