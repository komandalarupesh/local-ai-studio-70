/**
 * Model capability detection.
 *
 * Capabilities are *inferred* from the model id because OpenAI-compatible and
 * Ollama endpoints do not expose a machine-readable capability list. Anything we
 * cannot infer is reported as "unknown" — never as supported.
 */

export type Capability = "text" | "vision" | "tools" | "json" | "reasoning" | "embedding";

export type CapabilityState = "supported" | "unknown" | "unsupported";

export type ModelCapabilities = {
  model: string;
  states: Record<Capability, CapabilityState>;
  /** Where the inference came from, shown verbatim in the UI. */
  source: string;
};

const VISION = /gpt-4o|gpt-5|gemini|claude-3|claude-[45]|llava|llama-?3\.2-vision|qwen2?\.?5?-?vl|minicpm-v|moondream|pixtral|internvl/i;
const TOOLS = /gpt-4|gpt-5|gemini|claude|qwen[\d.]*|llama-?3\.[123]|mistral|mixtral|command-?r|firefunction|hermes/i;
const JSON_MODE = /gpt-4|gpt-5|gemini|claude|qwen|llama-?3|mistral|mixtral|command-?r/i;
const REASONING = /o[1345](-mini)?\b|gpt-5|deepseek-?r1|qwq|magistral|gemini-[\d.]+-(pro|flash)|claude-[45]/i;
const EMBEDDING = /embed|bge-|gte-|nomic-embed|e5-/i;

export function detectCapabilities(model: string | null | undefined): ModelCapabilities {
  const name = (model ?? "").trim();
  if (!name) {
    const unknown: Record<Capability, CapabilityState> = {
      text: "unknown",
      vision: "unknown",
      tools: "unknown",
      json: "unknown",
      reasoning: "unknown",
      embedding: "unknown",
    };
    return { model: "", states: unknown, source: "No model selected" };
  }

  const embedding = EMBEDDING.test(name);
  return {
    model: name,
    states: {
      text: embedding ? "unsupported" : "supported",
      vision: VISION.test(name) ? "supported" : "unknown",
      tools: TOOLS.test(name) ? "supported" : "unknown",
      json: JSON_MODE.test(name) ? "supported" : "unknown",
      reasoning: REASONING.test(name) ? "supported" : "unknown",
      embedding: embedding ? "supported" : "unknown",
    },
    source: "Inferred from the model id — endpoints do not publish capabilities",
  };
}

export const CAPABILITY_LABEL: Record<Capability, string> = {
  text: "Text generation",
  vision: "Image input",
  tools: "Tool / function calling",
  json: "Structured JSON output",
  reasoning: "Extended reasoning",
  embedding: "Embeddings",
};
