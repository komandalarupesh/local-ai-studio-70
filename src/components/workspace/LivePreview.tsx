import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buildPreviewDocument, type ProjectFile } from "@/lib/project-files";
import { ExternalLink, Info, Monitor, RefreshCw, Smartphone } from "lucide-react";
import { useMemo, useState } from "react";

/**
 * Renders the project's HTML entry point inside a sandboxed iframe with
 * relative CSS/JS inlined. The sandbox deliberately omits allow-same-origin,
 * so generated code cannot reach this app's storage, cookies or session.
 */
export function LivePreview({ files }: { files: ProjectFile[] }) {
  const [nonce, setNonce] = useState(0);
  const [narrow, setNarrow] = useState(false);
  const doc = useMemo(() => buildPreviewDocument(files), [files]);

  if (!doc) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Monitor className="size-5 text-muted-foreground" />
        <p className="max-w-xs text-xs text-muted-foreground">
          Live preview needs an <span className="font-mono">index.html</span> in this project. App
          Builder and Website Builder modes create one for you.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Live preview</p>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-1.5" aria-label="Preview limits">
              <Info className="size-3.5 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[300px] space-y-2 text-xs">
            <p className="font-medium">What the preview can and cannot do</p>
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              <li>Static HTML, CSS and JavaScript run in a locked-down sandbox.</li>
              <li>
                Relative <span className="font-mono">.css</span> and{" "}
                <span className="font-mono">.js</span> files are inlined; other local assets
                (images, fonts, JSON) cannot be served.
              </li>
              <li>
                No bundler or package installs — <span className="font-mono">npm</span> imports,
                JSX and TypeScript will not execute.
              </li>
              <li>
                The sandbox has no access to this app's origin, storage or your session, and cannot
                write to your account.
              </li>
            </ul>
          </PopoverContent>
        </Popover>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            aria-label="Toggle device width"
            onClick={() => setNarrow((v) => !v)}
          >
            {narrow ? <Monitor className="size-3.5" /> : <Smartphone className="size-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            aria-label="Reload preview"
            onClick={() => setNonce((n) => n + 1)}
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            aria-label="Open preview in a new tab"
            onClick={() => {
              const blob = new Blob([doc], { type: "text/html" });
              const url = URL.createObjectURL(blob);
              window.open(url, "_blank", "noopener,noreferrer");
              window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
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
          sandbox="allow-scripts allow-forms allow-modals"
          referrerPolicy="no-referrer"
          className="mx-auto h-full w-full rounded-lg border border-border bg-white"
          style={narrow ? { maxWidth: 390 } : undefined}
        />
      </div>
    </div>
  );
}
