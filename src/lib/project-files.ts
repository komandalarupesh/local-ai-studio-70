export type ProjectFile = {
  id: string;
  path: string;
  content: string;
  language: string;
  updated_at: string;
};

export type ParsedFile = { path: string; content: string; language: string };

/** Why a candidate file from the model was not written. */
export type RejectedFile = { path: string; reason: string };

export type ParseResult = {
  files: ParsedFile[];
  rejected: RejectedFile[];
  /** True when a fenced block was opened but never closed (truncated output). */
  truncated: boolean;
};

const EXT_LANGUAGE: Record<string, string> = {
  html: "html",
  htm: "html",
  css: "css",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  md: "markdown",
  py: "python",
  sql: "sql",
  sh: "bash",
  yml: "yaml",
  yaml: "yaml",
  svg: "svg",
  txt: "plaintext",
};

export function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANGUAGE[ext] ?? "plaintext";
}

export const MAX_FILE_BYTES = 400_000;
export const MAX_PATH_LENGTH = 180;

/**
 * Normalises a model- or user-supplied path into a safe project-relative path.
 * Returns null when the path cannot be made safe (traversal, absolute paths,
 * URL schemes, control characters, reserved names).
 */
export function safePath(raw: string): string | null {
  let path = (raw ?? "").trim().replace(/^["'`]|["'`]$/g, "");
  if (!path) return null;
  // Strip a trailing language/comment hint some models add: "index.html (updated)"
  path = path.split(/\s+[(#]/)[0] ?? path;
  path = path.replace(/\\/g, "/").trim();

  if (/[\u0000-\u001f\u007f]/.test(path)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null; // http:, file:, data:
  if (/^~/.test(path)) return null;
  if (/^[a-z]:\//i.test(path)) return null; // windows drive
  if (path.startsWith("//")) return null;

  const segments = path.split("/").filter((s) => s.length > 0 && s !== ".");
  if (segments.length === 0) return null;
  if (segments.some((s) => s === "..")) return null;
  if (segments.length > 12) return null;

  const cleaned = segments.map((segment) =>
    segment
      .replace(/\s+/g, "-")
      .replace(/[<>:"|?*]/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80),
  );
  if (cleaned.some((s) => s.length === 0)) return null;

  const path2 = cleaned.join("/");
  if (path2.length > MAX_PATH_LENGTH) return null;
  if (!/[A-Za-z0-9]/.test(cleaned[cleaned.length - 1] ?? "")) return null;
  return path2;
}

/** Backwards-compatible normaliser used by the manual file inputs. */
export function normalizePath(raw: string): string {
  return safePath(raw) ?? "";
}

const FENCE_INFO =
  /^(?:file|filepath|path|filename)\s*[:=]\s*(.+)$|^\S*\s*(?:file|filepath|path|filename)\s*=\s*["']?([^"'\s]+)["']?/i;

function pathFromInfo(info: string): string | null {
  const trimmed = info.trim();
  if (!trimmed) return null;
  const match = FENCE_INFO.exec(trimmed);
  const candidate = match?.[1] ?? match?.[2];
  if (candidate) return safePath(candidate);
  return null;
}

/**
 * Extracts file blocks from a model response with a line scanner rather than a
 * single regex, so nested fences inside a file, ~~~ fences and long fences all
 * work, and an unterminated final block is reported instead of half-written.
 */
export function parseFileBlocks(text: string): ParseResult {
  const lines = text.split(/\r?\n/);
  const files: ParsedFile[] = [];
  const rejected: RejectedFile[] = [];
  let truncated = false;

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const open = /^(\s{0,3})(`{3,}|~{3,})(.*)$/.exec(line);
    if (!open) {
      index += 1;
      continue;
    }
    const marker = open[2] ?? "```";
    const info = open[3] ?? "";
    const closeRe = new RegExp(`^\\s{0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);

    // Find the matching closing fence.
    let end = -1;
    for (let j = index + 1; j < lines.length; j += 1) {
      if (closeRe.test(lines[j] ?? "")) {
        end = j;
        break;
      }
    }

    const rawInfo = info.trim();
    const path = pathFromInfo(rawInfo);

    if (end === -1) {
      // Unterminated block: never write a half-generated file.
      if (path) {
        truncated = true;
        rejected.push({
          path,
          reason: "the response was cut off before the file was complete",
        });
      }
      break;
    }

    if (path) {
      const body = lines.slice(index + 1, end).join("\n").replace(/\s+$/, "");
      if (body.length > MAX_FILE_BYTES) {
        rejected.push({ path, reason: `larger than ${Math.round(MAX_FILE_BYTES / 1000)}kB` });
      } else if (body.trim().length === 0) {
        rejected.push({ path, reason: "the model emitted an empty file" });
      } else {
        files.push({ path, content: `${body}\n`, language: detectLanguage(path) });
      }
    } else if (rawInfo && /^(?:file|filepath|path|filename)\s*[:=]/i.test(rawInfo)) {
      rejected.push({ path: rawInfo.slice(0, 80), reason: "unsafe or invalid file path" });
    }

    index = end + 1;
  }

  // Last write wins when the model emits the same path twice.
  const deduped = new Map<string, ParsedFile>();
  for (const file of files) deduped.set(file.path, file);

  return { files: [...deduped.values()], rejected, truncated };
}

/** Prose with the file fences removed, for the chat transcript. */
export function stripFileBlocks(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const open = /^(\s{0,3})(`{3,}|~{3,})(.*)$/.exec(line);
    const path = open ? pathFromInfo(open[3] ?? "") : null;
    if (!open || !path) {
      out.push(line);
      index += 1;
      continue;
    }
    const marker = open[2] ?? "```";
    const closeRe = new RegExp(`^\\s{0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
    let end = lines.length;
    for (let j = index + 1; j < lines.length; j += 1) {
      if (closeRe.test(lines[j] ?? "")) {
        end = j;
        break;
      }
    }
    out.push(`\`${path}\``);
    index = end + 1;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Groups flat paths into a nested tree for the explorer. */
export type TreeNode = {
  name: string;
  path: string;
  file?: ProjectFile;
  children: TreeNode[];
};

export function buildTree(files: ProjectFile[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = file.path.split("/").filter(Boolean);
    let node = root;
    parts.forEach((part, index) => {
      const isLeaf = index === parts.length - 1;
      const path = parts.slice(0, index + 1).join("/");
      let next = node.children.find((c) => c.name === part && Boolean(c.file) === isLeaf);
      if (!next) {
        next = { name: part, path, children: [] };
        node.children.push(next);
      }
      if (isLeaf) next.file = file;
      node = next;
    });
  }
  return root.children;
}

/**
 * Builds a self-contained HTML document for the preview iframe by inlining
 * relative CSS/JS references, since project files live in the database.
 */
export function buildPreviewDocument(files: ProjectFile[]): string | null {
  const entry =
    files.find((f) => f.path === "index.html") ??
    files.find((f) => f.path.endsWith("index.html")) ??
    files.find((f) => f.path.endsWith(".html"));
  if (!entry) return null;

  const find = (href: string) => {
    const clean = safePath(href.split(/[?#]/)[0] ?? "");
    if (!clean) return undefined;
    return files.find((f) => f.path === clean || f.path.endsWith(`/${clean}`));
  };

  let html = entry.content;

  html = html.replace(/<link[^>]*href=["']([^"']+)["'][^>]*>/gi, (match, href: string) => {
    if (/^(https?:)?\/\//.test(href)) return match;
    const file = find(href);
    return file ? `<style>\n${file.content}\n</style>` : match;
  });

  html = html.replace(
    /<script([^>]*)src=["']([^"']+)["']([^>]*)><\/script>/gi,
    (match, before: string, src: string, after: string) => {
      if (/^(https?:)?\/\//.test(src)) return match;
      const file = find(src);
      if (!file) return match;
      const isModule = /type=["']module["']/.test(`${before} ${after}`);
      return `<script${isModule ? ' type="module"' : ""}>\n${file.content}\n</script>`;
    },
  );

  return html;
}

export type CheckIssue = { path: string; message: string };

/**
 * Static checks that run entirely in the browser: JSON/JavaScript syntax, the
 * HTML entry point and unresolved relative references. This is a static
 * analysis pass, NOT a real compiler, bundler or test runner — the workspace
 * has no build container, so it never reports a "build" as having run.
 */
export function checkProject(files: ProjectFile[], expectWeb: boolean): CheckIssue[] {
  const issues: CheckIssue[] = [];
  if (files.length === 0) return [{ path: "-", message: "The project has no files yet." }];

  for (const file of files) {
    if (file.language === "json") {
      try {
        JSON.parse(file.content);
      } catch (error) {
        issues.push({
          path: file.path,
          message: `Invalid JSON: ${error instanceof Error ? error.message : "parse error"}`,
        });
      }
    }
    if (file.language === "javascript" && !/\.(jsx)$/.test(file.path)) {
      const isModule = /(^|\n)\s*(import|export)\s/.test(file.content);
      try {
        if (isModule) {
          const unbalanced =
            countChar(file.content, "{") !== countChar(file.content, "}") ||
            countChar(file.content, "(") !== countChar(file.content, ")");
          if (unbalanced) {
            issues.push({ path: file.path, message: "Unbalanced brackets in module." });
          }
        } else {
          // eslint-disable-next-line no-new-func
          new Function(file.content);
        }
      } catch (error) {
        issues.push({
          path: file.path,
          message: `Syntax error: ${error instanceof Error ? error.message : "invalid JavaScript"}`,
        });
      }
    }
    if (file.language === "html") {
      const refs = [
        ...file.content.matchAll(/<link[^>]*href=["']([^"']+)["']/gi),
        ...file.content.matchAll(/<script[^>]*src=["']([^"']+)["']/gi),
        ...file.content.matchAll(/<img[^>]*src=["']([^"']+)["']/gi),
      ].map((m) => m[1] ?? "");
      for (const ref of refs) {
        if (/^(https?:)?\/\//.test(ref) || ref.startsWith("data:") || ref.startsWith("#")) continue;
        const clean = safePath(ref.split(/[?#]/)[0] ?? "");
        if (!clean) continue;
        if (!files.some((f) => f.path === clean || f.path.endsWith(`/${clean}`))) {
          issues.push({ path: file.path, message: `References missing file "${ref}".` });
        }
      }
    }
  }

  if (expectWeb && !files.some((f) => f.path.endsWith("index.html"))) {
    issues.push({ path: "-", message: "No index.html entry point for the preview." });
  }

  return issues;
}

function countChar(text: string, char: string): number {
  let count = 0;
  for (const c of text) if (c === char) count += 1;
  return count;
}

/** Triggers a browser download for a single project file. */
export function downloadFile(path: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = path.split("/").pop() || "file.txt";
  anchor.click();
  URL.revokeObjectURL(url);
}
