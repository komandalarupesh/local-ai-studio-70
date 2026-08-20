import { supabase } from "@/integrations/supabase/client";
import {
  planTasks,
  runAgentTurn,
  runProjectChecks,
  withRetry,
  compactIfNeeded,
  type AgentConversation,
  type AgentMessage,
} from "@/lib/agent";
import type { RunProvider } from "@/lib/model-client";
import { logEvent } from "@/lib/project-activity";
import { createSnapshot, changeSummary } from "@/lib/project-history";
import { memoryPrompt, listMemory } from "@/lib/project-memory";
import type { ProjectFile } from "@/lib/project-files";
import { modeConfig, type WorkspaceMode } from "@/lib/workspace-modes";

export type LoopPhase =
  | "plan"
  | "implement"
  | "inspect"
  | "check"
  | "fix"
  | "summarize"
  | "done"
  | "cancelled"
  | "failed";

export type LoopUpdate = {
  phase: LoopPhase;
  label: string;
  /** True only when the phase actually succeeded. */
  ok?: boolean;
};

export type LoopResult = {
  phase: LoopPhase;
  stepsTotal: number;
  stepsDone: number;
  stepsFailed: number;
  checksPassed: boolean | null;
  filesWritten: string[];
};

type TaskRecord = {
  id: string;
  title: string;
  detail: string;
  status: string;
  position: number;
  attempts: number;
};

