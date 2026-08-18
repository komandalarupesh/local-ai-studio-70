import { Button } from "@/components/ui/button";
import { downloadFile, type ProjectFile } from "@/lib/project-files";
import { cn } from "@/lib/utils";
import { Check, Copy, Download, Loader2, Save, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Lightweight code editor: a textarea with a synced line-number gutter, tabs
 * for open files, dirty tracking, Cmd/Ctrl+S to save and copy/download. No
 * heavy editor dependency — it stays fast and works on touch devices.
 */
export function CodeEditor({
  file,
  openFiles,
  onSelect,
  onClose,
  onSave,
  saving,
  onDirtyChange,
}: {
  file: ProjectFile | null;
  openFiles: ProjectFile[];
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onSave: (content: string) => void;
  saving: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [value, setValue] = useState(file?.content ?? "");
  const [dirty, setDirty] = useState(false);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setValue(file?.content ?? "");
    setDirty(false);
  }, [file?.id, file?.updated_at]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useLayoutEffect(() => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, [value]);

  const lineCount = value.split("\n").length;

  function save() {
    if (!file || !dirty) return;
    onSave(value);
    setDirty(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {openFiles.length > 0 && (
        <div className="scroll-slim flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
          {openFiles.map((item) => (
            <div
              key={item.id}
              className={cn(
                "group flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px]",
                item.path === file?.path
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted",
              )}
            >
              <button className="font-mono" onClick={() => onSelect(item.path)}>
                {item.path.split("/").pop()}
                {item.path === file?.path && dirty ? " •" : ""}
              </button>
              <button
                aria-label={`Close ${item.path}`}
                className="opacity-50 hover:opacity-100"
                onClick={() => onClose(item.path)}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {!file ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
          Select a file to view and edit its contents.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <span className="truncate font-mono text-xs text-foreground">{file.path}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
              {file.language}
            </span>
            <span className="text-[10px] text-muted-foreground">{lineCount} lines</span>
            <div className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                aria-label="Copy file contents"
                onClick={async () => {
                  await navigator.clipboard.writeText(value);
                  setCopied(true);
                  toast.success("Copied to clipboard");
                  window.setTimeout(() => setCopied(false), 1200);
                }}
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                aria-label="Download file"
                onClick={() => downloadFile(file.path, value)}
              >
                <Download className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant={dirty ? "default" : "secondary"}
                className="h-7 gap-1 px-2 text-xs"
                disabled={!dirty || saving}
                onClick={save}
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : dirty ? (
                  <Save className="size-3.5" />
                ) : (
                  <Check className="size-3.5" />
                )}
                {dirty ? "Save" : "Saved"}
              </Button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            <div
              ref={gutterRef}
              aria-hidden
              className="hidden shrink-0 select-none overflow-hidden border-r border-border/60 bg-muted/20 px-2 py-2 text-right font-mono text-xs leading-relaxed text-muted-foreground/70 sm:block"
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              value={value}
              spellCheck={false}
              onScroll={(event) => {
                if (gutterRef.current) {
                  gutterRef.current.scrollTop = event.currentTarget.scrollTop;
                }
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                  event.preventDefault();
                  save();
                }
                if (event.key === "Tab") {
                  event.preventDefault();
                  const el = event.currentTarget;
                  const start = el.selectionStart;
                  const next = `${value.slice(0, start)}  ${value.slice(el.selectionEnd)}`;
                  setValue(next);
                  setDirty(true);
                  window.requestAnimationFrame(() => {
                    el.selectionStart = el.selectionEnd = start + 2;
                  });
                }
              }}
              onChange={(event) => {
                setValue(event.target.value);
                setDirty(true);
              }}
              className="scroll-slim min-h-0 flex-1 resize-none bg-transparent p-2 font-mono text-xs leading-relaxed outline-none"
            />
          </div>
          <p className="shrink-0 border-t border-border px-3 py-1 text-[10px] text-muted-foreground">
            {dirty ? "Unsaved changes — " : ""}⌘/Ctrl+S saves. Tab inserts two spaces.
          </p>
        </>
      )}
    </div>
  );
}
