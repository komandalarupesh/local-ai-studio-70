import { ConfirmAction } from "@/components/workspace/ConfirmAction";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  MEMORY_KINDS,
  MEMORY_LABEL,
  addMemory,
  deleteMemory,
  listMemory,
  updateMemory,
  type MemoryKind,
} from "@/lib/project-memory";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/** Editable per-project knowledge the agent receives on every turn. */
export function MemoryPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<MemoryKind>("requirement");
  const [content, setContent] = useState("");

  const memoryQuery = useQuery({
    queryKey: ["project-memory", projectId],
    queryFn: () => listMemory(projectId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["project-memory", projectId] });

  const add = useMutation({
    mutationFn: () => addMemory({ projectId, kind, content }),
    onSuccess: () => {
      setContent("");
      void refresh();
      toast.success("Saved to project memory");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const patch = useMutation({
    mutationFn: (args: { id: string; patch: { content?: string; pinned?: boolean } }) =>
      updateMemory(args.id, args.patch),
    onSuccess: () => void refresh(),
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteMemory(id),
    onSuccess: () => void refresh(),
    onError: (error: Error) => toast.error(error.message),
  });

  const entries = memoryQuery.data ?? [];

  return (
    <div className="scroll-slim h-full overflow-y-auto p-3">
      <p className="mb-3 rounded-md border border-border/70 bg-muted/30 p-2 text-[11px] leading-relaxed text-muted-foreground">
        Pinned entries are sent with every agent turn and survive context compaction, so
        requirements, decisions and constraints are never summarised away.
      </p>

      <div className="mb-4 space-y-2 rounded-lg border border-border/70 bg-surface/50 p-2.5">
        <div className="flex items-center gap-2">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Type</Label>
          <Select value={kind} onValueChange={(value) => setKind(value as MemoryKind)}>
            <SelectTrigger className="h-7 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEMORY_KINDS.map((item) => (
                <SelectItem key={item} value={item} className="text-xs">
                  {MEMORY_LABEL[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Textarea
          rows={3}
          value={content}
          placeholder="e.g. The app must work offline against a local Ollama endpoint."
          onChange={(event) => setContent(event.target.value)}
          className="text-xs"
        />
        <Button
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={!content.trim() || add.isPending}
          onClick={() => add.mutate()}
        >
          {add.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Add memory
        </Button>
      </div>

      {memoryQuery.isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      {memoryQuery.isError && (
        <p className="text-xs text-destructive">Memory could not be loaded. Try again.</p>
      )}
      {!memoryQuery.isLoading && entries.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No memory yet. Add the requirements and decisions this project must always respect.
        </p>
      )}

      <div className="space-y-2">
        {entries.map((entry) => (
          <div key={entry.id} className="rounded-lg border border-border/70 bg-surface/50 p-2.5">
            <div className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              {MEMORY_LABEL[entry.kind] ?? entry.kind}
              <div className="ml-auto flex items-center gap-2">
                <span className="text-[10px] normal-case">{entry.pinned ? "Pinned" : "Off"}</span>
                <Switch
                  checked={entry.pinned}
                  onCheckedChange={(pinned) => patch.mutate({ id: entry.id, patch: { pinned } })}
                />
                <ConfirmAction
                  title="Delete this memory?"
                  description="The agent will stop receiving this instruction on future turns."
                  onConfirm={() => remove.mutate(entry.id)}
                  trigger={
                    <Button variant="ghost" size="icon" className="size-6">
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                  }
                />
              </div>
            </div>
            <Textarea
              key={entry.updated_at}
              defaultValue={entry.content}
              rows={2}
              className="text-xs"
              onBlur={(event) => {
                const next = event.target.value.trim();
                if (next && next !== entry.content)
                  patch.mutate({ id: entry.id, patch: { content: next } });
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
