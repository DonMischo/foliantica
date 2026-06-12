"use client";

import type { Node, NodeProps } from "@xyflow/react";
import { GripVertical } from "lucide-react";

// ── Act container node ────────────────────────────────────────────────────────

export interface ActNodeData extends Record<string, unknown> {
  label: string;
}
export type ActNodeType = Node<ActNodeData, "actNode">;

export function ActNode({ data }: NodeProps<ActNodeType>) {
  return (
    <div
      className="w-full h-full rounded-xl pointer-events-none"
      style={{
        background: "hsl(var(--muted)/0.25)",
        border: "1.5px solid hsl(var(--border)/0.5)",
      }}
    >
      <div className="px-4 pt-2 pb-1 text-[11px] font-bold tracking-wide uppercase text-muted-foreground/60 select-none">
        {data.label}
      </div>
    </div>
  );
}

// ── Draggable chapter group frame (free-form mode) ───────────────────────────

export interface GroupFrameNodeData extends Record<string, unknown> {
  label: string;
  chapterId: number;
}
export type GroupFrameNodeType = Node<GroupFrameNodeData, "groupFrameNode">;

export function GroupFrameNode({ data }: NodeProps<GroupFrameNodeType>) {
  return (
    <div
      className="w-full h-full rounded-xl cursor-grab active:cursor-grabbing transition-colors hover:border-primary/40"
      style={{
        background: "hsl(var(--muted)/0.92)",
        border: "2px dashed hsl(var(--border)/0.7)",
      }}
    >
      <div className="px-2.5 pt-1.5 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground/70 select-none">
        <GripVertical className="h-3 w-3 shrink-0" />
        {data.label}
      </div>
    </div>
  );
}

// ── Chapter container node ────────────────────────────────────────────────────

export interface ChapterNodeData extends Record<string, unknown> {
  label: string;
  sceneCount: number;
}
export type ChapterNodeType = Node<ChapterNodeData, "chapterNode">;

export function ChapterNode({ data }: NodeProps<ChapterNodeType>) {
  return (
    <div
      className="w-full h-full rounded-lg pointer-events-none"
      style={{
        background: "hsl(var(--card)/0.6)",
        border: "1px solid hsl(var(--border)/0.6)",
      }}
    >
      <div className="px-3 pt-1.5 text-[10px] font-semibold text-muted-foreground/70 select-none truncate">
        {data.label}
        <span className="ml-1.5 opacity-50">({data.sceneCount})</span>
      </div>
    </div>
  );
}
