/**
 * AI Orchestrator foundation.
 *
 * Given a request and the models actually configured, it produces an execution
 * plan: which agent handles it, which registry tools are relevant, which
 * workspace mode fits, and which provider/model should run it. It does NOT run
 * tools by itself — callers execute them explicitly, so nothing can be reported
 * as executed when it was not.
 */

import { modeConfig, type ModeConfig } from "@/lib/workspace-modes";

import { AGENT_MAP, getAgent, type AgentDef } from "./agent-registry";
import { getTool, type ToolDef } from "./tool-registry";
import { routeModel, type RoutableModel, type RoutingDecision } from "./model-router";
import { analyzeTask, type TaskAnalysis } from "./task-analyzer";

export type ToolPlan = {
  tool: ToolDef;
  /** True when this tool can really run right now. */
  executable: boolean;
  /** Why it cannot run, when it cannot. */
  blocker?: string;
};

export type OrchestrationPlan = {
  request: string;
  analysis: TaskAnalysis;
  agent: AgentDef;
  mode: ModeConfig;
  tools: ToolPlan[];
  routing: RoutingDecision;
  /** True when an agent + a routable model both exist. */
  runnable: boolean;
  /** Honest, user-facing list of what will not work in this plan. */
  limitations: string[];
};

export function planRun(
  request: string,
  candidates: RoutableModel[],
  options?: { preferredProviderId?: string | null; forceAgentId?: string | null },
): OrchestrationPlan {
  const analysis = analyzeTask(request);
  const agent =
    (options?.forceAgentId ? getAgent(options.forceAgentId) : undefined) ??
    getAgent(analysis.suggestedAgentId) ??
    AGENT_MAP["reasoning"]!;

  const routing = routeModel(analysis, candidates, options?.preferredProviderId ?? null);

  const toolIds = [...new Set([...agent.toolIds, ...analysis.suggestedToolIds])];
  const tools: ToolPlan[] = toolIds
    .map((id) => getTool(id))
    .filter((tool): tool is ToolDef => Boolean(tool))
    .map((tool) => {
      const executable = tool.status === "ready";
      return executable
        ? { tool, executable }
        : { tool, executable, blocker: tool.requirement ?? "Not configured in this workspace." };
    });

  const limitations: string[] = [];
  if (!routing.choice) limitations.push(routing.reason);
  if (routing.unmet.length > 0) {
    limitations.push(
      `The selected model does not support: ${routing.unmet.join(", ")}. Choose a different model for those steps.`,
    );
  }
  if (agent.status === "planned") {
    limitations.push(
      `The ${agent.name} agent is a placeholder — its target surface does not exist in the app yet.`,
    );
  }
  if (agent.status === "needs_tool") {
    limitations.push(
      `${agent.name} depends on tools that are not configured, so its answers come from model knowledge only.`,
    );
  }
  for (const plan of tools) {
    if (!plan.executable) limitations.push(`${plan.tool.name}: ${plan.blocker}`);
  }

  return {
    request,
    analysis,
    agent,
    mode: modeConfig(agent.mode),
    tools,
    routing,
    runnable: Boolean(routing.choice) && agent.status !== "planned",
    limitations,
  };
}

/** The exact system prompt that will be sent, so it is auditable before a run. */
export function planSystemPrompt(plan: OrchestrationPlan): string {
  const lines = [plan.agent.systemPrompt.trim()];
  const ready = plan.tools.filter((t) => t.executable).map((t) => t.tool.name);
  const blocked = plan.tools.filter((t) => !t.executable).map((t) => t.tool.name);
  if (ready.length > 0) {
    lines.push(
      `Tools the user can run for you in this app: ${ready.join(", ")}. Ask for their output instead of guessing it.`,
    );
  }
  if (blocked.length > 0) {
    lines.push(
      `Unavailable tools: ${blocked.join(", ")}. Never claim you used them, and say plainly when an answer needs them.`,
    );
  }
  lines.push(`Agent: ${plan.agent.name} v${plan.agent.promptVersion}.`);
  return lines.join("\n\n");
}
