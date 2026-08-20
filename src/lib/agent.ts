import { supabase } from "@/integrations/supabase/client";
import { runModel, type RunMessage, type RunProvider } from "@/lib/model-client";
import {
  checkProject,
  detectLanguage,
  parseFileBlocks,
  safePath,
  stripFileBlocks,
  type ProjectFile,
  type RejectedFile,
} from "@/lib/project-files";
import { workingCharBudget } from "@/lib/model-context";
import { selectProjectContext } from "@/lib/context-select";
import { modeConfig, type WorkspaceMode } from "@/lib/workspace-modes";

export type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model: string | null;
  compacted: boolean;
  created_at: string;
};

export type AgentConversation = {
  id: string;
  title: string;
  mode: string;
  summary: string;
  temperature: number;
  max_tokens: number;
  system_prompt: string;
  model: string;
  provider_id: string | null;
};

/**
 * Context policy. There is no arbitrary app-level message cap: the whole
 * conversation is sent until it approaches the *selected model's* working
 * window, at which point the oldest turns are folded into a running summary so
 * the thread can keep going. No model has unlimited context — when the model is
 * unrecognised we fall back to a conservative window and say so in the UI.
 */
export const CONTEXT = {
  /** Recent turns always kept verbatim. */
  keepRecentTurns: 8,
  /** Used only when no model information is available at all. */
  fallbackChars: 24_000,
};

export function contextChars(messages: AgentMessage[], summary: string): number {
  return (
    summary.length + messages.filter((m) => !m.compacted).reduce((n, m) => n + m.content.length, 0)
  );
}

export function contextBudget(model: string | null | undefined, maxOutputTokens: number) {
  const budget = workingCharBudget(model, maxOutputTokens || 8192);
  return { ...budget, chars: Math.max(CONTEXT.fallbackChars, budget.chars) };
}

export type CompactionResult = { compacted: number; summary: string } | null;

/** Folds older turns into a rolling summary when the thread grows large. */
export async function compactIfNeeded(args: {
  conversation: AgentConversation;
  messages: AgentMessage[];
  provider: RunProvider;
  model: string;
  signal?: AbortSignal;
}): Promise<CompactionResult> {
  const { conversation, messages, provider, model } = args;
  const live = messages.filter((m) => !m.compacted);
  const budget = contextBudget(model, conversation.max_tokens);
  if (contextChars(live, conversation.summary) < budget.chars) return null;

  const older = live.slice(0, Math.max(0, live.length - CONTEXT.keepRecentTurns));
  if (older.length === 0) return null;

  const transcript = older
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n")
    .slice(-120_000);

  const summary = await runModel({
    provider,
    model,
    temperature: 0.2,
    maxTokens: 2048,
    systemPrompt:
      "You compact long conversations for an AI development workspace. Produce a dense factual summary that preserves decisions, requirements, file names, APIs, naming conventions, unresolved questions and the user's preferences. Use short bullet points. No preamble.",
    messages: [
      {
        role: "user",
        content: `Existing summary (may be empty):\n${conversation.summary || "(none)"}\n\nNew conversation segment to fold in:\n${transcript}\n\nReturn the merged summary.`,
      },
    ],
    signal: args.signal,
  });

  const merged = summary.trim().slice(0, 20_000);
  await supabase
    .from("conversations")
    .update({ summary: merged, summarized_through: new Date().toISOString() })
    .eq("id", conversation.id);
  await supabase
    .from("messages")
    .update({ compacted: true })
    .in(
      "id",
      older.map((m) => m.id),
    );

  return { compacted: older.length, summary: merged };
}

