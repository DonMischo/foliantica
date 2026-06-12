"use client";

import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { User, MapPin, Sword, Gem, Scroll, Tag } from "lucide-react";
import { hexToRgba } from "./ColorPicker";

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
  item: Sword,
  relic: Gem,
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
      className="flex flex-col items-center gap-1 cursor-pointer group"
      onClick={(e) => {
        // Don't let the click bubble to the canvas — onPaneClick would close
        // the overlay (and the drawer we are about to open).
        e.stopPropagation();
        data.onOpen(data.entryId);
      }}
      title={`${data.name} — mentioned ${data.mentionCount}× · click for details`}
    >
      <Handle type="target" position={Position.Top} id="web" style={centerHandleStyle} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="web" style={centerHandleStyle} isConnectable={false} />

      <div
        className="relative flex items-center justify-center rounded-full border-2 shadow-md transition-transform group-hover:scale-110 bg-card"
        style={{
          width: 44,
          height: 44,
          borderColor: data.color,
          background: hexToRgba(data.color, 0.15),
        }}
      >
        <Icon className="h-5 w-5" style={{ color: data.color }} />
        {data.mentionCount > 1 && (
          <span
            className="absolute -top-1.5 -right-1.5 text-[9px] font-semibold rounded-full px-1 min-w-[16px] text-center text-white"
            style={{ background: data.color }}
          >
            {data.mentionCount}
          </span>
        )}
      </div>
      <span className="text-[10px] font-medium text-foreground max-w-[100px] truncate text-center bg-background/70 rounded px-1">
        {data.name}
      </span>
    </div>
  );
}
