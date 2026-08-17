import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectFile } from "@/lib/project-files";
import { Check, Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";

export function CodeEditor({
  file,
  onSave,
  saving,
}: {
  file: ProjectFile | null;
  onSave: (content: string) => void;
  saving: boolean;
}) {
  const [value, setValue] = useState(file?.content ?? "");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setValue(file?.content ?? "");
    setDirty(false);
  }, [file?.id, file?.updated_at]);

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        Select a file to view and edit its contents.
      </div>
    );
  }

  const lines = value.split("\n").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="truncate font-mono text-xs text-foreground">{file.path}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
          {file.language}
        </span>
        <span className="text-[10px] text-muted-foreground">{lines} lines</span>
        <Button
          size="sm"
          variant={dirty ? "default" : "secondary"}
          className="ml-auto h-7 gap-1 px-2 text-xs"
          disabled={!dirty || saving}
          onClick={() => {
            onSave(value);
            setDirty(false);
          }}
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
      <Textarea
        value={value}
        spellCheck={false}
        onChange={(event) => {
          setValue(event.target.value);
          setDirty(true);
        }}
        className="scroll-slim min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent font-mono text-xs leading-relaxed focus-visible:ring-0"
      />
    </div>
  );
}
