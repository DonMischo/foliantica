"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { User, MapPin, Package, Scroll, Tag, Info, Edit2, Crosshair, Copy, Unlink, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { CodexEntryDialog } from "@/components/codex/CodexEntryDialog";
import { useCodexEntries, useUpdateCodexEntry } from "@/store/queries";
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
const RADII = [0, 185, 300, 390];
const NODE_R = 28;

function radialPos(index: number, total: number, radius: number, offset = 0) {
  const angle = (2 * Math.PI * index) / total - Math.PI / 2 + offset;
  return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) };
}


// ── Context Menu ──────────────────────────────────────────────────────────────

const menuItemCls =
  "w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-secondary/60 cursor-pointer text-left text-xs";
const destructiveCls =
  "w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-destructive/10 text-destructive cursor-pointer text-left text-xs";

function ContextMenu({ menu, onClose, onDeleteRelation, onSetCenter, onEditEntry, onCopyName }: {
  menu: MenuState;
  onClose: () => void;
  onDeleteRelation: (relationId: number) => void;
  onSetCenter: (nodeId: string) => void;
  onEditEntry: (node: GraphNode) => void;
  onCopyName: (name: string) => void;
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
  node, x, y, selected, onClick, onRightClick,
}: {
  node: GraphNode; x: number; y: number; selected: boolean;
  onClick: () => void; onRightClick?: (e: React.MouseEvent) => void;
}) {
  const Icon = TYPE_ICONS[node.entry_type] ?? Tag;
  return (
    <g
      data-node="true"
      onClick={onClick}
      onContextMenu={e => { e.preventDefault(); onRightClick?.(e); }}
      className="cursor-pointer"
      style={{
        userSelect: "none",
        // CSS transform (not the SVG attribute) so position changes animate
        transform: `translate(${x}px, ${y}px)`,
        transition: "transform 400ms cubic-bezier(0.25, 1, 0.35, 1)",
      }}
    >
      {selected && (
        <circle r={NODE_R + 5} fill="none" stroke={node.color} strokeWidth={2} strokeOpacity={0.35} />
      )}
      <circle
        r={NODE_R}
        fill={`url(#${sphereGradientId(node.color)})`}
        stroke={node.color}
        strokeWidth={selected ? 2.5 : 1.5}
        className="transition-all"
      />
      <foreignObject x={-18} y={-18} width={36} height={36}>
        <div className="flex items-center justify-center w-full h-full">
          <Icon size={36} color="#ffffff" />
        </div>
      </foreignObject>
      <text
        y={NODE_R + 15}
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
  const updateEntry = useUpdateCodexEntry(projectId);

  const [centerId, setCenterId] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<GraphEdge | null>(null);
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

  const layout = useMemo(() => {
    if (!data || !centerNode) return { positions: {}, visibleEdges: [] };

    const centerName = centerNode.id;
    const positions: Record<string, { x: number; y: number }> = {};
    positions[centerName] = { x: CX, y: CY };

    let frontier = new Set<string>([centerName]);

    for (let d = 1; d <= depth; d++) {
      const nextFrontier = new Set<string>();
      for (const name of frontier) {
        for (const e of data.edges) {
          const src = e.source ?? "";
          if (src === name && !positions[e.target]) nextFrontier.add(e.target);
          if (e.target === name && src && !positions[src]) nextFrontier.add(src);
        }
      }
      const arr = [...nextFrontier];
      const baseR = RADII[d] * stretch;
      arr.forEach((name, i) => {
        // Stagger every 2nd node outward when ring has >6 nodes
        const r = arr.length > 6 && i % 2 === 1 ? baseR * 1.35 : baseR;
        positions[name] = radialPos(i, arr.length, r, Math.PI / arr.length);
      });
      frontier = nextFrontier;
    }

    const visibleEdges = data.edges.filter(
      e => positions[e.source ?? ""] && positions[e.target]
    );

    return { positions, visibleEdges };
  }, [data, centerNode, depth, stretch]);

  if (isLoading) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading graph…</div>;
  if (error || !data) return <div className="flex items-center justify-center h-full text-destructive text-sm">Failed to load graph</div>;
  if (!data.nodes.length) return (
    <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-8">
      <p className="mb-2">No relations yet.</p>
      <p className="text-xs">Add codex relations or use <code className="bg-secondary px-1 rounded">[rel:Name|type]</code> tags in your scenes.</p>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <style>{CANVAS_MOTION_CSS}</style>
      <header className="flex items-center justify-between px-6 py-3 border-b border-border">
        <div>
          <h1 className="text-base font-semibold">Relations</h1>
          <p className="text-xs text-muted-foreground">{data.nodes.length} nodes · {data.edges.length} edges · left-click to re-centre · drag to pan · double-click to reset · right-click for options</p>
        </div>
        <div className="flex items-center gap-4">
          {hoveredEdge && (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Info className="h-3 w-3" />
              {hoveredEdge.via === "inline"
                ? `In scene: "${hoveredEdge.scene_title}" (${hoveredEdge.chapter_title})`
                : "Defined in Codex"}
            </div>
          )}
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
              {/* Edges — keyed by layout so they fade in after nodes glide */}
              <g key={`${centerNode?.id}-${depth}-${stretch}`} className="canvas-fade-in">
              {layout.visibleEdges.map((edge, i) => {
                const src = edge.source ?? centerNode?.id ?? "";
                const sp = layout.positions[src];
                const tp = layout.positions[edge.target];
                if (!sp || !tp) return null;
                const nodeColor = data.nodes.find(n => n.id === src)?.color ?? "#6b7280";
                return (
                  <g
                    key={i}
                    onMouseEnter={() => setHoveredEdge(edge)}
                    onMouseLeave={() => setHoveredEdge(null)}
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
              {Object.entries(layout.positions).map(([name, pos]) => {
                const node = data.nodes.find(n => n.id === name);
                if (!node) return null;
                return (
                  <NodeCircle
                    key={name}
                    node={node}
                    x={pos.x}
                    y={pos.y}
                    selected={centerNode?.id === name}
                    onClick={() => setCenterId(name)}
                    onRightClick={e => openNodeMenu(node, e)}
                  />
                );
              })}
            </g>
          </svg>
        </div>
      </div>

      <div className="px-4 py-1.5 border-t border-border text-xs text-muted-foreground flex gap-4">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-6 border-t border-muted-foreground" /> Codex relation
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-6 border-t border-dashed border-muted-foreground" /> Inline <code>[rel:]</code> tag
        </span>
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
      />
    </div>
  );
}
