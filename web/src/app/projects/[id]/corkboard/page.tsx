"use client";

import { useState, useCallback, useEffect, useRef, useMemo, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import {
  ReactFlow,
  Background, Controls, MiniMap, Panel,
  useNodesState, useEdgesState,
  MarkerType,
} from "@xyflow/react";
import type { Node, Edge, OnNodeDrag, OnConnect, OnBeforeDelete, OnReconnect } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Plus, X, ZoomOut, Layers2, TreePine, Group, Link2, BookOpen, GitBranch,
  Filter, Check, Undo2, ExternalLink, Menu,
} from "lucide-react";
import {
  useCorkboard, useUpdateSceneSynopsis, useGenerateSynopsis,
  useMoveScene, useCodexEntries, useProjectStructure, useProject, useUpdateProject,
  useUpdateCorkboardPrefs, useCreateConnection, useDeleteConnection,
  useSetGlobalOrder, useRelationsGraph, useSceneMentionStats,
} from "@/store/queries";
import { projectsApi, scenesApi } from "@/lib/api";
import { SceneNode } from "@/components/corkboard/SceneNode";
import type { SceneNodeType, SceneNodeData } from "@/components/corkboard/SceneNode";
import { ActNode, ChapterNode, GroupFrameNode } from "@/components/corkboard/HierarchyNodes";
import type { ActNodeType, ChapterNodeType, GroupFrameNodeType } from "@/components/corkboard/HierarchyNodes";
import { CodexWebNode } from "@/components/corkboard/CodexWebNode";
import type { CodexWebNodeType } from "@/components/corkboard/CodexWebNode";
import { ColorPicker, MAIN_COLOR, SUBPLOT_PALETTE } from "@/components/corkboard/ColorPicker";
import { CONNECTION_TYPES, connectionTypeDef } from "@/components/corkboard/connectionTypes";
import type { CorkboardScene, CorkboardAct, CorkboardLayout, SceneConnection, CodexEntry } from "@/types";
import { PLOT_TEMPLATES } from "@/lib/plotTemplates";
import { useColColorsStore } from "@/store/colColors";
import { BOARD_STYLES } from "@/components/corkboard/boardStyles";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAIN_COL = "__main__";
const CARD_W    = 230;
const CARD_W_SM = 160;
const COL_GAP   = 100;
const ROW_H     = 200;  // approximate card height + gap

// Group frame geometry
const FRAME_PAD    = 24;   // padding around scenes inside a chapter frame
const SCENE_H_FULL = 180;  // approx card height (normal mode)
const SCENE_H_CMP  = 130;  // approx card height (compact mode)

// Cascade layout geometry
const CDX = 12;   // x offset per scene in a pile
const CDY = 36;   // y offset per scene in a pile
const CH_PAD_TOP = 36;   // chapter node top padding (for label)
const CH_PAD_X   = 14;   // chapter node horizontal padding
const CH_PAD_BOT = 14;   // chapter node bottom padding
const CH_GAP     = 18;   // gap between chapters in an act
const ACT_PAD_TOP = 44;  // act node top padding (for label)
const ACT_PAD_X   = 16;  // act node horizontal padding
const ACT_PAD_BOT = 16;  // act node bottom padding
const ACT_GAP     = 36;  // gap between acts

const NO_BEAT = "__none__";  // filter key for scenes without a beat

// ── Legacy localStorage helpers ───────────────────────────────────────────────
// Board state now lives server-side (scenes.card_color + project corkboard_prefs).
// These readers remain only to migrate boards created before that change.

function getLegacySceneColor(id: number): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(`lw_scene_hex_${id}`) ?? null;
}

function getColColors(pid: number): Record<string, string> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(`lw_col_colors_${pid}`) ?? "{}"); }
  catch { return {}; }
}
function saveColColors(pid: number, m: Record<string, string>) {
  // local cache — other views (sidebar, plot) read this synchronously
  localStorage.setItem(`lw_col_colors_${pid}`, JSON.stringify(m));
}

function getStoredSubplots(pid: number): string[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(`lw_subplots_${pid}`) ?? "[]"); }
  catch { return []; }
}
function saveStoredSubplots(pid: number, sp: string[]) {
  localStorage.setItem(`lw_subplots_${pid}`, JSON.stringify(sp));
}

function getLegacyBeatTemplateId(pid: number): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(`lw_beat_tpl_${pid}`) ?? null;
}

function getLegacyStackNames(scenes: CorkboardScene[]): Record<string, string> {
  if (typeof window === "undefined") return {};
  const names: Record<string, string> = {};
  for (const s of scenes) {
    if (s.stack_group && !(s.stack_group in names)) {
      const n = localStorage.getItem(`lw_stack_name_${s.stack_group}`);
      if (n) names[s.stack_group] = n;
    }
  }
  return names;
}

// ── Color helpers ─────────────────────────────────────────────────────────────

function defaultColColor(col: string, allCols: string[]): string {
  if (col === MAIN_COL) return MAIN_COLOR;
  const idx = allCols.filter((c) => c !== MAIN_COL).indexOf(col);
  return SUBPLOT_PALETTE[idx % SUBPLOT_PALETTE.length];
}

function resolveColColor(col: string, allCols: string[], stored: Record<string, string>, codexMap: Record<string, string>): string {
  // Stored override wins (set on creation or changed manually). Codex color is the
  // seed used when the subplot is first created — after that the user can change it freely.
  if (stored[col]) return stored[col];
  const codexColor = codexMap[col.toLowerCase()];
  if (codexColor) return codexColor;
  return defaultColColor(col, allCols);
}

// ── Node group (single scene or a stack) ─────────────────────────────────────

interface NodeGroup {
  id: string;            // RF node id
  scenes: CorkboardScene[];
  subplot: string | null;
  globalOrder: number;   // representative (minimum) global_order
}

function buildNodeGroups(scenes: CorkboardScene[]): NodeGroup[] {
  const stacks = new Map<string, CorkboardScene[]>();
  const singles: CorkboardScene[] = [];

  for (const s of scenes) {
    if (s.stack_group) {
      if (!stacks.has(s.stack_group)) stacks.set(s.stack_group, []);
      stacks.get(s.stack_group)!.push(s);
    } else {
      singles.push(s);
    }
  }

  const groups: NodeGroup[] = [];

  for (const s of singles) {
    groups.push({
      id: `scene-${s.id}`,
      scenes: [s],
      subplot: s.subplot,
      globalOrder: s.global_order ?? 0,
    });
  }

  for (const [sg, scs] of stacks) {
    const sorted = [...scs].sort((a, b) => (a.global_order ?? 0) - (b.global_order ?? 0));
    groups.push({
      id: `stack-${sg}`,
      scenes: sorted,
      subplot: sorted[0].subplot,
      globalOrder: sorted[0].global_order ?? 0,
    });
  }

  return groups;
}

// ── Computed view layouts (cascade / circle / concentric) ────────────────────
// These are read-only views: they never write node_x/node_y. "Apply layout"
// bakes the returned positions into the Custom arrangement explicitly.

function computeViewPositions(
  groups: NodeGroup[],
  layout: CorkboardLayout,
  allCols: string[],
  compact: boolean,
  circleRadiusMult = 0,
  concentricRadiusMult = 0,
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  const sw = compact ? CARD_W_SM : CARD_W;
  const sh = compact ? SCENE_H_CMP : SCENE_H_FULL;

  if (layout === "cascade") {
    const colW = sw + COL_GAP;
    for (const col of allCols) {
      const colIdx = allCols.indexOf(col);
      const colGroups = groups
        .filter((g) => (g.subplot ?? MAIN_COL) === col)
        .sort((a, b) => a.globalOrder - b.globalOrder);
      const x0 = colIdx * colW;
      colGroups.forEach((g, i) => result.set(g.id, { x: x0 + i * CDX, y: 40 + i * CDY }));
    }
    return result;
  }

  if (layout === "circle") {
    const sorted = [...groups].sort((a, b) => a.globalOrder - b.globalOrder);
    const n = sorted.length;
    if (n === 0) return result;
    const spacing = sw + 90;
    const naturalR = Math.max(320, (n * spacing) / (2 * Math.PI));
    const r = naturalR * Math.max(0.3, 1 + circleRadiusMult * 0.1);
    sorted.forEach((g, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      result.set(g.id, {
        x: r * Math.cos(angle) - sw / 2,
        y: r * Math.sin(angle) - sh / 2,
      });
    });
    return result;
  }

  // concentric — one ring per plot column, main plot innermost
  const ringCols = allCols.filter((col) =>
    groups.some((g) => (g.subplot ?? MAIN_COL) === col));
  ringCols.forEach((col, ringIdx) => {
    const ring = groups
      .filter((g) => (g.subplot ?? MAIN_COL) === col)
      .sort((a, b) => a.globalOrder - b.globalOrder);
    const n = ring.length;
    const spacing = sw + 70;
    const naturalMinR = 320 + ringIdx * (sh + 160);
    const naturalR = Math.max(naturalMinR, (n * spacing) / (2 * Math.PI));
    const r = naturalR * Math.max(0.3, 1 + concentricRadiusMult * 0.1);
    ring.forEach((g, i) => {
      // small per-ring rotation so cards on adjacent rings don't align/overlap
      const angle = -Math.PI / 2 + ringIdx * 0.35 + (i * 2 * Math.PI) / n;
      result.set(g.id, {
        x: r * Math.cos(angle) - sw / 2,
        y: r * Math.sin(angle) - sh / 2,
      });
    });
  });
  return result;
}

// ── Build RF nodes ────────────────────────────────────────────────────────────

function buildRFNodes(
  groups: NodeGroup[],
  allCols: string[],
  sceneColors: Record<number, string | null>,
  colColors: Record<string, string>,
  compact: boolean,
  generatingId: number | null,
  availableSubplots: string[],
  stackNames: Record<string, string>,
  handlers: Pick<SceneNodeData,
    "onTitleChange" | "onSynopsisChange" | "onGenerateSynopsis" |
    "onColorChange" | "onSubplotChange" | "onUnstack" | "onStackRename" | "onCodexWeb">,
  projectId: number,
  viewPositions: Map<string, { x: number; y: number }> | null,
): SceneNodeType[] {
  // Group by subplot to compute row indices for auto-layout
  const colGroups = new Map<string, NodeGroup[]>();
  for (const col of allCols) colGroups.set(col, []);
  for (const g of groups) {
    const col = g.subplot ?? MAIN_COL;
    if (!colGroups.has(col)) colGroups.set(col, []);
    colGroups.get(col)!.push(g);
  }
  // Sort each column by globalOrder for auto-layout row index
  for (const [, arr] of colGroups) arr.sort((a, b) => a.globalOrder - b.globalOrder);

  return groups.map((g): SceneNodeType => {
    const col = g.subplot ?? MAIN_COL;
    const colIdx = allCols.indexOf(col);
    const colArr = colGroups.get(col) ?? [];
    const rowIdx = colArr.indexOf(g);

    // Computed view position > saved position > auto-layout
    const rep = g.scenes[0];
    const computed = viewPositions?.get(g.id);
    const x = computed ? computed.x : rep.node_x ?? (colIdx * (CARD_W + COL_GAP));
    const y = computed ? computed.y : rep.node_y ?? (rowIdx * ROW_H + 40);

    const sg = rep.stack_group;
    return {
      id: g.id,
      type: "sceneNode",
      position: { x, y },
      dragHandle: '[data-drag="handle"]',
      draggable: viewPositions === null,
      data: {
        scenes: g.scenes,
        projectId,
        sceneColors,
        colColor: colColors[col] ?? defaultColColor(col, allCols),
        showSynopsis: true,
        compact,
        generatingId,
        availableSubplots,
        stackName: sg ? stackNames[sg] ?? "" : undefined,
        ...handlers,
      },
    };
  });
}

