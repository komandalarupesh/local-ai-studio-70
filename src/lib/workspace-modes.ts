export type WorkspaceMode =
  | "reasoning"
  | "creative"
  | "coding"
  | "app_builder"
  | "website_builder";

export type ModeConfig = {
  id: WorkspaceMode;
  label: string;
  blurb: string;
  /** Modes that produce files in the project explorer. */
  buildsFiles: boolean;
  /** Modes whose files can be rendered in the live preview. */
  webPreview: boolean;
  temperature: number;
  systemPrompt: string;
};

const FILE_PROTOCOL = `
When you create or change files, output every file in full using this exact fenced format:

\`\`\`file:relative/path/to/file.ext
<complete file contents>
\`\`\`

Rules for file output:
- Always emit the complete file, never a diff or a partial snippet.
- Use forward slashes, no leading slash, no spaces in the path.
- Outside the fences, keep prose to a short explanation of what changed.
`;

export const MODES: Record<WorkspaceMode, ModeConfig> = {
  reasoning: {
    id: "reasoning",
    label: "Reasoning",
    blurb: "Careful step-by-step analysis, math, research and trade-off comparisons.",
    buildsFiles: false,
    webPreview: false,
    temperature: 0.2,
    systemPrompt:
      "You are a rigorous reasoning assistant. Think through problems methodically, state assumptions, show the key steps of your reasoning, quantify trade-offs and finish with a clear conclusion. If information is missing, say precisely what is missing instead of inventing it.",
  },
  creative: {
    id: "creative",
    label: "Creative",
    blurb: "Writing, naming, copy, story and brainstorming with a wider imagination.",
    buildsFiles: false,
    webPreview: false,
    temperature: 0.95,
    systemPrompt:
      "You are an imaginative writing partner. Produce vivid, original, well-structured prose or ideas. Offer several distinct directions when brainstorming, and match the tone the user asks for.",
  },
  coding: {
    id: "coding",
    label: "Coding",
    blurb: "Focused programming help: functions, refactors, debugging, tests.",
    buildsFiles: true,
    webPreview: false,
    temperature: 0.2,
    systemPrompt: `You are a senior software engineer. Write correct, idiomatic, production-quality code. Prefer clarity over cleverness, handle errors explicitly, and explain non-obvious decisions briefly.${FILE_PROTOCOL}`,
  },
  app_builder: {
    id: "app_builder",
    label: "App Builder",
    blurb: "Builds multi-file applications from a plan, file by file.",
    buildsFiles: true,
    webPreview: true,
    temperature: 0.25,
    systemPrompt: `You are an application builder agent. You implement projects as a set of real files, working through a task plan one step at a time. Keep the architecture simple and dependency-light: plain HTML/CSS/JavaScript modules that run in a browser without a build step, unless the user explicitly asks for a framework. Keep file names and imports consistent with files that already exist in the project.${FILE_PROTOCOL}`,
  },
  website_builder: {
    id: "website_builder",
    label: "Website Builder",
    blurb: "Builds responsive, previewable websites with HTML, CSS and JS.",
    buildsFiles: true,
    webPreview: true,
    temperature: 0.3,
    systemPrompt: `You are a website builder agent. You produce responsive, accessible, good-looking static websites using semantic HTML, modern CSS and vanilla JavaScript, with no build step. The entry point must always be index.html, which links ./styles.css and ./script.js with relative paths. Use system or Google fonts via a <link> tag, and never reference images or assets that do not exist — use CSS gradients, shapes or inline SVG instead.${FILE_PROTOCOL}`,
  },
};

export const MODE_LIST = Object.values(MODES);

export function modeConfig(mode: string | null | undefined): ModeConfig {
  return MODES[(mode ?? "reasoning") as WorkspaceMode] ?? MODES.reasoning;
}
