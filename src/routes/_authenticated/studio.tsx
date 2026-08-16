import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { MessageSquarePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/studio")({
  component: StudioLayout,
});

type ConversationSummary = { id: string; title: string; updated_at: string; model: string };

function StudioLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams({ strict: false }) as { conversationId?: string };

  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: async (): Promise<ConversationSummary[]> => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, title, updated_at, model")
        .order("updated_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as ConversationSummary[];
    },
  });

  const createChat = useMutation({
    mutationFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      const userId = user.user?.id;
      if (!userId) throw new Error("Session expired.");
      const [{ data: settings }, { data: providers }] = await Promise.all([
        supabase
          .from("user_settings")
          .select("default_provider_id, system_prompt, temperature, max_tokens")
          .maybeSingle(),
        supabase.from("providers").select("id, default_model").order("created_at").limit(1),
      ]);
      const provider = providers?.[0];
      const { data, error } = await supabase
        .from("conversations")
        .insert({
          user_id: userId,
          title: "New chat",
          provider_id: settings?.default_provider_id ?? provider?.id ?? null,
          model: provider?.default_model ?? "",
          system_prompt: settings?.system_prompt ?? "",
          temperature: settings?.temperature ?? 0.7,
          max_tokens: settings?.max_tokens ?? 2048,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id as string;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      navigate({ to: "/studio/$conversationId", params: { conversationId: id } });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeChat = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("conversations").delete().eq("id", id);
      if (error) throw new Error(error.message);
      return id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (params.conversationId === id) navigate({ to: "/studio" });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        <div className="p-3">
          <Button className="w-full" onClick={() => createChat.mutate()} disabled={createChat.isPending}>
            <MessageSquarePlus className="size-4" /> New chat
          </Button>
        </div>
        <div className="scroll-slim min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          <p className="px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            History
          </p>
          {(conversations.data ?? []).map((conversation) => (
            <div
              key={conversation.id}
              className={cn(
                "group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-sidebar-accent",
                params.conversationId === conversation.id && "bg-sidebar-accent",
              )}
            >
              <Link
                to="/studio/$conversationId"
                params={{ conversationId: conversation.id }}
                className="min-w-0 flex-1 truncate"
              >
                {conversation.title}
              </Link>
              <button
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => removeChat.mutate(conversation.id)}
                aria-label={`Delete ${conversation.title}`}
              >
                <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          ))}
          {conversations.data?.length === 0 && (
            <p className="px-2 text-xs text-muted-foreground">No conversations yet.</p>
          )}
        </div>
      </aside>
      <main className="min-h-0 min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
