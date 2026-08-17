import { AgentPanel } from "@/components/workspace/AgentPanel";
import { CodeEditor } from "@/components/workspace/CodeEditor";
import { FileExplorer } from "@/components/workspace/FileExplorer";
import { LivePreview } from "@/components/workspace/LivePreview";
import { TaskPlanner, type TaskRow } from "@/components/workspace/TaskPlanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  CONTEXT,
  compactIfNeeded,
  contextChars,
  planTasks,
  runAgentTurn,
  runProjectChecks,
  type AgentConversation,
  type AgentMessage,
} from "@/lib/agent";
import { isLocalEndpoint } from "@/lib/local-stream";
import type { RunProvider } from "@/lib/model-client";
import type { ProjectFile } from "@/lib/project-files";
import { MODE_LIST, modeConfig, type WorkspaceMode } from "@/lib/workspace-modes";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Layers,
  Loader2,
  PlayCircle,
  Settings2,
  ShieldCheck,
  Wrench,
  XCircle,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/workspace/$projectId")({
  component: ProjectWorkspace,
  head: () => ({
    meta: [
      { title: "Project workspace · Rupesh LLM Studio" },
      {
        name: "description",
        content:
          "Plan, generate, edit, check and preview your project with your own local or OpenAI-compatible model backend.",
      },
      { property: "og:title", content: "Project workspace · Rupesh LLM Studio" },
      {
        property: "og:description",
        content: "An AI development workspace powered by the models you control.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

type ProjectRow = {
  id: string;
  name: string;
  description: string;
  mode: string;
  updated_at: string;
};

type CheckRow = { id: string; status: string; output: string; created_at: string; kind: string };

function ProjectWorkspace() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();
  const [pane, setPane] = useState<"files" | "preview" | "checks">("files");
  const [activePath, setActivePath] = useState<string | null>(null);
  const [streamed, setStreamed] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: async (): Promise<ProjectRow> => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, description, mode, updated_at")
        .eq("id", projectId)
        .single();
      if (error) throw new Error(error.message);
      return data as ProjectRow;
    },
  });

  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: async (): Promise<(RunProvider & { name: string })[]> => {
      const { data, error } = await supabase
        .from("providers")
        .select("id, name, kind, base_url, default_model, has_key")
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as (RunProvider & { name: string })[];
    },
  });

  const conversationQuery = useQuery({
    queryKey: ["project-conversation", projectId],
    enabled: Boolean(projectQuery.data),
    queryFn: async (): Promise<AgentConversation> => {
      const select =
        "id, title, mode, summary, temperature, max_tokens, system_prompt, model, provider_id";
      const { data: existing, error } = await supabase
        .from("conversations")
        .select(select)
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .limit(1);
      if (error) throw new Error(error.message);
      if (existing?.[0]) return existing[0] as AgentConversation;

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Your session expired. Sign in again.");
      const project = projectQuery.data!;
      const { data: providers } = await supabase
        .from("providers")
        .select("id, default_model")
        .order("created_at")
        .limit(1);
      const provider = providers?.[0];
      const { data: created, error: createError } = await supabase
        .from("conversations")
        .insert({
          user_id: userId,
          project_id: projectId,
          title: project.name,
          mode: project.mode,
          model: provider?.default_model ?? "",
          provider_id: provider?.id ?? null,
          temperature: modeConfig(project.mode).temperature,
          max_tokens: 8192,
        })
        .select(select)
        .single();
      if (createError) throw new Error(createError.message);
      return created as AgentConversation;
    },
  });

  const messagesQuery = useQuery({
    queryKey: ["project-messages", conversationQuery.data?.id],
    enabled: Boolean(conversationQuery.data?.id),
    queryFn: async (): Promise<AgentMessage[]> => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, role, content, model, compacted, created_at")
        .eq("conversation_id", conversationQuery.data!.id)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as AgentMessage[];
    },
  });

  const filesQuery = useQuery({
    queryKey: ["project-files", projectId],
    queryFn: async (): Promise<ProjectFile[]> => {
      const { data, error } = await supabase
        .from("project_files")
        .select("id, path, content, language, updated_at")
        .eq("project_id", projectId)
        .order("path", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as ProjectFile[];
    },
  });

  const tasksQuery = useQuery({
    queryKey: ["project-tasks", projectId],
    queryFn: async (): Promise<TaskRow[]> => {
      const { data, error } = await supabase
        .from("project_tasks")
        .select("id, title, detail, status, position")
        .eq("project_id", projectId)
        .order("position", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as TaskRow[];
    },
  });

  const checksQuery = useQuery({
    queryKey: ["project-checks", projectId],
    queryFn: async (): Promise<CheckRow[]> => {
      const { data, error } = await supabase
        .from("project_checks")
        .select("id, kind, status, output, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return (data ?? []) as CheckRow[];
    },
  });

  const project = projectQuery.data;
  const conversation = conversationQuery.data;
  const providers = providersQuery.data ?? [];
  const files = filesQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const messages = messagesQuery.data ?? [];
  const mode = (project?.mode ?? "reasoning") as WorkspaceMode;
  const config = modeConfig(mode);

  const provider = useMemo(
    () => providers.find((p) => p.id === conversation?.provider_id) ?? providers[0],
    [providers, conversation?.provider_id],
  );
  const model = conversation?.model || provider?.default_model || "";
  const activeFile = files.find((f) => f.path === activePath) ?? null;

  const modelsQuery = useQuery({
    queryKey: ["provider-models", provider?.id],
    enabled: Boolean(provider),
    staleTime: 60_000,
    queryFn: async (): Promise<string[]> => {
      if (!provider) return [];
      if (provider.kind !== "lovable" && isLocalEndpoint(provider.base_url)) {
        const { listLocalModels } = await import("@/lib/local-stream");
        return listLocalModels(provider.kind as "openai" | "ollama", provider.base_url).catch(
          () => [],
        );
      }
      const { testProviderConnection } = await import("@/lib/studio.functions");
      const result = await testProviderConnection({ data: { providerId: provider.id } });
      return result.models;
    },
  });

  function invalidate(keys: (readonly unknown[])[]) {
    for (const key of keys) queryClient.invalidateQueries({ queryKey: key });
  }

  const patchProject = useMutation({
    mutationFn: async (patch: Partial<ProjectRow>) => {
      const { error } = await supabase.from("projects").update(patch).eq("id", projectId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidate([["project", projectId], ["projects"]]),
    onError: (error: Error) => toast.error(error.message),
  });

  const patchConversation = useMutation({
    mutationFn: async (patch: Partial<AgentConversation>) => {
      if (!conversation) return;
      const { error } = await supabase
        .from("conversations")
        .update(patch)
        .eq("id", conversation.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidate([["project-conversation", projectId]]),
    onError: (error: Error) => toast.error(error.message),
  });

  const saveFile = useMutation({
    mutationFn: async ({ file, content }: { file: ProjectFile; content: string }) => {
      const { error } = await supabase
        .from("project_files")
        .update({ content })
        .eq("id", file.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      invalidate([["project-files", projectId]]);
      toast.success("File saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteFile = useMutation({
    mutationFn: async (file: ProjectFile) => {
      const { error } = await supabase.from("project_files").delete().eq("id", file.id);
      if (error) throw new Error(error.message);
      return file.path;
    },
    onSuccess: (path) => {
      if (activePath === path) setActivePath(null);
      invalidate([["project-files", projectId]]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createFile = useMutation({
    mutationFn: async (path: string) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Your session expired. Sign in again.");
      const { error } = await supabase.from("project_files").insert({
        project_id: projectId,
        user_id: userId,
        path,
        content: "",
      });
      if (error) throw new Error(error.message);
      return path;
    },
    onSuccess: (path) => {
      setActivePath(path);
      invalidate([["project-files", projectId]]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function requireRuntime(): { provider: RunProvider; model: string } | null {
    if (!provider) {
      toast.error("Add a model provider first.");
      return null;
    }
    if (!model) {
      toast.error("Select a model for this workspace.");
      return null;
    }
    return { provider, model };
  }

  async function withRun<T>(label: string, fn: (signal: AbortSignal) => Promise<T>) {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setStatus(label);
    setStreamed("");
    try {
      return await fn(controller.signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        toast.info("Stopped.");
      } else {
        toast.error(error instanceof Error ? error.message : "Something went wrong.");
      }
      return null;
    } finally {
      abortRef.current = null;
      setBusy(false);
      setStatus(null);
      setStreamed("");
    }
  }

  async function maybeCompact(signal: AbortSignal) {
    const runtime = requireRuntime();
    if (!runtime || !conversation) return;
    const result = await compactIfNeeded({
      conversation,
      messages,
      provider: runtime.provider,
      model: runtime.model,
      signal,
    }).catch(() => null);
    if (result) {
      toast.info(`Compacted ${result.compacted} older messages into the running summary.`);
      invalidate([
        ["project-conversation", projectId],
        ["project-messages", conversation.id],
      ]);
    }
  }

  async function sendMessage(text: string) {
    const runtime = requireRuntime();
    if (!runtime || !conversation) return;
    await withRun("Generating", async (signal) => {
      setStatus("Managing context");
      await maybeCompact(signal);
      const fresh = queryClient.getQueryData<AgentMessage[]>([
        "project-messages",
        conversation.id,
      ]);
      setStatus("Generating");
      const result = await runAgentTurn({
        projectId,
        mode,
        conversation,
        messages: fresh ?? messages,
        files,
        provider: runtime.provider,
        model: runtime.model,
        userText: text,
        onDelta: (_delta, full) => setStreamed(full),
        signal,
      });
      invalidate([
        ["project-messages", conversation.id],
        ["project-files", projectId],
        ["projects"],
      ]);
      if (result.written.length > 0) {
        toast.success(`${result.written.length} file(s) written.`);
        setActivePath(result.written[0] ?? null);
      }
      return result;
    });
  }

  async function makePlan(text: string) {
    const runtime = requireRuntime();
    if (!runtime) return;
    await withRun("Planning steps", async (signal) => {
      const planned = await planTasks({
        projectId,
        mode,
        provider: runtime.provider,
        model: runtime.model,
        request: text,
        files,
        signal,
      });
      invalidate([["project-tasks", projectId]]);
      toast.success(`Planned ${planned.length} steps.`);
      return planned;
    });
  }

  async function regenerate() {
    if (!conversation) return;
    const last = messages[messages.length - 1];
    if (last?.role === "assistant") {
      await supabase.from("messages").delete().eq("id", last.id);
      await queryClient.invalidateQueries({ queryKey: ["project-messages", conversation.id] });
    }
    const runtime = requireRuntime();
    if (!runtime) return;
    const remaining = (
      queryClient.getQueryData<AgentMessage[]>(["project-messages", conversation.id]) ?? []
    ).filter((m) => m.id !== last?.id);
    await withRun("Regenerating", async (signal) => {
      const result = await runAgentTurn({
        projectId,
        mode,
        conversation,
        messages: remaining,
        files,
        provider: runtime.provider,
        model: runtime.model,
        userText: "",
        onDelta: (_d, full) => setStreamed(full),
        signal,
      });
      invalidate([
        ["project-messages", conversation.id],
        ["project-files", projectId],
      ]);
      return result;
    });
  }

  async function runTask(task: TaskRow, signal?: AbortSignal) {
    const runtime = requireRuntime();
    if (!runtime || !conversation) return false;
    setRunningTaskId(task.id);
    await supabase.from("project_tasks").update({ status: "running" }).eq("id", task.id);
    invalidate([["project-tasks", projectId]]);
    try {
      const currentFiles =
        queryClient.getQueryData<ProjectFile[]>(["project-files", projectId]) ?? files;
      await runAgentTurn({
        projectId,
        mode,
        conversation,
        messages:
          queryClient.getQueryData<AgentMessage[]>(["project-messages", conversation.id]) ??
          messages,
        files: currentFiles,
        provider: runtime.provider,
        model: runtime.model,
        userText: `Execute plan step ${task.position + 1}: ${task.title}\n\n${task.detail}\n\nImplement it now and output every file you create or change in full.`,
        onDelta: (_d, full) => setStreamed(full),
        ...(signal ? { signal } : {}),
      });
      await supabase.from("project_tasks").update({ status: "done" }).eq("id", task.id);
      invalidate([
        ["project-tasks", projectId],
        ["project-files", projectId],
        ["project-messages", conversation.id],
      ]);
      return true;
    } catch (error) {
      await supabase.from("project_tasks").update({ status: "failed" }).eq("id", task.id);
      invalidate([["project-tasks", projectId]]);
      throw error;
    } finally {
      setRunningTaskId(null);
    }
  }

  async function runRemainingTasks() {
    await withRun("Running plan", async (signal) => {
      const pending = tasks.filter((t) => t.status !== "done");
      for (const task of pending) {
        if (signal.aborted) break;
        setStatus(`Step ${task.position + 1}: ${task.title}`);
        await runTask(task, signal);
      }
      return true;
    });
  }

  async function runChecks() {
    const currentFiles =
      queryClient.getQueryData<ProjectFile[]>(["project-files", projectId]) ?? files;
    const result = await runProjectChecks({
      projectId,
      files: currentFiles,
      expectWeb: config.webPreview,
    });
    invalidate([["project-checks", projectId]]);
    setPane("checks");
    if (result.status === "passed") toast.success("Checks passed.");
    else toast.error("Checks found issues. Use “Fix issues” to feed them back to the model.");
    return result;
  }

  async function fixIssues() {
    const runtime = requireRuntime();
    if (!runtime || !conversation) return;
    const result = await runChecks();
    if (result.status === "passed") return;
    await withRun("Repairing", async (signal) => {
      await runAgentTurn({
        projectId,
        mode,
        conversation,
        messages:
          queryClient.getQueryData<AgentMessage[]>(["project-messages", conversation.id]) ??
          messages,
        files: queryClient.getQueryData<ProjectFile[]>(["project-files", projectId]) ?? files,
        provider: runtime.provider,
        model: runtime.model,
        userText: `The project check pass reported these problems:\n\n${result.output}\n\nFix all of them and re-output every affected file in full.`,
        onDelta: (_d, full) => setStreamed(full),
        signal,
      });
      invalidate([
        ["project-files", projectId],
        ["project-messages", conversation.id],
      ]);
      await runChecks();
      return true;
    });
  }

  if (projectQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  if (projectQuery.isError || !project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle className="size-6 text-destructive" />
        <p className="text-sm text-muted-foreground">
          This project could not be loaded. It may have been deleted.
        </p>
        <Button asChild variant="secondary">
          <Link to="/workspace">Back to projects</Link>
        </Button>
      </div>
    );
  }

  const used = contextChars(messages, conversation?.summary ?? "");
  const pct = Math.min(100, Math.round((used / CONTEXT.workingChars) * 100));
  const models = modelsQuery.data ?? [];
  const latestCheck = checksQuery.data?.[0];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-surface/60 px-4 py-2.5 backdrop-blur">
        <Input
          key={project.name}
          defaultValue={project.name}
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (name && name !== project.name) patchProject.mutate({ name });
          }}
          className="h-8 w-[190px] border-transparent bg-transparent px-2 font-display text-sm font-semibold hover:border-border"
        />

        <Select value={mode} onValueChange={(value) => patchProject.mutate({ mode: value })}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODE_LIST.map((item) => (
              <SelectItem key={item.id} value={item.id} className="text-xs">
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={provider?.id ?? ""}
          onValueChange={(value) => {
            const next = providers.find((p) => p.id === value);
            patchConversation.mutate({ provider_id: value, model: next?.default_model ?? "" });
          }}
        >
          <SelectTrigger className="h-8 w-[170px] text-xs">
            <SelectValue placeholder="Provider" />
          </SelectTrigger>
          <SelectContent>
            {providers.map((item) => (
              <SelectItem key={item.id} value={item.id} className="text-xs">
                {item.kind === "ollama" ? "🖥 " : item.kind === "lovable" ? "☁ " : "⚙ "}
                {item.name}
              </SelectItem>
            ))}
            {providers.length === 0 && (
              <div className="p-2 text-xs text-muted-foreground">No providers yet</div>
            )}
          </SelectContent>
        </Select>

        {models.length > 0 ? (
          <Select
            value={models.includes(model) ? model : ""}
            onValueChange={(value) => patchConversation.mutate({ model: value })}
          >
            <SelectTrigger className="h-8 w-[190px] text-xs">
              <SelectValue placeholder={model || "Model"} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {models.map((item) => (
                <SelectItem key={item} value={item} className="text-xs">
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            key={model}
            defaultValue={model}
            placeholder="model name"
            onBlur={(event) => patchConversation.mutate({ model: event.target.value })}
            className="h-8 w-[180px] text-xs"
          />
        )}

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary" size="sm" className="h-8 gap-1.5 text-xs">
              <Settings2 className="size-3.5" /> Tuning
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[360px] space-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Extra project instructions
              </Label>
              <Textarea
                key={conversation?.id}
                defaultValue={conversation?.system_prompt ?? ""}
                rows={4}
                className="mt-2 text-xs"
                onBlur={(event) =>
                  patchConversation.mutate({ system_prompt: event.target.value })
                }
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Added on top of the {config.label} mode prompt.
              </p>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs">
                <Label>Temperature</Label>
                <span className="font-mono text-primary">
                  {Number(conversation?.temperature ?? config.temperature).toFixed(2)}
                </span>
              </div>
              <Slider
                className="mt-2"
                min={0}
                max={2}
                step={0.05}
                value={[Number(conversation?.temperature ?? config.temperature)]}
                onValueChange={([value]) =>
                  patchConversation.mutate({ temperature: value ?? config.temperature })
                }
              />
            </div>
            <div>
              <div className="flex items-center justify-between text-xs">
                <Label>Max output tokens</Label>
                <span className="font-mono text-primary">{conversation?.max_tokens ?? 8192}</span>
              </div>
              <Slider
                className="mt-2"
                min={512}
                max={32768}
                step={512}
                value={[conversation?.max_tokens ?? 8192]}
                onValueChange={([value]) => patchConversation.mutate({ max_tokens: value ?? 8192 })}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Provider limit: the selected model decides the real ceiling and rejects values above
                it. The workspace itself adds no cap.
              </p>
            </div>
          </PopoverContent>
        </Popover>

        <div className="ml-auto flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
                <Layers className="size-3.5 text-primary" /> Context {pct}%
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[300px] space-y-2 text-xs">
              <p className="font-medium">Long-context management</p>
              <p className="text-muted-foreground">
                {Math.round(used / 1000)}k characters (~{Math.round(used / 4000)}k tokens) of live
                context, including the running summary.
              </p>
              <p className="text-muted-foreground">
                At {Math.round(CONTEXT.workingChars / 1000)}k characters the oldest turns are
                summarized automatically and the newest {CONTEXT.keepRecentTurns} stay verbatim, so
                long builds keep going. The hard limit is your provider's context window, not this
                app.
              </p>
            </PopoverContent>
          </Popover>
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={busy}
            onClick={() => void runChecks()}
          >
            <ShieldCheck className="size-3.5" /> Run checks
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={busy || !config.buildsFiles}
            onClick={() => void fixIssues()}
          >
            <Wrench className="size-3.5" /> Fix issues
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        <section className="hidden w-64 shrink-0 border-r border-border xl:block">
          <TaskPlanner
            tasks={tasks}
            runningTaskId={runningTaskId}
            busy={busy}
            onRun={(task) => void withRun(`Step: ${task.title}`, (signal) => runTask(task, signal))}
            onRunAll={() => void runRemainingTasks()}
            onReset={(task) => {
              void supabase
                .from("project_tasks")
                .update({ status: "pending" })
                .eq("id", task.id)
                .then(() => invalidate([["project-tasks", projectId]]));
            }}
            onDelete={(task) => {
              void supabase
                .from("project_tasks")
                .delete()
                .eq("id", task.id)
                .then(() => invalidate([["project-tasks", projectId]]));
            }}
            onClear={() => {
              void supabase
                .from("project_tasks")
                .delete()
                .eq("project_id", projectId)
                .then(() => invalidate([["project-tasks", projectId]]));
            }}
          />
        </section>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-border">
          <AgentPanel
            messages={messages}
            streamed={streamed}
            busy={busy}
            status={status}
            canPlan={config.buildsFiles}
            onSend={(text) => void sendMessage(text)}
            onPlan={(text) => void makePlan(text)}
            onRegenerate={() => void regenerate()}
            onStop={() => abortRef.current?.abort()}
            emptyHint={`${config.label} mode. ${config.blurb} ${
              config.buildsFiles
                ? "Use “Plan steps” for a large request, then run the plan step by step."
                : ""
            }`}
          />
        </section>

        <section className="flex min-h-0 w-full shrink-0 flex-col border-t border-border xl:w-[38%] xl:border-l xl:border-t-0">
          <div className="border-b border-border px-3 py-2">
            <Tabs value={pane} onValueChange={(value) => setPane(value as typeof pane)}>
              <TabsList className="h-8">
                <TabsTrigger value="files" className="text-xs">
                  Files
                </TabsTrigger>
                <TabsTrigger value="preview" className="text-xs">
                  Preview
                </TabsTrigger>
                <TabsTrigger value="checks" className="text-xs">
                  Checks
                  {latestCheck && (
                    <span
                      className={cn(
                        "ml-1.5 size-1.5 rounded-full",
                        latestCheck.status === "passed" ? "bg-primary" : "bg-destructive",
                      )}
                    />
                  )}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="min-h-0 flex-1">
            {pane === "files" && (
              <div className="flex h-full min-h-0 flex-col">
                <div className="h-[38%] min-h-0 border-b border-border">
                  <FileExplorer
                    files={files}
                    activePath={activePath}
                    onSelect={(file) => setActivePath(file.path)}
                    onCreate={() => {
                      const path = window.prompt("New file path", "src/new-file.js");
                      if (path?.trim()) createFile.mutate(path.trim());
                    }}
                    onDelete={(file) => deleteFile.mutate(file)}
                  />
                </div>
                <div className="min-h-0 flex-1">
                  <CodeEditor
                    file={activeFile}
                    saving={saveFile.isPending}
                    onSave={(content) => {
                      if (activeFile) saveFile.mutate({ file: activeFile, content });
                    }}
                  />
                </div>
              </div>
            )}

            {pane === "preview" && <LivePreview files={files} />}

            {pane === "checks" && (
              <div className="scroll-slim h-full overflow-y-auto p-3">
                <Button
                  size="sm"
                  variant="secondary"
                  className="mb-3 gap-1.5 text-xs"
                  disabled={busy}
                  onClick={() => void runChecks()}
                >
                  <PlayCircle className="size-3.5" /> Run checks now
                </Button>
                {(checksQuery.data ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No check runs yet. Checks validate JSON and JavaScript syntax, the HTML entry
                    point and relative file references.
                  </p>
                )}
                <div className="space-y-2">
                  {(checksQuery.data ?? []).map((check) => (
                    <div
                      key={check.id}
                      className="rounded-lg border border-border/70 bg-surface/50 p-2.5"
                    >
                      <div className="flex items-center gap-2 text-xs">
                        {check.status === "passed" ? (
                          <CheckCircle2 className="size-3.5 text-primary" />
                        ) : (
                          <XCircle className="size-3.5 text-destructive" />
                        )}
                        <span className="font-medium capitalize">{check.status}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {new Date(check.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                      <pre className="scroll-slim mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                        {check.output}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
