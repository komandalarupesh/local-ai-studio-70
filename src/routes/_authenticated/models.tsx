import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { isLocalEndpoint, listLocalModels } from "@/lib/local-stream";
import {
  CAPABILITY_LABEL,
  buildCandidates,
  type Capability,
  type CapabilityState,
  type RoutableModel,
  type RoutableProvider,
} from "@/lib/orchestrator";
import { testProviderConnection } from "@/lib/studio.functions";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Cpu, Loader2, Plug, RefreshCw, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/models")({
  head: () => ({
    meta: [
      { title: "Model Center — Rupesh LLM Studio" },
      {
        name: "description",
        content:
          "Discover the models your configured providers actually serve, with inferred capabilities and known context windows.",
      },
      { property: "og:title", content: "Model Center — Rupesh LLM Studio" },
      {
        property: "og:description",
        content: "Only models your own endpoints report are listed here.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ModelsPage,
});

const CAPS: Capability[] = ["text", "vision", "tools", "json", "reasoning", "embedding"];

const STATE_CLASS: Record<CapabilityState, string> = {
  supported: "border-primary/50 text-primary",
  unknown: "border-border text-muted-foreground",
  unsupported: "border-destructive/50 text-destructive",
};

const STATE_LABEL: Record<CapabilityState, string> = {
  supported: "likely",
  unknown: "unverified",
  unsupported: "no",
};

function ModelsPage() {
  const [discovered, setDiscovered] = useState<Record<string, string[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: async (): Promise<RoutableProvider[]> => {
      const { data, error } = await supabase
        .from("providers")
        .select("id, name, kind, base_url, default_model, has_key")
        .order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as RoutableProvider[];
    },
  });

  const rows = providers.data ?? [];

  const candidates = useMemo(() => buildCandidates(rows, discovered), [rows, discovered]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) => c.model.toLowerCase().includes(q) || c.providerName.toLowerCase().includes(q),
    );
  }, [candidates, query]);

  async function discover(provider: RoutableProvider) {
    setBusy(provider.id);
    setErrors((prev) => ({ ...prev, [provider.id]: "" }));
    try {
      let models: string[] = [];
      if (provider.kind !== "lovable" && isLocalEndpoint(provider.base_url) && !provider.has_key) {
        models = await listLocalModels(provider.kind, provider.base_url);
      } else {
        const result = await testProviderConnection({ data: { providerId: provider.id } });
        if (!result.ok) throw new Error(result.message);
        models = result.models;
      }
      setDiscovered((prev) => ({ ...prev, [provider.id]: models }));
      if (models.length === 0) {
        setErrors((prev) => ({
          ...prev,
          [provider.id]: "The endpoint responded but listed no models.",
        }));
      } else {
        toast.success(`${provider.name}: ${models.length} model(s) found.`);
      }
    } catch (error) {
      setErrors((prev) => ({
        ...prev,
        [provider.id]: error instanceof Error ? error.message : "Discovery failed.",
      }));
    } finally {
      setBusy(null);
    }
  }

  async function discoverAll() {
    for (const provider of rows) await discover(provider);
  }

  return (
    <div className="scroll-slim h-full overflow-y-auto px-4 py-8 md:px-8">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <header>
          <p className="text-xs uppercase tracking-wider text-primary">Routing</p>
          <h1 className="mt-1 font-display text-3xl font-semibold">Model Center</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Only models your own providers report are listed. Capabilities are inferred from the
            model id because OpenAI-compatible and Ollama endpoints do not publish them — anything
            unproven is marked “unverified”, never as supported. Remote keys stay server-side; local
            endpoints are queried straight from your browser.
          </p>
        </header>

        {providers.isLoading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading providers…
          </p>
        )}

        {providers.isError && (
          <p className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            Could not load your providers: {(providers.error as Error).message}
          </p>
        )}

        {!providers.isLoading && rows.length === 0 && (
          <div className="rounded-lg border border-border bg-surface/60 p-6 text-center">
            <Plug className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              No provider is configured, so there are no models to show.
            </p>
            <Button asChild size="sm" className="mt-3">
              <Link to="/providers">Add a provider</Link>
            </Button>
          </div>
        )}

        {rows.length > 0 && (
          <>
            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-base font-semibold">Your providers</h2>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={discoverAll}
                  disabled={busy !== null}
                >
                  <RefreshCw className="size-3.5" /> Refresh all
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {rows.map((provider) => {
                  const found = discovered[provider.id];
                  return (
                    <article
                      key={provider.id}
                      className="rounded-lg border border-border bg-surface/60 p-4"
                    >
                      <div className="flex items-center gap-2">
                        <Cpu className="size-4 text-primary" />
                        <h3 className="text-sm font-semibold">{provider.name}</h3>
                        <Badge variant="outline" className="ml-auto text-[10px]">
                          {provider.kind}
                        </Badge>
                      </div>
                      <p className="mt-2 break-all text-[11px] text-muted-foreground">
                        {provider.base_url || "hosted by Lovable Cloud"}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        {provider.has_key ? (
                          <>
                            <ShieldCheck className="size-3" /> Key stored server-side
                          </>
                        ) : (
                          "No key — treated as an open/local endpoint"
                        )}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Default model: {provider.default_model || "none set"}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {found
                          ? `${found.length} model(s) discovered from the endpoint.`
                          : "Not queried yet — the list below falls back to the default model only."}
                      </p>
                      {errors[provider.id] && (
                        <p className="mt-2 text-[11px] text-destructive">{errors[provider.id]}</p>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        className="mt-3"
                        onClick={() => discover(provider)}
                        disabled={busy === provider.id}
                      >
                        {busy === provider.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="size-3.5" />
                        )}
                        Discover models
                      </Button>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-base font-semibold">
                  Models ({filtered.length})
                </h2>
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter models…"
                  className="ml-auto max-w-[14rem] text-xs"
                />
              </div>
              {filtered.length === 0 ? (
                <p className="rounded-lg border border-border bg-surface/60 p-6 text-center text-sm text-muted-foreground">
                  No model matches. Run “Discover models” on a provider, or clear the filter.
                </p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {filtered.map((candidate) => (
                    <ModelCard
                      key={`${candidate.providerId}:${candidate.model}`}
                      candidate={candidate}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function ModelCard({ candidate }: { candidate: RoutableModel }) {
  return (
    <article className="rounded-lg border border-border bg-surface/60 p-4">
      <div className="flex items-start gap-2">
        <h3 className="break-all text-sm font-semibold">{candidate.model}</h3>
        {candidate.local && (
          <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
            local
          </Badge>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {candidate.providerName} · {candidate.providerKind}
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Context: {candidate.context.tokens.toLocaleString()} tokens
        {candidate.context.known ? "" : " (conservative fallback)"} — {candidate.context.source}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {CAPS.map((capability) => {
          const state = candidate.capabilities.states[capability];
          return (
            <Badge
              key={capability}
              variant="outline"
              className={`text-[10px] ${STATE_CLASS[state]}`}
              title={`${CAPABILITY_LABEL[capability]}: ${STATE_LABEL[state]}`}
            >
              {CAPABILITY_LABEL[capability]}: {STATE_LABEL[state]}
            </Badge>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">{candidate.capabilities.source}</p>
    </article>
  );
}
