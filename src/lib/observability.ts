import { supabase } from "@/integrations/supabase/client";

/**
 * Observability for AI work: one row per request or tool run.
 * Deliberately stores no prompt text, no model output and no secrets —
 * only identifiers, timings, counts and status.
 */

export type UsageEvent = {
  id: string;
  request_id: string;
  kind: string;
  provider_kind: string;
  model: string;
  agent_id: string;
  tools: string[];
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
  retries: number;
  status: string;
  verification: string;
  error: string;
  created_at: string;
};

const COLUMNS =
  "id, request_id, kind, provider_kind, model, agent_id, tools, latency_ms, prompt_tokens, completion_tokens, cost_usd, retries, status, verification, error, created_at";

export function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function logUsageEvent(event: {
  requestId: string;
  kind: "model_call" | "tool_call" | "agent_run" | "check";
  providerKind?: string;
  model?: string;
  agentId?: string;
  tools?: string[];
  latencyMs: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  costUsd?: number | null;
  retries?: number;
  status: "ok" | "error" | "cancelled";
  verification?: "verified" | "unverified" | "failed";
  error?: string;
  projectId?: string;
  conversationId?: string;
}): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return;
  await supabase.from("usage_events").insert({
    user_id: userId,
    project_id: event.projectId ?? null,
    conversation_id: event.conversationId ?? null,
    request_id: event.requestId,
    kind: event.kind,
    provider_kind: event.providerKind ?? "",
    model: event.model ?? "",
    agent_id: event.agentId ?? "",
    tools: event.tools ?? [],
    latency_ms: Math.round(event.latencyMs),
    prompt_tokens: event.promptTokens ?? null,
    completion_tokens: event.completionTokens ?? null,
    cost_usd: event.costUsd ?? null,
    retries: event.retries ?? 0,
    status: event.status,
    verification: event.verification ?? "unverified",
    error: (event.error ?? "").slice(0, 2000),
  });
}

export async function listUsageEvents(limit = 100): Promise<UsageEvent[]> {
  const { data, error } = await supabase
    .from("usage_events")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as UsageEvent[];
}
