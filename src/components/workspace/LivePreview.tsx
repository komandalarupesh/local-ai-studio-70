import { Button } from "@/components/ui/button";
import { buildPreviewDocument, type ProjectFile } from "@/lib/project-files";
import { ExternalLink, Monitor, RefreshCw, Smartphone } from "lucide-react";
import { useMemo, useState } from "react";

export function LivePreview({ files }: { files: ProjectFile[] }) {
  const [nonce, setNonce] = useState(0);
  const [narrow, setNarrow] = useState(false);
  const doc = useMemo(() => buildPreviewDocument(files), [files]);

  if (!doc) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Monitor className="size-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Live preview needs an <span className="font-mono">index.html</span> in this project.
          App Builder and Website Builder modes create one for you.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Live preview</p>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setNarrow((v) => !v)}
          >
            {narrow ? <Monitor className="size-3.5" /> : <Smartphone className="size-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setNonce((n) => n + 1)}
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              const blob = new Blob([doc], { type: "text/html" });
              window.open(URL.createObjectURL(blob), "_blank", "noopener");
            }}
          >
            <ExternalLink className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-background p-3">
        <iframe
          key={nonce}
          title="Project preview"
          srcDoc={doc}
          sandbox="allow-scripts allow-forms allow-modals allow-popups"
          className="mx-auto h-full w-full rounded-lg border border-border bg-white"
          style={narrow ? { maxWidth: 390 } : undefined}
        />
      </div>
    </div>
  );
}
