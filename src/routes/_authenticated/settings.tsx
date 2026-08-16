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
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Rupesh LLM Studio" },
      {
        name: "description",
        content:
          "Configure your assistant defaults: system prompt, temperature, token budget and default model provider.",
      },
      { property: "og:title", content: "Settings — Rupesh LLM Studio" },
      {
        property: "og:description",
        content: "Own your assistant's behaviour with configurable defaults.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [state, setState] = useState({
    displayName: "",
    systemPrompt: "",
    temperature: 0.7,
    maxTokens: 2048,
    defaultProviderId: "",
  });

  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("providers")
        .select("id, name")
        .order("created_at");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const [{ data: row }, { data: profile }] = await Promise.all([
        supabase
          .from("user_settings")
          .select("default_provider_id, system_prompt, temperature, max_tokens, onboarded")
          .maybeSingle(),
        supabase.from("profiles").select("display_name").maybeSingle(),
      ]);
      return { row, profile };
    },
  });

  useEffect(() => {
    const row = settings.data?.row;
    if (!row) return;
    setState({
      displayName: settings.data?.profile?.display_name ?? "",
      systemPrompt: row.system_prompt ?? "",
      temperature: Number(row.temperature ?? 0.7),
      maxTokens: row.max_tokens ?? 2048,
      defaultProviderId: row.default_provider_id ?? "",
    });
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Session expired.");
      const { error } = await supabase.from("user_settings").upsert({
        user_id: user.id,
        system_prompt: state.systemPrompt,
        temperature: state.temperature,
        max_tokens: state.maxTokens,
        default_provider_id: state.defaultProviderId || null,
        onboarded: true,
      });
      if (error) throw new Error(error.message);
      const { error: profileError } = await supabase
        .from("profiles")
        .upsert({ id: user.id, display_name: state.displayName });
      if (profileError) throw new Error(profileError.message);
    },
    onSuccess: () => {
      toast.success("Settings saved.");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (settings.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="scroll-slim h-full overflow-y-auto px-4 py-8 md:px-8">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-primary">Configuration</p>
          <h1 className="mt-1 font-display text-3xl font-semibold">Assistant defaults</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            These defaults apply to every new conversation. You can override them per chat under
            Tuning.
          </p>
        </div>

        <section className="glass-panel space-y-5 p-5">
          <div className="space-y-1.5">
            <Label className="text-xs">Display name</Label>
            <Input
              value={state.displayName}
              onChange={(event) => setState((p) => ({ ...p, displayName: event.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Default system prompt</Label>
            <Textarea
              rows={7}
              value={state.systemPrompt}
              onChange={(event) => setState((p) => ({ ...p, systemPrompt: event.target.value }))}
            />
            <p className="text-[11px] text-muted-foreground">
              You control the persona and rules. Content still has to follow applicable laws and the
              policies of whichever model backend you connect.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Default provider</Label>
            <Select
              value={state.defaultProviderId}
              onValueChange={(value) => setState((p) => ({ ...p, defaultProviderId: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick a provider" />
              </SelectTrigger>
              <SelectContent>
                {(providers.data ?? []).map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs">
              <Label>Temperature</Label>
              <span className="font-mono text-primary">{state.temperature.toFixed(2)}</span>
            </div>
            <Slider
              className="mt-2"
              min={0}
              max={2}
              step={0.05}
              value={[state.temperature]}
              onValueChange={([value]) =>
                setState((p) => ({ ...p, temperature: value ?? p.temperature }))
              }
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs">
              <Label>Max tokens</Label>
              <span className="font-mono text-primary">{state.maxTokens}</span>
            </div>
            <Slider
              className="mt-2"
              min={128}
              max={16384}
              step={128}
              value={[state.maxTokens]}
              onValueChange={([value]) =>
                setState((p) => ({ ...p, maxTokens: value ?? p.maxTokens }))
              }
            />
          </div>

          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save settings
          </Button>
        </section>
      </div>
    </div>
  );
}
