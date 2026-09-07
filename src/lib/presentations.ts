import { supabase } from "@/integrations/supabase/client";

export type Slide = {
  title: string;
  bullets: string[];
  notes?: string;
};

export type Presentation = {
  id: string;
  title: string;
  topic: string;
  theme: string;
  slides: Slide[];
  updated_at: string;
};

export const THEMES = {
  midnight: { bg: "1B1B2F", fg: "F5F6FA", accent: "6C8CFF" },
  paper: { bg: "FFFFFF", fg: "111827", accent: "2563EB" },
  ember: { bg: "1A1110", fg: "FFF4EC", accent: "FF7A45" },
  forest: { bg: "0F1A14", fg: "EAF7EF", accent: "35C08A" },
} as const;

export type ThemeId = keyof typeof THEMES;

export function themeOf(id: string) {
  return THEMES[(id as ThemeId) in THEMES ? (id as ThemeId) : "midnight"];
}

/** Tolerant slide parsing — a stored value from any source is normalised, never trusted blindly. */
export function normalizeSlides(value: unknown): Slide[] {
  if (!Array.isArray(value)) return [];
  const out: Slide[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const title = typeof rec['title'] === "string" ? rec['title'] : "";
    const bullets = Array.isArray(rec['bullets'])
      ? rec['bullets'].filter((b): b is string => typeof b === "string")
      : [];
    const notes = typeof rec['notes'] === "string" ? rec['notes'] : "";
    if (!title && bullets.length === 0) continue;
    out.push({ title, bullets, notes });
  }
  return out;
}

export async function listPresentations(): Promise<Presentation[]> {
  const { data, error } = await supabase
    .from("presentations")
    .select("id, title, topic, theme, slides, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    topic: row.topic,
    theme: row.theme,
    slides: normalizeSlides(row.slides),
    updated_at: row.updated_at,
  }));
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const id = data.user?.id;
  if (!id) throw new Error("Your session expired. Sign in again.");
  return id;
}

export async function createPresentation(args: {
  title: string;
  topic: string;
  theme: string;
  slides: Slide[];
}): Promise<string> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("presentations")
    .insert({
      user_id: userId,
      title: args.title.trim() || "Untitled deck",
      topic: args.topic.trim(),
      theme: args.theme,
      slides: args.slides as unknown as never,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function savePresentation(
  id: string,
  patch: { title?: string; topic?: string; theme?: string; slides?: Slide[] },
): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) payload['title'] = patch.title;
  if (patch.topic !== undefined) payload['topic'] = patch.topic;
  if (patch.theme !== undefined) payload['theme'] = patch.theme;
  if (patch.slides !== undefined) payload['slides'] = patch.slides;
  const { error } = await supabase
    .from("presentations")
    .update(payload as never)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deletePresentation(id: string): Promise<void> {
  const { error } = await supabase.from("presentations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

function safeFileName(title: string, ext: string): string {
  const base = title.trim().replace(/[^a-z0-9\-_ ]/gi, "").replace(/\s+/g, "-") || "deck";
  return `${base.slice(0, 60)}.${ext}`;
}

/** Real .pptx generation in the browser — the file that downloads opens in PowerPoint/Keynote/Slides. */
export async function exportPptx(presentation: {
  title: string;
  theme: string;
  slides: Slide[];
}): Promise<void> {
  if (presentation.slides.length === 0) throw new Error("Add at least one slide first.");
  const { default: PptxGenJS } = await import("pptxgenjs");
  const theme = themeOf(presentation.theme);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = presentation.title;

  presentation.slides.forEach((slide, index) => {
    const s = pptx.addSlide();
    s.background = { color: theme.bg };
    s.addText(slide.title || `Slide ${index + 1}`, {
      x: 0.6,
      y: 0.5,
      w: 8.8,
      h: 1,
      fontSize: index === 0 ? 34 : 26,
      bold: true,
      color: theme.fg,
    });
    if (slide.bullets.length > 0) {
      s.addText(
        slide.bullets.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
        { x: 0.8, y: 1.7, w: 8.4, h: 3.6, fontSize: 16, color: theme.fg, lineSpacingMultiple: 1.3 },
      );
    }
    s.addShape(pptx.ShapeType.rect, {
      x: 0.6,
      y: 1.45,
      w: 1.4,
      h: 0.06,
      fill: { color: theme.accent },
    });
    if (slide.notes) s.addNotes(slide.notes);
  });

  await pptx.writeFile({ fileName: safeFileName(presentation.title, "pptx") });
}

/** Real .pdf generation in the browser, one landscape page per slide. */
export async function exportPdf(presentation: {
  title: string;
  theme: string;
  slides: Slide[];
}): Promise<void> {
  if (presentation.slides.length === 0) throw new Error("Add at least one slide first.");
  const { jsPDF } = await import("jspdf");
  const theme = themeOf(presentation.theme);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();

  presentation.slides.forEach((slide, index) => {
    if (index > 0) doc.addPage();
    doc.setFillColor(`#${theme.bg}`);
    doc.rect(0, 0, width, height, "F");
    doc.setTextColor(`#${theme.fg}`);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(index === 0 ? 30 : 24);
    doc.text(doc.splitTextToSize(slide.title || `Slide ${index + 1}`, width - 96), 48, 84);
    doc.setFillColor(`#${theme.accent}`);
    doc.rect(48, 104, 90, 4, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(14);
    let y = 148;
    for (const bullet of slide.bullets) {
      const lines = doc.splitTextToSize(`•  ${bullet}`, width - 120) as string[];
      if (y + lines.length * 20 > height - 48) break;
      doc.text(lines, 60, y);
      y += lines.length * 20 + 8;
    }
    doc.setFontSize(10);
    doc.setTextColor(`#${theme.accent}`);
    doc.text(`${index + 1} / ${presentation.slides.length}`, width - 72, height - 32);
  });

  doc.save(safeFileName(presentation.title, "pdf"));
}

export const OUTLINE_PROMPT = `You are a presentation writer. Return ONLY a JSON array, no prose and no code fence.
Each item: {"title": string, "bullets": string[], "notes": string}.
Use 5-8 slides, 3-5 short bullets each, and speaker notes of one or two sentences.`;

/** Parses a model outline reply into slides; throws a clear error instead of guessing. */
export function parseOutline(reply: string): Slide[] {
  const start = reply.indexOf("[");
  const end = reply.lastIndexOf("]");
  if (start === -1 || end <= start) {
    throw new Error("The model did not return a slide list. Try again or edit slides by hand.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.slice(start, end + 1));
  } catch {
    throw new Error("The model's slide list was not valid JSON. Try again.");
  }
  const slides = normalizeSlides(parsed);
  if (slides.length === 0) throw new Error("The model returned an empty slide list.");
  return slides;
}
