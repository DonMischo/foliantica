"use client";

import { useState } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronUp, Pencil, Waypoints } from "lucide-react";
import { SingleCard } from "./SceneCard";
import { hexToRgba } from "./ColorPicker";
import { CONNECTION_TYPES } from "./connectionTypes";
import type { CorkboardScene } from "@/types";

// ── Node data contract ────────────────────────────────────────────────────────

export interface SceneNodeData extends Record<string, unknown> {
  scenes: CorkboardScene[];
  projectId: number;
  sceneColors: Record<number, string | null>;
  colColor: string;
  showSynopsis: boolean;
  compact: boolean;
  generatingId: number | null;
  availableSubplots: string[];
  availableBeats: string[];
  stackName?: string;
  onTitleChange: (id: number, title: string) => void;
  onSynopsisChange: (id: number, syn: string | null) => void;
  onGenerateSynopsis: (id: number) => Promise<string>;
  onColorChange: (id: number, color: string | null) => void;
  onSubplotChange: (ids: number[], subplot: string | null) => void;
  onBeatChange: (ids: number[], beat: string | null) => void;
  onUnstack: (sceneId: number) => void;
  onStackRename: (stackGroup: string, name: string) => void;
  onCodexWeb: (sceneId: number) => void;
}

export type SceneNodeType = Node<SceneNodeData, "sceneNode">;

// ── Stack display (no dnd-kit dependency) ────────────────────────────────────

interface StackDisplayProps {
  scenes: CorkboardScene[];
  projectId: number;
  sceneColors: Record<number, string | null>;
  colColor: string;
  showSynopsis: boolean;
  compact: boolean;
  generatingId: number | null;
  availableSubplots: string[];
  stackName: string;
  onTitleChange: (id: number, title: string) => void;
  onSynopsisChange: (id: number, syn: string | null) => void;
  onGenerateSynopsis: (id: number) => Promise<string>;
  onColorChange: (id: number, color: string | null) => void;
  onSubplotChange: (ids: number[], subplot: string | null) => void;
  onUnstack: (sceneId: number) => void;
  onStackRename: (stackGroup: string, name: string) => void;
}

