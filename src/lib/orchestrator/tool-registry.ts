/**
 * Tool registry.
 *
 * Tools are either really executable in this app today ("ready") or clearly
 * marked "configuration_required". A tool never reports success it did not
 * achieve, and unconfigured tools throw instead of returning fake output.
 */

export type ToolStatus = "ready" | "configuration_required";

export type ToolResult = {
  ok: boolean;
  output: string;
  detail?: string;
};

export type ToolDef = {
  id: string;
  name: string;
  group: "Computation" | "Files" | "Web" | "Code" | "Multimodal";
  blurb: string;
  status: ToolStatus;
  /** What is missing when status is configuration_required. */
  requirement?: string;
  run?: (input: string, signal?: AbortSignal) => Promise<ToolResult>;
};

/* ------------------------------- calculator ------------------------------ */

const FUNCS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
};

const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

type Token = { type: "num" | "op" | "lparen" | "rparen" | "comma" | "ident"; value: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const src = input.replace(/\s+/g, "");
  while (i < src.length) {
    const ch = src[i]!;
    if (/[0-9.]/.test(ch)) {
      let num = "";
      while (i < src.length && /[0-9.eE]/.test(src[i]!)) {
        // allow exponent sign
        if (/[eE]/.test(src[i]!) && /[+-]/.test(src[i + 1] ?? "")) {
          num += src[i]! + src[i + 1]!;
          i += 2;
          continue;
        }
        num += src[i]!;
        i += 1;
      }
      if (!Number.isFinite(Number(num))) throw new Error(`Not a number: ${num}`);
      tokens.push({ type: "num", value: num });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let name = "";
      while (i < src.length && /[a-zA-Z_0-9]/.test(src[i]!)) name += src[i++]!;
      tokens.push({ type: "ident", value: name.toLowerCase() });
      continue;
    }
    if ("+-*/^%".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen", value: ch });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ch });
      i += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma", value: ch });
      i += 1;
      continue;
    }
    throw new Error(`Unexpected character: ${ch}`);
  }
  return tokens;
}

/** Recursive-descent evaluator. No eval, no globals — exact IEEE-754 arithmetic. */
export function evaluateExpression(input: string): number {
  const tokens = tokenize(input);
  let pos = 0;
  const peek = () => tokens[pos];

  function parseExpr(): number {
    let left = parseTerm();
    for (;;) {
      const t = peek();
      if (t?.type === "op" && (t.value === "+" || t.value === "-")) {
        pos += 1;
        const right = parseTerm();
        left = t.value === "+" ? left + right : left - right;
      } else return left;
    }
  }

  function parseTerm(): number {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (t?.type === "op" && (t.value === "*" || t.value === "/" || t.value === "%")) {
        pos += 1;
        const right = parseUnary();
        if (t.value === "*") left = left * right;
        else if (t.value === "/") {
          if (right === 0) throw new Error("Division by zero");
          left = left / right;
        } else left = left % right;
      } else return left;
    }
  }

  function parseUnary(): number {
    const t = peek();
    if (t?.type === "op" && (t.value === "-" || t.value === "+")) {
      pos += 1;
      const value = parseUnary();
      return t.value === "-" ? -value : value;
    }
    return parsePower();
  }

  function parsePower(): number {
    const base = parseAtom();
    const t = peek();
    if (t?.type === "op" && t.value === "^") {
      pos += 1;
      return Math.pow(base, parseUnary());
    }
    return base;
  }

  function parseAtom(): number {
    const t = peek();
    if (!t) throw new Error("Unexpected end of expression");
    if (t.type === "num") {
      pos += 1;
      return Number(t.value);
    }
    if (t.type === "lparen") {
      pos += 1;
      const value = parseExpr();
      if (peek()?.type !== "rparen") throw new Error("Missing closing parenthesis");
      pos += 1;
      return value;
    }
    if (t.type === "ident") {
      pos += 1;
      if (peek()?.type === "lparen") {
        const fn = FUNCS[t.value];
        if (!fn) throw new Error(`Unknown function: ${t.value}`);
        pos += 1;
        const args: number[] = [];
        if (peek()?.type !== "rparen") {
          args.push(parseExpr());
          while (peek()?.type === "comma") {
            pos += 1;
            args.push(parseExpr());
          }
        }
        if (peek()?.type !== "rparen") throw new Error("Missing closing parenthesis");
        pos += 1;
        return fn(...args);
      }
      const constant = CONSTS[t.value];
      if (constant === undefined) throw new Error(`Unknown identifier: ${t.value}`);
      return constant;
    }
    throw new Error(`Unexpected token: ${t.value}`);
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error("Unexpected trailing input");
  if (!Number.isFinite(result)) throw new Error("Result is not a finite number");
  return result;
}

/* ------------------------------- js sandbox ------------------------------ */

const WORKER_SOURCE = `
self.onmessage = (event) => {
  const logs = [];
  const push = (level, args) => logs.push(level + ': ' + args.map((a) => {
    try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); }
  }).join(' '));
  self.console = {
    log: (...a) => push('log', a),
    info: (...a) => push('info', a),
    warn: (...a) => push('warn', a),
    error: (...a) => push('error', a),
  };
  try {
    const fn = new Function(event.data);
    const value = fn();
    self.postMessage({ ok: true, logs, value: typeof value === 'undefined' ? null : String(value) });
  } catch (error) {
    self.postMessage({ ok: false, logs, error: String(error && error.stack ? error.stack : error) });
  }
};
`;

/**
 * Runs plain JavaScript in a Web Worker with no DOM, no network helper and a
 * hard timeout. This is real execution — the output shown is the output produced.
 * It is not a container: it is same-origin worker isolation only.
 */