async function loadTasks(projectId: string): Promise<TaskRecord[]> {
  const { data, error } = await supabase
    .from("project_tasks")
    .select("id, title, detail, status, position, attempts")
    .eq("project_id", projectId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as TaskRecord[];
}

async function loadFiles(projectId: string): Promise<ProjectFile[]> {
  const { data, error } = await supabase
    .from("project_files")
    .select("id, path, content, language, updated_at")
    .eq("project_id", projectId)
    .order("path", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectFile[];
}

async function loadMessages(conversationId: string): Promise<AgentMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, model, compacted, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AgentMessage[];
}

async function setTask(
  id: string,
  patch: { status?: string; attempts?: number; error?: string; result?: string },
) {
  await supabase.from("project_tasks").update(patch).eq("id", id);
}

function aborted(signal?: AbortSignal) {
  return Boolean(signal?.aborted);
}

/**
 * Autonomous plan → implement → inspect → check → fix → summarize run.
 *
 * Every phase persists its own state, so a refresh or a cancellation leaves a
 * truthful record: step status/attempts/error live on `project_tasks`, check
 * results on `project_checks`, and everything is logged to the activity
 * timeline. Nothing is reported as successful unless it actually completed.
 */
export async function runAgentLoop(args: {
  projectId: string;
  mode: WorkspaceMode;
  conversation: AgentConversation;
  provider: RunProvider;
  model: string;
  request: string;
  /** Reuse an existing plan instead of asking the model for a new one. */
  reusePlan?: boolean;
  maxAttemptsPerStep?: number;
  maxFixRounds?: number;
  onUpdate?: (update: LoopUpdate) => void;
  onDelta?: (delta: string, full: string) => void;
  onRefresh?: () => void;
  signal?: AbortSignal;
}): Promise<LoopResult> {
  const config = modeConfig(args.mode);
  const attemptsPerStep = args.maxAttemptsPerStep ?? 2;
  const fixRounds = args.maxFixRounds ?? 2;
  const filesWritten = new Set<string>();
  const say = (phase: LoopPhase, label: string, ok?: boolean) =>
    args.onUpdate?.({ phase, label, ...(ok === undefined ? {} : { ok }) });

  const memory = memoryPrompt(await listMemory(args.projectId).catch(() => []));
  const startingFiles = await loadFiles(args.projectId);

  // Safety snapshot so an autonomous run is always reversible.
  if (startingFiles.length > 0) {
    await createSnapshot({
      projectId: args.projectId,
      files: startingFiles,
      label: "Before autonomous run",
      reason: args.request.slice(0, 400),
      summary: `${startingFiles.length} file(s) captured before the run started.`,
    }).catch(() => undefined);
  }

  await logEvent({
    projectId: args.projectId,
    kind: "plan",
    title: "Autonomous run started",
    detail: args.request.slice(0, 4000),
  });

  // ---- 1. PLAN -------------------------------------------------------------
  say("plan", "Planning steps");
  let tasks = await loadTasks(args.projectId);
  const reuse = args.reusePlan && tasks.some((t) => t.status !== "done");
  if (!reuse) {
    await withRetry(
      () =>
        planTasks({
          projectId: args.projectId,
          mode: args.mode,
          provider: args.provider,
          model: args.model,
          request: args.request,
          files: startingFiles,
          ...(args.signal ? { signal: args.signal } : {}),
        }),
      {
        attempts: 2,
        ...(args.signal ? { signal: args.signal } : {}),
        onRetry: () => say("plan", "Planning failed, retrying"),
      },
    );
    tasks = await loadTasks(args.projectId);
  }
  args.onRefresh?.();
  const queue = tasks.filter((t) => t.status !== "done");
  say("plan", `${queue.length} step(s) planned`, true);
  await logEvent({
    projectId: args.projectId,
    kind: "plan",
    title: `Plan ready: ${queue.length} step(s)`,
    detail: queue.map((t) => `${t.position + 1}. ${t.title}`).join("\n"),
    status: "success",
  });

  let done = 0;
  let failed = 0;

  // ---- 2. IMPLEMENT --------------------------------------------------------
  for (const task of queue) {
    if (aborted(args.signal)) break;
    say("implement", `Step ${task.position + 1}: ${task.title}`);
    let stepOk = false;
    let lastError = "";
    for (let attempt = 1; attempt <= attemptsPerStep; attempt += 1) {
      if (aborted(args.signal)) break;
      await setTask(task.id, { status: "running", attempts: attempt, error: "" });
      args.onRefresh?.();
      try {
        const conversationMessages = await loadMessages(args.conversation.id);
        await compactIfNeeded({
          conversation: args.conversation,
          messages: conversationMessages,
          provider: args.provider,
          model: args.model,
          ...(args.signal ? { signal: args.signal } : {}),
        }).catch(() => null);

        const result = await runAgentTurn({
          projectId: args.projectId,
          mode: args.mode,
          conversation: args.conversation,
          messages: await loadMessages(args.conversation.id),
          files: await loadFiles(args.projectId),
          provider: args.provider,
          model: args.model,
          memory,
          userText:
            `Execute plan step ${task.position + 1} of ${tasks.length}: ${task.title}\n\n${task.detail}\n\n` +
            (attempt > 1 ? `The previous attempt failed with: ${lastError}\n\n` : "") +
            `Implement it now. Output every file you create or change in full, complete files only.`,
          ...(args.onDelta ? { onDelta: args.onDelta } : {}),
          ...(args.signal ? { signal: args.signal } : {}),
        });
        for (const path of result.written) filesWritten.add(path);

        // ---- 3. INSPECT: a step that should have produced files but did not,
        // or whose output was cut off, is not a success.
        if (config.buildsFiles && result.truncated) {
          lastError = "Model output was cut off mid-file; nothing was written for that file.";
          throw new Error(lastError);
        }
        await setTask(task.id, {
          status: "done",
          attempts: attempt,
          error: "",
          result:
            result.written.length > 0
              ? `Wrote: ${result.written.join(", ")}`.slice(0, 4000)
              : "Completed with no file changes.",
        });
        stepOk = true;
        await logEvent({
          projectId: args.projectId,
          kind: "implement",
          title: `Step ${task.position + 1} done: ${task.title}`,
          detail: result.written.length ? `Files: ${result.written.join(", ")}` : "No file changes.",
          status: "success",
        });
        break;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          await setTask(task.id, { status: "pending" });
          args.onRefresh?.();
          break;
        }
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt === attemptsPerStep) {
          await setTask(task.id, {
            status: "failed",
            attempts: attempt,
            error: lastError.slice(0, 4000),
          });
          await logEvent({
            projectId: args.projectId,
            kind: "error",
            title: `Step ${task.position + 1} failed: ${task.title}`,
            detail: lastError,
            status: "error",
          });
        } else {
          say("implement", `Step ${task.position + 1} retrying (${attempt + 1}/${attemptsPerStep})`);
        }
      }
    }
    args.onRefresh?.();
    if (stepOk) done += 1;
    else if (!aborted(args.signal)) failed += 1;
  }

  if (aborted(args.signal)) {
    await logEvent({
      projectId: args.projectId,
      kind: "cancel",
      title: "Autonomous run cancelled",
      detail: `${done} step(s) completed before cancelling.`,
      status: "warning",
    });
    say("cancelled", "Run cancelled");
    return {
      phase: "cancelled",
      stepsTotal: queue.length,
      stepsDone: done,
      stepsFailed: failed,
      checksPassed: null,
      filesWritten: [...filesWritten],
    };
  }

  // ---- 4/5. CHECK + FIX ----------------------------------------------------
  let checksPassed: boolean | null = null;
  if (config.buildsFiles) {
    for (let round = 0; round <= fixRounds; round += 1) {
      if (aborted(args.signal)) break;
      say("check", round === 0 ? "Running static checks" : `Re-checking (round ${round})`);
      const files = await loadFiles(args.projectId);
      const check = await runProjectChecks({
        projectId: args.projectId,
        files,
        expectWeb: config.webPreview,
      });
      args.onRefresh?.();
      checksPassed = check.status === "passed";
      await logEvent({
        projectId: args.projectId,
        kind: "check",
        title: `Static checks ${check.status}`,
        detail: check.output,
        status: checksPassed ? "success" : "warning",
      });
      if (checksPassed || round === fixRounds) break;

      say("fix", `Repairing reported issues (round ${round + 1})`);
      try {
        const result = await runAgentTurn({
          projectId: args.projectId,
          mode: args.mode,
          conversation: args.conversation,
          messages: await loadMessages(args.conversation.id),
          files,
          provider: args.provider,
          model: args.model,
          memory,
          userText: `The static check pass reported these problems:\n\n${check.output}\n\nFix all of them and re-output every affected file in full.`,
          ...(args.onDelta ? { onDelta: args.onDelta } : {}),
          ...(args.signal ? { signal: args.signal } : {}),
        });
        for (const path of result.written) filesWritten.add(path);
        args.onRefresh?.();
        await logEvent({
          projectId: args.projectId,
          kind: "fix",
          title: `Repair round ${round + 1}`,
          detail: result.written.length ? `Files: ${result.written.join(", ")}` : "No file changes.",
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") break;
        await logEvent({
          projectId: args.projectId,
          kind: "error",
          title: `Repair round ${round + 1} failed`,
          detail: error instanceof Error ? error.message : String(error),
          status: "error",
        });
        break;
      }
    }
  }

  // ---- 6. SUMMARIZE --------------------------------------------------------
  say("summarize", "Writing run summary");
  const endingFiles = await loadFiles(args.projectId);
  const diff = changeSummary(startingFiles, endingFiles);
  if (filesWritten.size > 0) {
    await createSnapshot({
      projectId: args.projectId,
      files: endingFiles,
      label: `After: ${args.request.slice(0, 80)}`,
      reason: "Automatic snapshot at the end of an autonomous run.",
      summary: diff,
    }).catch(() => undefined);
  }

  const phase: LoopPhase = failed > 0 ? "failed" : "done";
  const detail = [
    `${done}/${queue.length} step(s) completed${failed > 0 ? `, ${failed} failed` : ""}.`,
    `File changes: ${diff}.`,
    checksPassed === null
      ? "No static checks apply to this mode."
      : checksPassed
        ? "Static browser checks passed (this is not a compiler or test-suite build)."
        : "Static browser checks still report issues.",
  ].join(" ");

  await logEvent({
    projectId: args.projectId,
    kind: "summary",
    title: failed > 0 ? "Autonomous run finished with failures" : "Autonomous run finished",
    detail,
    status: failed > 0 ? "warning" : "success",
  });
  args.onRefresh?.();
  say(phase, detail, failed === 0);

  return {
    phase,
    stepsTotal: queue.length,
    stepsDone: done,
    stepsFailed: failed,
    checksPassed,
    filesWritten: [...filesWritten],
  };
}
