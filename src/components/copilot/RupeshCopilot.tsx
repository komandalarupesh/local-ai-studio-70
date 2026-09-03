import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { runModel, type RunProvider } from "@/lib/model-client";
import {
  buildCandidates,
  buildSuggestions,
  planRun,
  planSystemPrompt,
  type OrchestrationPlan,
  type RoutableProvider,
  type Suggestion,
} from "@/lib/orchestrator";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  AlertTriangle,
  CircleDot,
  Loader2,
  Sparkles,
  StopCircle,
  TriangleAlert,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

/**
 * Rupesh Copilot — context-aware assistant.
 *
 * Suggestions are computed from real rows loaded from the database. The "Ask"
 * tab routes through the orchestrator to a provider/model the user actually
 * configured; if none is configured it refuses instead of inventing an answer.
 */

const SEVERITY_ICON = {
  info: CircleDot,
  warning: TriangleAlert,
  error: AlertTriangle,
} as const;

function useCopilotContext() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const projectId = /^\/workspace\/([0-9a-f-]{36})/i.exec(pathname)?.[1] ?? null;

  const providers = useQuery({
    queryKey: ["copilot", "providers"],
    queryFn: async (): Promise<RoutableProvider[]> => {
      const { data, error } = await supabase
        .from("providers")
        .select("id, name, kind, base_url, default_model, has_key")
        .order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as RoutableProvider[];
    },
  });

  const settings = useQuery({
    queryKey: ["copilot", "settings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_settings")
        .select("default_provider_id")
        .maybeSingle();
      return data ?? null;
    },
  });

  const project = useQuery({
    queryKey: ["copilot", "project", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const id = projectId!;
      const [row, files, tasks, checks, memory, snapshots, events] = await Promise.all([
        supabase.from("projects").select("id, name").eq("id", id).maybeSingle(),
        supabase.from("project_files").select("path").eq("project_id", id),
        supabase.from("project_tasks").select("status").eq("project_id", id),
        supabase
          .from("project_checks")
          .select("status, output, created_at")
          .eq("project_id", id)
          .order("created_at", { ascending: false })
          .limit(1),
        supabase.from("project_memory").select("id").eq("project_id", id),
        supabase.from("project_snapshots").select("id").eq("project_id", id),
        supabase
          .from("project_events")
          .select("status")
          .eq("project_id", id)
          .order("created_at", { ascending: false })
          .limit(40),
      ]);
      if (!row.data) return null;
      const paths = (files.data ?? []).map((f) => f.path);
      const statuses = (tasks.data ?? []).map((t) => t.status);
      const lastCheck = checks.data?.[0] ?? null;
      return {
        id: row.data.id,
        name: row.data.name,
        fileCount: paths.length,
        hasEntryPoint: paths.some((p) => p.replace(/^\.?\//, "").toLowerCase() === "index.html"),
        pendingTasks: statuses.filter((s) => s === "pending").length,
        failedTasks: statuses.filter((s) => s === "failed").length,
        lastCheckStatus: lastCheck?.status ?? null,
        lastCheckOutput: lastCheck?.output ?? null,
        memoryCount: (memory.data ?? []).length,
        snapshotCount: (snapshots.data ?? []).length,
        recentErrors: (events.data ?? []).filter((e) => e.status === "error").length,
      };
    },
  });

  const providerRows = providers.data ?? [];
  const suggestions: Suggestion[] = buildSuggestions({
    route: pathname,
    providerCount: providerRows.length,
    providersWithModel: providerRows.filter((p) => p.default_model.trim().length > 0).length,
    ...(project.data ? { project: project.data } : {}),
  });

  return {
    pathname,
    providerRows,
    defaultProviderId: settings.data?.default_provider_id ?? null,
    suggestions,
    loading: providers.isLoading || (Boolean(projectId) && project.isLoading),
    error: providers.error instanceof Error ? providers.error.message : null,
    project: project.data ?? null,
  };
}

export function RupeshCopilot() {
  const [open, setOpen] = useState(false);
  const ctx = useCopilotContext();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const candidates = useMemo(
    () => buildCandidates(ctx.providerRows, {}),
    [ctx.providerRows],
  );

  const plan: OrchestrationPlan | null = question.trim()
    ? planRun(question.trim(), candidates, { preferredProviderId: ctx.defaultProviderId })
    : null;

  async function ask() {
    const request = question.trim();
    if (!request || !plan) return;
    if (!plan.routing.choice) {
      setRunError(plan.routing.reason);
      return;
    }
    const provider = ctx.providerRows.find((p) => p.id === plan.routing.choice!.providerId);
    if (!provider) {
      setRunError("The routed provider is no longer available. Reload the page.");
      return;
    }
    setRunError(null);
    setAnswer("");
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const contextLines = [
      `Current app route: ${ctx.pathname}`,
      ctx.project
        ? `Open project "${ctx.project.name}": ${ctx.project.fileCount} files, ${ctx.project.pendingTasks} pending steps, ${ctx.project.failedTasks} failed steps, last static check: ${ctx.project.lastCheckStatus ?? "none"}.`
        : "No project is open.",
      `Configured providers: ${ctx.providerRows.map((p) => `${p.name} (${p.kind})`).join(", ") || "none"}.`,
    ];
    try {
      await runModel({
        provider: provider as RunProvider,
        model: plan.routing.choice.model,
        systemPrompt: `${planSystemPrompt(plan)}\n\nWorkspace context (facts, do not contradict):\n${contextLines.join("\n")}`,
        messages: [{ role: "user", content: request }],
        temperature: plan.agent.temperature,
        onDelta: (_delta, full) => setAnswer(full),
        signal: controller.signal,
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        setRunError(error instanceof Error ? error.message : "The model call failed.");
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  const attention = ctx.suggestions.filter((s) => s.severity !== "info").length;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="relative"
        aria-label="Open Rupesh Copilot"
      >
        <Sparkles className="size-3.5" />
        <span className="hidden sm:inline">Copilot</span>
        {attention > 0 && (
          <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
            {attention}
          </span>
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b border-border p-4">
            <SheetTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="size-4 text-primary" /> Rupesh Copilot
            </SheetTitle>
            <SheetDescription className="text-xs">
              Suggestions come from your real project and provider rows. Answers come from a model
              you configured.
            </SheetDescription>
          </SheetHeader>

          <Tabs defaultValue="next" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mx-4 mt-3 grid w-auto grid-cols-2">
              <TabsTrigger value="next">What next</TabsTrigger>
              <TabsTrigger value="ask">Ask</TabsTrigger>
            </TabsList>

            <TabsContent value="next" className="min-h-0 flex-1">
              <ScrollArea className="h-full">
                <div className="space-y-2 p-4">
                  {ctx.loading && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" /> Reading current state…
                    </div>
                  )}
                  {ctx.error && (
                    <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                      {ctx.error}
                    </p>
                  )}
                  {!ctx.loading &&
                    ctx.suggestions.map((suggestion) => {
                      const Icon = SEVERITY_ICON[suggestion.severity];
                      return (
                        <div
                          key={suggestion.id}
                          className="rounded-lg border border-border bg-surface/60 p-3"
                        >
                          <div className="flex items-center gap-2">
                            <Icon
                              className={
                                suggestion.severity === "error"
                                  ? "size-3.5 text-destructive"
                                  : suggestion.severity === "warning"
                                    ? "size-3.5 text-amber-400"
                                    : "size-3.5 text-muted-foreground"
                              }
                            />
                            <span className="text-xs font-semibold">{suggestion.title}</span>
                            <Badge variant="outline" className="ml-auto text-[10px] uppercase">
                              {suggestion.kind}
                            </Badge>
                          </div>
                          <p className="mt-1.5 text-xs text-muted-foreground">{suggestion.detail}</p>
                          <p className="mt-1.5 text-[11px] text-muted-foreground/80">
                            Evidence: {suggestion.evidence}
                          </p>
                          <div className="mt-2 flex gap-2">
                            {suggestion.href && (
                              <Button asChild size="sm" variant="secondary" className="h-7 text-xs">
                                <Link to={suggestion.href} onClick={() => setOpen(false)}>
                                  Open
                                </Link>
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => {
                                setQuestion(`${suggestion.title}. ${suggestion.detail}`);
                              }}
                            >
                              Ask about this
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="ask" className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-border p-4">
                <Textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ask about this project, an error, or what to build next…"
                  className="min-h-20 text-xs"
                />
                {plan && (
                  <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                    <p>
                      Agent: <span className="text-foreground">{plan.agent.name}</span> · Mode{" "}
                      {plan.mode.label} · {plan.analysis.domain.replace("_", " ")} /{" "}
                      {plan.analysis.complexity}
                    </p>
                    <p>{plan.routing.reason || "No model available."}</p>
                    {plan.limitations.length > 0 && (
                      <p className="text-amber-400">{plan.limitations[0]}</p>
                    )}
                  </div>
                )}
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={!question.trim() || running}
                    onClick={ask}
                  >
                    {running ? <Loader2 className="size-3.5 animate-spin" /> : null} Ask
                  </Button>
                  {running && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => abortRef.current?.abort()}
                    >
                      <StopCircle className="size-3.5" /> Stop
                    </Button>
                  )}
                  {answer && !running && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => setAnswer("")}
                    >
                      <X className="size-3.5" /> Clear
                    </Button>
                  )}
                </div>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="p-4">
                  {runError && (
                    <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                      {runError}
                    </p>
                  )}
                  {!runError && !answer && !running && (
                    <p className="text-xs text-muted-foreground">
                      No answer yet. Nothing here is pre-written — the text appears only when a
                      configured model streams it.
                    </p>
                  )}
                  {answer && (
                    <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-foreground">
                      {answer}
                    </pre>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>
    </>
  );
}
