/**
 * Server-only helpers for talking to replaceable model backends.
 * Supports OpenAI-compatible endpoints, Ollama-compatible local endpoints
 * and the built-in Lovable AI gateway. API keys never leave the server.
 */

export type ProviderKind = "openai" | "ollama" | "lovable";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ResolvedProvider = {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string | null;
  defaultModel: string;
};

export const LOVABLE_BASE_URL = "https://ai.gateway.lovable.dev/v1";

export const LOVABLE_MODELS = [
  "google/gemini-3.6-flash",
  "google/gemini-3.5-flash",
  "google/gemini-3.1-flash-lite",
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
];

export function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export class LlmError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

export async function resolveProvider(
  providerId: string,
  userId: string,
): Promise<ResolvedProvider> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: provider, error } = await supabaseAdmin
    .from("providers")
    .select("id, name, kind, base_url, default_model, has_key")
    .eq("id", providerId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new LlmError(error.message, 500);
  if (!provider) throw new LlmError("Model provider not found for this account.", 404);

  const kind = provider.kind as ProviderKind;
  let apiKey: string | null = null;

  if (kind === "lovable") {
    apiKey = process.env["LOVABLE_API_KEY"] ?? null;
    if (!apiKey) throw new LlmError("Built-in Lovable AI is not configured for this project.", 500);
  } else if (provider.has_key) {
    const { data: secret } = await supabaseAdmin
      .from("provider_secrets")
      .select("api_key")
      .eq("provider_id", provider.id)
      .maybeSingle();
    apiKey = secret?.api_key ?? null;
  }

  const baseUrl = kind === "lovable" ? LOVABLE_BASE_URL : normalizeBase(provider.base_url ?? "");
  if (kind !== "lovable" && !baseUrl) {
    throw new LlmError("This provider has no endpoint URL configured.", 400);
  }

  return {
    id: provider.id,
    name: provider.name,
    kind,
    baseUrl,
    apiKey,
    defaultModel: provider.default_model ?? "",
  };
}

function authHeaders(provider: ResolvedProvider): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.kind === "lovable" && provider.apiKey) {
    headers["Lovable-API-Key"] = provider.apiKey;
    headers["X-Lovable-AIG-SDK"] = "fetch";
  } else if (provider.apiKey) {
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
  }
  return headers;
}

async function readError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
    if (parsed.message) return parsed.message;
  } catch {
    /* plain text */
  }
  return raw.slice(0, 400) || `Endpoint responded with ${response.status}`;
}

/** Lists models exposed by the endpoint — also used as the connection test. */
export async function listModels(provider: ResolvedProvider): Promise<string[]> {
  if (provider.kind === "lovable") return LOVABLE_MODELS;

  const url =
    provider.kind === "ollama" ? `${provider.baseUrl}/api/tags` : `${provider.baseUrl}/models`;

  let response: Response;
  try {
    response = await fetch(url, { headers: authHeaders(provider) });
  } catch (error) {
    throw new LlmError(
      `Could not reach ${url}. ${error instanceof Error ? error.message : "Network error"}`,
      502,
    );
  }

  if (!response.ok) throw new LlmError(await readError(response), response.status);

  const payload = (await response.json().catch(() => null)) as
    | { data?: Array<{ id?: string }>; models?: Array<{ name?: string; model?: string }> }
    | null;
  if (!payload) throw new LlmError("Endpoint returned an unexpected response.", 502);

  const models =
    provider.kind === "ollama"
      ? (payload.models ?? []).map((m) => m.name ?? m.model ?? "")
      : (payload.data ?? []).map((m) => m.id ?? "");

  return models.filter(Boolean);
}

export type ChatOptions = {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
};

/**
 * Streams the assistant answer as plain UTF-8 text chunks so the browser can
 * render it token by token, regardless of the upstream wire format.
 */
export async function streamChat(
  provider: ResolvedProvider,
  options: ChatOptions,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const isOllama = provider.kind === "ollama";
  const url = isOllama
    ? `${provider.baseUrl}/api/chat`
    : `${provider.baseUrl}/chat/completions`;

  const body = isOllama
    ? {
        model: options.model,
        messages: options.messages,
        stream: true,
        options: { temperature: options.temperature, num_predict: options.maxTokens },
      }
    : {
        model: options.model,
        messages: options.messages,
        stream: true,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      };

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: authHeaders(provider),
      body: JSON.stringify(body),
      signal: signal ?? null,
    });
  } catch (error) {
    throw new LlmError(
      `Could not reach ${url}. ${error instanceof Error ? error.message : "Network error"}`,
      502,
    );
  }

  if (!upstream.ok || !upstream.body) {
    throw new LlmError(await readError(upstream), upstream.ok ? 502 : upstream.status);
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
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
            error?: { message?: string };
          };
          if (parsed.error?.message) {
            controller.enqueue(encoder.encode(`\n\n> Provider error: ${parsed.error.message}`));
            continue;
          }
          const text =
            parsed.choices?.[0]?.delta?.content ??
            parsed.choices?.[0]?.text ??
            parsed.message?.content ??
            "";
          if (text) controller.enqueue(encoder.encode(text));
        } catch {
          /* ignore keep-alive / partial frames */
        }
      }
    },
  });

  return upstream.body.pipeThrough(transform);
}
