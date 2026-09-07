import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmAction } from "@/components/workspace/ConfirmAction";
import { supabase } from "@/integrations/supabase/client";
import { runModel, type RunProvider } from "@/lib/model-client";
import {
  OUTLINE_PROMPT,
  THEMES,
  createPresentation,
  deletePresentation,
  exportPdf,
  exportPptx,
  listPresentations,
  parseOutline,
  savePresentation,
  themeOf,
  type Presentation,
  type Slide,
} from "@/lib/presentations";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Download, FileText, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/presentations")({
  head: () => ({
    meta: [
      { title: "Presentation Studio · Rupesh LLM Studio" },
      {
        name: "description",
        content:
          "Draft decks with your own models, edit every slide, and download a real .pptx or .pdf file from the browser.",
      },
      { property: "og:title", content: "Presentation Studio · Rupesh LLM Studio" },
      {
        property: "og:description",
        content: "Editable slide decks with genuine PowerPoint and PDF export.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PresentationStudio,
});

const EMPTY_SLIDE: Slide = { title: "New slide", bullets: ["First point"], notes: "" };

function PresentationStudio() {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Presentation | null>(null);
  const [topic, setTopic] = useState("");
  const [generating, setGenerating] = useState(false);

  const decks = useQuery({ queryKey: ["presentations"], queryFn: listPresentations });

  const providers = useQuery({
    queryKey: ["presentations", "providers"],
    queryFn: async (): Promise<RunProvider[]> => {
      const { data, error } = await supabase
        .from("providers")
        .select("id, kind, base_url, default_model, has_key")
        .order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as RunProvider[];
    },
  });

  const provider = providers.data?.[0] ?? null;

  useEffect(() => {
    const found = decks.data?.find((d) => d.id === activeId) ?? decks.data?.[0] ?? null;
    if (found && found.id !== draft?.id) {
      setActiveId(found.id);
      setDraft(found);
    }
  }, [decks.data, activeId, draft?.id]);

  const create = useMutation({
    mutationFn: () =>
      createPresentation({
        title: "Untitled deck",
        topic: topic.trim(),
        theme: "midnight",
        slides: [{ ...EMPTY_SLIDE, title: topic.trim() || "Title slide" }],
      }),
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ["presentations"] });
      setActiveId(id);
      setDraft(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      await savePresentation(draft.id, {
        title: draft.title,
        topic: draft.topic,
        theme: draft.theme,
        slides: draft.slides,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["presentations"] });
      toast.success("Deck saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deletePresentation(id),
    onSuccess: async () => {
      setActiveId(null);
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["presentations"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function generate() {
    if (!draft) return;
    if (!provider) {
      toast.error("Add a model provider first — nothing can be drafted without one.");
      return;
    }
    const subject = draft.topic.trim() || draft.title;
    if (!subject) {
      toast.error("Write what the deck is about first.");
      return;
    }
    setGenerating(true);
    try {
      const reply = await runModel({
        provider,
        model: provider.default_model,
        systemPrompt: OUTLINE_PROMPT,
        messages: [{ role: "user", content: `Write a deck about: ${subject}` }],
        temperature: 0.5,
      });
      const slides = parseOutline(reply);
      setDraft({ ...draft, slides });
      toast.success(`Drafted ${slides.length} slides — review and edit before exporting.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Drafting failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function download(kind: "pptx" | "pdf") {
    if (!draft) return;
    try {
      const payload = { title: draft.title, theme: draft.theme, slides: draft.slides };
      if (kind === "pptx") await exportPptx(payload);
      else await exportPdf(payload);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed.");
    }
  }

  function patchSlide(index: number, patch: Partial<Slide>) {
    if (!draft) return;
    const slides = draft.slides.map((slide, i) => (i === index ? { ...slide, ...patch } : slide));
    setDraft({ ...draft, slides });
  }

  return (
    <div className="scroll-slim h-full overflow-y-auto px-4 py-8 md:px-8">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <header>
          <p className="text-xs uppercase tracking-wider text-primary">Studios</p>
          <h1 className="mt-1 font-display text-3xl font-semibold">Presentation Studio</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Draft a deck with a model you configured, edit every slide by hand, then download a real
            PowerPoint or PDF file. Export runs entirely in your browser, so it works even with no
            provider set up — only the drafting step needs a model.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="What is the new deck about?"
            className="max-w-sm"
          />
          <Button onClick={() => create.mutate()} disabled={create.isPending} className="gap-1.5">
            {create.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            New deck
          </Button>
        </div>

        <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
          <aside className="space-y-1">
            {decks.isLoading && <p className="text-xs text-muted-foreground">Loading decks…</p>}
            {decks.data?.length === 0 && (
              <p className="text-xs text-muted-foreground">No decks yet.</p>
            )}
            {decks.data?.map((deck) => (
              <div
                key={deck.id}
                className={cn(
                  "group flex items-center gap-1 rounded-md px-2 py-1.5",
                  deck.id === activeId ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    setActiveId(deck.id);
                    setDraft(deck);
                  }}
                >
                  <span className="block truncate text-xs">{deck.title}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {deck.slides.length} slides
                  </span>
                </button>
                <ConfirmAction
                  title="Delete this deck?"
                  description={`"${deck.title}" and its slides will be permanently removed.`}
                  onConfirm={() => remove.mutate(deck.id)}
                  trigger={
                    <button aria-label={`Delete ${deck.title}`}>
                      <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                    </button>
                  }
                />
              </div>
            ))}
          </aside>

          {draft ? (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  className="max-w-xs"
                  aria-label="Deck title"
                />
                <select
                  value={draft.theme}
                  onChange={(event) => setDraft({ ...draft, theme: event.target.value })}
                  aria-label="Theme"
                  className="h-9 rounded-md border border-border bg-background px-2 text-xs"
                >
                  {Object.keys(THEMES).map((theme) => (
                    <option key={theme} value={theme}>
                      {theme}
                    </option>
                  ))}
                </select>
                <Button
                  variant="secondary"
                  className="gap-1.5"
                  onClick={generate}
                  disabled={generating}
                  title={provider ? undefined : "Add a model provider to draft slides"}
                >
                  {generating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  {provider ? "Draft with AI" : "Drafting needs a provider"}
                </Button>
                <Button onClick={() => save.mutate()} disabled={save.isPending}>
                  Save
                </Button>
                <Button variant="outline" className="gap-1.5" onClick={() => download("pptx")}>
                  <Download className="size-4" /> .pptx
                </Button>
                <Button variant="outline" className="gap-1.5" onClick={() => download("pdf")}>
                  <FileText className="size-4" /> .pdf
                </Button>
              </div>

              <Input
                value={draft.topic}
                onChange={(event) => setDraft({ ...draft, topic: event.target.value })}
                placeholder="Subject / brief for AI drafting"
                aria-label="Deck subject"
              />

              <div className="space-y-3">
                {draft.slides.map((slide, index) => {
                  const theme = themeOf(draft.theme);
                  return (
                    <div key={index} className="rounded-lg border border-border bg-surface/50 p-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ background: `#${theme.accent}` }}
                        />
                        <span className="font-mono text-[11px] text-muted-foreground">
                          Slide {index + 1}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto h-7 px-2 text-[11px]"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              slides: draft.slides.filter((_, i) => i !== index),
                            })
                          }
                        >
                          Remove
                        </Button>
                      </div>
                      <Input
                        value={slide.title}
                        onChange={(event) => patchSlide(index, { title: event.target.value })}
                        className="mt-2"
                        aria-label={`Slide ${index + 1} title`}
                      />
                      <Textarea
                        value={slide.bullets.join("\n")}
                        onChange={(event) =>
                          patchSlide(index, {
                            bullets: event.target.value.split("\n").filter((line) => line.trim()),
                          })
                        }
                        rows={4}
                        className="mt-2 font-mono text-xs"
                        placeholder="One bullet per line"
                        aria-label={`Slide ${index + 1} bullets`}
                      />
                      <Textarea
                        value={slide.notes ?? ""}
                        onChange={(event) => patchSlide(index, { notes: event.target.value })}
                        rows={2}
                        className="mt-2 text-xs"
                        placeholder="Speaker notes (exported into the .pptx)"
                        aria-label={`Slide ${index + 1} notes`}
                      />
                    </div>
                  );
                })}
                <Button
                  variant="secondary"
                  className="gap-1.5"
                  onClick={() => setDraft({ ...draft, slides: [...draft.slides, { ...EMPTY_SLIDE }] })}
                >
                  <Plus className="size-4" /> Add slide
                </Button>
              </div>
            </section>
          ) : (
            <p className="text-sm text-muted-foreground">
              Create a deck to start editing slides.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
