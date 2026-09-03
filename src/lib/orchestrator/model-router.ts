/**
 * Model router.
 *
 * Chooses which configured provider + model should run a task. It only ever
 * routes to models that really exist on a provider the user has configured; if
 * nothing satisfies the requirement it says so instead of silently picking a
 * model that cannot do the job.
 */

import { modelContext, type ContextInfo } from "@/lib/model-context";

import { detectCapabilities, type Capability, type ModelCapabilities } from "./capabilities";
import type { TaskAnalysis } from "./task-analyzer";

export type RoutableProvider = {
  id: string;
  name: string;
  kind: "openai" | "ollama" | "lovable";
  base_url: string;
  default_model: string;
  has_key: boolean;
};

export type RoutableModel = {
  providerId: string;
  providerName: string;
  providerKind: RoutableProvider["kind"];
  model: string;
  capabilities: ModelCapabilities;
  context: ContextInfo;
  /** True when the endpoint is local (browser-direct, no key needed). */
  local: boolean;
};

export type RoutingDecision = {
  choice: RoutableModel | null;
  /** Capabilities the task wanted. */
  required: Capability[];
  /** Requirements no candidate reported as supported. */
  unmet: Capability[];
  /** Plain-language explanation shown verbatim in the UI. */
  reason: string;
  /** Every candidate, best first, so the UI can offer manual override. */
  ranked: RoutableModel[];
};

export function isLocalUrl(url: string): boolean {
  return /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(
    url.trim(),
  );
}

export function buildCandidates(
  providers: RoutableProvider[],
  modelsByProvider: Record<string, string[]>,
): RoutableModel[] {
  const candidates: RoutableModel[] = [];
  for (const provider of providers) {
    const listed = modelsByProvider[provider.id] ?? [];
    const models = listed.length > 0 ? listed : provider.default_model ? [provider.default_model] : [];
    for (const model of models) {
      candidates.push({
        providerId: provider.id,
        providerName: provider.name,
        providerKind: provider.kind,
        model,
        capabilities: detectCapabilities(model),
        context: modelContext(model),
        local: isLocalUrl(provider.base_url),
      });
    }
  }
  return candidates;
}

/** Capabilities a task domain genuinely needs from the model. */
export function requiredCapabilities(analysis: TaskAnalysis): Capability[] {
  const required: Capability[] = ["text"];
  if (analysis.domain === "presentation") required.push("json");
  if (analysis.complexity === "complex") required.push("reasoning");
  if (analysis.suggestedToolIds.includes("vision")) required.push("vision");
  if (analysis.suggestedToolIds.includes("embeddings")) required.push("embedding");
  return [...new Set(required)];
}

function score(candidate: RoutableModel, required: Capability[]): number {
  let value = 0;
  for (const capability of required) {
    const state = candidate.capabilities.states[capability];
    if (state === "supported") value += 10;
    else if (state === "unknown") value += 2;
    else value -= 40;
  }
  // Prefer a larger, *known* context window; unknown windows are conservative.
  value += Math.min(12, Math.log2(candidate.context.tokens / 1024));
  if (candidate.context.known) value += 3;
  return value;
}

export function routeModel(
  analysis: TaskAnalysis,
  candidates: RoutableModel[],
  preferredProviderId?: string | null,
): RoutingDecision {
  const required = requiredCapabilities(analysis);

  if (candidates.length === 0) {
    return {
      choice: null,
      required,
      unmet: required,
      reason:
        "No provider is configured yet, so nothing can be routed. Add an OpenAI-compatible endpoint or a local Ollama server on the Providers page.",
      ranked: [],
    };
  }

  const ranked = [...candidates].sort((a, b) => {
    const preference =
      Number(b.providerId === preferredProviderId) - Number(a.providerId === preferredProviderId);
    if (preference !== 0) return preference;
    return score(b, required) - score(a, required);
  });

  const choice = ranked[0] ?? null;
  const unmet = choice
    ? required.filter((capability) => choice.capabilities.states[capability] === "unsupported")
    : required;

  const unknown = choice
    ? required.filter((capability) => choice.capabilities.states[capability] === "unknown")
    : [];

  const parts: string[] = [];
  if (choice) {
    parts.push(
      `Routed to ${choice.model} on ${choice.providerName} for a ${analysis.complexity} ${analysis.domain.replace("_", " ")} task.`,
    );
    parts.push(`Context window: ${choice.context.tokens.toLocaleString()} tokens (${choice.context.source}).`);
    if (unknown.length > 0) {
      parts.push(
        `Unverified for: ${unknown.join(", ")} — capability is inferred from the model id, not published by the endpoint.`,
      );
    }
    if (unmet.length > 0) {
      parts.push(`This model cannot do: ${unmet.join(", ")}. Pick another model for that step.`);
    }
  }

  return { choice, required, unmet, reason: parts.join(" "), ranked };
}
