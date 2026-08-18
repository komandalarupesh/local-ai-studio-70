import { Markdown } from "@/components/studio/Markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { AgentMessage } from "@/lib/agent";
import { stripFileBlocks } from "@/lib/project-files";
import {
  Check,
  Copy,
  Layers,
  Loader2,
  RefreshCw,
  SendHorizontal,
  Square,
  Wand2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function AgentPanel({
  messages,
  streamed,
  busy,
  status,
  canPlan,
  onSend,
  onPlan,
  onRegenerate,
  onStop,
  emptyHint,
}: {
  messages: AgentMessage[];
  streamed: string;
  busy: boolean;
  status: string | null;
  canPlan: boolean;
  onSend: (text: string) => void;
  onPlan: (text: string) => void;
  onRegenerate: () => void;
  onStop: () => void;
  emptyHint: string;
}) {
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, streamed]);

  const visible = messages.filter((m) => m.role !== "system");
  const compactedCount = visible.filter((m) => m.compacted).length;

  function submit(mode: "send" | "plan") {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    if (mode === "plan") onPlan(text);
    else onSend(text);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {compactedCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface/50 px-3 py-2 text-[11px] text-muted-foreground">
              <Layers className="size-3.5 text-primary" />
              {compactedCount} earlier message{compactedCount === 1 ? "" : "s"} folded into a
              running summary so this thread can keep growing.
            </div>
          )}

          {visible.length === 0 && !busy && (
            <div className="glass-panel p-5 text-center text-sm text-muted-foreground">
              {emptyHint}
            </div>
          )}

          {visible
            .filter((m) => !m.compacted)
            .map((message) => (
              <div
                key={message.id}
                className={cn(
                  "group relative rounded-xl border px-4 py-3 text-sm",
                  message.role === "user"
                    ? "border-primary/25 bg-primary/10"
                    : "border-border/70 bg-surface/50",
                )}
              >
                <div className="mb-1.5 flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                  {message.role === "user" ? "You" : "Assistant"}
                  {message.model && <span className="font-mono normal-case">{message.model}</span>}
                  <button
                    className="ml-auto opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={async () => {
                      await navigator.clipboard.writeText(message.content);
                      setCopied(message.id);
                      setTimeout(() => setCopied(null), 1500);
                    }}
                    aria-label="Copy message"
                  >
                    {copied === message.id ? (
                      <Check className="size-3.5 text-primary" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </button>
                </div>
                {message.role === "assistant" ? (
                  <Markdown content={stripFileBlocks(message.content) || message.content} />
                ) : (
                  <p className="whitespace-pre-wrap">{message.content}</p>
                )}
              </div>
            ))}

          {busy && (
            <div className="rounded-xl border border-border/70 bg-surface/50 px-4 py-3 text-sm">
              <div className="mb-1.5 flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                <Loader2 className="size-3 animate-spin text-primary" />
                {status ?? "Working"}
              </div>
              {streamed ? (
                <Markdown content={stripFileBlocks(streamed) || streamed} />
              ) : (
                <p className="text-xs text-muted-foreground">Waiting for the first tokens…</p>
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-border bg-surface/60 px-4 py-3 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl">
          <Textarea
            value={input}
            rows={3}
            placeholder="Describe what to build, ask a question, or paste an error…"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit("send");
              }
            }}
            className="resize-none text-sm"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="mr-auto text-[11px] text-muted-foreground">⌘/Ctrl + Enter to send</p>
            {canPlan && (
              <Button
                variant="secondary"
                size="sm"
                className="gap-1.5"
                disabled={busy || !input.trim()}
                onClick={() => submit("plan")}
              >
                <Wand2 className="size-3.5" /> Plan steps
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              disabled={busy || visible.length === 0}
              onClick={onRegenerate}
            >
              <RefreshCw className="size-3.5" /> Regenerate
            </Button>
            {busy ? (
              <Button variant="destructive" size="sm" className="gap-1.5" onClick={onStop}>
                <Square className="size-3.5" /> Stop
              </Button>
            ) : (
              <Button
                size="sm"
                className="gap-1.5"
                disabled={!input.trim()}
                onClick={() => submit("send")}
              >
                <SendHorizontal className="size-3.5" /> Send
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
