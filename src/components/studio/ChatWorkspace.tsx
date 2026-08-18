import { Markdown } from "@/components/studio/Markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { isLocalEndpoint, streamLocalChat } from "@/lib/local-stream";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Check,
  Copy,
  Cpu,
  FileText,
  Loader2,
  Paperclip,
  RefreshCw,
  SendHorizontal,
  Settings2,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

export type ProviderRow = {
  id: string;
  name: string;
  kind: "openai" | "ollama" | "lovable";
  base_url: string;
  default_model: string;
  has_key: boolean;
};

type MessageRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model: string | null;
  attachments: { name: string; size: number }[] | null;
  created_at: string;
};

type ConversationRow = {
  id: string;
  title: string;
  provider_id: string | null;
  model: string;
  system_prompt: string;
  temperature: number;
  max_tokens: number;
};

const MAX_ATTACHMENT_CHARS = 16000;

export function ChatWorkspace({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [streamed, setStreamed] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorState, setErrorState] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<{ name: string; size: number; text: string }[]>(
    [],
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const conversationQuery = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: async (): Promise<ConversationRow> => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, title, provider_id, model, system_prompt, temperature, max_tokens")
        .eq("id", conversationId)
        .single();
      if (error) throw new Error(error.message);
      return data as ConversationRow;
    },
  });

  const messagesQuery = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: async (): Promise<MessageRow[]> => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, role, content, model, attachments, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as MessageRow[];
    },
  });

  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: async (): Promise<ProviderRow[]> => {
      const { data, error } = await supabase
        .from("providers")
        .select("id, name, kind, base_url, default_model, has_key")
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as ProviderRow[];
    },
  });

  const conversation = conversationQuery.data;
  const providers = providersQuery.data ?? [];
  const activeProvider = useMemo(
    () => providers.find((p) => p.id === conversation?.provider_id) ?? providers[0],
    [providers, conversation?.provider_id],
  );

  const modelsQuery = useQuery({
    queryKey: ["provider-models", activeProvider?.id],
    enabled: Boolean(activeProvider),
    queryFn: async (): Promise<string[]> => {
      if (!activeProvider) return [];
      if (activeProvider.kind !== "lovable" && isLocalEndpoint(activeProvider.base_url)) {
        const { listLocalModels } = await import("@/lib/local-stream");
        return listLocalModels(
          activeProvider.kind as "openai" | "ollama",
          activeProvider.base_url,
        ).catch(() => []);
      }
      const { testProviderConnection } = await import("@/lib/studio.functions");
      const result = await testProviderConnection({ data: { providerId: activeProvider.id } });
      return result.models;
    },
    staleTime: 60_000,
  });

  const updateConversation = useMutation({
    mutationFn: async (patch: Partial<ConversationRow>) => {
      const { error } = await supabase.from("conversations").update(patch).eq("id", conversationId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messagesQuery.data?.length, streamed]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, [conversationId]);

  async function runCompletion(history: { role: "user" | "assistant"; content: string }[]) {
    if (!conversation) return;
    const provider = activeProvider;
    if (!provider) {
      setErrorState("No model provider configured yet. Add one in Providers first.");
      return;
    }

    const model = conversation.model || provider.default_model;
    if (!model) {
      setErrorState("Pick a model for this conversation before sending.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsStreaming(true);
    setStreamed("");
    setErrorState(null);
    let acc = "";

    try {
      const useBrowser =
        provider.kind !== "lovable" && isLocalEndpoint(provider.base_url) && !provider.has_key;

      if (useBrowser) {
        const systemPrompt = conversation.system_prompt.trim();
        await streamLocalChat(
          {
            kind: provider.kind as "openai" | "ollama",
            baseUrl: provider.base_url,
            model,
            messages: systemPrompt
              ? [{ role: "system", content: systemPrompt }, ...history]
              : history,
            temperature: Number(conversation.temperature),
            maxTokens: conversation.max_tokens,
          },
          (delta) => {
            acc += delta;
            setStreamed(acc);
          },
          controller.signal,
        );
      } else {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error("Your session expired. Sign in again.");

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            conversationId,
            providerId: provider.id,
            model,
            systemPrompt: conversation.system_prompt,
            temperature: Number(conversation.temperature),
            maxTokens: conversation.max_tokens,
            messages: history,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? `The model backend failed (${response.status}).`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setStreamed(acc);
        }
      }

      if (!acc.trim()) throw new Error("The model returned an empty response.");

      const { error } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        user_id: (await supabase.auth.getUser()).data.user!.id,
        role: "assistant",
        content: acc,
        model,
      });
      if (error) throw new Error(error.message);
      await queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
      updateConversation.mutate({});
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (acc.trim()) {
          const userId = (await supabase.auth.getUser()).data.user?.id;
          if (userId) {
            await supabase.from("messages").insert({
              conversation_id: conversationId,
              user_id: userId,
              role: "assistant",
              content: `${acc}\n\n_[stopped]_`,
              model,
            });
            await queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
          }
        }
      } else {
        const message = error instanceof Error ? error.message : "Something went wrong.";
        setErrorState(message);
        toast.error(message);
      }
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
      setStreamed("");
    }
  }

  async function handleSend() {
    if (isStreaming) return;
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (!conversation) return;

    const attachmentBlock = attachments
      .map((a) => `\n\n### Attached file: ${a.name}\n\`\`\`\n${a.text}\n\`\`\``)
      .join("");
    const content = `${text}${attachmentBlock}`.trim();

    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) {
      setErrorState("Your session expired. Sign in again.");
      return;
    }

    const { error } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      user_id: userId,
      role: "user",
      content,
      attachments: attachments.map((a) => ({ name: a.name, size: a.size })),
    });
    if (error) {
      toast.error(error.message);
      return;
    }

    if (conversation.title === "New chat") {
      await supabase
        .from("conversations")
        .update({ title: text.slice(0, 60) || attachments[0]?.name || "New chat" })
        .eq("id", conversationId);
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
    }

    setInput("");
    setAttachments([]);
    await queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });

    const history = [
      ...(messagesQuery.data ?? [])
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content },
    ];
    await runCompletion(history);
  }

  async function handleRegenerate() {
    if (isStreaming) return;
    const messages = messagesQuery.data ?? [];
    const last = messages[messages.length - 1];
    let history = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    if (last?.role === "assistant") {
      await supabase.from("messages").delete().eq("id", last.id);
      history = history.slice(0, -1);
      await queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
    }
    if (history.length === 0) return;
    await runCompletion(history);
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const next: { name: string; size: number; text: string }[] = [];
    for (const file of Array.from(files).slice(0, 4)) {
      if (file.size > 2_000_000) {
        toast.error(`${file.name} is larger than 2 MB.`);
        continue;
      }
      const text = await file.text().catch(() => "");
      if (!text) {
        toast.error(`${file.name} could not be read as text.`);
        continue;
      }
      next.push({ name: file.name, size: file.size, text: text.slice(0, MAX_ATTACHMENT_CHARS) });
    }
    setAttachments((prev) => [...prev, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function copyMessage(id: string, content: string) {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedId(null), 1500);
  }

  if (conversationQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (conversationQuery.isError || !conversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle className="size-6 text-destructive" />
        <p className="text-sm text-muted-foreground">
          This conversation could not be loaded. It may have been deleted.
        </p>
        <Button asChild variant="secondary">
          <Link to="/studio">Start a new chat</Link>
        </Button>
      </div>
    );
  }

  const messages = messagesQuery.data ?? [];
  const models = modelsQuery.data ?? [];
  const currentModel = conversation.model || activeProvider?.default_model || "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: provider, model, parameters */}
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-surface/60 px-4 py-3 backdrop-blur">
        <div className="mr-auto flex min-w-0 items-center gap-2">
          <span className="truncate font-display text-sm font-semibold">{conversation.title}</span>
        </div>

        <Select
          value={activeProvider?.id ?? ""}
          onValueChange={(value) => {
            const provider = providers.find((p) => p.id === value);
            updateConversation.mutate({
              provider_id: value,
              model: provider?.default_model ?? "",
            });
          }}
        >
          <SelectTrigger className="h-9 w-[180px] text-xs">
            <SelectValue placeholder="Provider" />
          </SelectTrigger>
          <SelectContent>
            {providers.map((provider) => (
              <SelectItem key={provider.id} value={provider.id} className="text-xs">
                {provider.kind === "ollama" ? "🖥 " : provider.kind === "lovable" ? "☁ " : "⚙ "}
                {provider.name}
              </SelectItem>
            ))}
            {providers.length === 0 && (
              <div className="p-2 text-xs text-muted-foreground">No providers yet</div>
            )}
          </SelectContent>
        </Select>

        {models.length > 0 ? (
          <Select
            value={models.includes(currentModel) ? currentModel : ""}
            onValueChange={(value) => updateConversation.mutate({ model: value })}
          >
            <SelectTrigger className="h-9 w-[200px] text-xs">
              <SelectValue placeholder={currentModel || "Model"} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {models.map((model) => (
                <SelectItem key={model} value={model} className="text-xs">
                  {model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            defaultValue={currentModel}
            key={currentModel}
            placeholder="model name"
            onBlur={(event) => updateConversation.mutate({ model: event.target.value })}
            className="h-9 w-[200px] text-xs"
          />
        )}

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary" size="sm" className="h-9 gap-1.5">
              <Settings2 className="size-3.5" /> Tuning
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[340px] space-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                System prompt
              </Label>
              <Textarea
                defaultValue={conversation.system_prompt}
                rows={5}
                className="mt-2 text-xs"
                onBlur={(event) => updateConversation.mutate({ system_prompt: event.target.value })}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Defines your assistant's behaviour for this conversation.
              </p>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs">
                <Label>Temperature</Label>
                <span className="font-mono text-primary">
                  {Number(conversation.temperature).toFixed(2)}
                </span>
              </div>
              <Slider
                className="mt-2"
                min={0}
                max={2}
                step={0.05}
                value={[Number(conversation.temperature)]}
                onValueChange={([value]) =>
                  updateConversation.mutate({ temperature: value ?? 0.7 })
                }
              />
            </div>
            <div>
              <div className="flex items-center justify-between text-xs">
                <Label>Max tokens</Label>
                <span className="font-mono text-primary">{conversation.max_tokens}</span>
              </div>
              <Slider
                className="mt-2"
                min={128}
                max={16384}
                step={128}
                value={[conversation.max_tokens]}
                onValueChange={([value]) =>
                  updateConversation.mutate({ max_tokens: value ?? 2048 })
                }
              />
            </div>
          </PopoverContent>
        </Popover>
      </header>

      {/* Messages */}
      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          {messages.length === 0 && !isStreaming && (
            <div className="glass-panel mt-6 p-6 text-center">
              <Cpu className="mx-auto size-6 text-primary" />
              <h2 className="mt-3 font-display text-lg font-semibold">Your assistant is ready</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                Send a message to run it on{" "}
                <span className="text-foreground">{activeProvider?.name ?? "a provider"}</span>
                {currentModel ? (
                  <>
                    {" "}
                    with <span className="font-mono text-primary">{currentModel}</span>
                  </>
                ) : null}
                . Adjust the system prompt, temperature and token limit under Tuning at any time.
              </p>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "group relative rounded-xl border px-4 py-3",
                message.role === "user"
                  ? "border-primary/25 bg-primary/10"
                  : "border-border bg-panel",
              )}
            >
              <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                {message.role === "user" ? "You" : "Assistant"}
                {message.model && <span className="font-mono normal-case">{message.model}</span>}
              </div>
              <Markdown content={message.content} />
              {message.attachments && message.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {message.attachments.map((file) => (
                    <span
                      key={file.name}
                      className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      <FileText className="size-3" /> {file.name}
                    </span>
                  ))}
                </div>
              )}
              <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={() => copyMessage(message.id, message.content)}
                  aria-label="Copy message"
                >
                  {copiedId === message.id ? (
                    <Check className="size-3.5 text-primary" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </Button>
              </div>
            </div>
          ))}

          {isStreaming && (
            <div className="rounded-xl border border-border bg-panel px-4 py-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                Assistant
                <Loader2 className="size-3 animate-spin text-primary" />
              </div>
              {streamed ? (
                <Markdown content={streamed} />
              ) : (
                <p className="text-sm text-muted-foreground">Waiting for the first tokens…</p>
              )}
            </div>
          )}

          {errorState && (
            <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="space-y-2">
                <p className="text-foreground">{errorState}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={handleRegenerate}>
                    <RefreshCw className="size-3.5" /> Retry
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <Link to="/providers">
                      <Terminal className="size-3.5" /> Check providers
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border bg-surface/70 px-4 py-4 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl space-y-2">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((file, index) => (
                <span
                  key={`${file.name}-${index}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-[11px]"
                >
                  <FileText className="size-3" />
                  {file.name}
                  <button
                    onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="glass-panel flex items-end gap-2 p-2">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".txt,.md,.json,.csv,.log,.yml,.yaml,.ts,.tsx,.js,.jsx,.py,.sql,.html,.css"
              className="hidden"
              onChange={(event) => handleFiles(event.target.files)}
            />
            <Button
              size="icon"
              variant="ghost"
              className="mb-0.5 shrink-0"
              onClick={() => fileRef.current?.click()}
              aria-label="Attach text file"
            >
              <Paperclip className="size-4" />
            </Button>
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
              placeholder="Ask your assistant anything… (Shift + Enter for a new line)"
              className="max-h-40 min-h-11 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
            {isStreaming ? (
              <Button
                size="icon"
                variant="destructive"
                className="mb-0.5 shrink-0"
                onClick={() => abortRef.current?.abort()}
                aria-label="Stop generating"
              >
                <Square className="size-4" />
              </Button>
            ) : (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  className="mb-0.5 shrink-0"
                  disabled={messages.length === 0}
                  onClick={handleRegenerate}
                  aria-label="Regenerate last answer"
                >
                  <RefreshCw className="size-4" />
                </Button>
                <Button
                  size="icon"
                  className="mb-0.5 shrink-0"
                  onClick={handleSend}
                  disabled={!input.trim() && attachments.length === 0}
                  aria-label="Send message"
                >
                  <SendHorizontal className="size-4" />
                </Button>
              </>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {activeProvider
              ? activeProvider.kind === "ollama" || isLocalEndpoint(activeProvider.base_url)
                ? "Local endpoint — requests run straight from your browser to your machine."
                : "Requests are proxied server-side; your API key never reaches the browser."
              : "Add a model provider to start chatting."}
          </p>
        </div>
      </div>
    </div>
  );
}
