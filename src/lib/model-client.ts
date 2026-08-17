import { supabase } from "@/integrations/supabase/client";
import { isLocalEndpoint, streamLocalChat } from "@/lib/local-stream";

export type RunProvider = {
  id: string;
  kind: "openai" | "ollama" | "lovable";
  base_url: string;
  default_model: string;
  has_key: boolean;
};

export type RunMessage = { role: "user" | "assistant"; content: string };

export type RunOptions = {
  provider: RunProvider;
  model: string;
  systemPrompt?: string | undefined;
  messages: RunMessage[];
  temperature?: number | undefined;
  /** Provider-side output cap. This is the model/provider limit, not an app limit. */
  maxTokens?: number | undefined;
  onDelta?: ((delta: string, full: string) => void) | undefined;
  signal?: AbortSignal | undefined;
};

/**
 * Runs one completion and returns the full text.
 * Local endpoints (localhost / LAN, no API key) stream directly from the
 * browser because the cloud server cannot reach them. Everything else goes
 * through the server so credentials stay server-side.
 */
export async function runModel(options: RunOptions): Promise<string> {
  const {
    provider,
    model,
    systemPrompt = "",
    messages,
    temperature = 0.3,
    maxTokens = 8192,
    onDelta,
    signal,
  } = options;

  if (!model) throw new Error("No model selected. Pick a model for this workspace first.");

  let acc = "";
  const push = (delta: string) => {
    acc += delta;
    onDelta?.(delta, acc);
  };

  const browserDirect =
    provider.kind !== "lovable" && isLocalEndpoint(provider.base_url) && !provider.has_key;

  if (browserDirect) {
    await streamLocalChat(
      {
        kind: provider.kind as "openai" | "ollama",
        baseUrl: provider.base_url,
        model,
        messages: systemPrompt.trim()
          ? [{ role: "system", content: systemPrompt.trim() }, ...messages]
          : messages,
        temperature,
        maxTokens,
      },
      push,
      signal,
    );
    return acc;
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Your session expired. Sign in again.");

  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      providerId: provider.id,
      model,
      systemPrompt,
      temperature,
      maxTokens,
      messages,
    }),
    signal: signal ?? null,
  });

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `The model backend failed (${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    push(decoder.decode(value, { stream: true }));
  }
  return acc;
}
