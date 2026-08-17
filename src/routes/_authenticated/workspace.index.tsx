import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { MODE_LIST, type WorkspaceMode } from "@/lib/workspace-modes";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Brain, Code2, Globe, Loader2, PenLine, Rocket, Sparkle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/workspace/")({
  component: NewProjectPage,
  head: () => ({
    meta: [
      { title: "AI Development Workspace · Rupesh LLM Studio" },
      {
        name: "description",
        content:
          "Create a project and build it with your own local or OpenAI-compatible models: planner, file explorer, editor, checks and live preview.",
      },
      { property: "og:title", content: "AI Development Workspace · Rupesh LLM Studio" },
      {
        property: "og:description",
        content: "Plan, generate, check and preview projects with your own models.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const MODE_ICONS: Record<WorkspaceMode, typeof Brain> = {
  reasoning: Brain,
  creative: PenLine,
  coding: Code2,
  app_builder: Rocket,
  website_builder: Globe,
};

const STARTER_FILES: Partial<Record<WorkspaceMode, { path: string; content: string }[]>> = {
  website_builder: [
    {
      path: "index.html",
      content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>New site</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main>
      <h1>New site</h1>
      <p>Ask the agent to build this page.</p>
    </main>
    <script src="./script.js"></script>
  </body>
</html>
`,
    },
    {
      path: "styles.css",
      content: `:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; display: grid; place-items: center; min-height: 100vh; }
`,
    },
    { path: "script.js", content: `console.log("ready");\n` },
  ],
};

function NewProjectPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<WorkspaceMode>("app_builder");

  const create = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Your session expired. Sign in again.");

      const { data, error } = await supabase
        .from("projects")
        .insert({
          user_id: userId,
          name: name.trim() || "Untitled project",
          description: description.trim(),
          mode,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      const starters = STARTER_FILES[mode];
      if (starters?.length) {
        await supabase.from("project_files").insert(
          starters.map((file) => ({
            project_id: data.id,
            user_id: userId,
            path: file.path,
            content: file.content,
            language: file.path.endsWith(".html")
              ? "html"
              : file.path.endsWith(".css")
                ? "css"
                : "javascript",
          })),
        );
      }
      return data.id as string;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate({ to: "/workspace/$projectId", params: { projectId: id } });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="scroll-slim h-full overflow-y-auto px-5 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkle className="size-3.5 text-primary" /> AI Development Workspace
        </div>
        <h1 className="mt-2 font-display text-2xl font-semibold">Start a project</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Pick a mode, name the project, and the workspace gives you a step planner, file explorer,
          editor, check loop and live preview — all driven by the model provider you configured.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODE_LIST.map((config) => {
            const Icon = MODE_ICONS[config.id];
            const active = mode === config.id;
            return (
              <button
                key={config.id}
                onClick={() => setMode(config.id)}
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors",
                  active
                    ? "border-primary/60 bg-primary/10"
                    : "border-border bg-surface/50 hover:border-primary/30",
                )}
              >
                <Icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} />
                <p className="mt-2 text-sm font-medium">{config.label}</p>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                  {config.blurb}
                </p>
                <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {config.buildsFiles ? "Writes files" : "Chat only"}
                  {config.webPreview ? " · Live preview" : ""}
                </p>
              </button>
            );
          })}
        </div>

        <div className="mt-6 space-y-4 rounded-xl border border-border bg-surface/50 p-5">
          <div>
            <Label htmlFor="project-name" className="text-xs">
              Project name
            </Label>
            <Input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Invoice tracker"
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="project-goal" className="text-xs">
              What are you building? (optional)
            </Label>
            <Textarea
              id="project-goal"
              value={description}
              rows={3}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="A single-page tool that tracks invoices in localStorage with filters and CSV export."
              className="mt-1.5 text-sm"
            />
          </div>
          <Button
            className="gap-1.5"
            disabled={create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Rocket className="size-4" />
            )}
            Create project
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Context length, output tokens and speed are set by the provider and model you select —
            the workspace adds no extra caps and summarizes long threads automatically instead.
          </p>
        </div>
      </div>
    </div>
  );
}
