"use client";

import { useState, useMemo, useEffect, useRef, useReducer } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY,
  type Simulation, type SimulationNodeDatum, type SimulationLinkDatum,
} from "d3-force";
import { User, MapPin, Package, Scroll, Tag, Info, Edit2, Crosshair, Copy, Unlink, ChevronRight, HelpCircle, RotateCcw } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { CodexEntryDialog } from "@/components/codex/CodexEntryDialog";
import { useCodexEntries, useUpdateCodexEntry, useProjectMentionStats } from "@/store/queries";
import { imagesApi } from "@/lib/api";
import { cropImageStyle } from "@/lib/imageCrop";
import type { CodexEntry } from "@/types";
import { sphereGradientId, bezierPath, CANVAS_MOTION_CSS } from "@/lib/canvasStyle";
import { CanvasGradientDefs } from "@/components/canvas/GradientDefs";

interface GraphNode {
  id: string;
  codex_id: number | null;
  entry_type: string;
  color: string;
}

interface GraphEdge {
  source: string | null;
  target: string;
  type: string;
  relation_id?: number;
  scene_id?: number;
  scene_title?: string;
  chapter_title?: string;
  via: "codex" | "inline";
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface RelationItem {
  relation_id: number;
  other_name: string;
  rel_type: string;
  direction: "from" | "to";
}

type MenuState =
  | { kind: "node"; x: number; y: number; node: GraphNode; relations: RelationItem[] }
  | { kind: "edge"; x: number; y: number; edge: GraphEdge }
  | null;

const TYPE_ICONS: Record<string, React.ElementType> = {
  character: User, location: MapPin, item: Package, lore: Scroll, custom: Tag,
};

const W = 1000;
const H = 800;
const CX = W / 2;
const CY = H / 2;

// Node radius scales with how often the entry is mentioned across the story.
const MIN_R = 20;
const MAX_R = 44;
const DEFAULT_R = 28; // nodes with no codex entry / zero mentions
const RIM = 4; // ring of node color left visible around a portrait image

// Physics-driven node — persists across re-layouts so dragging/settling feels continuous.
interface SimNode extends SimulationNodeDatum {
  id: string;
  codex_id: number | null;
  entry_type: string;
  color: string;
  r: number;
  image_path: string | null;
  image_crop: { x: number; y: number; width: number; height: number } | null;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  edge: GraphEdge;
}

function radiusFor(count: number, maxCount: number): number {
  if (!count || maxCount <= 0) return DEFAULT_R;
  const t = Math.sqrt(count / maxCount);
  return MIN_R + (MAX_R - MIN_R) * t;
}

// Manually-dragged node positions persist per project (survives reload) so
// characters can be grouped/arranged by hand without the simulation pulling
// them back into equilibrium.
function pinsKey(projectId: number) { return `relations:pins:${projectId}`; }

function loadPins(projectId: number): Record<string, { x: number; y: number }> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(pinsKey(projectId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePins(projectId: number, pins: Record<string, { x: number; y: number }>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(pinsKey(projectId), JSON.stringify(pins));
  } catch {
    // ignore quota/serialization errors
  }
}

/** Convert a client (screen) point to this SVG's user-space coordinates (pre-pan). */
function clientToSvgPoint(svg: SVGSVGElement, clientX: number, clientY: number) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const transformed = pt.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
}

/** BFS outward from `centerName` up to `depth` hops — which nodes/edges are visible. */
function visibleSubgraph(data: GraphData, centerName: string, depth: number) {
  const nodeIds = new Set<string>([centerName]);
  let frontier = new Set<string>([centerName]);
  for (let d = 1; d <= depth; d++) {
    const next = new Set<string>();
    for (const name of frontier) {
      for (const e of data.edges) {
        const src = e.source ?? "";
        if (src === name && !nodeIds.has(e.target)) next.add(e.target);
        if (e.target === name && src && !nodeIds.has(src)) next.add(src);
      }
    }
    for (const n of next) nodeIds.add(n);
    frontier = next;
  }
  const edges = data.edges.filter(e => nodeIds.has(e.source ?? "") && nodeIds.has(e.target));
  return { nodeIds, edges };
}

// ── Context Menu ──────────────────────────────────────────────────────────────

const menuItemCls =
  "w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-secondary/60 cursor-pointer text-left text-xs";
const destructiveCls =
  "w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-destructive/10 text-destructive cursor-pointer text-left text-xs";

function ContextMenu({ menu, onClose, onDeleteRelation, onSetCenter, onEditEntry, onCopyName, onResetPosition }: {
  menu: MenuState;
  onClose: () => void;
  onDeleteRelation: (relationId: number) => void;
  onSetCenter: (nodeId: string) => void;
  onEditEntry: (node: GraphNode) => void;
  onCopyName: (name: string) => void;
  onResetPosition: (nodeId: string) => void;
}) {
  const [subOpen, setSubOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!menu) return null;

  return (
    <>
      {/* Invisible overlay — catches outside clicks */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={e => { e.preventDefault(); onClose(); }}
      />

      <div
        className="fixed z-50 bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[11rem] select-none"
        style={{ left: menu.x, top: menu.y }}
      >
        {menu.kind === "node" && (
          <>
            {menu.node.codex_id && (
              <button className={menuItemCls} onClick={() => { onEditEntry(menu.node); onClose(); }}>
                <Edit2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                Edit Codex Entry
              </button>
            )}
            <button className={menuItemCls} onClick={() => { onSetCenter(menu.node.id); onClose(); }}>
              <Crosshair className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Set as Center
            </button>
            <button className={menuItemCls} onClick={() => { onCopyName(menu.node.id); onClose(); }}>
              <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Copy Name
            </button>
            <button className={menuItemCls} onClick={() => { onResetPosition(menu.node.id); onClose(); }}>
              <RotateCcw className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Reset Position
            </button>

            {menu.relations.length > 0 && (
              <>
                <div className="my-1 mx-2 border-t border-border" />
                <div
                  className="relative"
                  onMouseEnter={() => setSubOpen(true)}
                  onMouseLeave={() => setSubOpen(false)}
                >
                  <div className={cn(destructiveCls, "justify-between")}>
                    <span className="flex items-center gap-2.5">
                      <Unlink className="h-3.5 w-3.5 shrink-0" />
                      Remove Relation
                    </span>
                    <ChevronRight className="h-3 w-3 opacity-60" />
                  </div>

                  {subOpen && (
                    <div className="absolute left-full top-0 ml-0.5 bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[13rem]">
                      {menu.relations.map(rel => (
                        <button
                          key={rel.relation_id}
                          className={destructiveCls}
                          onClick={() => { onDeleteRelation(rel.relation_id); onClose(); }}
                        >
                          <span className="text-muted-foreground shrink-0 w-4">
                            {rel.direction === "from" ? "→" : "←"}
                          </span>
                          <span className="truncate flex-1">{rel.other_name}</span>
                          {rel.rel_type && (
                            <span className="text-muted-foreground shrink-0 ml-1">({rel.rel_type})</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {menu.kind === "edge" && menu.edge.relation_id && (
          <button
            className={destructiveCls}
            onClick={() => { onDeleteRelation(menu.edge.relation_id!); onClose(); }}
          >
            <Unlink className="h-3.5 w-3.5 shrink-0" />
            Remove Relation
          </button>
        )}
      </div>
    </>
  );
}

// ── Node + Edge rendering ─────────────────────────────────────────────────────

function NodeCircle({
  node, x, y, selected, onClick, onRightClick, onMouseDown,
}: {
  node: SimNode; x: number; y: number; selected: boolean;
  onClick: () => void; onRightClick?: (e: React.MouseEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
}) {
  const Icon = TYPE_ICONS[node.entry_type] ?? Tag;
  const r = node.r;
  const hasImage = !!node.image_path;
  const imgR = Math.max(r - RIM, 8);
  const iconSize = Math.round(r * 1.3);
  return (
    <g
      data-node="true"
      onClick={onClick}
      onMouseDown={onMouseDown}
      onContextMenu={e => { e.preventDefault(); onRightClick?.(e); }}
      className="cursor-pointer"
      style={{
        userSelect: "none",
        transform: `translate(${x}px, ${y}px)`,
      }}
    >
      {selected && (
        <circle r={r + 5} fill="none" stroke={node.color} strokeWidth={2} strokeOpacity={0.35} />
      )}
      <circle
        r={r}
        fill={hasImage ? "none" : `url(#${sphereGradientId(node.color)})`}
        stroke={node.color}
        strokeWidth={selected ? 2.5 : 1.5}
        className="transition-all"
      />
      {hasImage ? (
        <foreignObject x={-imgR} y={-imgR} width={imgR * 2} height={imgR * 2}>
          <div style={{ width: "100%", height: "100%", borderRadius: "9999px", overflow: "hidden", position: "relative" }}>
            <img
              src={imagesApi.url(node.image_path!)}
              alt=""
              style={
                node.image_crop
                  ? cropImageStyle(node.image_crop, imgR * 2, imgR * 2)
                  : { width: "100%", height: "100%", objectFit: "cover" }
              }
            />
          </div>
        </foreignObject>
      ) : (
        <foreignObject x={-iconSize / 2} y={-iconSize / 2} width={iconSize} height={iconSize}>
          <div className="flex items-center justify-center w-full h-full">
            <Icon size={iconSize} color="#ffffff" />
          </div>
        </foreignObject>
      )}
      <text
        y={r + 15}
        textAnchor="middle"
        fontSize={13}
        className="fill-foreground"
        style={{ fontWeight: selected ? 600 : 400 }}
      >
        {node.id.length > 14 ? node.id.slice(0, 13) + "…" : node.id}
      </text>
    </g>
  );
}

// Curvature used for all relation edges — the label midpoint below must
// match the curve's actual midpoint offset.
const EDGE_CURVE = 0.12;

function EdgePath({
  x1, y1, x2, y2, label, color, dashed, highlighted,
}: { x1: number; y1: number; x2: number; y2: number; label: string; color: string; dashed: boolean; highlighted?: boolean }) {
  // Cubic bezier midpoint sits 3/4 of the control-point offset from the chord
  const dx = x2 - x1;
  const dy = y2 - y1;
  const mx = (x1 + x2) / 2 - dy * EDGE_CURVE * 0.75;
  const my = (y1 + y2) / 2 + dx * EDGE_CURVE * 0.75;
  return (
    <g>
      <path
        d={bezierPath(x1, y1, x2, y2, EDGE_CURVE)}
        fill="none"
        stroke={color}
        strokeWidth={highlighted ? 2.5 : 1.5}
        strokeDasharray={dashed ? "4 3" : undefined}
        strokeOpacity={highlighted ? 0.95 : 0.6}
        markerEnd="url(#canvas-arrow)"
        className={dashed ? "canvas-dash-flow" : undefined}
        style={{ transition: "stroke-opacity 150ms ease, stroke-width 150ms ease" }}
      />
      {label && (
        <text x={mx} y={my - 5} textAnchor="middle" fontSize={12} fill={color} fillOpacity={highlighted ? 1 : 0.85}>
          {label}
        </text>
      )}
    </g>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RelationsPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery<GraphData>({
    queryKey: ["graph", projectId],
    queryFn: () => fetch(`/api/projects/${projectId}/graph`).then(r => r.json()),
  });

  const { data: codexEntries = [] } = useCodexEntries(projectId);
  const { data: mentionStats = [] } = useProjectMentionStats(projectId);
  const updateEntry = useUpdateCodexEntry(projectId);

  const [centerId, setCenterId] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<GraphEdge | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [dialogEntry, setDialogEntry] = useState<CodexEntry | null>(null);
  const [depth, setDepth] = useState(1);
  const [stretch, setStretch] = useState(1);
  const [menu, setMenu] = useState<MenuState>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragStart = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | null>(null);

  // Reset pan when center or depth changes so the graph stays in frame
  useEffect(() => { setPan({ x: 0, y: 0 }); }, [centerId, depth]);

  const screenDeltaToSvg = (dx: number, dy: number) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return { dx: 0, dy: 0 };
    return { dx: dx / ctm.a, dy: dy / ctm.d };
  };

  const onSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest("[data-node]")) return;
    dragStart.current = { clientX: e.clientX, clientY: e.clientY, panX: pan.x, panY: pan.y };
    setIsDragging(true);
    e.preventDefault();
  };

  const onSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragStart.current) return;
    const { dx, dy } = screenDeltaToSvg(
      e.clientX - dragStart.current.clientX,
      e.clientY - dragStart.current.clientY,
    );
    setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
  };

  const onSvgMouseUp = () => { dragStart.current = null; setIsDragging(false); };

  const onSvgDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest("[data-node]")) return;
    setPan({ x: 0, y: 0 });
  };

  const openEntryDialog = (node: GraphNode) => {
    if (!node.codex_id) return;
    const entry = codexEntries.find(e => e.id === node.codex_id);
    if (entry) setDialogEntry(entry);
  };

  const deleteRelation = async (relationId: number) => {
    await fetch(`/api/codex/relations/${relationId}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["graph", projectId] });
  };

  const openNodeMenu = (node: GraphNode, e: React.MouseEvent) => {
    if (!data) return;
    const relations: RelationItem[] = data.edges
      .filter(edge => edge.via === "codex" && edge.relation_id &&
        (edge.source === node.id || edge.target === node.id))
      .map(edge => ({
        relation_id: edge.relation_id!,
        other_name: edge.source === node.id ? edge.target : (edge.source ?? ""),
        rel_type: edge.type,
        direction: edge.source === node.id ? "from" : "to",
      }));
    setMenu({ kind: "node", x: e.clientX + 4, y: e.clientY + 4, node, relations });
  };

  const openEdgeMenu = (edge: GraphEdge, e: React.MouseEvent) => {
    if (!edge.relation_id) return;
    setMenu({ kind: "edge", x: e.clientX + 4, y: e.clientY + 4, edge });
  };

  const centerNode = useMemo(() => {
    if (!data) return null;
    let defaultId = centerId;
    if (!defaultId) {
      const mainChar = codexEntries.find(e => e.is_main_char && e.entry_type === "character");
      if (mainChar) {
        const node = data.nodes.find(n => n.codex_id === mainChar.id);
        if (node) defaultId = node.id;
      }
      if (!defaultId) {
        defaultId = data.nodes.find(n => n.entry_type === "character")?.id ?? data.nodes[0]?.id ?? null;
      }
    }
    return data.nodes.find(n => n.id === defaultId) ?? null;
  }, [data, centerId, codexEntries]);

  // Total mentions per codex entry, aggregated across scenes.
  const mentionByCodex = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of mentionStats) m.set(s.codex_id, (m.get(s.codex_id) ?? 0) + s.count);
    return m;
  }, [mentionStats]);
  const maxMentionCount = useMemo(
    () => Math.max(0, ...Array.from(mentionByCodex.values())),
    [mentionByCodex]
  );

  // ── Physics simulation ────────────────────────────────────────────────────
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const simNodesRef = useRef<Map<string, SimNode>>(new Map());
  // Manually-dragged positions — kept fixed (not released back to physics) and
  // persisted per project so groupings survive a reload.
  const pinnedRef = useRef<Record<string, { x: number; y: number }>>(loadPins(projectId));
  const [, forceRerender] = useReducer((n: number) => n + 1, 0);
  const rafPending = useRef(false);
  const scheduleRender = () => {
    if (rafPending.current) return;
    rafPending.current = true;
    requestAnimationFrame(() => { rafPending.current = false; forceRerender(); });
  };

  const visible = useMemo(() => {
    if (!data || !centerNode) return null;
    return visibleSubgraph(data, centerNode.id, depth);
  }, [data, centerNode, depth]);

  // Rebuild the simulation whenever the visible node/edge set changes.
  useEffect(() => {
    if (!data || !visible || !centerNode) return;

    const prevNodes = simNodesRef.current;
    const nodeList: SimNode[] = [...visible.nodeIds].map(nid => {
      const gnode = data.nodes.find(n => n.id === nid)!;
      const entry = gnode.codex_id ? codexEntries.find(e => e.id === gnode.codex_id) : undefined;
      const count = gnode.codex_id ? (mentionByCodex.get(gnode.codex_id) ?? 0) : 0;
      const prev = prevNodes.get(nid);
      const pin = pinnedRef.current[nid];
      return {
        id: nid,
        codex_id: gnode.codex_id,
        entry_type: gnode.entry_type,
        color: gnode.color,
        r: radiusFor(count, maxMentionCount),
        image_path: entry?.image_path ?? null,
        image_crop: entry?.image_crop ?? null,
        x: prev?.x ?? pin?.x ?? CX + (Math.random() - 0.5) * 60,
        y: prev?.y ?? pin?.y ?? CY + (Math.random() - 0.5) * 60,
        vx: prev?.vx ?? 0,
        vy: prev?.vy ?? 0,
        // A manually-dragged node stays exactly where it was dropped.
        fx: pin?.x,
        fy: pin?.y,
      };
    });

    const nodeById = new Map(nodeList.map(n => [n.id, n]));
    simNodesRef.current = nodeById;

    const center = nodeById.get(centerNode.id);
    if (center) { center.fx = CX; center.fy = CY; }

    const linkList: SimLink[] = visible.edges
      .filter(e => e.source && nodeById.has(e.source) && nodeById.has(e.target))
      .map(e => ({ source: e.source!, target: e.target, edge: e }));

    const sim = forceSimulation<SimNode>(nodeList)
      .force("link", forceLink<SimNode, SimLink>(linkList).id(d => d.id).distance(110 * stretch).strength(0.2))
      .force("charge", forceManyBody().strength(-180))
      .force("collide", forceCollide<SimNode>(d => d.r + 10))
      .force("x", forceX(CX).strength(0.02))
      .force("y", forceY(CY).strength(0.02))
      .velocityDecay(0.5)
      .alpha(1)
      .on("tick", scheduleRender);

    simRef.current = sim;
    return () => { sim.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, visible, centerNode?.id, codexEntries, mentionByCodex, maxMentionCount]);

  // Re-tune link distance live when "stretch" changes, without rebuilding the simulation.
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    const linkForce = sim.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>> | undefined;
    linkForce?.distance(110 * stretch);
    sim.alpha(0.4).restart();
  }, [stretch]);

  // ── Node dragging (springs connected nodes via the running simulation) ────
  const dragRef = useRef<{ node: SimNode; moved: boolean; startX: number; startY: number } | null>(null);
  const wasDraggedRef = useRef(false);

  const onNodeMouseDown = (node: SimNode) => (e: React.MouseEvent) => {
    e.stopPropagation();
    dragRef.current = { node, moved: false, startX: e.clientX, startY: e.clientY };

    const onMove = (ev: MouseEvent) => {
      const drag = dragRef.current;
      const svg = svgRef.current;
      if (!drag || !svg) return;
      if (!drag.moved) {
        if (Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) < 4) return;
        drag.moved = true;
        simRef.current?.alphaTarget(0.2).restart();
      }
      const pt = clientToSvgPoint(svg, ev.clientX, ev.clientY);
      drag.node.fx = pt.x - pan.x;
      drag.node.fy = pt.y - pan.y;
      scheduleRender();
    };

    const onUp = () => {
      const drag = dragRef.current;
      wasDraggedRef.current = drag?.moved ?? false;
      if (drag?.moved) {
        // Leave fx/fy set — the node stays exactly where it was dropped
        // instead of springing back into the force layout.
        if (drag.node.id !== centerNode?.id) {
          const pins = { ...pinnedRef.current, [drag.node.id]: { x: drag.node.fx as number, y: drag.node.fy as number } };
          pinnedRef.current = pins;
          savePins(projectId, pins);
        }
        simRef.current?.alphaTarget(0);
      }
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onNodeClick = (name: string) => {
    if (wasDraggedRef.current) { wasDraggedRef.current = false; return; }
    setCenterId(name);
  };

  const resetNodePosition = (nodeId: string) => {
    const { [nodeId]: _removed, ...rest } = pinnedRef.current;
    pinnedRef.current = rest;
    savePins(projectId, rest);
    const node = simNodesRef.current.get(nodeId);
    if (node && node.id !== centerNode?.id) {
      node.fx = null;
      node.fy = null;
      simRef.current?.alpha(0.6).restart();
    }
  };

  if (isLoading) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading graph…</div>;
  if (error || !data) return <div className="flex items-center justify-center h-full text-destructive text-sm">Failed to load graph</div>;
  if (!data.nodes.length) return (
    <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-8">
      <p className="mb-2">No relations yet.</p>
      <p className="text-xs">Add codex relations or use <code className="bg-secondary px-1 rounded">[rel:Name|type]</code> tags in your scenes.</p>
    </div>
  );

  const simNodes = [...simNodesRef.current.values()];
  const visibleEdges = visible?.edges ?? [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <style>{CANVAS_MOTION_CSS}</style>
      <header className="flex items-center justify-between px-6 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div>
            <h1 className="text-base font-semibold">Relations</h1>
            <p className="text-xs text-muted-foreground">{data.nodes.length} nodes · {data.edges.length} edges</p>
          </div>
          <Popover.Root>
            <Popover.Trigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title="Help"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="bottom"
                align="start"
                sideOffset={8}
                className="z-50 w-72 rounded-lg border border-border bg-popover shadow-xl p-3 text-xs text-muted-foreground space-y-2"
              >
                <ul className="space-y-1.5 list-disc list-inside">
                  <li>Drag a node to rearrange or group it — it stays put; right-click → Reset Position to release it.</li>
                  <li>Left-click a node to re-centre the graph on it.</li>
                  <li>Drag empty canvas to pan; double-click to reset.</li>
                  <li>Right-click a node or relation for more options.</li>
                </ul>
                <div className="border-t border-border pt-2 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-6 border-t border-muted-foreground" /> Codex relation
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-6 border-t border-dashed border-muted-foreground" /> Inline <code>[rel:]</code> tag
                  </div>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Depth</span>
            <input
              type="range" min={1} max={3} step={1} value={depth}
              onChange={e => setDepth(Number(e.target.value))}
              className="w-20 accent-primary"
            />
            <span className="text-xs font-medium w-3 text-center">{depth}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Stretch</span>
            <input
              type="range" min={0.5} max={3} step={0.1} value={stretch}
              onChange={e => setStretch(Number(e.target.value))}
              className="w-20 accent-primary"
            />
            <span className="text-xs font-medium w-6 text-center">{stretch.toFixed(1)}×</span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-48 border-r border-border overflow-y-auto py-2 shrink-0">
          {[...data.nodes].sort((a, b) => {
            const order: Record<string, number> = { character: 0, location: 1, item: 2, lore: 3, custom: 4 };
            return (order[a.entry_type] ?? 5) - (order[b.entry_type] ?? 5);
          }).map(n => {
            const Icon = TYPE_ICONS[n.entry_type] ?? Tag;
            const hasCodexEntry = !!n.codex_id && codexEntries.some(e => e.id === n.codex_id);
            return (
              <button
                key={n.id}
                onClick={() => hasCodexEntry ? openEntryDialog(n) : setCenterId(n.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-secondary/50 text-left",
                  centerNode?.id === n.id && "bg-secondary font-medium"
                )}
                title={hasCodexEntry ? "Click to edit entry" : undefined}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: n.color }} />
                <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="truncate">{n.id}</span>
              </button>
            );
          })}
        </aside>

        <div className="flex-1 overflow-hidden bg-background/50 relative">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="absolute inset-0 w-full h-full"
            preserveAspectRatio="xMidYMid meet"
            style={{ cursor: isDragging ? "grabbing" : "grab" }}
            onMouseDown={onSvgMouseDown}
            onMouseMove={onSvgMouseMove}
            onMouseUp={onSvgMouseUp}
            onMouseLeave={onSvgMouseUp}
            onDoubleClick={onSvgDoubleClick}
          >
            <defs>
              <CanvasGradientDefs colors={data.nodes.map(n => n.color)} />
            </defs>

            {/* Transparent background — catches drags on empty space */}
            <rect x={0} y={0} width={W} height={H} fill="transparent" />

            <g transform={`translate(${pan.x},${pan.y})`}>
              {/* Edges */}
              <g className="canvas-fade-in">
              {visibleEdges.map((edge, i) => {
                const src = edge.source ?? centerNode?.id ?? "";
                const sp = simNodesRef.current.get(src);
                const tp = simNodesRef.current.get(edge.target);
                if (!sp || !tp || sp.x == null || sp.y == null || tp.x == null || tp.y == null) return null;
                const nodeColor = data.nodes.find(n => n.id === src)?.color ?? "#6b7280";
                return (
                  <g
                    key={i}
                    onMouseEnter={e => { setHoveredEdge(edge); setHoverPos({ x: e.clientX, y: e.clientY }); }}
                    onMouseMove={e => setHoverPos({ x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => { setHoveredEdge(null); setHoverPos(null); }}
                    onContextMenu={e => { e.preventDefault(); openEdgeMenu(edge, e); }}
                    className="cursor-context-menu"
                  >
                    {/* Wider invisible hit area — follows the same curve */}
                    <path
                      d={bezierPath(sp.x, sp.y, tp.x, tp.y, 0.12)}
                      fill="none" stroke="transparent" strokeWidth={12}
                    />
                    <EdgePath
                      x1={sp.x} y1={sp.y} x2={tp.x} y2={tp.y}
                      label={edge.type} color={nodeColor} dashed={edge.via === "inline"}
                      highlighted={hoveredEdge === edge}
                    />
                  </g>
                );
              })}
              </g>

              {/* Nodes */}
              {simNodes.map((node) => {
                if (node.x == null || node.y == null) return null;
                const gnode = data.nodes.find(n => n.id === node.id);
                if (!gnode) return null;
                return (
                  <NodeCircle
                    key={node.id}
                    node={node}
                    x={node.x}
                    y={node.y}
                    selected={centerNode?.id === node.id}
                    onClick={() => onNodeClick(node.id)}
                    onMouseDown={onNodeMouseDown(node)}
                    onRightClick={e => openNodeMenu(gnode, e)}
                  />
                );
              })}
            </g>
          </svg>

          {hoveredEdge && hoverPos && (
            <div
              className="fixed z-50 pointer-events-none text-xs bg-popover border border-border rounded px-2 py-1 shadow-md text-muted-foreground flex items-center gap-1.5"
              style={{ left: hoverPos.x + 12, top: hoverPos.y + 12 }}
            >
              <Info className="h-3 w-3 shrink-0" />
              {hoveredEdge.via === "inline"
                ? `In scene: "${hoveredEdge.scene_title}" (${hoveredEdge.chapter_title})`
                : "Defined in Codex"}
            </div>
          )}
        </div>
      </div>

      {dialogEntry && (
        <CodexEntryDialog
          open={!!dialogEntry}
          onClose={() => setDialogEntry(null)}
          onSave={(data) => {
            updateEntry.mutate({ id: dialogEntry.id, data });
            setDialogEntry(null);
          }}
          initial={dialogEntry}
          title="Edit Entry"
          allEntries={codexEntries}
          onOpenRelation={(id) => {
            const entry = codexEntries.find(e => e.id === id);
            if (entry) setDialogEntry(entry);
          }}
        />
      )}

      <ContextMenu
        menu={menu}
        onClose={() => setMenu(null)}
        onDeleteRelation={deleteRelation}
        onSetCenter={id => setCenterId(id)}
        onEditEntry={openEntryDialog}
        onCopyName={name => navigator.clipboard.writeText(name)}
        onResetPosition={resetNodePosition}
      />
    </div>
  );
}
