import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildTree, type ProjectFile, type TreeNode } from "@/lib/project-files";
import { ChevronDown, ChevronRight, File, FilePlus, Folder, Trash2 } from "lucide-react";
import { useState } from "react";

export function FileExplorer({
  files,
  activePath,
  onSelect,
  onCreate,
  onDelete,
}: {
  files: ProjectFile[];
  activePath: string | null;
  onSelect: (file: ProjectFile) => void;
  onCreate: () => void;
  onDelete: (file: ProjectFile) => void;
}) {
  const tree = buildTree(files);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Files · {files.length}
        </p>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onCreate}>
          <FilePlus className="size-3.5" /> New
        </Button>
      </div>
      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto p-2">
        {files.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            No files yet. Ask the agent to build something, or create a file manually.
          </p>
        ) : (
          tree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              depth={0}
              activePath={activePath}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TreeItem({
  node,
  depth,
  activePath,
  onSelect,
  onDelete,
}: {
  node: TreeNode;
  depth: number;
  activePath: string | null;
  onSelect: (file: ProjectFile) => void;
  onDelete: (file: ProjectFile) => void;
}) {
  const [open, setOpen] = useState(true);

  if (node.file) {
    const active = activePath === node.file.path;
    return (
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md pr-1 text-xs",
          active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
        )}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left"
          onClick={() => node.file && onSelect(node.file)}
        >
          <File className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono">{node.name}</span>
        </button>
        <button
          className="opacity-0 transition-opacity group-hover:opacity-100"
          aria-label={`Delete ${node.path}`}
          onClick={() => node.file && onDelete(node.file)}
        >
          <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        className="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-1 text-xs hover:bg-sidebar-accent/60"
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <Folder className="size-3.5 text-primary/80" />
        <span className="truncate font-mono">{node.name}</span>
      </button>
      {open &&
        node.children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            activePath={activePath}
            onSelect={onSelect}
            onDelete={onDelete}
          />
        ))}
    </div>
  );
}
