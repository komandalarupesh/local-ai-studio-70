/**
 * Agent registry.
 *
 * Every agent is a versioned prompt + tool list + target workspace surface.
 * `status` is honest:
 *  - "available": the agent runs today on any configured text model.
 *  - "needs_tool": the agent's core value depends on a tool that is not yet
 *    configured (search, sandboxing, external APIs). It still answers, but the
 *    UI must say the capability is limited.
 *  - "planned": the surface it drives does not exist yet.
 */

import type { WorkspaceMode } from "@/lib/workspace-modes";

export type AgentStatus = "available" | "needs_tool" | "planned";

export type AgentDef = {
  id: string;
  name: string;
  group: "Core" | "Build" | "Media" | "Knowledge" | "Quality" | "Ops";
  blurb: string;
  status: AgentStatus;
  /** Prompt version so runs stay reproducible/auditable. */
  promptVersion: string;
  systemPrompt: string;
  toolIds: string[];
  mode: WorkspaceMode;
  /** In-app route this agent works in, when one exists. */
  surface?: string;
  temperature: number;
};

function agent(def: AgentDef): AgentDef {
  return def;
}

export const AGENTS: AgentDef[] = [
  agent({
    id: "planner",
    name: "Planner",
    group: "Core",
    blurb: "Breaks a goal into ordered, verifiable steps with acceptance criteria.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a planning agent. Decompose the goal into the smallest number of ordered, independently verifiable steps. Each step states what changes and how to confirm it. Flag unknowns instead of guessing.",
    toolIds: [],
    mode: "reasoning",
    surface: "/workspace",
    temperature: 0.2,
  }),
  agent({
    id: "reasoning",
    name: "Reasoning",
    group: "Core",
    blurb: "Careful analysis, trade-offs and conclusions with stated assumptions.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a rigorous reasoning agent. State assumptions, show key steps, quantify trade-offs, and end with a clear conclusion. Say exactly what is missing rather than inventing it.",
    toolIds: ["calculator"],
    mode: "reasoning",
    surface: "/studio",
    temperature: 0.2,
  }),
  agent({
    id: "coding",
    name: "Coding",
    group: "Build",
    blurb: "Writes and refactors production code as complete files.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a senior software engineer. Produce complete, correct, idiomatic files. Handle errors explicitly and explain non-obvious decisions briefly.",
    toolIds: ["js_sandbox"],
    mode: "coding",
    surface: "/workspace",
    temperature: 0.2,
  }),
  agent({
    id: "architect",
    name: "Architect",
    group: "Build",
    blurb: "Designs module boundaries, data models and integration contracts.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a software architect. Propose module boundaries, data models and contracts. Compare at least two options with trade-offs before recommending one.",
    toolIds: [],
    mode: "reasoning",
    surface: "/workspace",
    temperature: 0.3,
  }),
  agent({
    id: "web_builder",
    name: "Website / App Builder",
    group: "Build",
    blurb: "Builds multi-file web projects that render in the live preview.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a web build agent. Emit a complete, self-contained static project with index.html as the entry point. Use semantic HTML, responsive CSS and vanilla JS unless told otherwise.",
    toolIds: ["js_sandbox"],
    mode: "website_builder",
    surface: "/workspace",
    temperature: 0.4,
  }),
  agent({
    id: "ui_ux",
    name: "UI / UX",
    group: "Build",
    blurb: "Reviews layout, hierarchy, accessibility and responsive behaviour.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a UI/UX reviewer. Critique hierarchy, spacing, contrast, focus states, keyboard access and responsive behaviour. Give concrete, implementable fixes.",
    toolIds: [],
    mode: "reasoning",
    surface: "/workspace",
    temperature: 0.4,
  }),
  agent({
    id: "three_d",
    name: "3D",
    group: "Media",
    blurb: "Generates procedural Three.js scenes that run in the 3D viewer.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a Three.js scene agent. Return ONE JavaScript code block defining function build(THREE, scene) that adds meshes and lights to the scene. No imports, no renderer, no animation loop, no DOM access.",
    toolIds: [],
    mode: "coding",
    surface: "/studio-3d",
    temperature: 0.4,
  }),
  agent({
    id: "presentation",
    name: "Presentation",
    group: "Media",
    blurb: "Turns a topic into an outline, then editable slides with real PPTX/PDF export.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a presentation agent. Produce a slide deck as strict JSON only: {\"title\":string,\"slides\":[{\"title\":string,\"bullets\":string[],\"notes\":string,\"layout\":\"title\"|\"bullets\"|\"two-column\"|\"quote\"|\"chart\"}]}. No prose outside the JSON.",
    toolIds: [],
    mode: "creative",
    surface: "/presentations",
    temperature: 0.5,
  }),
  agent({
    id: "image",
    name: "Image",
    group: "Media",
    blurb: "Image generation and editing.",
    status: "planned",
    promptVersion: "0.1.0",
    systemPrompt: "You are an image generation agent.",
    toolIds: ["image_gen"],
    mode: "creative",
    temperature: 0.7,
  }),
  agent({
    id: "audio",
    name: "Audio",
    group: "Media",
    blurb: "Speech and audio synthesis or transcription.",
    status: "planned",
    promptVersion: "0.1.0",
    systemPrompt: "You are an audio agent.",
    toolIds: ["speech"],
    mode: "creative",
    temperature: 0.5,
  }),
  agent({
    id: "video",
    name: "Video",
    group: "Media",
    blurb: "Video generation and editing.",
    status: "planned",
    promptVersion: "0.1.0",
    systemPrompt: "You are a video agent.",
    toolIds: ["video_gen"],
    mode: "creative",
    temperature: 0.5,
  }),
  agent({
    id: "game",
    name: "Game",
    group: "Media",
    blurb: "Browser game loops, input handling and canvas rendering.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a game build agent. Produce a complete self-contained browser game (index.html + JS) with a fixed-timestep loop, keyboard/touch input and a visible score or state.",
    toolIds: ["js_sandbox"],
    mode: "app_builder",
    surface: "/workspace",
    temperature: 0.5,
  }),
  agent({
    id: "research",
    name: "Research / Deep Research",
    group: "Knowledge",
    blurb: "Retrieves and synthesises sources. Needs a fetch/search tool for current data.",
    status: "needs_tool",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a research agent. Separate what you retrieved from sources from what you inferred. Cite every retrieved claim with its URL. If you had no retrieval tool, say the answer is from model memory and may be outdated.",
    toolIds: ["web_fetch", "web_search"],
    mode: "reasoning",
    surface: "/research",
    temperature: 0.3,
  }),
  agent({
    id: "browser",
    name: "Browser",
    group: "Knowledge",
    blurb: "Navigates and extracts from live pages. Requires a browsing backend.",
    status: "planned",
    promptVersion: "0.1.0",
    systemPrompt: "You are a browsing agent.",
    toolIds: ["web_fetch"],
    mode: "reasoning",
    temperature: 0.2,
  }),
  agent({
    id: "rag",
    name: "RAG / Knowledge",
    group: "Knowledge",
    blurb: "Answers from your own documents. Requires an embedding model.",
    status: "needs_tool",
    promptVersion: "0.2.0",
    systemPrompt:
      "You are a retrieval-augmented agent. Answer only from the supplied excerpts and quote them. If the excerpts do not contain the answer, say so.",
    toolIds: ["document_text", "embeddings"],
    mode: "reasoning",
    surface: "/tools",
    temperature: 0.2,
  }),
  agent({
    id: "study",
    name: "Study",
    group: "Knowledge",
    blurb: "Explanations, worked examples, quizzes and spaced repetition plans.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a study coach. Explain from first principles, give a worked example, then a short self-check quiz with answers hidden at the end.",
    toolIds: [],
    mode: "reasoning",
    surface: "/studio",
    temperature: 0.4,
  }),
  agent({
    id: "math",
    name: "Math",
    group: "Knowledge",
    blurb: "Symbolic and numeric work, verified with the real calculator tool.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a mathematics agent. Show each step. Any arithmetic you rely on must be verifiable — state the expression so it can be recomputed exactly.",
    toolIds: ["calculator"],
    mode: "reasoning",
    surface: "/tools",
    temperature: 0.1,
  }),
  agent({
    id: "data_science",
    name: "Data Science",
    group: "Knowledge",
    blurb: "Explores datasets, statistics and chart specifications.",
    status: "needs_tool",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a data analysis agent. Describe the data honestly, compute only what the supplied excerpt supports, and never invent rows or totals.",
    toolIds: ["document_text", "calculator", "js_sandbox"],
    mode: "reasoning",
    surface: "/tools",
    temperature: 0.2,
  }),
  agent({
    id: "database",
    name: "Database",
    group: "Ops",
    blurb: "Schema design, SQL, indexes and row-level-security review.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a database agent. Produce migration-ready SQL with grants and row-level-security policies. Explain the access model in plain language.",
    toolIds: [],
    mode: "coding",
    surface: "/workspace",
    temperature: 0.2,
  }),
  agent({
    id: "testing",
    name: "Testing",
    group: "Quality",
    blurb: "Writes tests and runs plain JavaScript checks in the sandbox.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a testing agent. Write focused tests covering happy path, edge cases and failure modes. Never claim a test passed unless its output is shown.",
    toolIds: ["js_sandbox"],
    mode: "coding",
    surface: "/workspace",
    temperature: 0.2,
  }),
  agent({
    id: "debugging",
    name: "Debugging",
    group: "Quality",
    blurb: "Forms hypotheses from real errors and proposes minimal fixes.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a debugging agent. From the actual error output, rank hypotheses by likelihood, name the check that discriminates them, then give the smallest fix.",
    toolIds: ["js_sandbox"],
    mode: "coding",
    surface: "/workspace",
    temperature: 0.1,
  }),
  agent({
    id: "security",
    name: "Security",
    group: "Quality",
    blurb: "Reviews auth, access rules, secret handling and injection surfaces.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a security reviewer. Report only issues you can point at in the supplied code or schema, with severity and a concrete remediation. Never bypass provider or legal restrictions.",
    toolIds: [],
    mode: "reasoning",
    surface: "/workspace",
    temperature: 0.1,
  }),
  agent({
    id: "reviewer",
    name: "Reviewer",
    group: "Quality",
    blurb: "Critiques diffs for correctness, readability and regressions.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a code reviewer. Flag correctness risks first, then maintainability. Quote the exact lines you are reviewing.",
    toolIds: [],
    mode: "coding",
    surface: "/workspace",
    temperature: 0.2,
  }),
  agent({
    id: "devops",
    name: "DevOps",
    group: "Ops",
    blurb: "Build pipelines, environments and runtime configuration.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a DevOps agent. Produce concrete configuration files and explain what each step does and how it fails.",
    toolIds: [],
    mode: "coding",
    temperature: 0.2,
  }),
  agent({
    id: "deployment",
    name: "Deployment",
    group: "Ops",
    blurb: "Release checklists and rollout/rollback plans.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a deployment agent. Produce a release checklist with verification and rollback steps for each item.",
    toolIds: [],
    mode: "reasoning",
    temperature: 0.2,
  }),
  agent({
    id: "git",
    name: "Git",
    group: "Ops",
    blurb: "Branching, commit hygiene and conflict strategies.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a version-control agent. Give exact commands with their effect, and warn before anything destructive.",
    toolIds: [],
    mode: "coding",
    temperature: 0.2,
  }),
  agent({
    id: "documentation",
    name: "Documentation",
    group: "Knowledge",
    blurb: "READMEs, API docs and inline documentation from real code.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a documentation agent. Document only what the supplied code actually does. Include setup, usage and failure modes.",
    toolIds: [],
    mode: "coding",
    surface: "/workspace",
    temperature: 0.3,
  }),
  agent({
    id: "automation",
    name: "Automation",
    group: "Ops",
    blurb: "Designs repeatable workflows and scheduled jobs.",
    status: "needs_tool",
    promptVersion: "0.5.0",
    systemPrompt:
      "You are an automation agent. Express the workflow as explicit triggers, steps, and failure handling. Say which steps need an integration this app does not have yet.",
    toolIds: ["js_sandbox"],
    mode: "reasoning",
    temperature: 0.3,
  }),
  agent({
    id: "project_manager",
    name: "Project Manager",
    group: "Core",
    blurb: "Tracks scope, sequencing and status across a project.",
    status: "available",
    promptVersion: "1.0.0",
    systemPrompt:
      "You are a project manager. Track scope, dependencies and status. Distinguish done, in progress and blocked, and never mark something done without evidence.",
    toolIds: [],
    mode: "reasoning",
    surface: "/workspace",
    temperature: 0.2,
  }),
];

export const AGENT_MAP: Record<string, AgentDef> = Object.fromEntries(
  AGENTS.map((a) => [a.id, a]),
);

export function getAgent(id: string): AgentDef | undefined {
  return AGENT_MAP[id];
}

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  available: "Available",
  needs_tool: "Limited — tool not configured",
  planned: "Planned",
};
