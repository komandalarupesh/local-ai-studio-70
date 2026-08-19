import type { ProjectFile } from "@/lib/project-files";

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "make",
  "add",
  "use",
  "you",
  "your",
  "please",
  "file",
  "files",
  "code",
  "app",
  "page",
]);

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_.-]{3,}/g) ?? []).filter((t) => !STOP.has(t));
}

/** Entry points and config files that are almost always worth including. */
function baseScore(path: string): number {
  const lower = path.toLowerCase();
  if (/(^|\/)index\.html?$/.test(lower)) return 60;
  if (/(^|\/)(main|app|index)\.(js|ts|jsx|tsx)$/.test(lower)) return 40;
  if (/(^|\/)(styles?|style)\.css$/.test(lower)) return 26;
  if (/(^|\/)(package\.json|readme\.md)$/.test(lower)) return 20;
  return 0;
}

export type SelectedContext = {
  /** Files included in full (possibly clipped per file). */
  included: ProjectFile[];
  /** Files listed by path only. */
  omitted: ProjectFile[];
  digest: string;
};

/**
 * Picks the files most likely to matter for this request instead of shipping the
 * whole repository. Scoring mixes path/content keyword overlap with entry-point
 * weighting, then fills a character budget newest-relevant-first.
 */
export function selectProjectContext(args: {
  files: ProjectFile[];
  query: string;
  memory?: string;
  budgetChars?: number;
  perFileChars?: number;
}): SelectedContext {
  const { files } = args;
  const budget = args.budgetChars ?? 40_000;
  const perFile = args.perFileChars ?? 10_000;

  if (files.length === 0) {
    return { included: [], omitted: [], digest: "The project has no files yet." };
  }

  const keys = new Set([...tokens(args.query), ...tokens(args.memory ?? "")]);
  const scored = files.map((file) => {
    let score = baseScore(file.path);
    const pathTokens = tokens(file.path);
    for (const token of pathTokens) if (keys.has(token)) score += 25;
    const head = file.content.slice(0, 4000).toLowerCase();
    for (const key of keys) if (key.length > 3 && head.includes(key)) score += 4;
    // Small files are cheap to include, so give them a slight edge.
    if (file.content.length < 2000) score += 5;
    return { file, score };
  });
  scored.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));

  const included: ProjectFile[] = [];
  const omitted: ProjectFile[] = [];
  let left = budget;
  for (const { file } of scored) {
    const body = file.content.slice(0, perFile);
    if (body.length > left) {
      omitted.push(file);
      continue;
    }
    left -= body.length;
    included.push(file);
  }

  const parts: string[] = [
    `Project has ${files.length} file(s): ${files.map((f) => f.path).join(", ")}`,
    included.length > 0
      ? `\nContents of the ${included.length} most relevant file(s) for this request:`
      : "",
  ];
  for (const file of included) {
    const clipped = file.content.length > perFile;
    parts.push(
      `\n--- ${file.path} ---\n${file.content.slice(0, perFile)}${
        clipped ? `\n… (clipped, full length ${file.content.length} chars)` : ""
      }`,
    );
  }
  if (omitted.length > 0) {
    parts.push(
      `\nNot included in full this turn (ask for a file by path if you need it): ${omitted
        .map((f) => f.path)
        .join(", ")}`,
    );
  }

  return { included, omitted, digest: parts.filter(Boolean).join("\n") };
}
