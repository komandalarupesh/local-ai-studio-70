/**
 * Task analyzer — deterministic, local classification of a user request.
 *
 * This runs in the browser with no model call, so it is instant, free and
 * reproducible. It is a router input, not a claim about the answer: it says
 * which domain a request looks like and which tools/agents are relevant.
 */

import type { WorkspaceMode } from "@/lib/workspace-modes";

export type TaskDomain =
  | "code"
  | "web_app"
  | "presentation"
  | "three_d"
  | "research"
  | "math"
  | "data"
  | "writing"
  | "debug"
  | "test"
  | "security"
  | "devops"
  | "database"
  | "general";

export type TaskComplexity = "trivial" | "standard" | "complex";

export type TaskAnalysis = {
  domain: TaskDomain;
  complexity: TaskComplexity;
  /** Registry ids of tools that could help. Never executed automatically. */
  suggestedToolIds: string[];
  /** Registry id of the best-matching agent. */
  suggestedAgentId: string;
  /** Workspace mode that fits the request. */
  suggestedMode: WorkspaceMode;
  /** Whether the request implies producing/updating files. */
  producesFiles: boolean;
  /** Short, honest explanation of the classification. */
  rationale: string;
  signals: string[];
};

type Rule = {
  domain: TaskDomain;
  test: RegExp;
  agentId: string;
  mode: WorkspaceMode;
  tools: string[];
  producesFiles: boolean;
};

const RULES: Rule[] = [
  {
    domain: "presentation",
    test: /\b(slide|slides|deck|presentation|pptx|powerpoint|keynote)\b/i,
    agentId: "presentation",
    mode: "creative",
    tools: [],
    producesFiles: false,
  },
  {
    domain: "three_d",
    test: /\b(3d|three\.?js|mesh|gltf|glb|scene|shader|voxel|procedural model)\b/i,
    agentId: "three_d",
    mode: "coding",
    tools: ["js_sandbox"],
    producesFiles: true,
  },
  {
    domain: "web_app",
    test: /\b(website|landing page|web app|html|css|tailwind|frontend|ui|page|portfolio)\b/i,
    agentId: "web_builder",
    mode: "website_builder",
    tools: ["js_sandbox"],
    producesFiles: true,
  },
  {
    domain: "debug",
    test: /\b(bug|error|stack trace|exception|not working|broken|fails?|crash|debug)\b/i,
    agentId: "debugging",
    mode: "coding",
    tools: ["js_sandbox"],
    producesFiles: true,
  },
  {
    domain: "test",
    test: /\b(test|tests|unit test|spec|coverage|vitest|jest)\b/i,
    agentId: "testing",
    mode: "coding",
    tools: ["js_sandbox"],
    producesFiles: true,
  },
  {
    domain: "security",
    test: /\b(security|vulnerab|xss|csrf|injection|secret|auth bypass|rls)\b/i,
    agentId: "security",
    mode: "reasoning",
    tools: [],
    producesFiles: false,
  },
  {
    domain: "devops",
    test: /\b(deploy|ci\/cd|pipeline|docker|kubernetes|github action|hosting)\b/i,
    agentId: "devops",
    mode: "coding",
    tools: [],
    producesFiles: true,
  },
  {
    domain: "database",
    test: /\b(sql|postgres|database|schema|migration|table|query plan|index)\b/i,
    agentId: "database",
    mode: "coding",
    tools: [],
    producesFiles: false,
  },
  {
    domain: "data",
    test: /\b(dataset|csv|analyse|analyze|statistics|chart|plot|regression|pandas)\b/i,
    agentId: "data_science",
    mode: "reasoning",
    tools: ["calculator", "document_text", "js_sandbox"],
    producesFiles: false,
  },
  {
    domain: "math",
    test: /\b(calculate|compute|solve|equation|integral|derivative|percentage|sum of)\b|[\d)]\s*[+\-*/^]\s*\d/i,
    agentId: "math",
    mode: "reasoning",
    tools: ["calculator"],
    producesFiles: false,
  },
  {
    domain: "research",
    test: /\b(research|latest|news|compare tools|sources?|cite|current|find out|market)\b/i,
    agentId: "research",
    mode: "reasoning",
    tools: ["web_fetch", "web_search"],
    producesFiles: false,
  },
  {
    domain: "code",
    test: /\b(code|function|refactor|typescript|python|api|implement|class|component|script)\b/i,
    agentId: "coding",
    mode: "coding",
    tools: ["js_sandbox"],
    producesFiles: true,
  },
  {
    domain: "writing",
    test: /\b(write|blog|copy|email|story|poem|rewrite|tone|summar)/i,
    agentId: "reasoning",
    mode: "creative",
    tools: [],
    producesFiles: false,
  },
];

const COMPLEX = /\b(and then|multi[- ]step|full|end[- ]to[- ]end|architecture|plan|migrate|refactor everything|production)\b/i;

export function analyzeTask(request: string): TaskAnalysis {
  const text = (request ?? "").trim();
  const signals: string[] = [];
  const match = RULES.find((rule) => rule.test.test(text));

  const words = text.split(/\s+/).filter(Boolean).length;
  let complexity: TaskComplexity = "standard";
  if (words <= 6 && !COMPLEX.test(text)) complexity = "trivial";
  if (words > 60 || COMPLEX.test(text)) complexity = "complex";
  signals.push(`${words} words`);

  if (!match) {
    return {
      domain: "general",
      complexity,
      suggestedToolIds: [],
      suggestedAgentId: "reasoning",
      suggestedMode: "reasoning",
      producesFiles: false,
      rationale:
        "No domain keyword matched, so this is routed to the general reasoning agent. Keyword matching is a heuristic, not a guarantee.",
      signals,
    };
  }

  signals.push(`matched ${match.domain} keywords`);
  return {
    domain: match.domain,
    complexity,
    suggestedToolIds: match.tools,
    suggestedAgentId: match.agentId,
    suggestedMode: match.mode,
    producesFiles: match.producesFiles,
    rationale: `Matched the ${match.domain.replace("_", " ")} rule set by keyword. Complexity estimated from request length and multi-step wording.`,
    signals,
  };
}
