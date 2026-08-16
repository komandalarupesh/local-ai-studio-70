import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, MessageSquarePlus, Plug } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/studio/")({
  component: StudioIndex,
});

function StudioIndex() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const started = useRef(false);
  const [creating, setCreating] = useState(false);

  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("providers")
        .select("id, name, default_model")
        .order("created_at");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  useEffect(() => {
    if (providers.isLoading || started.current) return;
    if ((providers.data ?? []).length === 0) return;
    started.current = true;
    void createConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers.isLoading, providers.data]);

  async function createConversation() {
    setCreating(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      const userId = user.user?.id;
      if (!userId) throw new Error("Session expired.");
      const { data: settings } = await supabase
        .from("user_settings")
        .select("default_provider_id, system_prompt, temperature, max_tokens")
        .maybeSingle();
      const provider =
        (providers.data ?? []).find((p) => p.id === settings?.default_provider_id) ??
        (providers.data ?? [])[0];
      const { data, error } = await supabase
        .from("conversations")
        .insert({
          user_id: userId,
          title: "New chat",
          provider_id: provider?.id ?? null,
          model: provider?.default_model ?? "",
          system_prompt: settings?.system_prompt ?? "",
          temperature: settings?.temperature ?? 0.7,
          max_tokens: settings?.max_tokens ?? 2048,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      navigate({ to: "/studio/$conversationId", params: { conversationId: data.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start a chat.");
    } finally {
      setCreating(false);
    }
  }

  if (providers.isLoading || creating) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  if ((providers.data ?? []).length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="glass-panel max-w-md p-6 text-center">
          <Plug className="mx-auto size-6 text-primary" />
          <h1 className="mt-3 font-display text-lg font-semibold">Connect a model first</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Add an OpenAI-compatible endpoint, a local Ollama server, or enable the built-in model to
            start chatting.
          </p>
          <Button asChild className="mt-4">
            <Link to="/providers">Set up providers</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center">
      <Button onClick={createConversation}>
        <MessageSquarePlus className="size-4" /> Start a new chat
      </Button>
    </div>
  );
}
