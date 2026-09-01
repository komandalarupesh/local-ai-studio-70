import { ConfirmAction } from "@/components/workspace/ConfirmAction";
import { Button } from "@/components/ui/button";
import { clearEvents, listEvents } from "@/lib/project-activity";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

const STATUS_STYLE: Record<string, string> = {
  success: "border-primary/50 text-primary",
  warning: "border-amber-500/50 text-amber-500",
  error: "border-destructive/60 text-destructive",
  info: "border-border text-muted-foreground",
};

/** Append-only record of what the agent actually did, newest first. */
export function TimelinePanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const eventsQuery = useQuery({
    queryKey: ["project-events", projectId],
    queryFn: () => listEvents(projectId),
  });

  const clear = useMutation({
    mutationFn: () => clearEvents(projectId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-events", projectId] }),
    onError: (error: Error) => toast.error(error.message),
  });

  const events = eventsQuery.data ?? [];

  return (
    <div className="scroll-slim h-full overflow-y-auto p-3">
      <div className="mb-3 flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="gap-1.5 text-xs"
          onClick={() => void eventsQuery.refetch()}
        >
          {eventsQuery.isFetching ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Refresh
        </Button>
        {events.length > 0 && (
          <ConfirmAction
            title="Clear the activity timeline?"
            description="Every recorded action, file change, check and error for this project is deleted. Files and snapshots are not affected."
            confirmLabel="Clear"
            onConfirm={() => clear.mutate()}
            trigger={
              <Button size="sm" variant="ghost" className="ml-auto gap-1.5 text-xs">
                <Trash2 className="size-3.5" /> Clear
              </Button>
            }
          />
        )}
      </div>

      {eventsQuery.isError && (
        <p className="text-xs text-destructive">
          Timeline could not be loaded: {(eventsQuery.error as Error).message}
        </p>
      )}

      {!eventsQuery.isLoading && events.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nothing recorded yet. Planning, file writes, checks, fixes, snapshots and errors appear
          here as they happen.
        </p>
      )}

      <ol className="space-y-2">
        {events.map((event) => (
          <li
            key={event.id}
            className={cn(
              "rounded-lg border bg-surface/50 p-2.5",
              STATUS_STYLE[event.status] ?? STATUS_STYLE["info"],
            )}
          >
            <div className="flex items-center gap-2">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                {event.kind}
              </span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {new Date(event.created_at).toLocaleString()}
              </span>
            </div>
            <p className="mt-1 text-xs font-medium text-foreground">{event.title}</p>
            {event.detail && (
              <pre className="scroll-slim mt-1 max-h-36 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                {event.detail}
              </pre>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
