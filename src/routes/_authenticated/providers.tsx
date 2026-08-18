import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { isLocalEndpoint, listLocalModels } from "@/lib/local-stream";
import {
  createBuiltInProvider,
  providerPresets,
  saveProviderKey,
  testProviderConnection,
} from "@/lib/studio.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Cloud, Cpu, Loader2, Plug, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/providers")({
  head: () => ({
    meta: [
      { title: "Model providers — Rupesh LLM Studio" },
      {
        name: "description",
        content:
          "Connect OpenAI-compatible endpoints and local Ollama servers, test connections and manage keys securely.",
      },
      { property: "og:title", content: "Model providers — Rupesh LLM Studio" },
      {
        property: "og:description",
        content: "Add, test and manage the model backends powering your assistant.",
      },
    ],
  }),
  component: ProvidersPage,
});

type ProviderRow = {
  id: string;
  name: string;
  kind: "openai" | "ollama" | "lovable";
  base_url: string;
  default_model: string;
  has_key: boolean;
};

function ProvidersPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "Local Ollama",
    kind: "ollama" as "openai" | "ollama",
    baseUrl: "http://localhost:11434",
    model: "llama3.1",
    apiKey: "",
  });
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [testing, setTesting] = useState<string | null>(null);

  const presets = useQuery({ queryKey: ["presets"], queryFn: () => providerPresets() });

  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: async (): Promise<ProviderRow[]> => {
      const { data, error } = await supabase
        .from("providers")
        .select("id, name, kind, base_url, default_model, has_key")
        .order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as ProviderRow[];
    },
  });

  const addProvider = useMutation({
    mutationFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      const userId = user.user?.id;
      if (!userId) throw new Error("Session expired.");
      if (!form.name.trim()) throw new Error("Give the provider a name.");
      if (!form.baseUrl.trim()) throw new Error("An endpoint URL is required.");

      const { data, error } = await supabase
        .from("providers")
        .insert({
          user_id: userId,
          name: form.name.trim(),
          kind: form.kind,
          base_url: form.baseUrl.trim(),
          default_model: form.model.trim(),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      if (form.apiKey.trim()) {
        await saveProviderKey({ data: { providerId: data.id, apiKey: form.apiKey.trim() } });
      }
      return data.id;
    },
    onSuccess: () => {
      toast.success("Provider added.");
      setForm((prev) => ({ ...prev, apiKey: "" }));
      queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const addBuiltIn = useMutation({
    mutationFn: () => createBuiltInProvider(),
    onSuccess: () => {
      toast.success("Built-in hosted model enabled.");
      queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeProvider = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("providers").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Provider removed.");
      queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function runTest(provider: ProviderRow) {
    setTesting(provider.id);
    try {
      if (provider.kind !== "lovable" && isLocalEndpoint(provider.base_url) && !provider.has_key) {
        const models = await listLocalModels(provider.kind, provider.base_url);
        setResults((prev) => ({
          ...prev,
          [provider.id]: {
            ok: true,
            message: `Reached from your browser. ${models.length} model(s): ${models.slice(0, 4).join(", ") || "none listed"}`,
          },
        }));
      } else {
        const result = await testProviderConnection({ data: { providerId: provider.id } });
        setResults((prev) => ({
          ...prev,
          [provider.id]: { ok: result.ok, message: result.message },
        }));
      }
    } catch (error) {
      setResults((prev) => ({
        ...prev,
        [provider.id]: {
          ok: false,
          message: error instanceof Error ? error.message : "Connection failed.",
        },
      }));
    } finally {
      setTesting(null);
    }
  }

  return (
    <div className="scroll-slim h-full overflow-y-auto px-4 py-8 md:px-8">
      <div className="mx-auto w-full max-w-4xl space-y-8">
        <div>
          <p className="text-xs uppercase tracking-wider text-primary">Backends</p>
          <h1 className="mt-1 font-display text-3xl font-semibold">Model providers</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            The model backend is replaceable. Point the studio at any OpenAI-compatible server or a
            local Ollama install. API keys are written straight to server-side storage and are never
            returned to the browser.
          </p>
        </div>

        <section className="glass-panel p-5">
          <h2 className="font-display text-base font-semibold">Add a provider</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {(presets.data?.presets ?? []).map((preset) => (
              <Button
                key={preset.label}
                size="sm"
                variant="secondary"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    name: preset.label,
                    kind: preset.kind,
                    baseUrl: preset.baseUrl,
                    model: preset.model,
                  }))
                }
              >
                {preset.label}
              </Button>
            ))}
            <Button size="sm" variant="secondary" onClick={() => addBuiltIn.mutate()}>
              <Cloud className="size-3.5" /> Enable built-in hosted model
            </Button>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                value={form.name}
                onChange={(event) => setForm((p) => ({ ...p, name: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">API style</Label>
              <Select
                value={form.kind}
                onValueChange={(value) =>
                  setForm((p) => ({ ...p, kind: value as "openai" | "ollama" }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ollama">Ollama (/api/chat)</SelectItem>
                  <SelectItem value="openai">OpenAI-compatible (/chat/completions)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Endpoint URL</Label>
              <Input
                value={form.baseUrl}
                placeholder="http://localhost:11434"
                onChange={(event) => setForm((p) => ({ ...p, baseUrl: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Default model</Label>
              <Input
                value={form.model}
                placeholder="llama3.1"
                onChange={(event) => setForm((p) => ({ ...p, model: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">API key (optional — remote endpoints only)</Label>
              <Input
                type="password"
                value={form.apiKey}
                placeholder="Leave empty for local servers"
                onChange={(event) => setForm((p) => ({ ...p, apiKey: event.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground">
                Stored server-side. It is never sent back to the browser or embedded in the app.
              </p>
            </div>
          </div>

          <Button
            className="mt-5"
            onClick={() => addProvider.mutate()}
            disabled={addProvider.isPending}
          >
            {addProvider.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plug className="size-4" />
            )}
            Add provider
          </Button>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-base font-semibold">Connected</h2>
          {providers.isLoading && <Loader2 className="size-4 animate-spin text-primary" />}
          {(providers.data ?? []).map((provider) => {
            const result = results[provider.id];
            const local = provider.kind !== "lovable" && isLocalEndpoint(provider.base_url);
            return (
              <div key={provider.id} className="glass-panel p-4">
                <div className="flex flex-wrap items-center gap-3">
                  {provider.kind === "lovable" ? (
                    <Cloud className="size-4 text-primary" />
                  ) : (
                    <Cpu className="size-4 text-accent" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{provider.name}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {provider.kind === "lovable"
                        ? "hosted gateway"
                        : `${provider.base_url} · ${provider.kind}`}
                      {provider.default_model ? ` · ${provider.default_model}` : ""}
                      {local ? " · browser-direct" : ""}
                      {provider.has_key ? " · key stored" : ""}
                    </p>
                  </div>
                  <div className="ml-auto flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => runTest(provider)}
                      disabled={testing === provider.id}
                    >
                      {testing === provider.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : null}
                      Test connection
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeProvider.mutate(provider.id)}
                      aria-label={`Delete ${provider.name}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                {result && (
                  <div
                    className={`mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
                      result.ok
                        ? "border-success/40 bg-success/10"
                        : "border-destructive/40 bg-destructive/10"
                    }`}
                  >
                    {result.ok ? (
                      <CheckCircle2 className="mt-0.5 size-3.5 text-success" />
                    ) : (
                      <XCircle className="mt-0.5 size-3.5 text-destructive" />
                    )}
                    <span>{result.message}</span>
                  </div>
                )}
              </div>
            );
          })}
          {providers.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No providers yet. Add one above, or enable the built-in hosted model to try things
              out.
            </p>
          )}
        </section>

        <section className="glass-panel p-5 text-sm text-muted-foreground">
          <h2 className="font-display text-base font-semibold text-foreground">
            Running a local model
          </h2>
          <ol className="mt-3 space-y-1.5">
            <li>
              1. Install Ollama and pull a model:{" "}
              <span className="font-mono text-foreground">ollama pull llama3.1</span>
            </li>
            <li>
              2. Allow this app's origin:{" "}
              <span className="font-mono text-foreground">OLLAMA_ORIGINS=* ollama serve</span>
            </li>
            <li>
              3. Add the provider above with{" "}
              <span className="font-mono text-foreground">http://localhost:11434</span> and test it.
            </li>
          </ol>
        </section>
      </div>
    </div>
  );
}
