import { Button } from "@/components/ui/button";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Cpu,
  FileText,
  Gauge,
  Github,
  MessagesSquare,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Rupesh LLM Studio — Your own AI assistant on local models" },
      {
        name: "description",
        content:
          "Build and run a personal AI assistant on open-source and local language models. OpenAI-compatible and Ollama endpoints, your prompts, your parameters, your data.",
      },
      { property: "og:title", content: "Rupesh LLM Studio — Your own AI assistant" },
      {
        property: "og:description",
        content:
          "A premium chat studio for open-source and local LLMs: model management, prompt editing, streaming answers and saved history.",
      },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: Cpu,
    title: "Local & open-source first",
    body: "Run Llama, Mistral, Qwen or Gemma from Ollama, LM Studio, vLLM or llama.cpp on your own hardware — no data leaves your machine.",
  },
  {
    icon: ServerCog,
    title: "Replaceable backend",
    body: "Point the studio at any OpenAI-compatible endpoint, or use the built-in hosted model while you set up locally.",
  },
  {
    icon: Gauge,
    title: "Full parameter control",
    body: "System prompt editor, temperature and token budget per conversation. Behaviour is configurable — you decide the persona.",
  },
  {
    icon: MessagesSquare,
    title: "Streaming chat with history",
    body: "Token-by-token answers, markdown and code rendering, copy and regenerate, and every thread saved to your account.",
  },
  {
    icon: FileText,
    title: "File context",
    body: "Attach text, markdown, CSV or source files and the studio feeds them into the conversation as context.",
  },
  {
    icon: ShieldCheck,
    title: "Secrets stay server-side",
    body: "Provider keys are written to server-only storage, never returned to the browser and never hard-coded.",
  },
];

function Landing() {
  return (
    <main className="bg-hero min-h-screen">
      <header className="mx-auto flex w-full max-w-6xl items-center gap-3 px-5 py-5">
        <span className="size-2.5 rounded-full bg-primary shadow-glow" />
        <span className="font-display text-sm font-semibold">Rupesh LLM Studio</span>
        <div className="ml-auto flex gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link to="/auth">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/auth">Open the studio</Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-5 pb-16 pt-10 md:pt-20">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Sparkles className="size-3 text-accent" /> Open-source & local model studio
        </div>
        <h1 className="mt-5 max-w-3xl font-display text-4xl leading-tight font-semibold md:text-6xl">
          Your assistant. <span className="text-gradient">Your models.</span> Your rules.
        </h1>
        <p className="mt-5 max-w-2xl text-base text-muted-foreground md:text-lg">
          Rupesh LLM Studio is a premium chat workspace for language models you control — running
          locally through Ollama or on any OpenAI-compatible server. Configure the system prompt,
          sampling and token budget, keep your history in your own database, and swap the backend
          whenever you like.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/auth">Start building</Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link to="/auth">
              <Terminal className="size-4" /> Connect a local model
            </Link>
          </Button>
        </div>
        <p className="mt-4 max-w-2xl text-xs text-muted-foreground">
          "Without limitations" here means configurable, user-owned behaviour — model, prompt and
          parameters are all yours. It does not mean bypassing safety systems, provider terms or the
          law.
        </p>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 pb-20">
        <div className="grid gap-4 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="glass-panel p-5">
              <feature.icon className="size-5 text-primary" />
              <h2 className="mt-3 font-display text-base font-semibold">{feature.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 pb-24">
        <div className="glass-panel grid gap-6 p-6 md:grid-cols-2 md:p-8">
          <div>
            <h2 className="font-display text-2xl font-semibold">Three minutes to your own stack</h2>
            <ol className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li>
                <span className="text-foreground">1.</span> Create an account — history and providers
                are private to you.
              </li>
              <li>
                <span className="text-foreground">2.</span> Add a provider: local Ollama, an
                OpenAI-compatible URL, or the built-in hosted model.
              </li>
              <li>
                <span className="text-foreground">3.</span> Run the connection test and start
                chatting with streaming answers.
              </li>
            </ol>
            <Button asChild className="mt-6">
              <Link to="/auth">Create your studio</Link>
            </Button>
          </div>
          <div className="rounded-xl border border-border bg-background/60 p-4 font-mono text-xs text-muted-foreground">
            <p className="text-primary"># run an open-source model locally</p>
            <p className="mt-2">ollama pull llama3.1</p>
            <p>OLLAMA_ORIGINS=* ollama serve</p>
            <p className="mt-3 text-primary"># then in the studio</p>
            <p>Providers → Ollama (local) → http://localhost:11434</p>
            <p>Test connection → ✓ models listed</p>
          </div>
        </div>
      </section>

      <footer className="border-t border-border px-5 py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <Github className="size-3.5" /> Built for open-source models · Rupesh LLM Studio
          <Link to="/auth" className="ml-auto text-primary underline">
            Sign in
          </Link>
        </div>
      </footer>
    </main>
  );
}
