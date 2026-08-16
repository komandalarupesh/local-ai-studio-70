import { LlmError, resolveProvider, streamChat, type ChatMessage } from "@/lib/llm.server";
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const BodySchema = z.object({
  conversationId: z.string().uuid(),
  providerId: z.string().uuid(),
  model: z.string().min(1).max(200),
  systemPrompt: z.string().max(20000).default(""),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().min(16).max(32000).default(2048),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(200000),
      }),
    )
    .min(1)
    .max(200),
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!token) return jsonError("You must be signed in to run a model.", 401);

        const supabase = createClient(
          process.env["SUPABASE_URL"]!,
          process.env["SUPABASE_PUBLISHABLE_KEY"]!,
          {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
          },
        );

        const { data: userData, error: userError } = await supabase.auth.getUser(token);
        if (userError || !userData.user) return jsonError("Session expired. Sign in again.", 401);
        const userId = userData.user.id;

        let body: z.infer<typeof BodySchema>;
        try {
          body = BodySchema.parse(await request.json());
        } catch {
          return jsonError("Invalid request payload.", 400);
        }

        const { data: conversation } = await supabase
          .from("conversations")
          .select("id")
          .eq("id", body.conversationId)
          .eq("user_id", userId)
          .maybeSingle();
        if (!conversation) return jsonError("Conversation not found.", 404);

        try {
          const provider = await resolveProvider(body.providerId, userId);
          const messages: ChatMessage[] = [];
          if (body.systemPrompt.trim()) {
            messages.push({ role: "system", content: body.systemPrompt.trim() });
          }
          for (const m of body.messages) messages.push({ role: m.role, content: m.content });

          const stream = await streamChat(
            provider,
            {
              model: body.model || provider.defaultModel,
              messages,
              temperature: body.temperature,
              maxTokens: body.maxTokens,
            },
            request.signal,
          );

          return new Response(stream, {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              "X-Accel-Buffering": "no",
            },
          });
        } catch (error) {
          if (error instanceof LlmError) return jsonError(error.message, error.status);
          if (error instanceof Error && error.name === "AbortError") {
            return new Response(null, { status: 499 });
          }
          console.error(error);
          return jsonError(
            error instanceof Error ? error.message : "The model backend failed.",
            500,
          );
        }
      },
    },
  },
});