// ── Build RF edges ────────────────────────────────────────────────────────────

/** Derived sequence edges — a view of global_order within each subplot.
 *  They cannot be deleted (order is the data); rewiring one reorders scenes. */
function buildRFEdges(groups: NodeGroup[], reconnectable: boolean): Edge[] {
  // Within each subplot, connect groups in globalOrder sequence
  const bySubplot = new Map<string | null, NodeGroup[]>();
  for (const g of groups) {
    const key = g.subplot;
    if (!bySubplot.has(key)) bySubplot.set(key, []);
    bySubplot.get(key)!.push(g);
  }

  const edges: Edge[] = [];
  for (const [, arr] of bySubplot) {
    const sorted = [...arr].sort((a, b) => a.globalOrder - b.globalOrder);
    for (let i = 0; i < sorted.length - 1; i++) {
      const src = sorted[i];
      const tgt = sorted[i + 1];
      edges.push({
        id: `e-${src.id}-${tgt.id}`,
        source: src.id,
        target: tgt.id,
        type: "smoothstep",
        animated: false,
        deletable: false,
        reconnectable,
        data: { kind: "seq" },
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        style: { stroke: "hsl(var(--border))", strokeWidth: 1.5, opacity: 0.6 },
      });
    }
  }
  return edges;
}

/** User-drawn typed cables, attached to the colored side sockets. */
function buildConnectionEdges(
  connections: SceneConnection[],
  sceneToNode: Map<number, string>,
): Edge[] {
  const edges: Edge[] = [];
  for (const c of connections) {
    const srcNode = sceneToNode.get(c.source_scene_id);
    const tgtNode = sceneToNode.get(c.target_scene_id);
    if (!srcNode || !tgtNode || srcNode === tgtNode) continue;
    const def = connectionTypeDef(c.connection_type);
    edges.push({
      id: `conn-${c.id}`,
      source: srcNode,
      target: tgtNode,
      sourceHandle: `src-${def.id}`,
      targetHandle: `tgt-${def.id}`,
      type: "default",
      deletable: true,
      data: { kind: "conn", connId: c.id },
      label: c.label ?? undefined,
      labelStyle: { fontSize: 9, fill: def.color },
      labelBgStyle: { fill: "hsl(var(--card))", opacity: 0.85 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: def.color },
      style: { stroke: def.color, strokeWidth: 1.8, strokeDasharray: def.dash, opacity: 0.85 },
    });
  }
  return edges;
}

// ── Tree (hierarchy) layout helpers ──────────────────────────────────────────

function chapterBoxSize(nScenes: number, compact: boolean): { w: number; h: number } {
  const sw = compact ? CARD_W_SM : CARD_W;
  const sh = compact ? 130 : 180;
  return {
    w: CH_PAD_X * 2 + sw + Math.max(0, nScenes - 1) * CDX,
    h: CH_PAD_TOP + sh + Math.max(0, nScenes - 1) * CDY + CH_PAD_BOT,
  };
}

// ── Beat header node ──────────────────────────────────────────────────────────

interface BeatHeaderNodeData extends Record<string, unknown> {
  beatName: string;
  sceneCount: number;
  position?: number;
  isUnassigned?: boolean;
}
type BeatHeaderNodeType = Node<BeatHeaderNodeData, "beatHeaderNode">;

