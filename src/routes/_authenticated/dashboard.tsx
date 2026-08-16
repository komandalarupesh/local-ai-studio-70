import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { isLocalEndpoint } from "@/lib/local-stream";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Cpu, MessagesSquare, Plug, ServerCog, ShieldCheck, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Rupesh LLM Studio" },
      {
        name: "description",
        content:
          "Your AI studio overview: connected model providers, local endpoints and recent conversations.",
      },
      { property: "og:title", content: "Dashboard — Rupesh LLM Studio" },
      {
        property: "og:description",
        content: "Track your providers, local models and recent assistant conversations.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const stats = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [providers, conversations, messages, settings] = await Promise.all([
        supabase.from("providers").select("id, name, kind, base_url, default_model, has_key"),
        supabase
          .from("conversations")
          .select("id, title, updated_at")
          .order("updated_at", { ascending: false })
          .limit(5),
        supabase.from("messages").select("id", { count: "exact", head: true }),
        supabase.from("user_settings").select("onboarded").maybeSingle(),
      ]);
      return {
        providers: providers.data ?? [],
        conversations: conversations.data ?? [],
        messageCount: messages.count ?? 0,
        onboarded: settings.data?.onboarded ?? false,
      };
    },
  });

  const providers = stats.data?.providers ?? [];
  const localCount = providers.filter(
    (p) => p.kind === "ollama" || isLocalEndpoint(p.base_url),
  ).length;

  return (
    <div className="scroll-slim h-full overflow-y-auto px-4 py-8 md:px-8">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <div>
          <p className="text-xs uppercase tracking-wider text-primary">Control room</p>
          <h1 className="mt-1 font-display text-3xl font-semibold">Your studio</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Rupesh LLM Studio runs your assistant on whichever backend you choose — an
            OpenAI-compatible endpoint, a local Ollama server on your own machine, or the built-in
            hosted model. Behaviour is yours to configure: system prompt, temperature, token budget
            and model, per conversation.
          </p>
        </div>

        {!stats.data?.onboarded && (
          <div className="glass-panel p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-accent" />
              <h2 className="font-display text-base font-semibold">Get set up in three steps</h2>
            </div>
            <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>
                <span className="text-foreground">1. Connect a model.</span> Add a provider and run a
                connection test.
              </li>
              <li>
                <span className="text-foreground">2. Shape the assistant.</span> Write your default
                system prompt in Settings.
              </li>
              <li>
                <span className="text-foreground">3. Start chatting.</span> Open Studio — history is
                saved to your account.
              </li>
            </ol>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/providers">
                  <Plug className="size-4" /> Connect a model
                </Link>
              </Button>
              <Button asChild variant="secondary">
                <Link to="/settings">Assistant defaults</Link>
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard icon={ServerCog} label="Providers" value={String(providers.length)} />
          <StatCard icon={Cpu} label="Local endpoints" value={String(localCount)} />
          <StatCard
            icon={MessagesSquare}
            label="Messages exchanged"
            value={String(stats.data?.messageCount ?? 0)}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="glass-panel p-5">
            <h2 className="font-display text-base font-semibold">Recent conversations</h2>
            <div className="mt-3 space-y-2">
              {(stats.data?.conversations ?? []).map((conversation) => (
                <Link
                  key={conversation.id}
                  to="/studio/$conversationId"
                  params={{ conversationId: conversation.id }}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted"
                >
                  <span className="truncate">{conversation.title}</span>
                  <span className="ml-3 shrink-0 text-[11px] text-muted-foreground">
                    {new Date(conversation.updated_at).toLocaleDateString()}
                  </span>
                </Link>
              ))}
              {stats.data?.conversations.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nothing yet — <Link to="/studio" className="text-primary underline">open Studio</Link>.
                </p>
              )}
            </div>
          </section>

          <section className="glass-panel p-5">
            <h2 className="font-display text-base font-semibold">Open-source & local support</h2>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <Cpu className="mt-0.5 size-4 shrink-0 text-primary" />
                Ollama on <span className="font-mono text-foreground">localhost:11434</span> — Llama,
                Mistral, Qwen, Gemma and anything else you have pulled.
              </li>
              <li className="flex gap-2">
                <ServerCog className="mt-0.5 size-4 shrink-0 text-primary" />
                Any OpenAI-compatible server: LM Studio, vLLM, llama.cpp, text-generation-webui.
              </li>
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                Keys are stored server-side only; local endpoints are called straight from your
                browser so your machine never has to be exposed to the internet.
              </li>
            </ul>
            <Button asChild variant="secondary" className="mt-4">
              <Link to="/providers">Manage providers</Link>
            </Button>
          </section>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
}) {
  return (
    <div className="glass-panel p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5 text-primary" /> {label}
      </div>
      <p className="mt-2 font-display text-2xl font-semibold">{value}</p>
    </div>
  );
}
