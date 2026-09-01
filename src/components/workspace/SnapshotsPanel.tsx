import { ConfirmAction } from "@/components/workspace/ConfirmAction";
import { Button } from "@/components/ui/button";
import type { ProjectFile } from "@/lib/project-files";
import {
  createSnapshot,
  deleteSnapshot,
  listSnapshots,
  restoreSnapshot,
} from "@/lib/project-history";
import { logEvent } from "@/lib/project-activity";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, History, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Persistent version history. Snapshots store the full file set, so restoring
 * is exact; a safety snapshot of the current state is always taken first.
 */
export function SnapshotsPanel({
  projectId,
  files,
  onRestored,
}: {
  projectId: string;
  files: ProjectFile[];
  onRestored: () => void;
}) {
  const queryClient = useQueryClient();
  const snapshotsQuery = useQuery({
    queryKey: ["project-snapshots", projectId],
    queryFn: () => listSnapshots(projectId),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["project-snapshots", projectId] });
    queryClient.invalidateQueries({ queryKey: ["project-events", projectId] });
  };

  const take = useMutation({
    mutationFn: async () => {
      const label = `Manual snapshot · ${new Date().toLocaleString()}`;
      await createSnapshot({
        projectId,
        files,
        label,
        reason: "Taken manually from the workspace.",
        summary: `${files.length} file(s) captured.`,
      });
      await logEvent({
        projectId,
        kind: "snapshot",
        title: label,
        detail: `${files.length} file(s) captured.`,
        status: "success",
      });
    },
    onSuccess: () => {
      refresh();
      toast.success("Snapshot saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const restore = useMutation({
    mutationFn: async (snapshotId: string) =>
      restoreSnapshot({ projectId, snapshotId, currentFiles: files }),
    onSuccess: async (result) => {
      await logEvent({
        projectId,
        kind: "restore",
        title: `Restored ${result.restored} file(s)`,
        detail: result.summary,
        status: "success",
      });
      refresh();
      onRestored();
      toast.success(`Restored ${result.restored} file(s)`, { description: result.summary });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (snapshotId: string) => deleteSnapshot(snapshotId),
    onSuccess: () => refresh(),
    onError: (error: Error) => toast.error(error.message),
  });

  const snapshots = snapshotsQuery.data ?? [];

  return (
    <div className="scroll-slim h-full overflow-y-auto p-3">
      <div className="mb-3 flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="gap-1.5 text-xs"
          disabled={take.isPending || files.length === 0}
          onClick={() => take.mutate()}
        >
          {take.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Camera className="size-3.5" />
          )}
          Snapshot now
        </Button>
        {snapshotsQuery.isLoading && (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        )}
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {snapshots.length}
        </span>
      </div>

      {snapshotsQuery.isError && (
        <p className="text-xs text-destructive">
          Version history could not be loaded: {(snapshotsQuery.error as Error).message}
        </p>
      )}

      {!snapshotsQuery.isLoading && snapshots.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No snapshots yet. Autonomous runs snapshot before and after automatically, or take one
          manually.
        </p>
      )}

      <div className="space-y-2">
        {snapshots.map((snapshot) => (
          <div key={snapshot.id} className="rounded-lg border border-border/70 bg-surface/50 p-2.5">
            <div className="flex items-start gap-2">
              <History className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{snapshot.label}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {new Date(snapshot.created_at).toLocaleString()} · {snapshot.file_count} file(s)
                </p>
                {snapshot.summary && (
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    {snapshot.summary}
                  </p>
                )}
                {snapshot.reason && (
                  <p className="mt-1 text-[11px] italic leading-snug text-muted-foreground/80">
                    {snapshot.reason}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-2 flex gap-1">
              <ConfirmAction
                title="Restore this snapshot?"
                description="Every current file in this project is replaced with the snapshot contents. A safety snapshot of the current state is taken first, so this stays reversible."
                confirmLabel="Restore"
                onConfirm={() => restore.mutate(snapshot.id)}
              >
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-6 gap-1 px-2 text-[11px]"
                  disabled={restore.isPending}
                >
                  <RotateCcw className="size-3" /> Restore
                </Button>
              </ConfirmAction>
              <ConfirmAction
                title="Delete this snapshot?"
                description="The stored file contents for this version are removed permanently."
                confirmLabel="Delete"
                onConfirm={() => remove.mutate(snapshot.id)}
              >
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-6 px-2 text-[11px]"
                  aria-label={`Delete snapshot ${snapshot.label}`}
                >
                  <Trash2 className="size-3" />
                </Button>
              </ConfirmAction>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