function BeatHeaderNodeComponent({ data }: { data: BeatHeaderNodeData }) {
  return (
    <div
      style={{ width: "100%", height: "100%", pointerEvents: "none" }}
      className="flex flex-col items-center justify-center text-center px-3 rounded-lg border-2 border-dashed border-border/50 bg-muted/20"
    >
      <p className={`text-[11px] font-semibold leading-tight truncate w-full text-center ${data.isUnassigned ? "text-muted-foreground/40 italic" : "text-foreground"}`}>
        {data.isUnassigned ? "— Unassigned —" : data.beatName}
      </p>
      {data.position != null && !data.isUnassigned && (
        <p className="text-[9px] text-muted-foreground/50 mt-0.5">{data.position}%</p>
      )}
      <p className="text-[9px] text-muted-foreground/40 mt-1">
        {data.sceneCount} scene{data.sceneCount !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

type AnyNode = SceneNodeType | ActNodeType | ChapterNodeType | GroupFrameNodeType | BeatHeaderNodeType | CodexWebNodeType;

function buildHierarchyNodes(
  localScenes: CorkboardScene[],
  structure: CorkboardAct[],
  sceneColors: Record<number, string | null>,
  resolvedColColors: Record<string, string>,
  allCols: string[],
  compact: boolean,
  generatingId: number | null,
  availableSubplots: string[],
  handlers: Pick<SceneNodeData,
    "onTitleChange" | "onSynopsisChange" | "onGenerateSynopsis" |
    "onColorChange" | "onSubplotChange" | "onUnstack" | "onStackRename" | "onCodexWeb">,
  projectId: number,
): { nodes: AnyNode[]; edges: Edge[]; positions: Map<number, { x: number; y: number }> } {
  const allNodes: AnyNode[] = [];
  const edges: Edge[] = [];
  const positions = new Map<number, { x: number; y: number }>();

  // Map sceneId → CorkboardScene for fast lookup
  const sceneById = new Map(localScenes.map((s) => [s.id, s]));

  let actY = 0;

  for (const act of [...structure].sort((a, b) => a.order_index - b.order_index)) {
    const chapters = [...act.chapters].sort((a, b) => a.order_index - b.order_index);
    let chX = ACT_PAD_X;
    let maxChH = 0;

    const chapterNodes: AnyNode[] = [];
    const sceneNodes: AnyNode[]   = [];
    const chEdges: Edge[]         = [];

    for (const chapter of chapters) {
      // Scenes for this chapter, in structural order
      const chSceneIds = chapter.scenes.map((s) => s.id);
      const chScenes = chSceneIds
        .map((sid) => sceneById.get(sid))
        .filter((s): s is CorkboardScene => !!s);

      const { w: chW, h: chH } = chapterBoxSize(chScenes.length, compact);
      maxChH = Math.max(maxChH, chH);

      const chNodeId = `chapter-${chapter.id}`;
      chapterNodes.push({
        id: chNodeId,
        type: "chapterNode",
        position: { x: chX, y: actY + ACT_PAD_TOP },
        data: { label: chapter.title, sceneCount: chScenes.length },
        style: { width: chW, height: chH },
        selectable: false,
        draggable: false,
        zIndex: 1,
      } as ChapterNodeType);

      // Scene nodes — cascade within chapter box
      chScenes.forEach((scene, i) => {
        const sx = chX + CH_PAD_X + i * CDX;
        const sy = actY + ACT_PAD_TOP + CH_PAD_TOP + i * CDY;
        positions.set(scene.id, { x: sx, y: sy });

        sceneNodes.push({
          id: `scene-${scene.id}`,
          type: "sceneNode",
          position: { x: sx, y: sy },
          dragHandle: '[data-drag="handle"]',
          zIndex: 10 + i,   // later scenes sit on top (like papers laid down in sequence)
          data: {
            scenes: [scene],
            projectId,
            sceneColors,
            colColor: resolvedColColors[scene.subplot ?? MAIN_COL] ?? defaultColColor(scene.subplot ?? MAIN_COL, allCols),
            showSynopsis: true,
            compact,
            generatingId,
            availableSubplots,
            ...handlers,
          },
        } as SceneNodeType);

        // Edge: connect consecutive scenes within chapter
        if (i < chScenes.length - 1) {
          chEdges.push({
            id: `e-ch-${scene.id}-${chScenes[i + 1].id}`,
            source: `scene-${scene.id}`,
            target: `scene-${chScenes[i + 1].id}`,
            type: "smoothstep",
            deletable: false,
            data: { kind: "seq-tree" },
            markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
            style: { stroke: "hsl(var(--border))", strokeWidth: 1.2, opacity: 0.5 },
          });
        }
      });

      chX += chW + CH_GAP;
    }

    const actW = chX - CH_GAP + ACT_PAD_X;
    const actH = ACT_PAD_TOP + maxChH + ACT_PAD_BOT;

    // Act node (background container — added first so it's below chapters)
    allNodes.push({
      id: `act-${act.id}`,
      type: "actNode",
      position: { x: 0, y: actY },
      data: { label: act.title },
      style: { width: actW, height: actH },
      selectable: false,
      draggable: false,
      zIndex: 0,
    } as ActNodeType);

    allNodes.push(...chapterNodes);
    allNodes.push(...sceneNodes);
    edges.push(...chEdges);

    actY += actH + ACT_GAP;
  }

  return { nodes: allNodes, edges, positions };
}

// ── Chapter group frames (free-form mode) ────────────────────────────────────

function buildGroupFrames(
  structure: CorkboardAct[],
  scenePositions: Map<number, { x: number; y: number }>,
  compact: boolean,
): GroupFrameNodeType[] {
  const sh = compact ? SCENE_H_CMP : SCENE_H_FULL;
  const sw = compact ? CARD_W_SM : CARD_W;
  const frames: GroupFrameNodeType[] = [];

  for (const act of structure) {
    for (const chapter of act.chapters) {
      const positions = chapter.scenes
        .map((s) => scenePositions.get(s.id))
        .filter((p): p is { x: number; y: number } => !!p);
      if (positions.length === 0) continue;

      const minX = Math.min(...positions.map((p) => p.x));
      const minY = Math.min(...positions.map((p) => p.y));
      const maxX = Math.max(...positions.map((p) => p.x)) + sw;
      const maxY = Math.max(...positions.map((p) => p.y)) + sh;

      frames.push({
        id: `frame-chapter-${chapter.id}`,
        type: "groupFrameNode",
        position: { x: minX - FRAME_PAD, y: minY - FRAME_PAD - 20 },
        style: { width: maxX - minX + FRAME_PAD * 2, height: maxY - minY + FRAME_PAD * 2 + 20 },
        data: { label: chapter.title, chapterId: chapter.id },
        zIndex: -1,
        selectable: false,
        draggable: true,
      } as GroupFrameNodeType);
    }
  }
  return frames;
}

// ── Beat sheet view layout ────────────────────────────────────────────────────

const BEAT_HEADER_H = 84; // height of beat column header node

function buildBeatViewNodes(
  localScenes: CorkboardScene[],
  allBeatCols: string[],     // ordered list starting with "__unassigned__"
  beatPositions: Record<string, number>, // beat name → 0-100 position % from template
  sceneColors: Record<number, string | null>,
  resolvedColColors: Record<string, string>,
  allCols: string[],
  compact: boolean,
  cascade: boolean,          // when true, stack cards with CDX/CDY offsets
  generatingId: number | null,
  availableSubplots: string[],
  handlers: Pick<SceneNodeData,
    "onTitleChange" | "onSynopsisChange" | "onGenerateSynopsis" |
    "onColorChange" | "onSubplotChange" | "onUnstack" | "onStackRename" | "onCodexWeb">,
  projectId: number,
): { nodes: AnyNode[]; edges: Edge[] } {
  const sw = compact ? CARD_W_SM : CARD_W;
  const colW = sw + COL_GAP;

  // Group scenes by beat
  const byBeat = new Map<string, CorkboardScene[]>();
  for (const col of allBeatCols) byBeat.set(col, []);

  for (const scene of localScenes) {
    const beat = scene.beat;
    if (!beat || !allBeatCols.includes(beat)) {
      byBeat.get("__unassigned__")!.push(scene);
    } else {
      byBeat.get(beat)!.push(scene);
    }
  }
  for (const [, arr] of byBeat) arr.sort((a, b) => (a.global_order ?? 0) - (b.global_order ?? 0));

  const nodes: AnyNode[] = [];

  for (const col of allBeatCols) {
    const colIdx = allBeatCols.indexOf(col);
    const colX = colIdx * colW;
    const scenes = byBeat.get(col) ?? [];
    const isUnassigned = col === "__unassigned__";

    // Beat header node
    nodes.push({
      id: `beat-header-${col}`,
      type: "beatHeaderNode",
      position: { x: colX, y: 0 },
      style: { width: sw, height: BEAT_HEADER_H },
      data: {
        beatName: isUnassigned ? "Unassigned" : col,
        sceneCount: scenes.length,
        position: isUnassigned ? undefined : beatPositions[col],
        isUnassigned,
      },
      selectable: false,
      draggable: false,
      zIndex: 0,
    } as unknown as BeatHeaderNodeType);

    // Scene nodes — either spaced (normal) or cascading pile (cascade mode)
    scenes.forEach((scene, rowIdx) => {
      const sx = cascade ? colX + rowIdx * CDX : colX;
      const sy = cascade
        ? BEAT_HEADER_H + 12 + rowIdx * CDY
        : BEAT_HEADER_H + 12 + rowIdx * ROW_H;
      nodes.push({
        id: `scene-${scene.id}`,
        type: "sceneNode",
        position: { x: sx, y: sy },
        dragHandle: '[data-drag="handle"]',
        zIndex: 10 + rowIdx,
        data: {
          scenes: [scene],
          projectId,
          sceneColors,
          colColor: resolvedColColors[scene.subplot ?? MAIN_COL] ?? defaultColColor(scene.subplot ?? MAIN_COL, allCols),
          showSynopsis: true,
          compact,
          generatingId,
          availableSubplots,
          ...handlers,
        },
      } as SceneNodeType);
    });
  }

  return { nodes, edges: [] };
}

// ── Codex spider-web overlay ──────────────────────────────────────────────────

interface CodexWebInput {
  sceneNodeId: string;
  center: { x: number; y: number };
  mentions: { codex_id: number; count: number }[];
  entries: CodexEntry[];
  relations: { sourceId: number; targetId: number; type: string }[];
  onOpen: (entryId: number) => void;
}

function buildCodexWeb(input: CodexWebInput): { nodes: CodexWebNodeType[]; edges: Edge[] } {
  const entryById = new Map(input.entries.map((e) => [e.id, e]));
  const mentioned = input.mentions
    .filter((m) => m.count > 0 && entryById.has(m.codex_id))
    .map((m) => ({ entry: entryById.get(m.codex_id)!, count: m.count }));
  if (mentioned.length === 0) return { nodes: [], edges: [] };

  // Concentric rings by entry type: characters → locations → everything else
  const ringOf = (t: string) => (t === "character" ? 0 : t === "location" ? 1 : 2);
  const ringsUsed = [...new Set(mentioned.map((m) => ringOf(m.entry.entry_type)))].sort();
  const ringIndex = new Map(ringsUsed.map((r, i) => [r, i]));

  const nodes: CodexWebNodeType[] = [];
  const edges: Edge[] = [];
  const NODE_HALF = 22;

  for (const r of ringsUsed) {
    const ring = mentioned.filter((m) => ringOf(m.entry.entry_type) === r);
    const idx = ringIndex.get(r)!;
    const radius = 300 + idx * 150;
    ring.forEach((m, i) => {
      const angle = -Math.PI / 2 + idx * 0.4 + (i * 2 * Math.PI) / ring.length;
      nodes.push({
        id: `codex-${m.entry.id}`,
        type: "codexWebNode",
        position: {
          x: input.center.x + radius * Math.cos(angle) - NODE_HALF,
          y: input.center.y + radius * Math.sin(angle) - NODE_HALF,
        },
        zIndex: 1200,
        deletable: false,
        selectable: false,
        data: {
          entryId: m.entry.id,
          name: m.entry.name,
          entryType: m.entry.entry_type,
          color: m.entry.color,
          mentionCount: m.count,
          onOpen: input.onOpen,
        },
      });

      // Scene → entry thread, thickness by mention count
      edges.push({
        id: `web-${m.entry.id}`,
        source: input.sceneNodeId,
        sourceHandle: "web",
        target: `codex-${m.entry.id}`,
        targetHandle: "web",
        type: "straight",
        deletable: false,
        selectable: false,
        zIndex: 1100,
        style: {
          stroke: m.entry.color,
          strokeWidth: 1.2 + Math.min(m.count, 8) * 0.45,
          strokeDasharray: "6 4",
          opacity: 0.75,
        },
      });
    });
  }

  // Relations between mentioned entries (the web strands)
  const mentionedIds = new Set(mentioned.map((m) => m.entry.id));
  const seen = new Set<string>();
  for (const rel of input.relations) {
    if (!mentionedIds.has(rel.sourceId) || !mentionedIds.has(rel.targetId)) continue;
    const key = `${Math.min(rel.sourceId, rel.targetId)}-${Math.max(rel.sourceId, rel.targetId)}-${rel.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      id: `webrel-${key}`,
      source: `codex-${rel.sourceId}`,
      sourceHandle: "web",
      target: `codex-${rel.targetId}`,
      targetHandle: "web",
      type: "straight",
      deletable: false,
      selectable: false,
      zIndex: 1050,
      label: rel.type || undefined,
      labelStyle: { fontSize: 8, fill: "hsl(var(--muted-foreground))" },
      labelBgStyle: { fill: "hsl(var(--card))", opacity: 0.8 },
      style: {
        stroke: "hsl(var(--muted-foreground))",
        strokeWidth: 1,
        strokeDasharray: "2 4",
        opacity: 0.5,
      },
    });
  }

  return { nodes, edges };
}

// ── Node types registration (stable outside component) ────────────────────────

const nodeTypes = {
  sceneNode: SceneNode, actNode: ActNode, chapterNode: ChapterNode,
  groupFrameNode: GroupFrameNode, beatHeaderNode: BeatHeaderNodeComponent,
  codexWebNode: CodexWebNode,
};

// ── Small UI helpers ──────────────────────────────────────────────────────────

function toolBtn(active: boolean): string {
  return [
    "flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border transition-colors",
    active ? "border-border bg-muted text-foreground" : "border-transparent text-muted-foreground/50 hover:text-muted-foreground",
  ].join(" ");
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CorkboardPage() {
  const { id } = useParams();
  const projectId = Number(id);

  const { data: serverData, isLoading } = useCorkboard(projectId);
  const { data: structure }             = useProjectStructure(projectId);
  const { data: codexEntries }          = useCodexEntries(projectId);
  const { data: project }               = useProject(projectId);
  const { data: relationsGraph }        = useRelationsGraph(projectId);
  const updateProject                   = useUpdateProject();
  const updateSynopsis   = useUpdateSceneSynopsis(projectId);
  const generateSynopsis = useGenerateSynopsis(projectId);
  const moveScene        = useMoveScene(projectId);
  const updatePrefs      = useUpdateCorkboardPrefs(projectId);
  const createConn       = useCreateConnection(projectId);
  const deleteConn       = useDeleteConnection(projectId);
  const setGlobalOrder   = useSetGlobalOrder(projectId);

  // ── Stable mutation refs ──────────────────────────────────────────────────
  // Mutation objects are new references every render; store .mutate in refs so
  // useCallback deps stay empty and the handlers never force a re-render.
  const mutateRef = useRef({
    move:           moveScene.mutate,
    updateSyn:      updateSynopsis.mutate,
    genSyn:         generateSynopsis.mutateAsync,
    updateProject:  updateProject.mutate,
    savePrefs:      updatePrefs.mutate,
    createConn:     createConn.mutate,
    deleteConn:     deleteConn.mutate,
    setGlobalOrder: setGlobalOrder.mutate,
  });
  mutateRef.current.move           = moveScene.mutate;
  mutateRef.current.updateSyn      = updateSynopsis.mutate;
  mutateRef.current.genSyn         = generateSynopsis.mutateAsync;
  mutateRef.current.updateProject  = updateProject.mutate;
  mutateRef.current.savePrefs      = updatePrefs.mutate;
  mutateRef.current.createConn     = createConn.mutate;
  mutateRef.current.deleteConn     = deleteConn.mutate;
  mutateRef.current.setGlobalOrder = setGlobalOrder.mutate;

  // Codex name → color map for subplot auto-coloring
  const codexColorByName = useMemo(() => {
    const m: Record<string, string> = {};
    if (codexEntries)
      for (const e of codexEntries as CodexEntry[]) {
        m[e.name.toLowerCase()] = e.color;
        for (const alias of e.aliases ?? [])
          m[alias.toLowerCase()] = e.color;
      }
    return m;
  }, [codexEntries]);

  const [localScenes, setLocalScenes]       = useState<CorkboardScene[]>([]);
  const [connections, setConnections]       = useState<SceneConnection[]>([]);
  const [extraSubplots, setExtraSubplots]   = useState<string[]>([]);
  const [newSubplotName, setNewSubplotName] = useState("");
  const [addingSubplot, setAddingSubplot]   = useState(false);
  const [sceneColors, setSceneColors]       = useState<Record<number, string | null>>({});
  const [colColors, setColColors]           = useState<Record<string, string>>({});
  const storeSetColor  = useColColorsStore((s) => s.setColor);
  const storeSetColors = useColColorsStore((s) => s.setColors);
  const [compact, setCompact]               = useState(false);
  const [layout, setLayout]                 = useState<CorkboardLayout>("custom");
  const [showHierarchy, setShowHierarchy]   = useState(false);
  const [showBeatView, setShowBeatView]     = useState(false);
  const [beatTemplateId, setBeatTemplateId] = useState<string | null>(null);
  const [beatCascade, setBeatCascade]       = useState(false);
  const [generatingId, setGeneratingId]     = useState<number | null>(null);
  const [showFrames, setShowFrames]         = useState(true);
  const [scratchMode, setScratchMode]       = useState(false);
  const [plotChain, setPlotChain]           = useState(false);
  const [stackNames, setStackNames]         = useState<Record<string, string>>({});
  const [filterSubplots, setFilterSubplots] = useState<string[]>([]);
  const [filterBeats, setFilterBeats]       = useState<string[]>([]);
  const [filterOpen, setFilterOpen]         = useState(false);
  const [circleRadiusMult, setCircleRadiusMult]           = useState(0);
  const [concentricRadiusMult, setConcentricRadiusMult]   = useState(0);
  const [boardStyle, setBoardStyle]         = useState("default");
  const [menuOpen, setMenuOpen]             = useState(false);
  const [showLegend, setShowLegend]         = useState(false);
  const [webSceneId, setWebSceneId]         = useState<number | null>(null);
  const [drawerEntryId, setDrawerEntryId]   = useState<number | null>(null);
  const [undoToast, setUndoToast]           = useState<{ message: string; undo: () => void } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmDialog, setConfirmDialog]   = useState<{
    message: string; confirmLabel?: string; destructive?: boolean; onConfirm: () => void;
  } | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // ── Sync server → local state ─────────────────────────────────────────────

  const prefsHydrated      = useRef(false);
  const colorMigrationDone = useRef(false);
  const prevServer = useRef<typeof serverData>(undefined);
  useEffect(() => {
    if (!serverData || serverData === prevServer.current) return;
    prevServer.current = serverData;
    setLocalScenes(serverData.scenes);
    setConnections(serverData.connections ?? []);
    const merged = [...new Set([...serverData.subplots, ...getStoredSubplots(projectId)])];
    setExtraSubplots(merged);
    saveStoredSubplots(projectId, merged);

    // Scene card colors — server is the source of truth; legacy localStorage
    // colors are adopted once and pushed up so they survive browser resets.
    const sc: Record<number, string | null> = {};
    const toMigrate: { id: number; color: string }[] = [];
    for (const s of serverData.scenes) {
      const legacy = getLegacySceneColor(s.id);
      sc[s.id] = s.card_color ?? legacy;
      if (!s.card_color && legacy) toMigrate.push({ id: s.id, color: legacy });
    }
    setSceneColors(sc);
    if (!colorMigrationDone.current && toMigrate.length > 0) {
      colorMigrationDone.current = true;
      // Plain API calls — no invalidation; local state already holds the colors.
      toMigrate.forEach((m) => scenesApi.update(m.id, { card_color: m.color }).catch(() => {}));
    }

    const prefs = serverData.prefs ?? {};

    // Column colors: server prefs as base, localStorage cache on top (it is
    // written synchronously on every change, so it is never staler than prefs).
    const stored = { ...(prefs.col_colors ?? {}), ...getColColors(projectId) };
    const allCols = [MAIN_COL, ...merged];
    const cc: Record<string, string> = {};
    for (const col of allCols) cc[col] = resolveColColor(col, allCols, stored, codexColorByName);
    // Identity guard — refetches happen after every drag; an unchanged color map
    // must not retrigger the prefs write-through effect.
    setColColors((prev) => JSON.stringify(prev) === JSON.stringify(cc) ? prev : cc);
    storeSetColors(projectId, cc);

    // One-time hydration of view prefs (don't clobber in-session toggles on refetch)
    if (!prefsHydrated.current) {
      setLayout(prefs.layout ?? "custom");
      setCompact(prefs.compact ?? false);
      setShowFrames(prefs.show_frames ?? true);
      setBeatTemplateId(prefs.beat_template ?? getLegacyBeatTemplateId(projectId));
      setStackNames(
        prefs.stack_names && Object.keys(prefs.stack_names).length > 0
          ? prefs.stack_names
          : getLegacyStackNames(serverData.scenes),
      );
      setFilterSubplots(prefs.filter_subplots ?? []);
      setFilterBeats(prefs.filter_beats ?? []);
      setCircleRadiusMult(prefs.circle_radius_mult ?? 0);
      setConcentricRadiusMult(prefs.concentric_radius_mult ?? 0);
      setBoardStyle(prefs.board_style ?? "default");
      prefsHydrated.current = true;
    }
  }, [serverData, projectId, codexColorByName, storeSetColors]);

  // Keep main plot color in sync with the project field (authoritative source).
  useEffect(() => {
    if (!project) return;
    const mainColor = project.main_plot_color ?? MAIN_COLOR;
    setColColors((prev) => {
      if (prev[MAIN_COL] === mainColor) return prev; // no-op guard
      return { ...prev, [MAIN_COL]: mainColor };
    });
    storeSetColor(projectId, MAIN_COL, mainColor);
  }, [project?.main_plot_color, projectId, storeSetColor]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist view prefs (debounced write-through) ──────────────────────────

  useEffect(() => {
    if (!prefsHydrated.current) return;
    const t = setTimeout(() => {
      mutateRef.current.savePrefs({
        layout,
        compact,
        show_frames: showFrames,
        beat_template: beatTemplateId,
        col_colors: colColors,
        stack_names: stackNames,
        filter_subplots: filterSubplots,
        filter_beats: filterBeats,
        circle_radius_mult: circleRadiusMult,
        concentric_radius_mult: concentricRadiusMult,
        board_style: boardStyle,
      });
    }, 600);
    return () => clearTimeout(t);
  }, [layout, compact, showFrames, beatTemplateId, colColors, stackNames, filterSubplots, filterBeats, circleRadiusMult, concentricRadiusMult, boardStyle]);

  // ── Undo toast helper ─────────────────────────────────────────────────────

  const showUndoToast = useCallback((message: string, undo: () => void) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoToast({ message, undo });
    undoTimer.current = setTimeout(() => setUndoToast(null), 8000);
  }, []);

  // ── Stable callbacks (all use mutateRef.current so deps stay empty) ─────────

  const handleTitleChange = useCallback((sceneId: number, title: string) => {
    setLocalScenes((prev) => prev.map((s) => s.id === sceneId ? { ...s, title } : s));
    mutateRef.current.move({ sceneId, data: { title } });
  }, []); // stable — reads mutation via ref

  const handleSynopsisChange = useCallback((sceneId: number, synopsis: string | null) => {
    mutateRef.current.updateSyn({ sceneId, synopsis });
  }, []); // stable

  const handleGenerateSynopsis = useCallback(async (sceneId: number): Promise<string> => {
    setGeneratingId(sceneId);
    try {
      const result = await mutateRef.current.genSyn(sceneId);
      const gen = result.synopsis;
      setLocalScenes((prev) => prev.map((s) => s.id === sceneId ? { ...s, synopsis: gen } : s));
      mutateRef.current.updateSyn({ sceneId, synopsis: gen });
      return gen;
    } finally {
      setGeneratingId(null);
    }
  }, []); // stable

  const handleColorChange = useCallback((sceneId: number, color: string | null) => {
    setSceneColors((prev) => ({ ...prev, [sceneId]: color }));
    setLocalScenes((prev) => prev.map((s) => s.id === sceneId ? { ...s, card_color: color } : s));
    mutateRef.current.move({ sceneId, data: { card_color: color } });
  }, []); // stable

  const handleSubplotChange = useCallback((sceneIds: number[], subplot: string | null) => {
    setLocalScenes((prev) => prev.map((s) => sceneIds.includes(s.id) ? { ...s, subplot } : s));
    sceneIds.forEach((sid) => mutateRef.current.move({ sceneId: sid, data: { subplot } }));
  }, []); // stable

  const handleUnstack = useCallback((sceneId: number) => {
    setLocalScenes((prev) => {
      const scene = prev.find((s) => s.id === sceneId);
      if (!scene?.stack_group) return prev;
      const siblings = prev.filter((s) => s.stack_group === scene.stack_group && s.id !== sceneId);
      return prev.map((s) => {
        if (s.id === sceneId) return { ...s, stack_group: null };
        if (siblings.length === 1 && s.id === siblings[0].id) return { ...s, stack_group: null };
        return s;
      });
    });
    mutateRef.current.move({ sceneId, data: { stack_group: null } });
  }, []); // stable

  const handleStackRename = useCallback((stackGroup: string, name: string) => {
    setStackNames((prev) => {
      const next = { ...prev };
      if (name.trim()) next[stackGroup] = name.trim();
      else delete next[stackGroup];
      return next;
    });
  }, []); // persisted via the prefs effect

  const handleCodexWeb = useCallback((sceneId: number) => {
    setWebSceneId((prev) => (prev === sceneId ? null : sceneId));
    setDrawerEntryId(null);
  }, []);

  const handleOpenCodexEntry = useCallback((entryId: number) => {
    setDrawerEntryId(entryId);
  }, []);

  const handleColColorChange = useCallback((col: string, color: string) => {
    setColColors((prev) => {
      const next = { ...prev, [col]: color };
      saveColColors(projectId, next); // localStorage cache (sidebar/plot read it)
      return next;
    });
    storeSetColor(projectId, col, color); // keep sidebar in sync
    if (col === MAIN_COL) {
      // Main plot color is stored on the project — authoritative source
      mutateRef.current.updateProject({ id: projectId, data: { main_plot_color: color } });
    }
  }, [projectId, storeSetColor]);

  // ── Stable handlers object ─────────────────────────────────────────────────

  const handlers = useMemo(() => ({
    onTitleChange: handleTitleChange,
    onSynopsisChange: handleSynopsisChange,
    onGenerateSynopsis: handleGenerateSynopsis,
    onColorChange: handleColorChange,
    onSubplotChange: handleSubplotChange,
    onUnstack: handleUnstack,
    onStackRename: handleStackRename,
    onCodexWeb: handleCodexWeb,
  }), [
    handleTitleChange, handleSynopsisChange, handleGenerateSynopsis,
    handleColorChange, handleSubplotChange, handleUnstack,
    handleStackRename, handleCodexWeb,
  ]);

  // ── Derived collections ────────────────────────────────────────────────────

  const allCols = useMemo(
    () => [MAIN_COL, ...new Set([...extraSubplots, ...localScenes.filter((s) => s.subplot).map((s) => s.subplot!)])],
    [extraSubplots, localScenes],
  );

  const availableSubplots = useMemo(
    () => allCols.filter((c) => c !== MAIN_COL),
    [allCols],
  );

  // Beat-view column ordering — derived from active template or from scene data
  const beatCols = useMemo(() => {
    if (beatTemplateId) {
      const tpl = PLOT_TEMPLATES.find((t) => t.id === beatTemplateId);
      if (tpl) return tpl.beats.map((b) => b.name);
    }
    // Fallback: unique beat values from scenes in narrative order
    const seen = new Set<string>();
    for (const s of [...localScenes].sort((a, b) => (a.global_order ?? 0) - (b.global_order ?? 0)))
      if (s.beat) seen.add(s.beat);
    return [...seen];
  }, [beatTemplateId, localScenes]);

  const allBeatCols = useMemo(() => ["__unassigned__", ...beatCols], [beatCols]);

  // Map beat name → position% (from template, for header display)
  const beatPositions = useMemo(() => {
    const m: Record<string, number> = {};
    if (beatTemplateId) {
      const tpl = PLOT_TEMPLATES.find((t) => t.id === beatTemplateId);
      if (tpl) for (const b of tpl.beats) m[b.name] = b.position;
    }
    return m;
  }, [beatTemplateId]);

  const resolvedColColors = useMemo(
    () => Object.fromEntries(allCols.map((col) => [col, resolveColColor(col, allCols, colColors, codexColorByName)])),
    [allCols, colColors, codexColorByName],
  );

  // Filtered scenes shown on the board
  const visibleScenes = useMemo(() => {
    let arr = localScenes;
    if (filterSubplots.length > 0)
      arr = arr.filter((s) => filterSubplots.includes(s.subplot ?? MAIN_COL));
    if (filterBeats.length > 0)
      arr = arr.filter((s) => s.beat ? filterBeats.includes(s.beat) : filterBeats.includes(NO_BEAT));
    return arr;
  }, [localScenes, filterSubplots, filterBeats]);

  const filtersActive = filterSubplots.length > 0 || filterBeats.length > 0;

  // Mention stats for the codex web overlay
  const { data: webMentions } = useSceneMentionStats(webSceneId ?? 0);

  // Codex relations resolved to entry ids (graph is keyed by entry name)
  const codexRelations = useMemo(() => {
    if (!relationsGraph) return [];
    const idByName = new Map(
      relationsGraph.nodes
        .filter((n) => n.codex_id != null)
        .map((n) => [n.id, n.codex_id!]),
    );
    return relationsGraph.edges
      .map((e) => {
        const sourceId = idByName.get(e.source);
        const targetId = idByName.get(e.target);
        return sourceId != null && targetId != null
          ? { sourceId, targetId, type: e.type }
          : null;
      })
      .filter((r): r is { sourceId: number; targetId: number; type: string } => !!r);
  }, [relationsGraph]);

  // ── Refs for stable drag/connect closures ──────────────────────────────────

  const localScenesRef = useRef(localScenes);
  localScenesRef.current = localScenes;
  const allColsRef = useRef(allCols);
  allColsRef.current = allCols;
  const compactRef = useRef(compact);
  compactRef.current = compact;
  const nodesRef        = useRef<Node[]>(nodes);
  nodesRef.current      = nodes;
  const structureRef    = useRef(structure);
  structureRef.current  = structure;
  const showFramesRef    = useRef(showFrames);
  showFramesRef.current  = showFrames;
  const scratchModeRef   = useRef(scratchMode);
  scratchModeRef.current = scratchMode;
  const plotChainRef     = useRef(plotChain);
  plotChainRef.current   = plotChain;
  const showHierarchyRef    = useRef(showHierarchy);
  showHierarchyRef.current  = showHierarchy;
  const showBeatViewRef     = useRef(showBeatView);
  showBeatViewRef.current   = showBeatView;
  const allBeatColsRef      = useRef(allBeatCols);
  allBeatColsRef.current    = allBeatCols;
  const layoutRef           = useRef(layout);
  layoutRef.current         = layout;

  // Positions computed by the active non-custom layout, per scene id —
  // consumed by "Apply layout".
  const computedPositionsRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  /** Map an RF node id to the scene ids it represents (stack-aware). */
  const nodeSceneIds = useCallback((nodeId: string | null): number[] => {
    if (!nodeId) return [];
    if (nodeId.startsWith("scene-")) {
      const sid = parseInt(nodeId.replace("scene-", ""), 10);
      return isNaN(sid) ? [] : [sid];
    }
    if (nodeId.startsWith("stack-")) {
      const sg = nodeId.replace("stack-", "");
      return localScenesRef.current
        .filter((s) => s.stack_group === sg)
        .sort((a, b) => (a.global_order ?? 0) - (b.global_order ?? 0))
        .map((s) => s.id);
    }
    return [];
  }, []);

  // ── Rebuild RF nodes + edges when data changes ────────────────────────────

  useEffect(() => {
    if (localScenes.length === 0) return;

    let builtNodes: AnyNode[] = [];
    let builtEdges: Edge[] = [];
    const sceneToNode = new Map<number, string>();

    if (showBeatView) {
      const { nodes: bn, edges: be } = buildBeatViewNodes(
        visibleScenes, allBeatCols, beatPositions, sceneColors,
        resolvedColColors, allCols,
        compact, beatCascade, generatingId, availableSubplots, handlers, projectId,
      );
      builtNodes = bn;
      builtEdges = be;
      for (const s of visibleScenes) sceneToNode.set(s.id, `scene-${s.id}`);
    } else if (showHierarchy && structure?.length) {
      const { nodes: hn, edges: he } = buildHierarchyNodes(
        visibleScenes, structure, sceneColors,
        resolvedColColors, allCols,
        compact, generatingId, availableSubplots, handlers, projectId,
      );
      builtNodes = hn;
      builtEdges = he;
      for (const s of visibleScenes) sceneToNode.set(s.id, `scene-${s.id}`);
    } else {
      const groups = buildNodeGroups(visibleScenes);
      const viewPositions = layout === "custom"
        ? null
        : computeViewPositions(groups, layout, allCols, compact, circleRadiusMult, concentricRadiusMult);
      const newNodes = buildRFNodes(
        groups, allCols, sceneColors, resolvedColColors,
        compact, generatingId, availableSubplots, stackNames, handlers, projectId,
        viewPositions,
      );
      builtEdges = buildRFEdges(groups, layout === "custom");
      for (const g of groups) for (const s of g.scenes) sceneToNode.set(s.id, g.id);

      // Remember computed per-scene positions for "Apply layout"
      const perScene = new Map<number, { x: number; y: number }>();
      if (viewPositions) {
        for (const g of groups) {
          const p = viewPositions.get(g.id);
          if (p) for (const s of g.scenes) perScene.set(s.id, p);
        }
      }
      computedPositionsRef.current = perScene;

      // Chapter frames only make sense on the saved (custom) arrangement
      if (layout === "custom" && showFrames && structure?.length) {
        const scenePositions = new Map(
          newNodes
            .filter((n) => n.id.startsWith("scene-"))
            .map((n) => [parseInt(n.id.replace("scene-", ""), 10), { ...n.position }]),
        );
        const frames = buildGroupFrames(structure, scenePositions, compact);
        builtNodes = [...frames, ...newNodes];
      } else {
        builtNodes = newNodes;
      }
    }

    // Typed cables (all views) — only between currently visible scenes
    builtEdges = [...builtEdges, ...buildConnectionEdges(connections, sceneToNode)];

    // Codex spider-web overlay around the selected scene
    if (webSceneId != null && webMentions && codexEntries) {
      const sceneNodeId = sceneToNode.get(webSceneId);
      const centerNode = builtNodes.find((n) => n.id === sceneNodeId);
      if (sceneNodeId && centerNode) {
        const sw = compact ? CARD_W_SM : CARD_W;
        const sh = compact ? SCENE_H_CMP : SCENE_H_FULL;
        const { nodes: webNodes, edges: webEdges } = buildCodexWeb({
          sceneNodeId,
          center: { x: centerNode.position.x + sw / 2, y: centerNode.position.y + sh / 2 },
          mentions: webMentions,
          entries: codexEntries as CodexEntry[],
          relations: codexRelations,
          onOpen: handleOpenCodexEntry,
        });
        if (webNodes.length > 0) {
          // Dim everything that isn't part of the web
          builtNodes = builtNodes.map((n) =>
            n.id === sceneNodeId
              ? { ...n, zIndex: 1150 }
              : { ...n, style: { ...n.style, opacity: 0.25, transition: "opacity 150ms" } },
          ) as AnyNode[];
          builtEdges = builtEdges.map((e) => ({
            ...e,
            style: { ...e.style, opacity: 0.1 },
          }));
          builtNodes = [...builtNodes, ...webNodes];
          builtEdges = [...builtEdges, ...webEdges];
        }
      }
    }

    setNodes(builtNodes);
    setEdges(builtEdges);
  }, [
    localScenes, visibleScenes, connections, structure, showHierarchy, showBeatView, showFrames, layout,
    allCols, allBeatCols, beatPositions, beatCascade, sceneColors, resolvedColColors,
    compact, generatingId, availableSubplots, stackNames,
    circleRadiusMult, concentricRadiusMult,
    webSceneId, webMentions, codexEntries, codexRelations, handleOpenCodexEntry,
    handlers, projectId, setNodes, setEdges,
  ]);

  // ── Apply computed layout to the custom arrangement ───────────────────────

  const applyLayout = useCallback(() => {
    const posMap = computedPositionsRef.current;
    if (posMap.size === 0) return;
    setConfirmDialog({
      message: "Apply this layout as your custom arrangement? Your current custom positions will be overwritten.",
      confirmLabel: "Apply",
      onConfirm: () => {
        setLocalScenes((prev) =>
          prev.map((s) => {
            const p = posMap.get(s.id);
            return p ? { ...s, node_x: p.x, node_y: p.y } : s;
          })
        );
        posMap.forEach((pos, sceneId) =>
          mutateRef.current.move({ sceneId, data: { node_x: pos.x, node_y: pos.y } })
        );
        setLayout("custom");
      },
    });
  }, []); // stable — setConfirmDialog and setters are stable refs

  // ── Cable-based reordering (Phase C) ──────────────────────────────────────
  // Sequence edges are a *view* of global_order: they cannot be deleted, only
  // rewired. Rewiring moves the target scene(s) directly after the new
  // predecessor — and into its plot column, since sequence threads are
  // per-subplot. Every move shows an Undo toast.

  const moveScenesAfter = useCallback((movedIds: number[], anchorId: number) => {
    if (movedIds.length === 0 || movedIds.includes(anchorId)) return;
    const all = [...localScenesRef.current].sort(
      (a, b) => (a.global_order ?? 0) - (b.global_order ?? 0));
    const anchor = all.find((s) => s.id === anchorId);
    if (!anchor) return;

    const movedSet = new Set(movedIds);
    const moved = all.filter((s) => movedSet.has(s.id));
    const rest  = all.filter((s) => !movedSet.has(s.id));
    const ai = rest.findIndex((s) => s.id === anchorId);
    if (ai < 0 || moved.length === 0) return;

    const newList = [...rest.slice(0, ai + 1), ...moved, ...rest.slice(ai + 1)];
    const items = newList.map((s, i) => ({ id: s.id, global_order: i * 100 }));
    const orderById = new Map(items.map((it) => [it.id, it.global_order]));

    // Snapshot for undo
    const prevItems = all.map((s) => ({ id: s.id, global_order: s.global_order ?? 0 }));
    const anchorSubplot = anchor.subplot ?? null;
    const subplotChanges = moved
      .filter((s) => (s.subplot ?? null) !== anchorSubplot)
      .map((s) => ({ id: s.id, prev: s.subplot ?? null }));

    setLocalScenes((prev) => prev.map((s) => ({
      ...s,
      global_order: orderById.get(s.id) ?? s.global_order,
      subplot: movedSet.has(s.id) ? anchorSubplot : s.subplot,
    })));
    mutateRef.current.setGlobalOrder(items);
    subplotChanges.forEach(({ id }) =>
      mutateRef.current.move({ sceneId: id, data: { subplot: anchorSubplot } }));

    const movedTitle = moved.length === 1
      ? `“${moved[0].title || "Untitled Scene"}”`
      : `${moved.length} scenes`;
    const plotNote = subplotChanges.length > 0
      ? ` (moved to ${anchorSubplot ?? "Main Plot"})` : "";
    showUndoToast(
      `${movedTitle} now follows “${anchor.title || "Untitled Scene"}”${plotNote}`,
      () => {
        const prevOrderById = new Map(prevItems.map((it) => [it.id, it.global_order]));
        const prevSubplotById = new Map(subplotChanges.map((c) => [c.id, c.prev]));
        setLocalScenes((prev) => prev.map((s) => ({
          ...s,
          global_order: prevOrderById.get(s.id) ?? s.global_order,
          subplot: prevSubplotById.has(s.id) ? prevSubplotById.get(s.id)! : s.subplot,
        })));
        mutateRef.current.setGlobalOrder(prevItems);
        subplotChanges.forEach(({ id, prev }) =>
          mutateRef.current.move({ sceneId: id, data: { subplot: prev } }));
      },
    );
  }, [showUndoToast]);

  // ── Connect / reconnect / delete cables ───────────────────────────────────

  const onConnect: OnConnect = useCallback((conn) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return;
    const srcIds = nodeSceneIds(conn.source);
    const tgtIds = nodeSceneIds(conn.target);
    if (srcIds.length === 0 || tgtIds.length === 0) return;

    const type = conn.sourceHandle?.startsWith("src-")
      ? conn.sourceHandle.slice(4)
      : null;

    if (type) {
      // Typed cable from a colored socket → persist a scene connection
      const source_scene_id = srcIds[0];
      const target_scene_id = tgtIds[0];
      if (source_scene_id === target_scene_id) return;
      setConnections((prev) => [
        ...prev,
        { id: -Date.now(), source_scene_id, target_scene_id, connection_type: type, label: null },
      ]);
      mutateRef.current.createConn({ source_scene_id, target_scene_id, connection_type: type });
    } else {
      // Sequence handle (top/bottom) → reorder: target goes right after source
      if (showHierarchyRef.current || showBeatViewRef.current) return;
      moveScenesAfter(tgtIds, srcIds[srcIds.length - 1]);
    }
  }, [nodeSceneIds, moveScenesAfter]);

  const onReconnect: OnReconnect = useCallback((oldEdge, newConn) => {
    if ((oldEdge.data as { kind?: string } | undefined)?.kind !== "seq") return;
    if (showHierarchyRef.current || showBeatViewRef.current) return;
    if (newConn.source === oldEdge.source && newConn.target === oldEdge.target) return;
    // Either end moved — the resulting edge means “target follows source”.
    const srcIds = nodeSceneIds(newConn.source);
    const tgtIds = nodeSceneIds(newConn.target);
    if (srcIds.length === 0 || tgtIds.length === 0) return;
    moveScenesAfter(tgtIds, srcIds[srcIds.length - 1]);
  }, [nodeSceneIds, moveScenesAfter]);

  // Only manual cables may be deleted — scenes and derived edges never.
  const onBeforeDelete: OnBeforeDelete = useCallback(async ({ edges: toDelete }) => ({
    nodes: [],
    edges: toDelete.filter((e) => (e.data as { kind?: string } | undefined)?.kind === "conn"),
  }), []);

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    for (const e of deleted) {
      const connId = (e.data as { connId?: number } | undefined)?.connId;
      if (connId == null) continue;
      setConnections((prev) => prev.filter((c) => c.id !== connId));
      if (connId > 0) mutateRef.current.deleteConn(connId);
    }
  }, []);

  // ── Drag-state tracking (frame drag and chain drags) ──────────────────────

  const dragStartRef = useRef<{
    nodeId: string;
    nodeType: "frame" | "scratch" | "plot";
    startPos: { x: number; y: number };
    followers: Array<{ id: string; startPos: { x: number; y: number } }>;
  } | null>(null);

  const onNodeDragStart: OnNodeDrag = useCallback((_, node) => {
    const nodeId = node.id;

    // Frame drag: identify all scene nodes that belong to this chapter
    if (nodeId.startsWith("frame-chapter-")) {
      const chapterId = parseInt(nodeId.replace("frame-chapter-", ""), 10);
      const chapterSceneIds = new Set(
        (structureRef.current ?? [])
          .flatMap((act) => act.chapters)
          .find((ch) => ch.id === chapterId)
          ?.scenes.map((s) => s.id) ?? [],
      );
      const followers = nodesRef.current
        .filter((n) => n.id.startsWith("scene-") && chapterSceneIds.has(parseInt(n.id.replace("scene-", ""), 10)))
        .map((n) => ({ id: n.id, startPos: { ...n.position } }));
      dragStartRef.current = { nodeId, nodeType: "frame", startPos: { ...node.position }, followers };
      return;
    }

    // Plot-chain drag: identify all scene nodes in the SAME subplot that come after the dragged one
    if (plotChainRef.current && nodeId.startsWith("scene-")) {
      const sceneId = parseInt(nodeId.replace("scene-", ""), 10);
      const dragged = localScenesRef.current.find((s) => s.id === sceneId);
      if (dragged) {
        const sameSubplot = dragged.subplot ?? null;
        const draggedOrder = dragged.global_order ?? 0;
        const followerIds = new Set(
          localScenesRef.current
            .filter((s) => (s.subplot ?? null) === sameSubplot && (s.global_order ?? 0) > draggedOrder)
            .map((s) => s.id),
        );
        const followers = nodesRef.current
          .filter((n) => n.id.startsWith("scene-") && followerIds.has(parseInt(n.id.replace("scene-", ""), 10)))
          .map((n) => ({ id: n.id, startPos: { ...n.position } }));
        dragStartRef.current = { nodeId, nodeType: "plot", startPos: { ...node.position }, followers };
      }
      return;
    }

    // Scratch drag: identify all scene nodes structurally after the dragged one
    if (scratchModeRef.current && nodeId.startsWith("scene-")) {
      const sceneId = parseInt(nodeId.replace("scene-", ""), 10);
      const flatOrder = (structureRef.current ?? [])
        .slice()
        .sort((a, b) => a.order_index - b.order_index)
        .flatMap((act) =>
          [...act.chapters]
            .sort((a, b) => a.order_index - b.order_index)
            .flatMap((ch) => ch.scenes.map((s) => s.id)),
        );
      const idx = flatOrder.indexOf(sceneId);
      const followerIds = new Set(idx >= 0 ? flatOrder.slice(idx + 1) : []);
      const followers = nodesRef.current
        .filter((n) => n.id.startsWith("scene-") && followerIds.has(parseInt(n.id.replace("scene-", ""), 10)))
        .map((n) => ({ id: n.id, startPos: { ...n.position } }));
      dragStartRef.current = { nodeId, nodeType: "scratch", startPos: { ...node.position }, followers };
    }
  }, []); // stable — reads via refs

  // ── Drag — move follower nodes by the same delta ──────────────────────────

  const onNodeDrag: OnNodeDrag = useCallback((_, node) => {
    const drag = dragStartRef.current;
    if (!drag || drag.nodeId !== node.id || drag.followers.length === 0) return;
    const dx = node.position.x - drag.startPos.x;
    const dy = node.position.y - drag.startPos.y;
    setNodes((prev) =>
      prev.map((n) => {
        const f = drag.followers.find((fl) => fl.id === n.id);
        return f ? { ...n, position: { x: f.startPos.x + dx, y: f.startPos.y + dy } } : n;
      }),
    );
  }, [setNodes]); // setNodes is stable

  const onNodeDragStop: OnNodeDrag = useCallback((_, node) => {
    const drag = dragStartRef.current;

    // ── Case 1: frame drag — save follower positions by delta ────────────────
    if (drag && drag.nodeType === "frame" && drag.nodeId === node.id) {
      dragStartRef.current = null;
      const dx = node.position.x - drag.startPos.x;
      const dy = node.position.y - drag.startPos.y;
      const updates = drag.followers.map(({ id, startPos }) => ({
        sceneId: parseInt(id.replace("scene-", ""), 10),
        nx: startPos.x + dx,
        ny: startPos.y + dy,
      }));
      setLocalScenes((prev) =>
        prev.map((s) => {
          const u = updates.find((up) => up.sceneId === s.id);
          return u ? { ...s, node_x: u.nx, node_y: u.ny } : s;
        })
      );
      updates.forEach(({ sceneId, nx, ny }) =>
        mutateRef.current.move({ sceneId, data: { node_x: nx, node_y: ny } })
      );
      return;
    }

    // ── Case 2: scratch drag — save dragged + followers, optional chapter ───
    if (drag && drag.nodeType === "scratch" && drag.nodeId === node.id) {
      dragStartRef.current = null;
      const dx = node.position.x - drag.startPos.x;
      const dy = node.position.y - drag.startPos.y;
      const droppedSceneId = parseInt(node.id.replace("scene-", ""), 10);

      // Hit-test: find which chapter box/frame the dragged scene was dropped into.
      // Tree view → chapterNode boxes; free-form → groupFrameNode boxes (when visible).
      let targetChapterId: number | null = null;
      const inTree = showHierarchyRef.current;
      const framePrefix = inTree ? "chapter-" : "frame-chapter-";
      if (inTree || showFramesRef.current) {
        for (const frame of nodesRef.current) {
          if (!frame.id.startsWith(framePrefix)) continue;
          const fs = frame.style as { width?: number; height?: number } | undefined;
          const fw = fs?.width ?? 0;
          const fh = fs?.height ?? 0;
          if (
            node.position.x >= frame.position.x && node.position.x <= frame.position.x + fw &&
            node.position.y >= frame.position.y && node.position.y <= frame.position.y + fh
          ) {
            targetChapterId = parseInt(frame.id.replace(framePrefix, ""), 10);
            break;
          }
        }
      }

      // Build full update list: dragged scene + all followers at their new positions
      const allUpdates = [
        { sceneId: droppedSceneId, nx: node.position.x, ny: node.position.y },
        ...drag.followers.map(({ id, startPos }) => ({
          sceneId: parseInt(id.replace("scene-", ""), 10),
          nx: startPos.x + dx,
          ny: startPos.y + dy,
        })),
      ];
      setLocalScenes((prev) =>
        prev.map((s) => {
          const u = allUpdates.find((up) => up.sceneId === s.id);
          return u ? { ...s, node_x: u.nx, node_y: u.ny } : s;
        })
      );
      allUpdates.forEach(({ sceneId, nx, ny }) => {
        const data: Record<string, unknown> = { node_x: nx, node_y: ny };
        if (targetChapterId !== null) data.chapter_id = targetChapterId;
        mutateRef.current.move({ sceneId, data });
      });
      return;
    }

    // ── Case 2.5: plot-chain drag — save dragged scene + same-subplot followers ─
    if (drag && drag.nodeType === "plot" && drag.nodeId === node.id) {
      dragStartRef.current = null;
      const dx = node.position.x - drag.startPos.x;
      const dy = node.position.y - drag.startPos.y;
      const droppedSceneId = parseInt(node.id.replace("scene-", ""), 10);
      const allUpdates = [
        { sceneId: droppedSceneId, nx: node.position.x, ny: node.position.y },
        ...drag.followers.map(({ id, startPos }) => ({
          sceneId: parseInt(id.replace("scene-", ""), 10),
          nx: startPos.x + dx,
          ny: startPos.y + dy,
        })),
      ];
      setLocalScenes((prev) =>
        prev.map((s) => {
          const u = allUpdates.find((up) => up.sceneId === s.id);
          return u ? { ...s, node_x: u.nx, node_y: u.ny } : s;
        })
      );
      allUpdates.forEach(({ sceneId, nx, ny }) =>
        mutateRef.current.move({ sceneId, data: { node_x: nx, node_y: ny } })
      );
      return;
    }

    // ── Case 3: normal drag ──────────────────────────────────────────────────
    dragStartRef.current = null;
    const { x, y } = node.position;
    const nodeId = node.id;
    if (!nodeId.startsWith("scene-") && !nodeId.startsWith("stack-")) return;
    let sceneIds: number[];
    if (nodeId.startsWith("stack-")) {
      const sg = nodeId.replace("stack-", "");
      sceneIds = localScenesRef.current.filter((s) => s.stack_group === sg).map((s) => s.id);
    } else {
      const sid = parseInt(nodeId.replace("scene-", ""), 10);
      sceneIds = isNaN(sid) ? [] : [sid];
    }
    if (sceneIds.length === 0) return;

    // ── Beat view: assign beat by x-position column ──────────────────────────
    if (showBeatViewRef.current) {
      const sw = compactRef.current ? CARD_W_SM : CARD_W;
      const colW = sw + COL_GAP;
      const cols = allBeatColsRef.current;
      const colIdx = Math.max(0, Math.min(cols.length - 1, Math.round(x / colW)));
      const beatCol = cols[colIdx];
      const newBeat = beatCol === "__unassigned__" ? null : beatCol;
      setLocalScenes((prev) =>
        prev.map((s) => sceneIds.includes(s.id) ? { ...s, beat: newBeat } : s)
      );
      sceneIds.forEach((sid) => mutateRef.current.move({ sceneId: sid, data: { beat: newBeat } }));
      return;
    }

    // Computed layouts are read-only views — never persist positions from them.
    if (!showHierarchyRef.current && layoutRef.current !== "custom") return;

    // Detect cross-chapter drop via bounding-box hit-test.
    // Tree view → chapterNode boxes; free-form with frames → groupFrameNode boxes.
    let droppedChapterId: number | null = null;
    if (sceneIds.length === 1) {
      const inTree2  = showHierarchyRef.current;
      const prefix2  = inTree2 ? "chapter-" : "frame-chapter-";
      if (inTree2 || showFramesRef.current) {
        for (const n of nodesRef.current) {
          if (!n.id.startsWith(prefix2)) continue;
          const ns = n.style as { width?: number; height?: number } | undefined;
          const nw = ns?.width ?? 0;
          const nh = ns?.height ?? 0;
          if (x >= n.position.x && x <= n.position.x + nw && y >= n.position.y && y <= n.position.y + nh) {
            droppedChapterId = parseInt(n.id.replace(prefix2, ""), 10);
            break;
          }
        }
      }
    }

    setLocalScenes((prev) =>
      prev.map((s) => sceneIds.includes(s.id) ? { ...s, node_x: x, node_y: y } : s)
    );
    sceneIds.forEach((sid) => {
      const data: Record<string, unknown> = { node_x: x, node_y: y };
      if (droppedChapterId !== null) {
        const currentChapterId = localScenesRef.current.find((s) => s.id === sid)?.chapter_id;
        if (currentChapterId !== droppedChapterId) data.chapter_id = droppedChapterId;
      }
      mutateRef.current.move({ sceneId: sid, data });
    });
  }, []); // stable — reads all values via refs

  // ── Overlay dismissal ─────────────────────────────────────────────────────

  const closeOverlays = useCallback(() => {
    setWebSceneId(null);
    setDrawerEntryId(null);
    setFilterOpen(false);
    setMenuOpen(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeOverlays();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeOverlays]);

  // ── Subplot management ────────────────────────────────────────────────────

  const handleAddSubplot = () => {
    const name = newSubplotName.trim();
    if (!name || extraSubplots.includes(name)) return;
    const next = [...extraSubplots, name];
    setExtraSubplots(next);
    saveStoredSubplots(projectId, next);
    projectsApi.setSubplotNames(projectId, next).catch(() => {});
    setColColors((prev) => {
      const allC = [MAIN_COL, ...extraSubplots, name];
      // Codex entry with the same name seeds the initial color; user can change it later.
      const initial = codexColorByName[name.toLowerCase()] || defaultColColor(name, allC);
      const nextColors = { ...prev, [name]: initial };
      saveColColors(projectId, nextColors);
      return nextColors;
    });
    setNewSubplotName("");
    setAddingSubplot(false);
  };

  const handleRemoveSubplot = (subplot: string) => {
    const affected = localScenes.filter((s) => s.subplot === subplot);
    const sceneNote = affected.length > 0
      ? ` ${affected.length} scene${affected.length !== 1 ? "s" : ""} will be moved to Main Plot.`
      : "";
    setConfirmDialog({
      message: `Remove subplot "${subplot}"?${sceneNote}`,
      confirmLabel: "Remove",
      destructive: true,
      onConfirm: () => {
        affected.forEach((s) => mutateRef.current.move({ sceneId: s.id, data: { subplot: null } }));
        setLocalScenes((prev) => prev.map((s) => s.subplot === subplot ? { ...s, subplot: null } : s));
        const next = extraSubplots.filter((x) => x !== subplot);
        setExtraSubplots(next);
        saveStoredSubplots(projectId, next);
        projectsApi.setSubplotNames(projectId, next).catch(() => {});
        setColColors((prev) => {
          const { [subplot]: _, ...rest } = prev;
          saveColColors(projectId, rest);
          return rest;
        });
        setFilterSubplots((prev) => prev.filter((c) => c !== subplot));
      },
    });
  };

  // ── Filter helpers ────────────────────────────────────────────────────────

  const toggleFilterSubplot = (col: string) =>
    setFilterSubplots((prev) => prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]);
  const toggleFilterBeat = (beat: string) =>
    setFilterBeats((prev) => prev.includes(beat) ? prev.filter((b) => b !== beat) : [...prev, beat]);

  const webEmpty = webSceneId != null && webMentions != null
    && !webMentions.some((m) => m.count > 0);

  const drawerEntry = useMemo(
    () => drawerEntryId != null
      ? (codexEntries as CodexEntry[] | undefined)?.find((e) => e.id === drawerEntryId) ?? null
      : null,
    [drawerEntryId, codexEntries],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading corkboard…
      </div>
    );
  }

  const inFreeForm = !showHierarchy && !showBeatView;
  const activeStyle = BOARD_STYLES.find((s) => s.id === boardStyle) ?? BOARD_STYLES[0];

  return (
    <div className="h-full flex flex-col overflow-hidden relative bg-background" style={activeStyle.vars as CSSProperties}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onBeforeDelete={onBeforeDelete}
        onEdgesDelete={onEdgesDelete}
        onPaneClick={closeOverlays}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode={["Delete", "Backspace"]}
        className="bg-background"
      >
        <Background color="hsl(var(--border))" gap={24} size={1} />
        <Controls
          className="!border-border/50 !shadow-lg [&>button]:!bg-background [&>button]:!text-foreground [&>button]:!border-border/40 [&>button:hover]:!bg-muted"
          style={{ background: "hsl(var(--background))" }}
        />
        <MiniMap
          nodeColor={(n) => {
            const d = (n as SceneNodeType).data;
            return d?.colColor ?? "#888";
          }}
          className="!bg-card !border-border"
          maskColor="hsl(var(--background)/0.7)"
        />

        {/* ── Top toolbar ───────────────────────────────────────────────── */}
        <Panel position="top-left" className="flex items-center gap-2 m-0 p-2 bg-card border border-border rounded-lg shadow-sm flex-wrap max-w-[calc(100%-1rem)]">

          {/* Hamburger menu — View (layout) + Style */}
          <div className="relative">
            <button
              onClick={() => { setMenuOpen((v) => !v); setFilterOpen(false); }}
              title="Layout & Style"
              className={toolBtn(menuOpen)}
            >
              <Menu className="h-3.5 w-3.5" />
            </button>
            {menuOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 w-52 bg-card border border-border rounded-lg shadow-lg p-3 space-y-3">

                {/* View section — layout picker, only in free-form mode */}
                {inFreeForm && (
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">View</p>
                    <div className="grid grid-cols-2 gap-1">
                      {(["custom", "cascade", "circle", "concentric"] as CorkboardLayout[]).map((l) => (
                        <button
                          key={l}
                          onClick={() => setLayout(l)}
                          className={`text-xs px-1.5 py-1 rounded border capitalize transition-colors ${
                            layout === l
                              ? "border-primary/60 bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                    {(layout === "circle" || layout === "concentric") && (() => {
                      const mult = layout === "circle" ? circleRadiusMult : concentricRadiusMult;
                      const setMult = layout === "circle" ? setCircleRadiusMult : setConcentricRadiusMult;
                      const pct = mult * 10;
                      return (
                        <div className="mt-2 flex items-center gap-1.5" title="Ring size relative to auto-fit (−70% … +50%)">
                          <span className="text-[10px] text-muted-foreground/60 shrink-0">Ring</span>
                          <input
                            type="range" min={-7} max={5} step={1} value={mult}
                            onChange={(e) => setMult(Number(e.target.value))}
                            className="flex-1 accent-primary cursor-pointer"
                          />
                          <span className="text-[10px] tabular-nums w-9 text-right text-muted-foreground/60">
                            {pct === 0 ? "±0 %" : pct > 0 ? `+${pct} %` : `${pct} %`}
                          </span>
                        </div>
                      );
                    })()}
                    {layout !== "custom" && (
                      <button
                        onClick={applyLayout}
                        className="mt-2 w-full flex items-center justify-center gap-1 text-xs px-2 py-1 rounded-md border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
                      >
                        <Check className="h-3 w-3" />
                        Apply as Custom
                      </button>
                    )}
                  </div>
                )}

                {/* Style section */}
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Style</p>
                  <div className="space-y-0.5">
                    {BOARD_STYLES.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setBoardStyle(s.id)}
                        className={`w-full flex items-center gap-2 px-2 py-1 rounded text-xs transition-colors ${
                          boardStyle === s.id
                            ? "bg-primary/10 text-primary border border-primary/30"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent"
                        }`}
                      >
                        <span className="flex shrink-0">
                          <span className="h-3.5 w-3.5 rounded-l-sm border border-r-0 border-border/40" style={{ background: s.swatch.bg }} />
                          <span className="h-3.5 w-3.5 rounded-r-sm border border-border/40" style={{ background: s.swatch.card }} />
                        </span>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="w-px h-4 bg-border" />

          {/* Compact toggle */}
          <button
            onClick={() => setCompact((v) => !v)}
            title={compact ? "Normal view" : "Compact view"}
            className={toolBtn(compact)}
          >
            <ZoomOut className="h-3.5 w-3.5" />
            Compact
          </button>

          {/* Tree (hierarchy) toggle — not available in beat view */}
          {!showBeatView && (
            <button
              onClick={() => setShowHierarchy((v) => !v)}
              title={showHierarchy ? "Free-form canvas" : "Tree view — acts → chapters → scenes"}
              className={toolBtn(showHierarchy)}
            >
              <TreePine className="h-3.5 w-3.5" />
              Tree
            </button>
          )}

          {/* Beat sheet view toggle */}
          <button
            onClick={() => {
              setShowBeatView((v) => {
                if (!v) setShowHierarchy(false);
                else setBeatCascade(false); // reset cascade state when leaving beat view
                return !v;
              });
            }}
            title={showBeatView ? "Exit beat sheet view" : "Beat sheet view — organize scenes by story beat"}
            className={toolBtn(showBeatView)}
          >
            <BookOpen className="h-3.5 w-3.5" />
            Beat
          </button>

          {/* Template selector — only in beat view */}
          {showBeatView && (
            <>
              <select
                value={beatTemplateId ?? ""}
                onChange={(e) => setBeatTemplateId(e.target.value || null)}
                className="text-xs bg-background border border-border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary text-foreground"
              >
                <option value="">Auto-detect beats</option>
                {PLOT_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button
                onClick={() => setBeatCascade((v) => !v)}
                title={beatCascade ? "Spread beat columns" : "Pile scenes in each beat column"}
                className={toolBtn(beatCascade)}
              >
                <Layers2 className="h-3.5 w-3.5" />
                Pile
              </button>
            </>
          )}

          {/* Frames — free-form custom layout only */}
          {inFreeForm && layout === "custom" && (
            <button
              onClick={() => setShowFrames((v) => !v)}
              title={showFrames ? "Hide chapter frames" : "Show chapter frames — drag a frame to move all its scenes"}
              className={toolBtn(showFrames)}
            >
              <Group className="h-3.5 w-3.5" />
              Frames
            </button>
          )}

          {/* Chain modes — free-form custom layout, and tree view */}
          {!showBeatView && (showHierarchy || layout === "custom") && (
            <>
              <button
                onClick={() => { setPlotChain(false); setScratchMode((v) => !v); }}
                title={scratchMode ? "Switch to normal drag" : "Chain drag — grab a scene to pull all later scenes with it"}
                className={toolBtn(scratchMode)}
              >
                <Link2 className="h-3.5 w-3.5" />
                Chain
              </button>
              {!showHierarchy && (
                <button
                  onClick={() => { setScratchMode(false); setPlotChain((v) => !v); }}
                  title={plotChain ? "Switch to normal drag" : "Plot chain — drag a scene to pull later scenes in the same subplot only"}
                  className={toolBtn(plotChain)}
                >
                  <GitBranch className="h-3.5 w-3.5" />
                  Plot
                </button>
              )}
            </>
          )}

          {/* Filter dropdown */}
          <div className="relative">
            <button
              onClick={() => setFilterOpen((v) => !v)}
              title="Filter scenes by plot or beat"
              className={toolBtn(filtersActive || filterOpen)}
            >
              <Filter className="h-3.5 w-3.5" />
              Filter
              {filtersActive && (
                <span className="text-[9px] bg-primary text-primary-foreground rounded-full px-1 min-w-[14px] text-center">
                  {filterSubplots.length + filterBeats.length}
                </span>
              )}
            </button>
            {filterOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 w-56 max-h-80 overflow-y-auto bg-card border border-border rounded-lg shadow-lg p-2 space-y-2">
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-1">Plots</p>
                  {allCols.map((col) => (
                    <label key={col} className="flex items-center gap-2 px-1 py-0.5 text-xs cursor-pointer hover:bg-muted rounded">
                      <input
                        type="checkbox"
                        checked={filterSubplots.includes(col)}
                        onChange={() => toggleFilterSubplot(col)}
                        className="accent-current"
                        style={{ accentColor: resolvedColColors[col] }}
                      />
                      <span style={{ color: resolvedColColors[col] }}>
                        {col === MAIN_COL ? "Main Plot" : col}
                      </span>
                    </label>
                  ))}
                </div>
                {(beatCols.length > 0 || localScenes.some((s) => !s.beat)) && (
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-1">Beats</p>
                    {beatCols.map((beat) => (
                      <label key={beat} className="flex items-center gap-2 px-1 py-0.5 text-xs cursor-pointer hover:bg-muted rounded">
                        <input
                          type="checkbox"
                          checked={filterBeats.includes(beat)}
                          onChange={() => toggleFilterBeat(beat)}
                        />
                        <span className="truncate">{beat}</span>
                      </label>
                    ))}
                    <label className="flex items-center gap-2 px-1 py-0.5 text-xs cursor-pointer hover:bg-muted rounded">
                      <input
                        type="checkbox"
                        checked={filterBeats.includes(NO_BEAT)}
                        onChange={() => toggleFilterBeat(NO_BEAT)}
                      />
                      <span className="italic text-muted-foreground">No beat</span>
                    </label>
                  </div>
                )}
                {filtersActive && (
                  <button
                    onClick={() => { setFilterSubplots([]); setFilterBeats([]); }}
                    className="w-full text-xs text-muted-foreground hover:text-foreground border-t border-border pt-1.5"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="w-px h-4 bg-border" />

          {/* Subplot legend + management */}
          {allCols.map((col) => {
            const color = resolvedColColors[col];
            return (
              <div key={col} className="flex items-center gap-1">
                <ColorPicker
                  color={color}
                  onChange={(hex) => handleColColorChange(col, hex ?? MAIN_COLOR)}
                  alignLeft={col === MAIN_COL}
                />
                <span className="text-xs font-medium" style={{ color }}>
                  {col === MAIN_COL ? "Main" : col}
                </span>
                {col !== MAIN_COL && (
                  <button
                    onClick={() => handleRemoveSubplot(col)}
                    className="text-muted-foreground/30 hover:text-destructive"
                    title="Remove subplot"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}

          {/* Add subplot */}
          {addingSubplot ? (
            <form
              className="flex gap-1"
              onSubmit={(e) => { e.preventDefault(); handleAddSubplot(); }}
            >
              <input
                autoFocus
                value={newSubplotName}
                onChange={(e) => setNewSubplotName(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setAddingSubplot(false)}
                placeholder="Name…"
                className="text-xs bg-background border border-border rounded px-2 py-0.5 w-24 outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/40"
              />
              <button type="submit" className="text-xs text-primary">Add</button>
              <button type="button" className="text-xs text-muted-foreground/50" onClick={() => setAddingSubplot(false)}>✕</button>
            </form>
          ) : (
            <button
              onClick={() => setAddingSubplot(true)}
              className="flex items-center gap-1 text-xs text-muted-foreground/50 hover:text-muted-foreground"
            >
              <Plus className="h-3 w-3" />
              Subplot
            </button>
          )}
        </Panel>

        {/* ── Cable legend ──────────────────────────────────────────────── */}
        <Panel position="top-right" className="m-2">
          {showLegend ? (
            <div className="bg-card/90 backdrop-blur border border-border rounded-lg shadow-sm p-2 text-xs space-y-1.5 w-44">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[10px] uppercase tracking-wide text-muted-foreground">Cables</span>
                <button onClick={() => setShowLegend(false)} className="text-muted-foreground/40 hover:text-muted-foreground">
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <svg width="26" height="6"><line x1="0" y1="3" x2="26" y2="3" stroke="hsl(var(--border))" strokeWidth="1.5" /></svg>
                <span className="text-muted-foreground">Sequence (story order)</span>
              </div>
              {CONNECTION_TYPES.map((t) => (
                <div key={t.id} className="flex items-center gap-2">
                  <svg width="26" height="6">
                    <line x1="0" y1="3" x2="26" y2="3" stroke={t.color} strokeWidth="2" strokeDasharray={t.dash} />
                  </svg>
                  <span style={{ color: t.color }}>{t.label}</span>
                </div>
              ))}
              <p className="text-[9px] text-muted-foreground/50 leading-snug pt-1 border-t border-border/50">
                Drag from a colored socket to draw a cable. Select a cable + Delete to remove it.
                Rewire a gray sequence cable to reorder scenes.
              </p>
            </div>
          ) : (
            <button
              onClick={() => setShowLegend(true)}
              title="Cable legend"
              className="bg-card/90 backdrop-blur border border-border rounded-lg shadow-sm px-2 py-1 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {CONNECTION_TYPES.map((t) => (
                <span key={t.id} className="h-2 w-2 rounded-full" style={{ background: t.color }} />
              ))}
              Legend
            </button>
          )}
        </Panel>

        {/* ── Undo toast ────────────────────────────────────────────────── */}
        {undoToast && (
          <Panel position="top-center" className="m-2">
            <div className="flex items-center gap-3 bg-card border border-border rounded-lg shadow-lg px-3 py-2 text-xs">
              <span className="text-foreground">{undoToast.message}</span>
              <button
                onClick={() => {
                  undoToast.undo();
                  setUndoToast(null);
                  if (undoTimer.current) clearTimeout(undoTimer.current);
                }}
                className="flex items-center gap-1 text-primary hover:underline font-medium"
              >
                <Undo2 className="h-3 w-3" />
                Undo
              </button>
              <button
                onClick={() => setUndoToast(null)}
                className="text-muted-foreground/40 hover:text-muted-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </Panel>
        )}

        {/* ── Help hint ─────────────────────────────────────────────────── */}
        <Panel position="bottom-center">
          <div className="text-[10px] text-muted-foreground/40 flex items-center gap-1 bg-card/70 px-2 py-1 rounded-md border border-border/30">
            <Layers2 className="h-3 w-3" />
            {webSceneId != null
              ? webEmpty
                ? "No codex entries are mentioned in this scene yet — write them into the scene text first"
                : "Codex web — click an entry for details · Esc or click the canvas to close"
              : showBeatView
              ? "Beat view — drag a scene into a different column to reassign its beat · pick a template to order columns"
              : showHierarchy
              ? scratchMode
                  ? "Tree · Chain mode — drag a scene to pull all later scenes · drop in another chapter box to reassign"
                  : "Tree view — drag scenes into chapter boxes to reassign · cables follow sidebar order"
              : layout !== "custom"
              ? "Computed view — drag is off · Apply saves these positions to your Custom arrangement"
              : plotChain ? "Plot Chain — drag a scene to pull all later scenes in the same subplot · other subplots stay put"
              : scratchMode ? "Chain mode — drag a scene to pull all later scenes · drop in a frame to reassign chapter"
              : showFrames ? "Frames on — drag a frame to move its chapter · drop a scene into another frame to reassign"
              : "Drag to reposition · colored sockets draw cables · rewire gray cables to reorder · scroll to zoom"}
          </div>
        </Panel>
      </ReactFlow>

      {/* ── Confirmation dialog ─────────────────────────────────────────── */}
      {confirmDialog && (
        <div
          className="absolute inset-0 z-[300] flex items-center justify-center bg-black/40"
          onClick={() => setConfirmDialog(null)}
        >
          <div
            className="bg-card border border-border rounded-xl shadow-2xl p-5 w-full max-w-xs mx-4 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-foreground leading-relaxed">{confirmDialog.message}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
                className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
                  confirmDialog.destructive
                    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
              >
                {confirmDialog.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Codex entry drawer ──────────────────────────────────────────── */}
      {drawerEntry && (
        <div className="absolute right-0 top-0 bottom-0 w-72 z-50 bg-card border-l border-border shadow-xl flex flex-col">
          <div
            className="flex items-center gap-2 px-3 py-2.5 border-b border-border"
            style={{ borderTop: `3px solid ${drawerEntry.color}` }}
          >
            <span
              className="h-3 w-3 rounded-full shrink-0"
              style={{ background: drawerEntry.color }}
            />
            <h3 className="flex-1 text-sm font-semibold truncate">{drawerEntry.name}</h3>
            <button
              onClick={() => setDrawerEntryId(null)}
              className="text-muted-foreground/50 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize">
                {drawerEntry.entry_type}
              </span>
              {drawerEntry.aliases.length > 0 && (
                <span className="text-muted-foreground/60 truncate">
                  aka {drawerEntry.aliases.join(", ")}
                </span>
              )}
            </div>
            {drawerEntry.description ? (
              <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {stripHtml(drawerEntry.description)}
              </p>
            ) : (
              <p className="text-muted-foreground/40 italic">No description yet.</p>
            )}
          </div>
          <div className="p-3 border-t border-border">
            <a
              href={`/projects/${projectId}/codex`}
              className="flex items-center justify-center gap-1.5 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Open in Codex
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
