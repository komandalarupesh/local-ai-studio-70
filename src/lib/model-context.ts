/**
 * Context-window estimates for common open-source and hosted models.
 *
 * These are best-effort lookups by model-name pattern. When a model is not
 * recognised we say so and fall back to a conservative window instead of
 * pretending the context is unlimited — no model has infinite context, and the
 * real ceiling always belongs to the provider/model, not to this app.
 */

export type ContextInfo = {
  /** Usable context window in tokens. */
  tokens: number;
  /** True when the window came from a known model match, false when it is the fallback. */
  known: boolean;
  /** Human-readable source of the number. */
  source: string;
};

const FALLBACK_TOKENS = 8192;

const PATTERNS: { test: RegExp; tokens: number; label: string }[] = [
  { test: /gemini-[\d.]*-?(flash|pro)/i, tokens: 1_000_000, label: "Gemini family" },
  { test: /gpt-5|gpt-4\.1|o[34](-mini)?\b/i, tokens: 200_000, label: "OpenAI long-context" },
  { test: /gpt-4o/i, tokens: 128_000, label: "GPT-4o" },
  { test: /claude/i, tokens: 200_000, label: "Claude family" },
  { test: /qwen[\d.]*[-_]?(2\.5|3)|qwen3/i, tokens: 32_768, label: "Qwen 2.5/3" },
  { test: /llama[-_ ]?3\.[123]|llama3\.[123]/i, tokens: 128_000, label: "Llama 3.1+" },
  { test: /llama[-_ ]?3\b|llama3\b/i, tokens: 8_192, label: "Llama 3" },
  { test: /deepseek/i, tokens: 65_536, label: "DeepSeek" },
  { test: /mistral|mixtral|codestral/i, tokens: 32_768, label: "Mistral family" },
  { test: /gemma[-_ ]?[23]/i, tokens: 8_192, label: "Gemma" },
  { test: /phi[-_ ]?[34]/i, tokens: 16_384, label: "Phi" },
  { test: /command[-_ ]?r/i, tokens: 128_000, label: "Cohere Command R" },
  { test: /yi[-_ ]?(1\.5|34b)/i, tokens: 32_768, label: "Yi" },
  { test: /starcoder|codellama/i, tokens: 16_384, label: "Code model" },
];

export function modelContext(model: string | null | undefined): ContextInfo {
  const name = (model ?? "").trim();
  if (!name) {
    return { tokens: FALLBACK_TOKENS, known: false, source: "no model selected" };
  }

  // Many local model tags encode the window, e.g. "qwen2.5:7b-32k" or "…-128k".
  const tagged = /[-_:](\d{2,4})k\b/i.exec(name);
  if (tagged?.[1]) {
    const k = Number(tagged[1]);
    if (k >= 4 && k <= 4096) {
      return { tokens: k * 1024, known: true, source: `declared in the model tag (${k}k)` };
    }
  }

  for (const pattern of PATTERNS) {
    if (pattern.test.test(name)) {
      return { tokens: pattern.tokens, known: true, source: pattern.label };
    }
  }

  return {
    tokens: FALLBACK_TOKENS,
    known: false,
    source: "unknown model — using a conservative 8k assumption",
  };
}

/** Rough char-per-token ratio used for budgeting without a tokenizer. */
export const CHARS_PER_TOKEN = 4;

/**
 * How many characters of live conversation we keep verbatim before folding
 * older turns into the rolling summary. We reserve room for the system prompt,
 * the project file digest and the model's own output.
 */
export function workingCharBudget(model: string | null | undefined, maxOutputTokens: number) {
  const info = modelContext(model);
  const reserved = Math.min(info.tokens * 0.35, Math.max(maxOutputTokens, 1024) + 4096);
  const usable = Math.max(2048, info.tokens - reserved);
  return {
    ...info,
    chars: Math.round(usable * CHARS_PER_TOKEN),
    reservedTokens: Math.round(reserved),
  };
}
