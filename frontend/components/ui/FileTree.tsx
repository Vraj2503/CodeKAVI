"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

import type { FileNode } from "../../lib/api";

interface FileTreeProps {
  data: FileNode[];
  className?: string;
}

/**
 * The repository tree.
 *
 * Two things changed from the old one. Folders no longer animate open — a tree
 * is expanded and collapsed dozens of times in a session, and the old
 * `max-height: children × 100px` guess both janked and clipped any folder with
 * more than a screenful in it. And the per-extension glyph palette is gone:
 * eleven colors that encoded nothing the filename didn't already say.
 */
function FileItem({ node, depth }: { node: FileNode; depth: number }) {
  const [isOpen, setIsOpen] = useState(depth < 1);

  const isFolder = node.type === "dir";
  const children = isFolder ? (node.children ?? []) : [];

  return (
    <li>
      <div
        role={isFolder ? "button" : undefined}
        tabIndex={isFolder ? 0 : undefined}
        onClick={() => isFolder && setIsOpen((open) => !open)}
        onKeyDown={(e) => {
          if (isFolder && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setIsOpen((open) => !open);
          }
        }}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        className={cn(
          "group flex items-center gap-1.5 rounded py-[3px] pr-2",
          "transition-colors duration-150 ease-out",
          isFolder && "cursor-pointer hover:bg-accent/60",
        )}
      >
        <span className="grid h-3.5 w-3.5 flex-shrink-0 place-items-center">
          {isFolder ? (
            <ChevronRight
              size={12}
              strokeWidth={2}
              className={cn(
                "text-muted-foreground transition-transform duration-150 ease-out",
                isOpen && "rotate-90",
              )}
            />
          ) : (
            <span className="h-[3px] w-[3px] rounded-full bg-muted-foreground/40" />
          )}
        </span>

        <span
          className={cn(
            "truncate font-mono text-[12px]",
            isFolder
              ? "text-foreground/90"
              : "text-muted-foreground group-hover:text-foreground",
          )}
        >
          {node.name}
        </span>
      </div>

      {isFolder && isOpen && children.length > 0 && (
        <ul>
          {children.map((child) => (
            <FileItem key={child.name} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FileTree({ data, className }: FileTreeProps) {
  return (
    <ul className={cn("select-none", className)}>
      {data.map((node) => (
        <FileItem key={node.name} node={node} depth={0} />
      ))}
    </ul>
  );
}