function StackDisplay({
  scenes, projectId, sceneColors, showSynopsis, compact, colColor,
  generatingId, availableSubplots, stackName,
  onTitleChange, onSynopsisChange, onGenerateSynopsis, onColorChange,
  onSubplotChange, onUnstack, onStackRename,
}: StackDisplayProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(stackName);

  const saveStackName = (name: string) => {
    const sg = scenes[0]?.stack_group ?? "";
    if (sg) onStackRename(sg, name);
    setEditingName(false);
  };

  const displayName = stackName || `Stack (${scenes.length})`;

  if (collapsed) {
    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-card shadow-sm cursor-default"
        style={{ borderLeftColor: hexToRgba(colColor, 0.5), borderLeftWidth: 3, minWidth: compact ? 140 : 180 }}
      >
        {/* Stack name (click to edit) */}
        {editingName ? (
          <input
            autoFocus
            className="nodrag flex-1 text-xs bg-transparent border-b border-primary outline-none"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => saveStackName(draftName)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveStackName(draftName);
              if (e.key === "Escape") { setEditingName(false); }
            }}
          />
        ) : (
          <span
            className="flex-1 text-xs font-medium truncate cursor-text"
            onClick={() => { setDraftName(stackName); setEditingName(true); }}
          >
            {displayName}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground/50">{scenes.length}</span>
        <button
          className="nodrag text-muted-foreground/70 hover:text-foreground"
          onClick={() => setCollapsed(false)}
          title="Expand stack"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0" style={{ minWidth: compact ? 140 : 180 }}>
      {/* Stack header */}
      <div
        className="flex items-center gap-1 px-2 py-1 rounded-t-md border border-b-0 border-border bg-muted/30"
        style={{ borderLeftColor: hexToRgba(colColor, 0.5), borderLeftWidth: 3 }}
      >
        {editingName ? (
          <input
            autoFocus
            className="nodrag flex-1 text-xs bg-transparent border-b border-primary outline-none"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => saveStackName(draftName)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveStackName(draftName);
              if (e.key === "Escape") { setEditingName(false); }
            }}
          />
        ) : (
          <span className="flex-1 text-[11px] font-semibold text-muted-foreground truncate">
            {displayName}
          </span>
        )}
        <button
          className="nodrag text-muted-foreground/30 hover:text-muted-foreground/70 p-0.5"
          onClick={() => { setDraftName(stackName); setEditingName(true); }}
          title="Rename stack"
        >
          <Pencil className="h-2.5 w-2.5" />
        </button>
        <button
          className="nodrag text-muted-foreground/70 hover:text-foreground"
          onClick={() => setCollapsed(true)}
          title="Collapse stack"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
      </div>

      {/* Scene cards in the stack */}
      {scenes.map((scene: CorkboardScene, i: number) => (
        <div
          key={scene.id}
          className="relative border border-t-0 border-border"
          style={{
            borderLeftColor: hexToRgba(colColor, 0.3),
            borderLeftWidth: 3,
            marginTop: i > 0 ? -4 : 0,
            zIndex: scenes.length - i,
          }}
        >
          <SingleCard
            scene={scene}
            projectId={projectId}
            color={sceneColors[scene.id] ?? null}
            dragHandleProps={{ "data-drag": "handle" } as React.HTMLAttributes<HTMLButtonElement>}
            onTitleChange={onTitleChange}
            onSynopsisChange={onSynopsisChange}
            onGenerateSynopsis={onGenerateSynopsis}
            onColorChange={onColorChange}
            isGenerating={generatingId === scene.id}
            showSynopsis={showSynopsis}
            compact={compact}
          />
          {/* Unstack button */}
          <button
            className="nodrag absolute top-1 right-1 text-[9px] text-muted-foreground/30 hover:text-muted-foreground/70 px-1 rounded"
            onClick={() => onUnstack(scene.id)}
            title="Move out of stack"
          >
            ↑
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Beat selector ─────────────────────────────────────────────────────────────

function BeatChip({
  current, available, onChange,
}: {
  current: string | null;
  available: string[];
  onChange: (val: string | null) => void;
}) {
  if (available.length === 0) return null;
  return (
    <select
      className="nodrag text-[9px] bg-transparent border border-border/30 rounded px-1 py-0.5 text-muted-foreground/50 hover:text-muted-foreground cursor-pointer outline-none max-w-[80px] truncate"
      value={current ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      title="Assign beat"
    >
      <option value="">— beat —</option>
      {available.map((b) => (
        <option key={b} value={b}>{b}</option>
      ))}
    </select>
  );
}

// ── Subplot selector ──────────────────────────────────────────────────────────

function SubplotChip({
  current, available, onChange,
}: {
  current: string | null;
  available: string[];
  onChange: (val: string | null) => void;
}) {
  return (
    <select
      className="nodrag text-[9px] bg-transparent border border-border/30 rounded px-1 py-0.5 text-muted-foreground/50 hover:text-muted-foreground cursor-pointer outline-none max-w-[90px] truncate"
      value={current ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      title="Change subplot"
    >
      <option value="">Main Plot</option>
      {available.map((sp) => (
        <option key={sp} value={sp}>{sp}</option>
      ))}
    </select>
  );
}

// ── Typed cable handles ───────────────────────────────────────────────────────

/** Colored connection sockets — targets on the left edge, sources on the right.
 *  Handle ids encode the cable type: `tgt-<type>` / `src-<type>`. */
function TypedHandles() {
  const n = CONNECTION_TYPES.length;
  return (
    <>
      {CONNECTION_TYPES.map((t, i) => {
        const top = `${((i + 1) / (n + 1)) * 100}%`;
        const common: React.CSSProperties = {
          top,
          width: 9,
          height: 9,
          border: "2px solid hsl(var(--card))",
          background: t.color,
        };
        return (
          <span key={t.id}>
            <Handle
              type="target"
              position={Position.Left}
              id={`tgt-${t.id}`}
              style={{ ...common, left: -5 }}
              title={`${t.label} (in)`}
            />
            <Handle
              type="source"
              position={Position.Right}
              id={`src-${t.id}`}
              style={{ ...common, right: -5 }}
              title={`${t.label} (out)`}
            />
          </span>
        );
      })}
    </>
  );
}

/** Hidden centered source handle — anchor for codex spider-web edges. */
const webHandleStyle: React.CSSProperties = {
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

// ── Custom React Flow node ────────────────────────────────────────────────────

export function SceneNode({ data }: NodeProps<SceneNodeType>) {
  const {
    scenes, projectId, sceneColors, colColor, showSynopsis, compact,
    generatingId, availableSubplots, availableBeats, stackName,
    onTitleChange, onSynopsisChange, onGenerateSynopsis, onColorChange,
    onSubplotChange, onBeatChange, onUnstack, onStackRename, onCodexWeb,
  } = data;

  const isStack = scenes.length > 1;
  const representative = scenes[0];
  const sceneIds = scenes.map((s) => s.id);

  return (
    <div
      className="nowheel flex flex-col gap-0.5 rounded-lg relative"
      style={{
        borderLeft: `3px solid ${hexToRgba(colColor, 0.7)}`,
        background: "hsl(var(--card))",
      }}
    >
      {/* Sequence handles (top/bottom) — derived story-order thread */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-2 !h-2 !bg-border !border-border/50"
      />

      {/* Typed cable sockets (left/right) */}
      <TypedHandles />

      {/* Spider-web anchor (invisible, centered) */}
      <Handle type="source" position={Position.Bottom} id="web" style={webHandleStyle} isConnectable={false} />

      {/* Card body */}
      {isStack ? (
        <StackDisplay
          scenes={scenes}
          projectId={projectId}
          sceneColors={sceneColors}
          colColor={colColor}
          showSynopsis={showSynopsis}
          compact={compact}
          generatingId={generatingId}
          availableSubplots={availableSubplots}
          stackName={stackName ?? ""}
          onTitleChange={onTitleChange}
          onSynopsisChange={onSynopsisChange}
          onGenerateSynopsis={onGenerateSynopsis}
          onColorChange={onColorChange}
          onSubplotChange={onSubplotChange}
          onUnstack={onUnstack}
          onStackRename={onStackRename}
        />
      ) : (
        <SingleCard
          scene={representative}
          projectId={projectId}
          color={sceneColors[representative.id] ?? null}
          dragHandleProps={{ "data-drag": "handle" } as React.HTMLAttributes<HTMLButtonElement>}
          onTitleChange={onTitleChange}
          onSynopsisChange={onSynopsisChange}
          onGenerateSynopsis={onGenerateSynopsis}
          onColorChange={onColorChange}
          isGenerating={generatingId === representative.id}
          showSynopsis={showSynopsis}
          compact={compact}
        />
      )}

      {/* Footer: codex web + beat + subplot selector */}
      <div className="flex items-center justify-between pl-1 pr-1 bg-card rounded-b-md">
        <button
          className="nodrag text-muted-foreground/30 hover:text-primary transition-colors"
          onClick={() => onCodexWeb(representative.id)}
          title="Show codex web — characters, places & items in this scene"
        >
          <Waypoints className="h-3 w-3" />
        </button>
        <BeatChip
          current={representative.beat ?? null}
          available={availableBeats}
          onChange={(val) => onBeatChange(sceneIds, val)}
        />
        <SubplotChip
          current={representative.subplot}
          available={availableSubplots}
          onChange={(val) => onSubplotChange(sceneIds, val)}
        />
      </div>

      {/* Sequence source handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2 !h-2 !bg-border !border-border/50"
      />
    </div>
  );
}
