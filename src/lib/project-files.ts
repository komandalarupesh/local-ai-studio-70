export type ProjectFile = {
  id: string;
  path: string;
  content: string;
  language: string;
  updated_at: string;
};

export type ParsedFile = { path: string; content: string; language: string };

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

export function normalizePath(raw: string): string {
  return raw
    .trim()
    .replace(/^[./\\]+/, "")
    .replace(/\\/g, "/")
    .replace(/\s+/g, "-")
    .slice(0, 200);
}

/** Extracts ```file:path fenced blocks from a model response. */
export function parseFileBlocks(text: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  const pattern = /```(?:file:|filepath:|path=)\s*([^\n`]+)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const path = normalizePath(match[1] ?? "");
    if (!path) continue;
    files.push({
      path,
      content: (match[2] ?? "").replace(/\s+$/, "") + "\n",
      language: detectLanguage(path),
    });
  }
  return files;
}

/** Prose with the file fences removed, for the chat transcript. */
export function stripFileBlocks(text: string): string {
  return text
    .replace(/```(?:file:|filepath:|path=)\s*[^\n`]+\n[\s\S]*?```/g, (m) => {
      const path = /```(?:file:|filepath:|path=)\s*([^\n`]+)/.exec(m)?.[1]?.trim();
      return path ? `\n\`${path}\` updated.\n` : "";
    })
    .trim();
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
    const clean = normalizePath(href.split("?")[0] ?? "");
    return files.find((f) => f.path === clean || f.path.endsWith(`/${clean}`));
  };

  let html = entry.content;

  html = html.replace(
    /<link[^>]*href=["']([^"']+)["'][^>]*>/gi,
    (match, href: string) => {
      if (/^(https?:)?\/\//.test(href)) return match;
      const file = find(href);
      return file ? `<style>\n${file.content}\n</style>` : match;
    },
  );

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
 * Static checks that can run in the browser: JS/JSON syntax, HTML entry point
 * and unresolved relative references. This is the app's own check pass — it is
 * not a substitute for a full toolchain.
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
        // eslint-disable-next-line no-new-func
        if (isModule) {
          new Function(`return import(URL.createObjectURL(new Blob([])))`);
          // Module syntax cannot be validated with Function(); do a light check.
          const unbalanced =
            countChar(file.content, "{") !== countChar(file.content, "}") ||
            countChar(file.content, "(") !== countChar(file.content, ")");
          if (unbalanced) {
            issues.push({ path: file.path, message: "Unbalanced brackets in module." });
          }
        } else {
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
        if (/^(https?:)?\/\//.test(ref) || ref.startsWith("data:")) continue;
        const clean = normalizePath(ref.split("?")[0] ?? "");
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
