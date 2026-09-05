import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  TOOLS,
  extractDocumentText,
  fetchUrlText,
  getTool,
  type ToolDef,
  type ToolResult,
} from "@/lib/orchestrator";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Loader2, Lock, Play, Wrench, XCircle } from "lucide-react";
import { useMemo, useRef, useState } from "react";

export const Route = createFileRoute("/_authenticated/tools")({
  head: () => ({
    meta: [
      { title: "Tools Center — Rupesh LLM Studio" },
      {
        name: "description",
        content:
          "Every tool the studio can really run, what it does, and exactly what is missing for the ones that need configuration.",
      },
      { property: "og:title", content: "Tools Center — Rupesh LLM Studio" },
      {
        property: "og:description",
        content: "Run the calculator, JavaScript sandbox, document reader and web fetch for real.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ToolsPage,
});

const GROUPS = ["Computation", "Code", "Files", "Web", "Multimodal"] as const;

function ToolsPage() {
  const ready = useMemo(() => TOOLS.filter((t) => t.status === "ready"), []);
  const blocked = useMemo(() => TOOLS.filter((t) => t.status !== "ready"), []);
  const [activeId, setActiveId] = useState<string>(ready[0]?.id ?? "");
  const active = getTool(activeId);

  return (
    <div className="scroll-slim h-full overflow-y-auto px-4 py-8 md:px-8">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <header>
          <p className="text-xs uppercase tracking-wider text-primary">Capabilities</p>
          <h1 className="mt-1 font-display text-3xl font-semibold">Tools Center</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {ready.length} of {TOOLS.length} tools execute today — you can run each one below and
            see its real output. The other {blocked.length} are listed with the exact prerequisite
            that is missing. Nothing here reports success it did not achieve.
          </p>
        </header>

        {GROUPS.map((group) => {
          const items = TOOLS.filter((t) => t.group === group);
          if (items.length === 0) return null;
          return (
            <section key={group} className="space-y-3">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {group}
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {items.map((tool) => (
                  <article
                    key={tool.id}
                    className={
                      "rounded-lg border bg-surface/60 p-4 " +
                      (tool.id === activeId ? "border-primary/60" : "border-border")
                    }
                  >
                    <div className="flex items-start gap-2">
                      <h3 className="text-sm font-semibold">{tool.name}</h3>
                      {tool.status === "ready" ? (
                        <Badge className="ml-auto shrink-0 text-[10px]">Ready</Badge>
                      ) : (
                        <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">
                          <Lock className="mr-1 size-2.5" /> Needs configuration
                        </Badge>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{tool.blurb}</p>
                    {tool.requirement && (
                      <p className="mt-2 rounded-md border border-border/60 bg-background/50 p-2 text-[11px] text-muted-foreground">
                        <span className="text-foreground/80">Missing: </span>
                        {tool.requirement}
                      </p>
                    )}
                    {tool.status === "ready" && (
                      <Button
                        size="sm"
                        variant={tool.id === activeId ? "default" : "outline"}
                        className="mt-3"
                        onClick={() => setActiveId(tool.id)}
                      >
                        <Wrench className="size-3.5" /> Open runner
                      </Button>
                    )}
                  </article>
                ))}
              </div>
            </section>
          );
        })}

        {active?.status === "ready" && <ToolRunner tool={active} />}
      </div>
    </div>
  );
}

function ToolRunner({ tool }: { tool: ToolDef }) {
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      if (tool.id === "document_text") {
        const file = fileRef.current?.files?.[0];
        if (!file) {
          setResult({ ok: false, output: "", detail: "Choose a file first." });
          return;
        }
        setResult(await extractDocumentText(file));
        return;
      }
      if (tool.id === "web_fetch") {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          setResult({ ok: false, output: "", detail: "Your session expired. Sign in again." });
          return;
        }
        setResult(await fetchUrlText(input.trim(), token));
        return;
      }
      if (tool.run) {
        setResult(await tool.run(input));
        return;
      }
      setResult({ ok: false, output: "", detail: "This tool has no runner wired." });
    } catch (error) {
      setResult({
        ok: false,
        output: "",
        detail: error instanceof Error ? error.message : "The tool failed.",
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="glass-panel space-y-3 p-5">
      <div className="flex items-center gap-2">
        <h2 className="font-display text-base font-semibold">Run: {tool.name}</h2>
        <Badge variant="outline" className="text-[10px]">
          real execution
        </Badge>
      </div>

      {tool.id === "document_text" ? (
        <Input ref={fileRef} type="file" className="text-xs" />
      ) : tool.id === "web_fetch" ? (
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="https://example.com/article"
          className="text-xs"
        />
      ) : (
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          rows={tool.id === "js_sandbox" ? 8 : 3}
          placeholder={
            tool.id === "calculator"
              ? "e.g. (2^10 - 24) / sqrt(16) + log(1000)"
              : "return [1,2,3].reduce((a, b) => a + b, 0);"
          }
          className="font-mono text-xs"
        />
      )}

      <Button size="sm" onClick={run} disabled={running}>
        {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
        Run
      </Button>

      {result && (
        <div className="space-y-2 rounded-md border border-border bg-background/60 p-3">
          <p
            className={
              "flex items-center gap-1.5 text-xs " +
              (result.ok ? "text-primary" : "text-destructive")
            }
          >
            {result.ok ? (
              <CheckCircle2 className="size-3.5" />
            ) : (
              <XCircle className="size-3.5" />
            )}
            {result.ok ? "Executed" : "Failed"}
            {result.detail && (
              <span className="text-muted-foreground">— {result.detail}</span>
            )}
          </p>
          {result.output && (
            <pre className="scroll-slim max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
              {result.output}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