export async function runJsSandbox(code: string, timeoutMs = 4000): Promise<ToolResult> {
  if (typeof Worker === "undefined") {
    return { ok: false, output: "", detail: "Workers are unavailable in this environment." };
  }
  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
  const worker = new Worker(url);
  try {
    return await new Promise<ToolResult>((resolve) => {
      const timer = setTimeout(() => {
        worker.terminate();
        resolve({
          ok: false,
          output: "",
          detail: `Execution timed out after ${timeoutMs} ms and was terminated.`,
        });
      }, timeoutMs);

      worker.onmessage = (event: MessageEvent) => {
        clearTimeout(timer);
        const data = event.data as {
          ok: boolean;
          logs: string[];
          value?: string | null;
          error?: string;
        };
        const lines = [...(data.logs ?? [])];
        if (data.ok && data.value != null) lines.push(`return: ${data.value}`);
        resolve({
          ok: data.ok,
          output: lines.join("\n"),
          ...(data.ok ? {} : { detail: data.error ?? "Unknown error" }),
        });
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        resolve({ ok: false, output: "", detail: event.message });
      };
      worker.postMessage(code);
    });
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}

/* ----------------------------- document text ----------------------------- */

const TEXT_EXT = /\.(txt|md|markdown|json|csv|tsv|log|ya?ml|html?|css|js|ts|tsx|jsx|py|sql|xml|svg)$/i;

/** Reads a text-based file in the browser. Binary formats are refused, not faked. */
export async function extractDocumentText(file: File): Promise<ToolResult> {
  if (!TEXT_EXT.test(file.name) && !file.type.startsWith("text/")) {
    return {
      ok: false,
      output: "",
      detail: `${file.name}: no parser for this format yet. Text, Markdown, JSON, CSV, YAML, HTML and source files are supported. PDF and DOCX parsing is not configured.`,
    };
  }
  const text = await file.text();
  return {
    ok: true,
    output: text,
    detail: `${file.name} — ${text.length.toLocaleString()} characters read in the browser.`,
  };
}

/* --------------------------------- fetch --------------------------------- */

/** Fetches a public URL through the app server and returns readable text. */
export async function fetchUrlText(url: string, token: string): Promise<ToolResult> {
  const response = await fetch("/api/fetch-url", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url }),
  });
  const payload = (await response.json().catch(() => null)) as {
    text?: string;
    title?: string;
    error?: string;
  } | null;
  if (!response.ok || !payload?.text) {
    return { ok: false, output: "", detail: payload?.error ?? `Fetch failed (${response.status}).` };
  }
  return { ok: true, output: payload.text, detail: payload.title ?? url };
}

/* -------------------------------- registry ------------------------------- */

export const TOOLS: ToolDef[] = [
  {
    id: "calculator",
    name: "Calculator",
    group: "Computation",
    blurb:
      "Exact arithmetic evaluated locally with a real parser — no model guessing, no eval.",
    status: "ready",
    run: async (input) => {
      try {
        const value = evaluateExpression(input);
        return { ok: true, output: String(value), detail: "Computed locally" };
      } catch (error) {
        return {
          ok: false,
          output: "",
          detail: error instanceof Error ? error.message : "Invalid expression",
        };
      }
    },
  },
  {
    id: "js_sandbox",
    name: "JavaScript sandbox",
    group: "Code",
    blurb:
      "Runs plain JavaScript in an isolated Web Worker with a hard timeout. Real output only; no DOM and no filesystem.",
    status: "ready",
    run: (input) => runJsSandbox(input),
  },
  {
    id: "document_text",
    name: "Document reader",
    group: "Files",
    blurb:
      "Reads text-based documents in the browser (txt, md, json, csv, yaml, html, source). PDF/DOCX need a parser that is not installed.",
    status: "ready",
  },
  {
    id: "web_fetch",
    name: "Web page fetch",
    group: "Web",
    blurb:
      "Retrieves a public URL through the app server and extracts readable text for citation.",
    status: "ready",
  },
  {
    id: "web_search",
    name: "Web search",
    group: "Web",
    blurb: "Keyword search across the open web for research with sources.",
    status: "configuration_required",
    requirement:
      "No search provider is connected. Add a search API key in Project Settings → Secrets, or paste URLs into the Web page fetch tool instead.",
  },
  {
    id: "embeddings",
    name: "Embeddings / vector search",
    group: "Multimodal",
    blurb: "Indexes your documents for retrieval-augmented answers.",
    status: "configuration_required",
    requirement:
      "No embedding model is configured. Point a provider at a local embedding model (for example nomic-embed-text on Ollama) to enable this.",
  },
  {
    id: "vision",
    name: "Image understanding",
    group: "Multimodal",
    blurb: "Sends images to a vision-capable model for description or extraction.",
    status: "configuration_required",
    requirement:
      "Select a vision-capable model on a configured provider (for example llava or a vision-capable hosted model). Capability is inferred from the model id and shown on the Models page.",
  },
  {
    id: "image_gen",
    name: "Image generation",
    group: "Multimodal",
    blurb: "Creates images from prompts.",
    status: "configuration_required",
    requirement: "No image generation endpoint is configured for this workspace.",
  },
  {
    id: "speech",
    name: "Speech (TTS / STT)",
    group: "Multimodal",
    blurb: "Speaks responses aloud and transcribes recordings.",
    status: "configuration_required",
    requirement: "No speech endpoint is configured for this workspace.",
  },
  {
    id: "video_gen",
    name: "Video generation",
    group: "Multimodal",
    blurb: "Creates short video clips from prompts.",
    status: "configuration_required",
    requirement: "No video generation endpoint is configured for this workspace.",
  },
];

export const TOOL_MAP: Record<string, ToolDef> = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

export function getTool(id: string): ToolDef | undefined {
  return TOOL_MAP[id];
}
