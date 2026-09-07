import { supabase } from "@/integrations/supabase/client";

/**
 * 3D scenes are stored as a declarative JSON spec, not as executable code.
 * Nothing here is evaluated: the spec is validated field by field and turned
 * into three.js objects, so a saved scene can never run script in your browser.
 */

export const SHAPES = ["box", "sphere", "torus", "cone", "cylinder", "plane"] as const;
export type ShapeKind = (typeof SHAPES)[number];

export type SceneObject = {
  shape: ShapeKind;
  color: string;
  size: number;
  position: [number, number, number];
  spin: number;
};

export type SceneSpec = {
  background: string;
  objects: SceneObject[];
};

export type Scene3D = {
  id: string;
  title: string;
  prompt: string;
  spec: SceneSpec;
  updated_at: string;
};

const HEX = /^#[0-9a-f]{6}$/i;

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function color(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX.test(value) ? value : fallback;
}

export const DEFAULT_SPEC: SceneSpec = {
  background: "#0b1020",
  objects: [
    { shape: "torus", color: "#6c8cff", size: 1, position: [0, 0, 0], spin: 0.6 },
    { shape: "sphere", color: "#35c08a", size: 0.6, position: [2.2, 0.4, -1], spin: 0.2 },
    { shape: "box", color: "#ff7a45", size: 0.8, position: [-2.2, -0.3, -0.5], spin: 0.35 },
  ],
};

export function parseSpec(value: unknown): SceneSpec {
  let raw = value;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return DEFAULT_SPEC;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error("That scene is not valid JSON.");
    }
  }
  if (!raw || typeof raw !== "object") throw new Error("A scene must be a JSON object.");
  const rec = raw as Record<string, unknown>;
  const list = Array.isArray(rec['objects']) ? rec['objects'] : [];
  const objects: SceneObject[] = [];
  for (const item of list.slice(0, 60)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const shape = SHAPES.includes(o['shape'] as ShapeKind) ? (o['shape'] as ShapeKind) : "box";
    const pos = Array.isArray(o['position']) ? o['position'] : [];
    objects.push({
      shape,
      color: color(o['color'], "#6c8cff"),
      size: clampNumber(o['size'], 0.05, 20, 1),
      position: [
        clampNumber(pos[0], -50, 50, 0),
        clampNumber(pos[1], -50, 50, 0),
        clampNumber(pos[2], -50, 50, 0),
      ],
      spin: clampNumber(o['spin'], -5, 5, 0),
    });
  }
  return { background: color(rec['background'], "#0b1020"), objects };
}

export async function listScenes(): Promise<Scene3D[]> {
  const { data, error } = await supabase
    .from("scenes_3d")
    .select("id, title, prompt, code, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    let spec = DEFAULT_SPEC;
    try {
      spec = parseSpec(row.code);
    } catch {
      spec = { background: "#0b1020", objects: [] };
    }
    return {
      id: row.id,
      title: row.title,
      prompt: row.prompt,
      spec,
      updated_at: row.updated_at,
    };
  });
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const id = data.user?.id;
  if (!id) throw new Error("Your session expired. Sign in again.");
  return id;
}

export async function createScene(args: {
  title: string;
  prompt: string;
  spec: SceneSpec;
}): Promise<string> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("scenes_3d")
    .insert({
      user_id: userId,
      title: args.title.trim() || "Untitled scene",
      prompt: args.prompt.trim(),
      code: JSON.stringify(args.spec, null, 2),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function saveScene(
  id: string,
  patch: { title?: string; prompt?: string; spec?: SceneSpec },
): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) payload['title'] = patch.title;
  if (patch.prompt !== undefined) payload['prompt'] = patch.prompt;
  if (patch.spec !== undefined) payload['code'] = JSON.stringify(patch.spec, null, 2);
  const { error } = await supabase
    .from("scenes_3d")
    .update(payload as never)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteScene(id: string): Promise<void> {
  const { error } = await supabase.from("scenes_3d").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export const SCENE_PROMPT = `You describe 3D scenes as JSON only, with no prose and no code fence.
Shape of the answer: {"background": "#rrggbb", "objects": [{"shape": "box|sphere|torus|cone|cylinder|plane", "color": "#rrggbb", "size": number, "position": [x, y, z], "spin": number}]}
Use 3 to 12 objects, sizes between 0.2 and 4, positions between -6 and 6.`;

export function parseSceneReply(reply: string): SceneSpec {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("The model did not return a scene. Try again or edit the scene by hand.");
  }
  const spec = parseSpec(reply.slice(start, end + 1));
  if (spec.objects.length === 0) throw new Error("The model returned a scene with no objects.");
  return spec;
}
