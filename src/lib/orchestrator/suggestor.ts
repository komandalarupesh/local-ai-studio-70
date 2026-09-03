/**
 * AI Suggestor.
 *
 * Deterministic, evidence-based "what should I do next?" suggestions. Every
 * suggestion is derived from real state that was actually loaded (providers,
 * project files, task rows, check rows, timeline errors) — nothing is inferred
 * from a model, so nothing can be hallucinated here.
 */

export type SuggestionKind = "fix" | "explain" | "test" | "improve" | "setup";

export type Suggestion = {
  id: string;
  kind: SuggestionKind;
  title: string;
  detail: string;
  /** Evidence this suggestion is based on. Shown so the user can verify it. */
  evidence: string;
  /** In-app destination, when one applies. */
  href?: string;
  severity: "info" | "warning" | "error";
};

export type SuggestorContext = {
  route: string;
  providerCount: number;
  providersWithModel: number;
  conversationCount?: number;
  project?: {
    id: string;
    name: string;
    fileCount: number;
    hasEntryPoint: boolean;
    pendingTasks: number;
    failedTasks: number;
    lastCheckStatus?: string | null;
    lastCheckOutput?: string | null;
    memoryCount: number;
    snapshotCount: number;
    recentErrors: number;
  };
};

export function buildSuggestions(context: SuggestorContext): Suggestion[] {
  const out: Suggestion[] = [];

  if (context.providerCount === 0) {
    out.push({
      id: "setup-provider",
      kind: "setup",
      title: "Connect a model backend",
      detail:
        "Nothing can run until a provider exists. Add a local Ollama server, an OpenAI-compatible endpoint, or enable the built-in hosted model.",
      evidence: "0 providers found on your account.",
      href: "/providers",
      severity: "error",
    });
  } else if (context.providersWithModel === 0) {
    out.push({
      id: "setup-model",
      kind: "setup",
      title: "Pick a default model for your provider",
      detail:
        "A provider is configured but no default model is set, so runs will fail with 'no model selected'.",
      evidence: `${context.providerCount} provider(s), none with a default model.`,
      href: "/providers",
      severity: "warning",
    });
  }

  const project = context.project;
  if (project) {
    if (project.failedTasks > 0) {
      out.push({
        id: "fix-failed-tasks",
        kind: "fix",
        title: `Retry ${project.failedTasks} failed step${project.failedTasks === 1 ? "" : "s"}`,
        detail:
          "Failed plan steps keep their recorded error. Open the task planner, read the error, then retry or edit the step.",
        evidence: `${project.failedTasks} task row(s) with status "failed" in ${project.name}.`,
        severity: "error",
      });
    }
    if (project.lastCheckStatus === "failed") {
      out.push({
        id: "fix-check",
        kind: "fix",
        title: "The last static check failed",
        detail:
          "Static browser analysis found a problem. This is syntax and reference checking only — not a compiler or test suite.",
        evidence: (project.lastCheckOutput ?? "See the Checks pane for the recorded output.").slice(
          0,
          300,
        ),
        severity: "error",
      });
    }
    if (project.recentErrors > 0) {
      out.push({
        id: "explain-errors",
        kind: "explain",
        title: "Review recent errors on the timeline",
        detail: "Ask the Copilot to explain the recorded failures before changing more files.",
        evidence: `${project.recentErrors} error event(s) in the recent activity timeline.`,
        severity: "warning",
      });
    }
    if (project.fileCount === 0) {
      out.push({
        id: "improve-generate",
        kind: "improve",
        title: "Generate the first files",
        detail: "This project has no files yet. Describe what to build and run the agent loop.",
        evidence: "0 files stored for this project.",
        severity: "info",
      });
    } else if (!project.hasEntryPoint) {
      out.push({
        id: "improve-entry",
        kind: "improve",
        title: "Add an index.html entry point",
        detail: "The live preview needs index.html at the project root to render anything.",
        evidence: `${project.fileCount} file(s), none named index.html.`,
        severity: "warning",
      });
    }
    if (project.fileCount > 0 && project.snapshotCount === 0) {
      out.push({
        id: "improve-snapshot",
        kind: "improve",
        title: "Take a snapshot before the next run",
        detail: "Snapshots are the only way to roll back generated files.",
        evidence: "0 snapshots stored for this project.",
        severity: "info",
      });
    }
    if (project.memoryCount === 0) {
      out.push({
        id: "improve-memory",
        kind: "improve",
        title: "Record project requirements in memory",
        detail:
          "Pinned memory is injected into every run, so decisions survive compaction and refreshes.",
        evidence: "0 memory entries for this project.",
        severity: "info",
      });
    }
    if (project.fileCount > 0) {
      out.push({
        id: "test-files",
        kind: "test",
        title: "Run the static check on the current files",
        detail:
          "Validates JSON/JS syntax and HTML references in the browser. It does not execute a build or tests.",
        evidence: `${project.fileCount} file(s) available to check.`,
        severity: "info",
      });
    }
    if (project.pendingTasks > 0) {
      out.push({
        id: "improve-run-plan",
        kind: "improve",
        title: `Continue the plan (${project.pendingTasks} step${project.pendingTasks === 1 ? "" : "s"} pending)`,
        detail: "Run the remaining steps one at a time, or use the autonomous loop.",
        evidence: `${project.pendingTasks} task row(s) with status "pending".`,
        severity: "info",
      });
    }
  } else if (context.route.startsWith("/workspace")) {
    out.push({
      id: "improve-open-project",
      kind: "improve",
      title: "Open or create a project",
      detail: "The workspace tools (files, plan, checks, preview) act on a specific project.",
      evidence: "No project is open on this route.",
      severity: "info",
    });
  }

  if (out.length === 0) {
    out.push({
      id: "explain-idle",
      kind: "explain",
      title: "Nothing needs attention",
      detail:
        "No failed steps, failed checks or missing configuration were found in the state that was loaded.",
      evidence: `Checked: providers (${context.providerCount}), current route ${context.route}.`,
      severity: "info",
    });
  }

  return out;
}
