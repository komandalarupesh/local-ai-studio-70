import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  LOVABLE_MODELS,
  LlmError,
  listModels,
  normalizeBase,
  resolveProvider,
} from "./llm.server";

const ProviderIdInput = z.object({ providerId: z.string().uuid() });

const SaveKeyInput = z.object({
  providerId: z.string().uuid(),
  apiKey: z.string().max(4000),
});

/** Connection test: reaches the endpoint and returns the models it advertises. */
export const testProviderConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProviderIdInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      const provider = await resolveProvider(data.providerId, context.userId);
      const models = await listModels(provider);
      return {
        ok: true as const,
        kind: provider.kind,
        endpoint: provider.baseUrl,
        models,
        message:
          models.length > 0
            ? `Connected. ${models.length} model${models.length === 1 ? "" : "s"} available.`
            : "Connected, but the endpoint listed no models.",
      };
    } catch (error) {
      return {
        ok: false as const,
        models: [] as string[],
        message: error instanceof Error ? error.message : "Connection failed.",
        status: error instanceof LlmError ? error.status : 500,
      };
    }
  });

/** Stores or clears an API key server-side. Keys are never readable by the browser. */
export const saveProviderKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveKeyInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: owned, error: ownError } = await supabase
      .from("providers")
      .select("id")
      .eq("id", data.providerId)
      .maybeSingle();
    if (ownError) throw new Error(ownError.message);
    if (!owned) throw new Error("Provider not found.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const key = data.apiKey.trim();

    if (!key) {
      await supabaseAdmin.from("provider_secrets").delete().eq("provider_id", data.providerId);
      await supabaseAdmin.from("providers").update({ has_key: false }).eq("id", data.providerId);
      return { hasKey: false };
    }

    const { error } = await supabaseAdmin
      .from("provider_secrets")
      .upsert({ provider_id: data.providerId, user_id: userId, api_key: key });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("providers").update({ has_key: true }).eq("id", data.providerId);
    return { hasKey: true };
  });

/** Creates the built-in Lovable AI provider so a new account can chat immediately. */
export const createBuiltInProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("providers")
      .select("id")
      .eq("kind", "lovable")
      .maybeSingle();
    if (existing) return { id: existing.id };

    const { data, error } = await supabase
      .from("providers")
      .insert({
        user_id: userId,
        name: "Built-in Lovable AI",
        kind: "lovable",
        base_url: "",
        default_model: LOVABLE_MODELS[0]!,
        has_key: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id };
  });

/** Suggests provider defaults for the onboarding/provider forms. */
export const providerPresets = createServerFn({ method: "GET" }).handler(async () => ({
  lovableModels: LOVABLE_MODELS,
  presets: [
    {
      label: "Ollama (local)",
      kind: "ollama" as const,
      baseUrl: normalizeBase("http://localhost:11434"),
      model: "llama3.1",
    },
    {
      label: "LM Studio (local, OpenAI-compatible)",
      kind: "openai" as const,
      baseUrl: normalizeBase("http://localhost:1234/v1"),
      model: "local-model",
    },
    {
      label: "vLLM / llama.cpp server",
      kind: "openai" as const,
      baseUrl: normalizeBase("http://localhost:8000/v1"),
      model: "mistralai/Mistral-7B-Instruct-v0.3",
    },
  ],
}));
