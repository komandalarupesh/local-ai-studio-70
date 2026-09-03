import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Server proxy used by the `web_fetch` tool. It exists because the browser
 * cannot read arbitrary cross-origin pages. Every request is authenticated,
 * restricted to public http(s) hosts, size-capped, and returns only the text
 * actually retrieved — never a summary invented by the server.
 */
const BodySchema = z.object({ url: z.string().url().max(2000) });

const MAX_BYTES = 400_000;
const MAX_CHARS = 120_000;

const BLOCKED_HOST =
  /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|.*\.internal|.*\.local)$/i;

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlToText(html: string): { text: string; title?: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim();
  return title ? { text: stripped, title } : { text: stripped };
}

export const Route = createFileRoute("/api/fetch-url")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!token) return jsonError("You must be signed in to fetch a page.", 401);

        const supabase = createClient(
          process.env["SUPABASE_URL"]!,
          process.env["SUPABASE_PUBLISHABLE_KEY"]!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const { data: userData, error: userError } = await supabase.auth.getUser(token);
        if (userError || !userData.user) return jsonError("Session expired. Sign in again.", 401);

        let body: z.infer<typeof BodySchema>;
        try {
          body = BodySchema.parse(await request.json());
        } catch {
          return jsonError("Provide a valid absolute http(s) URL.", 400);
        }

        let target: URL;
        try {
          target = new URL(body.url);
        } catch {
          return jsonError("That URL could not be parsed.", 400);
        }
        if (target.protocol !== "http:" && target.protocol !== "https:") {
          return jsonError("Only http and https URLs can be fetched.", 400);
        }
        if (BLOCKED_HOST.test(target.hostname)) {
          return jsonError(
            "Private, loopback and link-local addresses are blocked by this proxy.",
            400,
          );
        }

        let response: Response;
        try {
          response = await fetch(target.toString(), {
            redirect: "follow",
            headers: {
              "User-Agent": "RupeshStudio/1.0 (+web_fetch tool)",
              Accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5",
            },
            signal: AbortSignal.timeout(20_000),
          });
        } catch (error) {
          return jsonError(
            `Could not reach ${target.hostname}. ${
              error instanceof Error ? error.message : "Network error"
            }`,
            502,
          );
        }

        if (!response.ok) {
          return jsonError(`${target.hostname} responded with ${response.status}.`, 502);
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (!/text\/|json|xml|\+xml/i.test(contentType)) {
          return jsonError(
            `That URL served "${contentType || "an unknown type"}". Only text, HTML, JSON and XML can be extracted here.`,
            415,
          );
        }

        const buffer = await response.arrayBuffer();
        const truncatedBytes = buffer.byteLength > MAX_BYTES;
        const raw = new TextDecoder("utf-8").decode(buffer.slice(0, MAX_BYTES));

        const extracted = /html/i.test(contentType) ? htmlToText(raw) : { text: raw.trim() };
        let text = extracted.text;
        const truncatedChars = text.length > MAX_CHARS;
        if (truncatedChars) text = text.slice(0, MAX_CHARS);
        if (!text) return jsonError("The page contained no extractable text.", 422);
        if (truncatedBytes || truncatedChars) {
          text += "\n\n[Truncated by the fetch proxy — the page is longer than the size cap.]";
        }

        return new Response(
          JSON.stringify({
            text,
            title: extracted.title ?? target.toString(),
            url: target.toString(),
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
