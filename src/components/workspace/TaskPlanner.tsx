import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  CircleDashed,
  Loader2,
  Play,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";

export type TaskRow = {
  id: string;
  title: string;
  detail: string;
  status: string;
  position: number;
  attempts?: number | null;
  error?: string | null;
  result?: string | null;
};

export function TaskPlanner({
  tasks,
  runningTaskId,
  busy,
  onRun,
  onRunAll,
  onReset,
  onDelete,
  onClear,
}: {
  tasks: TaskRow[];
  runningTaskId: string | null;
  busy: boolean;
  onRun: (task: TaskRow) => void;
  onRunAll: () => void;
  onReset: (task: TaskRow) => void;
  onDelete: (task: TaskRow) => void;
  onClear: () => void;
}) {
  const done = tasks.filter((t) => t.status === "done").length;
  const pct = tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Task plan</p>
          <span className="ml-auto font-mono text-[11px] text-primary">
            {done}/{tasks.length}
          </span>
        </div>
        <Progress value={pct} className="mt-2 h-1.5" />
        <div className="mt-2 flex gap-1">
          <Button
            size="sm"
            className="h-7 flex-1 gap-1 px-2 text-xs"
            disabled={busy || tasks.every((t) => t.status === "done") || tasks.length === 0}
            onClick={onRunAll}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Run remaining
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={busy || tasks.length === 0}
            onClick={onClear}
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="scroll-slim min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {tasks.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            No plan yet. Send a build request and the agent will break it into steps here.
          </p>
        )}
        {tasks.map((task, index) => {
          const running = runningTaskId === task.id;
          return (
            <div
              key={task.id}
              className={cn(
                "group rounded-lg border border-border/70 bg-surface/50 p-2",
                running && "border-primary/50",
              )}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5">
                  {running ? (
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                  ) : task.status === "done" ? (
                    <CheckCircle2 className="size-3.5 text-primary" />
                  ) : task.status === "failed" ? (
                    <XCircle className="size-3.5 text-destructive" />
                  ) : (
                    <CircleDashed className="size-3.5 text-muted-foreground" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium leading-snug">
                    <span className="mr-1 font-mono text-muted-foreground">{index + 1}.</span>
                    {task.title}
                  </p>
                  {task.attempts != null && task.attempts > 1 && (
                    <p className="mt-1 font-mono text-[10px] text-amber-500">
                      {task.attempts} attempt(s)
                    </p>
                  )}
                  {task.error ? (
                    <p className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-destructive">
                      {task.error}
                    </p>
                  ) : task.result ? (
                    <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-primary">
                      {task.result}
                    </p>
                  ) : null}
                  {task.detail && (
                    <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-muted-foreground">
                      {task.detail}
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-6 gap-1 px-2 text-[11px]"
                  disabled={busy}
                  onClick={() => onRun(task)}
                >
                  <Play className="size-3" /> Run
                </Button>
                {task.status !== "pending" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 gap-1 px-2 text-[11px]"
                    disabled={busy}
                    onClick={() => onReset(task)}
                  >
                    <RotateCcw className="size-3" /> Reset
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-6 px-2 text-[11px]"
                  disabled={busy}
                  onClick={() => onDelete(task)}
                  aria-label={`Delete task ${task.title}`}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
