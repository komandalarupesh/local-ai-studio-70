import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AGENTS, AGENT_STATUS_LABEL, type AgentStatus } from "@/lib/orchestrator";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated/agents")({
  head: () => ({
    meta: [
      { title: "Agent registry — Rupesh LLM Studio" },
      {
        name: "description",
        content:
          "Every agent in Rupesh LLM Studio with its versioned prompt, tools, workspace and honest availability status.",
      },
      { property: "og:title", content: "Agent registry — Rupesh LLM Studio" },
      {
        property: "og:description",
        content: "Versioned agent prompts, required tools and real availability.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AgentsPage,
});

const STATUS_VARIANT: Record<AgentStatus, "default" | "secondary" | "outline"> = {
  available: "default",
  needs_tool: "secondary",
  planned: "outline",
};

function AgentsPage() {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return AGENTS;
    return AGENTS.filter(
      (agent) =>
        agent.name.toLowerCase().includes(q) ||
        agent.blurb.toLowerCase().includes(q) ||
        agent.group.toLowerCase().includes(q),
    );
  }, [query]);

  const counts = useMemo(
    () => ({
      available: AGENTS.filter((a) => a.status === "available").length,
      needs_tool: AGENTS.filter((a) => a.status === "needs_tool").length,
      planned: AGENTS.filter((a) => a.status === "planned").length,
    }),
    [],
  );

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
        <header className="space-y-2">
          <h1 className="font-display text-xl font-semibold">Agent registry</h1>
          <p className="text-sm text-muted-foreground">
            {AGENTS.length} agents. {counts.available} run today, {counts.needs_tool} are limited by
            a missing tool, {counts.planned} are placeholders whose surface does not exist yet. The
            orchestrator picks from this list; the prompt shown is the prompt sent.
          </p>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter agents…"
            className="max-w-xs"
          />
        </header>

        {filtered.length === 0 && (
          <p className="rounded-lg border border-border bg-surface/60 p-6 text-center text-sm text-muted-foreground">
            No agent matches “{query}”.
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((agent) => (
            <article key={agent.id} className="rounded-lg border border-border bg-surface/60 p-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">{agent.name}</h2>
                <Badge variant="outline" className="text-[10px]">
                  {agent.group}
                </Badge>
                <Badge variant={STATUS_VARIANT[agent.status]} className="ml-auto text-[10px]">
                  {AGENT_STATUS_LABEL[agent.status]}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{agent.blurb}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                <div>
                  <dt className="text-foreground/70">Prompt version</dt>
                  <dd>v{agent.promptVersion}</dd>
                </div>
                <div>
                  <dt className="text-foreground/70">Mode</dt>
                  <dd>{agent.mode.replace("_", " ")}</dd>
                </div>
                <div>
                  <dt className="text-foreground/70">Surface</dt>
                  <dd>{agent.surface ?? "not built yet"}</dd>
                </div>
                <div>
                  <dt className="text-foreground/70">Temperature</dt>
                  <dd>{agent.temperature}</dd>
                </div>
              </dl>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Tools: {agent.toolIds.length > 0 ? agent.toolIds.join(", ") : "none"}
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] text-primary">
                  System prompt
                </summary>
                <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-background/60 p-2 text-[11px] text-muted-foreground">
                  {agent.systemPrompt}
                </pre>
              </details>
            </article>
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
