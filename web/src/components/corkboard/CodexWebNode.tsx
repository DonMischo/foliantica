"use client";

import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { User, MapPin, Package, Scroll, Tag } from "lucide-react";

// ── Node data contract ────────────────────────────────────────────────────────

export interface CodexWebNodeData extends Record<string, unknown> {
  entryId: number;
  name: string;
  entryType: string;
  color: string;
  mentionCount: number;
  onOpen: (entryId: number) => void;
}

export type CodexWebNodeType = Node<CodexWebNodeData, "codexWebNode">;

const TYPE_ICONS: Record<string, typeof User> = {
  character: User,
  location: MapPin,
  item: Package,
  lore: Scroll,
};

/** Hidden handle centered on the node so spider-web edges anchor at its middle. */
const centerHandleStyle: React.CSSProperties = {
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: 1,
  height: 1,
  minWidth: 1,
  minHeight: 1,
  opacity: 0,
  pointerEvents: "none",
  border: "none",
};

export function CodexWebNode({ data }: NodeProps<CodexWebNodeType>) {
  const Icon = TYPE_ICONS[data.entryType] ?? Tag;
  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border bg-card shadow-sm cursor-pointer group hover:bg-secondary/50 transition-colors"
      onClick={(e) => {
        e.stopPropagation();
        data.onOpen(data.entryId);
      }}
      title={`${data.name} — mentioned ${data.mentionCount}× · click for details`}
    >
      <Handle type="target" position={Position.Top} id="web" style={centerHandleStyle} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="web" style={centerHandleStyle} isConnectable={false} />

      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: data.color }} />
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-sm font-medium truncate max-w-[120px] text-card-foreground">{data.name}</span>
      {data.mentionCount > 1 && (
        <span
          className="text-[9px] font-semibold rounded-full px-1 min-w-[16px] text-center text-white shrink-0"
          style={{ background: data.color }}
        >
          {data.mentionCount}
        </span>
      )}
    </div>
  );
}
