/**
 * Browser-side streaming for endpoints that only exist on the user's own
 * machine (Ollama, LM Studio, llama.cpp, vLLM on localhost). The cloud server
 * cannot reach 127.0.0.1, so those requests are made from the browser instead.
 * API keys are never used here — keyed providers always go through the server.
 */

export type LocalMessage = { role: "system" | "user" | "assistant"; content: string };

export function isLocalEndpoint(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local") ||
      /^192\.168\./.test(host) ||
      /^10\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return false;
  }
}

export async function streamLocalChat(
  opts: {
    kind: "openai" | "ollama";
    baseUrl: string;
    model: string;
    messages: LocalMessage[];
    temperature: number;
    maxTokens: number;
  },
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const isOllama = opts.kind === "ollama";
  const url = isOllama ? `${base}/api/chat` : `${base}/chat/completions`;
  const body = isOllama
    ? {
        model: opts.model,
        messages: opts.messages,
        stream: true,
        options: { temperature: opts.temperature, num_predict: opts.maxTokens },
      }
    : {
        model: opts.model,
        messages: opts.messages,
        stream: true,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
      };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ?? null,
    });
  } catch (error) {
    throw new Error(
      `Your browser could not reach ${url}. Make sure the local server is running and allows this origin (for Ollama: set OLLAMA_ORIGINS=* and restart it). ${
        error instanceof Error ? error.message : ""
      }`.trim(),
    );
  }

  if (!response.ok || !response.body) {
    const raw = await response.text().catch(() => "");
    throw new Error(raw.slice(0, 300) || `Local endpoint responded with ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string }; text?: string }>;
          message?: { content?: string };
        };
        const text =
          parsed.choices?.[0]?.delta?.content ??
          parsed.choices?.[0]?.text ??
          parsed.message?.content ??
          "";
        if (text) onDelta(text);
      } catch {
        /* ignore partial frames */
      }
    }
  }
}

export async function listLocalModels(kind: "openai" | "ollama", baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  const url = kind === "ollama" ? `${base}/api/tags` : `${base}/models`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Local endpoint responded with ${response.status}`);
  const payload = (await response.json()) as {
    data?: Array<{ id?: string }>;
    models?: Array<{ name?: string; model?: string }>;
  };
  return kind === "ollama"
    ? (payload.models ?? []).map((m) => m.name ?? m.model ?? "").filter(Boolean)
    : (payload.data ?? []).map((m) => m.id ?? "").filter(Boolean);
}