/** Retries transient provider failures with backoff; aborts are never retried. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: { attempts?: number; signal?: AbortSignal; onRetry?: (attempt: number, error: Error) => void } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  let lastError: Error = new Error("Unknown failure");
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      return await fn(attempt);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      const message = lastError.message.toLowerCase();
      const fatal =
        message.includes("session expired") ||
        message.includes("no model selected") ||
        message.includes("unauthorized") ||
        message.includes("invalid api key");
      if (fatal || attempt === attempts) throw lastError;
      options.onRetry?.(attempt, lastError);
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }
  }
  throw lastError;
}

export function buildRunMessages(args: {
  messages: AgentMessage[];
  summary: string;
  userText: string;
}): RunMessage[] {
  const out: RunMessage[] = [];
  if (args.summary.trim()) {
    out.push({
      role: "user",
      content: `Summary of the earlier part of this conversation:\n${args.summary}`,
    });
  }
  for (const m of args.messages.filter((x) => !x.compacted && x.role !== "system")) {
    out.push({ role: m.role as "user" | "assistant", content: m.content });
  }
  if (args.userText) out.push({ role: "user", content: args.userText });
  return out;
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const id = data.user?.id;
  if (!id) throw new Error("Your session expired. Sign in again.");
  return id;
}

export async function saveFiles(
  projectId: string,
  files: { path: string; content: string; language?: string }[],
): Promise<string[]> {
  const safe = files.filter((f) => safePath(f.path));
  if (safe.length === 0) return [];
  const userId = await currentUserId();
  const rows = safe.map((f) => ({
    project_id: projectId,
    user_id: userId,
    path: safePath(f.path)!,
    content: f.content,
    language: f.language ?? detectLanguage(f.path),
  }));
  const { error } = await supabase
    .from("project_files")
    .upsert(rows, { onConflict: "project_id,path" });
  if (error) throw new Error(error.message);
  return rows.map((r) => r.path);
}

export type AgentTurnResult = {
  text: string;
  written: string[];
  rejected: RejectedFile[];
  truncated: boolean;
};

/** One chat turn: streams the answer, persists it and applies any file output. */
export async function runAgentTurn(args: {
  projectId: string;
  mode: WorkspaceMode;
  conversation: AgentConversation;
  messages: AgentMessage[];
  files: ProjectFile[];
  provider: RunProvider;
  model: string;
  userText: string;
  extraSystem?: string;
  /** Pinned project memory rendered as a prompt block. */
  memory?: string;
  onDelta?: (delta: string, full: string) => void;
  signal?: AbortSignal;
}): Promise<AgentTurnResult> {
  const config = modeConfig(args.mode);
  const userId = await currentUserId();

  if (args.userText) {
    const { error } = await supabase.from("messages").insert({
      conversation_id: args.conversation.id,
      user_id: userId,
      role: "user",
      content: args.userText,
    });
    if (error) throw new Error(error.message);
  }

  const selected = config.buildsFiles
    ? selectProjectContext({
        files: args.files,
        query: `${args.userText}\n${args.extraSystem ?? ""}`,
        memory: args.memory ?? "",
      })
    : null;

  const systemPrompt = [
    config.systemPrompt,
    args.memory?.trim(),
    args.conversation.system_prompt?.trim(),
    args.extraSystem?.trim(),
    selected ? `Current project state:\n${selected.digest}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const text = await runModel({
    provider: args.provider,
    model: args.model,
    systemPrompt,
    temperature: Number(args.conversation.temperature ?? config.temperature),
    maxTokens: args.conversation.max_tokens || 8192,
    messages: buildRunMessages({
      messages: args.messages,
      summary: args.conversation.summary,
      userText: args.userText,
    }),
    onDelta: args.onDelta,
    signal: args.signal,
  });

  if (!text.trim()) throw new Error("The model returned an empty response.");

  const parsed = config.buildsFiles
    ? parseFileBlocks(text)
    : { files: [], rejected: [], truncated: false };
  // Only complete, safely-pathed files are written; existing files are left
  // untouched when the model output was cut off mid-file.
  const written = await saveFiles(args.projectId, parsed.files);

  await supabase.from("messages").insert({
    conversation_id: args.conversation.id,
    user_id: userId,
    role: "assistant",
    content: text,
    model: args.model,
  });
  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", args.conversation.id);

  return { text, written, rejected: parsed.rejected, truncated: parsed.truncated };
}

export type PlannedTask = { title: string; detail: string };

/** Breaks a large request into ordered, individually runnable steps. */
export async function planTasks(args: {
  projectId: string;
  mode: WorkspaceMode;
  provider: RunProvider;
  model: string;
  request: string;
  files: ProjectFile[];
  signal?: AbortSignal;
}): Promise<PlannedTask[]> {
  const raw = await runModel({
    provider: args.provider,
    model: args.model,
    temperature: 0.2,
    maxTokens: 4096,
    systemPrompt: `You are a planning agent for a ${modeConfig(args.mode).label} project. Break the user's request into 3-10 ordered, independently executable steps. Each step must be concrete enough that a coding agent can complete it in one pass, and should name the files it touches when relevant.

Reply with JSON only, no prose, no code fences:
{"tasks":[{"title":"short imperative title","detail":"what to do, which files, acceptance criteria"}]}`,
    messages: [
      {
        role: "user",
        content: `Request:\n${args.request}\n\nProject files: ${
          args.files.length ? args.files.map((f) => f.path).join(", ") : "(empty project)"
        }`,
      },
    ],
    signal: args.signal,
  });

  const tasks = parsePlan(raw);
  if (tasks.length === 0) throw new Error("The model did not return a usable plan. Try again.");

  const userId = await currentUserId();
  const { data: existing } = await supabase
    .from("project_tasks")
    .select("position")
    .eq("project_id", args.projectId)
    .order("position", { ascending: false })
    .limit(1);
  const base = (existing?.[0]?.position ?? -1) + 1;

  const { error } = await supabase.from("project_tasks").insert(
    tasks.map((task, index) => ({
      project_id: args.projectId,
      user_id: userId,
      title: task.title.slice(0, 200),
      detail: task.detail.slice(0, 4000),
      status: "pending",
      position: base + index,
    })),
  );
  if (error) throw new Error(error.message);
  return tasks;
}

export function parsePlan(raw: string): PlannedTask[] {
  const cleaned = raw
    .replace(/```json/gi, "```")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
      tasks?: { title?: string; detail?: string }[];
    };
    return (parsed.tasks ?? [])
      .map((t) => ({ title: (t.title ?? "").trim(), detail: (t.detail ?? "").trim() }))
      .filter((t) => t.title.length > 0);
  } catch {
    return [];
  }
}

/** Runs the app's static check pass and records the result. */
export async function runProjectChecks(args: {
  projectId: string;
  files: ProjectFile[];
  expectWeb: boolean;
}): Promise<{ status: "passed" | "failed"; output: string }> {
  const issues = checkProject(args.files, args.expectWeb);
  const status = issues.length === 0 ? "passed" : "failed";
  const header = `Static browser analysis (JSON/JavaScript syntax, HTML entry point, relative references). No compiler, bundler or test runner ran — this workspace has no build container.`;
  const body =
    issues.length === 0
      ? `All ${args.files.length} file(s) passed. 0 issues.`
      : `${issues.length} issue(s):\n${issues.map((i) => `${i.path}: ${i.message}`).join("\n")}`;
  const output = `${header}\n\n${body}`;

  const userId = await currentUserId();
  await supabase.from("project_checks").insert({
    project_id: args.projectId,
    user_id: userId,
    kind: "static",
    status,
    output,
  });
  return { status, output };
}

export { stripFileBlocks };
