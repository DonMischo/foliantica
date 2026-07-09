"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Calendar, Settings2, Plus, Pencil, Trash2, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTimelineV2, useTimeConfig, useUpdateTimeConfig } from "@/store/queries";
import { TimeConfigDialog } from "@/components/time/TimeConfigDialog";
import { DEFAULT_TIME_CONFIG, type TimelineTrack, type TimelineEventItem, type SceneTime, type TimeUnit } from "@/types";
import { timelineTracksApi, timelineEventsApi, type TimelineNode } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { sphereGradientId, verticalConnectorPath, CARD_LIFT, CANVAS_MOTION_CSS } from "@/lib/canvasStyle";
import { CanvasGradientDefs } from "@/components/canvas/GradientDefs";

// ── Constants ─────────────────────────────────────────────────────────────────

const LEFT_MARGIN = 60;
const RIGHT_MARGIN = 40;
const NODE_W = 110;
const LANE_HEIGHT = 64;
const AXIS_OFFSET = 8;
const RULER_H = 36;
const CARD_H = 44; // height of a node card — used to ensure cards above axis aren't clipped

// ── Helper functions ──────────────────────────────────────────────────────────

function sortKeyToTick(sortKey: number[], units: TimeUnit[]): number {
  const enabled = units.filter(u => u.enabled);
  const n = enabled.length;
  if (n === 0 || sortKey.length === 0) return 0;
  const mults = new Array(n).fill(1);
  for (let i = n - 2; i >= 0; i--) {
    mults[i] = mults[i + 1] * (enabled[i + 1].count_per_parent ?? 1000);
  }
  return sortKey.reduce((s, v, i) => s + (i < n ? (v || 0) * mults[i] : 0), 0);
}

function assignLanes(nodes: { x: number; id: string }[], minGap: number): Map<string, number> {
  const sorted = [...nodes].sort((a, b) => a.x - b.x);
  const laneRightEdge: number[] = [];
  const result = new Map<string, number>();
  for (const node of sorted) {
    let lane = laneRightEdge.findIndex(r => node.x - r >= minGap);
    if (lane === -1) { lane = laneRightEdge.length; laneRightEdge.push(-Infinity); }
    laneRightEdge[lane] = node.x + NODE_W;
    result.set(node.id, lane);
  }
  return result;
}

function laneToY(lane: number, laneH: number): number {
  const level = Math.floor(lane / 2) + 1;
  const above = lane % 2 === 0;
  return above ? -(level * laneH + AXIS_OFFSET) : (level * laneH + AXIS_OFFSET);
}

// "Nice" multipliers — scale up the base tick interval to keep count ≤ MAX_TICKS.
const RULER_NICE = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000,
                    10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
const MAX_TICKS = 10;

// Convert an absolute tick to a readable label by decomposing it into unit values.
// Trailing zero components (units the user left blank) are omitted.
// e.g. tick for Y1337 M3 (no day/hour) → "Y1337\nM3"   (multiline=true)
//      tick for Y1337 M3 D15 H12       → "Y1337 M3\nD15 H12"
// For 1-2 unit systems uses the full singular name ("Year 1337").
// multiline=true splits the parts across 2 lines (useful for labels on the canvas).
function tickToLabel(tick: number, units: TimeUnit[], upToIdx: number, multiline = false): string {
  const enabled = units.filter(u => u.enabled);
  const n = enabled.length;
  if (n === 0) return "";
  const mults = new Array(n).fill(1);
  for (let i = n - 2; i >= 0; i--)
    mults[i] = mults[i + 1] * (enabled[i + 1].count_per_parent ?? 1000);
  const target = Math.min(upToIdx, n - 1);
  const parts: string[] = [];
  const vals: number[] = [];
  let rem = Math.round(Math.max(0, tick));
  for (let i = 0; i <= target; i++) {
    const val = Math.floor(rem / mults[i]);
    rem = Math.max(0, rem - val * mults[i]);
    vals.push(val);
    const u = enabled[i];
    if (u.value_names && u.value_names[val - 1]) {
      parts.push(u.value_names[val - 1]);
    } else {
      const pfx = n > 2 ? u.singular[0].toUpperCase() : u.singular;
      parts.push(`${pfx}${val}`);
    }
  }
  // Trim trailing zeros (units the user didn't fill in)
  let end = parts.length;
  while (end > 1 && vals[end - 1] === 0) end--;
  const trimmed = parts.slice(0, end);
  if (!multiline || trimmed.length < 2) return trimmed.join(" ");
  const mid = Math.ceil(trimmed.length / 2);
  return trimmed.slice(0, mid).join(" ") + "\n" + trimmed.slice(mid).join(" ");
}

function rulerTicks(
  startTick: number,
  endTick: number,
  units: TimeUnit[],
  trackWidthPx: number,
): { x: number; label: string; chosenIdx: number }[] {
  const enabled = units.filter(u => u.enabled);
  const n = enabled.length;
  if (endTick <= startTick || trackWidthPx <= 0 || n === 0) return [];
  const mults = new Array(n).fill(1);
  for (let i = n - 2; i >= 0; i--) mults[i] = mults[i + 1] * (enabled[i + 1].count_per_parent ?? 1000);

  const range = endTick - startTick;
  const targetInterval = range / MAX_TICKS;

  let chosenIdx = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (mults[i] <= targetInterval) { chosenIdx = i; break; }
  }

  const baseInterval = mults[chosenIdx];
  if (baseInterval <= 0) return [];

  const rawCount = range / baseInterval;
  const niceMult = rawCount <= MAX_TICKS
    ? 1
    : (RULER_NICE.find(m => rawCount / m <= MAX_TICKS) ?? Math.ceil(rawCount / MAX_TICKS));
  const step = baseInterval * niceMult;

  const ticks: { x: number; label: string; chosenIdx: number }[] = [];
  const first = Math.ceil(startTick / step) * step;
  for (let t = first; t <= endTick && ticks.length < MAX_TICKS; t += step) {
    const x = ((t - startTick) / range) * trackWidthPx;
    ticks.push({ x, label: tickToLabel(t, units, chosenIdx, true), chosenIdx });
  }
  return ticks;
}

function sortKeyFromTimeData(td: SceneTime, units: TimeUnit[]): number[] {
  const enabled = units.filter(u => u.enabled);
  return enabled.map(u => td[u.id] ?? 0);
}

// ── Shared reusable components (module-level to avoid remount on re-render) ────

function TimeGrid({ label, units, vals, onChange }: {
  label: string;
  units: TimeUnit[];
  vals: SceneTime;
  onChange: (unitId: string, raw: string) => void;
}) {
  if (units.length === 0) return null;
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="grid grid-cols-2 gap-1.5">
        {units.map(unit => (
          <div key={unit.id} className="space-y-0.5">
            <span className="text-[10px] text-muted-foreground">{unit.singular}</span>
            <Input
              type="text"
              inputMode="numeric"
              value={vals[unit.id] ?? ""}
              placeholder="—"
              onChange={e => onChange(unit.id, e.target.value.replace(/[^0-9]/g, ""))}
              className="h-7 text-xs"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function SubplotFilter({ filter, onChange, availableSubplots, colColors }: {
  filter: string;
  onChange: (v: string) => void;
  availableSubplots: string[];
  colColors: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const options = [
    { value: "all", label: "All", color: null as string | null },
    { value: "main", label: "Main plot", color: colColors["__main__"] ?? null },
    ...availableSubplots.map(s => ({ value: s, label: s, color: colColors[s] ?? null })),
  ];
  const current = options.find(o => o.value === filter) ?? options[0];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 h-7 rounded-md border border-input bg-background px-2 text-xs hover:bg-secondary/50 focus:outline-none"
      >
        {current.color && <span style={{ width: 7, height: 7, borderRadius: "50%", background: current.color, flexShrink: 0 }} />}
        {current.label}
        <span className="opacity-40 ml-0.5">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 min-w-[140px] rounded-md border border-border bg-popover shadow-md py-1">
          {options.map(opt => (
            <button
              key={opt.value}
              className={cn(
                "w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-secondary",
                opt.value === filter && "bg-secondary/80",
              )}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              <span style={{
                width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                background: opt.color ?? "transparent",
                border: opt.color ? "none" : "1px solid currentColor",
                opacity: opt.color ? 1 : 0.3,
              }} />
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── TrackVisualization ────────────────────────────────────────────────────────

interface TrackVizProps {
  nodes: TimelineNode[];
  units: TimeUnit[];
  trackStartTime?: SceneTime | null;
  trackEndTime?: SceneTime | null;
  onSceneClick: (sceneId: number) => void;
  onEventClick: (node: TimelineNode) => void;
  minSpacing: number;
}

function TrackVisualization({
  nodes,
  units,
  trackStartTime,
  trackEndTime,
  onSceneClick,
  onEventClick,
  minSpacing,
}: TrackVizProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState(1);

  // Drag-to-scroll state
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartScroll = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // If the click originated from an interactive card, let it through normally
    if ((e.target as HTMLElement).closest("button")) return;
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartScroll.current = containerRef.current?.scrollLeft ?? 0;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.style.cursor = "grabbing";
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStartX.current;
    if (containerRef.current) containerRef.current.scrollLeft = dragStartScroll.current - dx;
  }, []);

  const onPointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    e.currentTarget.style.cursor = "grab";
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width || 800);
    return () => ro.disconnect();
  }, []);

  // Mousewheel zoom, centered on cursor position
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // let horizontal trackpad scroll through
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      setZoom(prev => {
        const next = Math.max(0.5, Math.min(20, prev * factor));
        requestAnimationFrame(() => {
          const baseW = rect.width - LEFT_MARGIN - RIGHT_MARGIN;
          const oldContentX = el.scrollLeft + cursorX;
          const fraction = (oldContentX - LEFT_MARGIN) / Math.max(1, baseW * prev);
          el.scrollLeft = Math.max(0, LEFT_MARGIN + fraction * baseW * next - cursorX);
        });
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const enabled = units.filter(u => u.enabled);

  const ticks = useMemo(
    () => nodes.map(n => sortKeyToTick(n.sort_key, units)),
    [nodes, units],
  );

  const { startTick, endTick } = useMemo(() => {
    let st =
      trackStartTime && Object.keys(trackStartTime).length > 0
        ? sortKeyToTick(sortKeyFromTimeData(trackStartTime, units), units)
        : undefined;
    let et =
      trackEndTime && Object.keys(trackEndTime).length > 0
        ? sortKeyToTick(sortKeyFromTimeData(trackEndTime, units), units)
        : undefined;

    if (ticks.length === 0) {
      return { startTick: st ?? 0, endTick: et ?? 100 };
    }
    const minT = Math.min(...ticks);
    const maxT = Math.max(...ticks);
    const pad = Math.max(1, (maxT - minT) * 0.05);
    return {
      startTick: st ?? minT - pad,
      endTick: et ?? maxT + pad,
    };
  }, [ticks, trackStartTime, trackEndTime, units]);

  const trackW = (width - LEFT_MARGIN - RIGHT_MARGIN) * zoom;

  const nodeXs = useMemo(() => {
    const range = endTick - startTick || 1;
    return nodes.map((_, i) => {
      const t = ticks[i];
      return LEFT_MARGIN + ((t - startTick) / range) * trackW;
    });
  }, [nodes, ticks, startTick, endTick, trackW]);

  const lanes = useMemo(
    () => assignLanes(nodes.map((n, i) => ({ id: n.id, x: nodeXs[i] })), minSpacing),
    [nodes, nodeXs, minSpacing],
  );

  const laneValues = Array.from(lanes.values());
  const maxLane = laneValues.length > 0 ? Math.max(0, ...laneValues) : 0;
  const lanesAbove = Math.floor(maxLane / 2) + 1;
  const lanesBelow = Math.ceil((maxLane + 1) / 2);
  // axisY must leave room for cards sitting above it (CARD_H) + axis offset
  const axisY = lanesAbove * LANE_HEIGHT + CARD_H;
  const vizH = axisY + lanesBelow * LANE_HEIGHT + RULER_H + 32;

  const tRuler = useMemo(
    () => rulerTicks(startTick, endTick, units, trackW),
    [startTick, endTick, units, trackW],
  );

  if (nodes.length === 0) {
    return (
      <div className="px-4 py-6 text-xs text-muted-foreground text-center">
        No nodes in this track yet.
      </div>
    );
  }

  const totalWidth = Math.max(300, trackW + LEFT_MARGIN + RIGHT_MARGIN);

  // Per-node data used by both the SVG layer and the card layer
  const DOT_R = 5; // dot radius — connectors stop this far short of the axis
  const nodeData = nodes.map((node, i) => {
    const x = nodeXs[i];
    const lane = lanes.get(node.id) ?? 0;
    const yOffset = laneToY(lane, LANE_HEIGHT);
    const cardTop = axisY + yOffset;
    const isAbove = yOffset < 0;
    // Card's actual rendered top (above cards are lifted by 32px — see card layer).
    const cardRenderTop = cardTop - (isAbove ? 32 : 0);
    // Connector runs between the card edge nearest the axis and just short of the
    // dot, so it never crosses the axis line or passes through the dot.
    let connTop: number, connHeight: number;
    if (isAbove) {
      const cardBottom = cardRenderTop + CARD_H;
      connTop = cardBottom;
      connHeight = Math.max(0, (axisY - DOT_R) - cardBottom);
    } else {
      connTop = axisY + DOT_R;
      connHeight = Math.max(0, cardRenderTop - connTop);
    }
    const isScene = node.type === "scene";
    const dotColor = isScene
      ? `hsl(${((node.scene_id ?? 0) * 53 + 180) % 360} 55% 60%)`
      : (node.color ?? "#6b7280");
    return { x, lane, yOffset, cardTop, connTop, connHeight, isScene, dotColor };
  });

  return (
    // overflow-hidden: no scrollbar track rendered at all — drag handles panning
    <div
      ref={containerRef}
      className="w-full overflow-hidden select-none"
      style={{ cursor: "grab" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerLeave={onPointerEnd}
      onDoubleClick={() => setZoom(1)}
      title={zoom !== 1 ? `Zoom ${Math.round(zoom * 100)}% — double-click to reset` : undefined}
    >
      <div style={{ position: "relative", height: vizH, width: totalWidth }}>

        {/* ── SVG layer: axis, connectors, dots, ruler ticks ───────────────── */}
        <svg
          style={{ position: "absolute", inset: 0, width: totalWidth, height: vizH, pointerEvents: "none", overflow: "visible" }}
          aria-hidden
        >
          <defs>
            <CanvasGradientDefs colors={nodeData.map(nd => nd.dotColor)} />
            {/* userSpaceOnUse: a horizontal line has a zero-height bounding box,
                so an objectBoundingBox gradient degenerates and paints nothing. */}
            <linearGradient id="tl-axis" gradientUnits="userSpaceOnUse"
              x1={LEFT_MARGIN} y1={0} x2={LEFT_MARGIN + trackW} y2={0}>
              <stop offset="0%" stopColor="hsl(var(--border))" stopOpacity={0.25} />
              <stop offset="8%" stopColor="hsl(var(--border))" stopOpacity={1} />
              <stop offset="92%" stopColor="hsl(var(--border))" stopOpacity={1} />
              <stop offset="100%" stopColor="hsl(var(--border))" stopOpacity={0.25} />
            </linearGradient>
          </defs>

          {/* Axis line — soft-fades at both ends */}
          <line
            x1={LEFT_MARGIN} y1={axisY}
            x2={LEFT_MARGIN + trackW} y2={axisY}
            stroke="url(#tl-axis)"
            strokeWidth={2}
          />

          {/* Ruler tick marks */}
          {tRuler.map((tick, i) => (
            <line
              key={i}
              x1={LEFT_MARGIN + tick.x} y1={axisY + 2}
              x2={LEFT_MARGIN + tick.x} y2={axisY + 8}
              stroke="hsl(var(--border))"
              strokeWidth={1}
            />
          ))}

          {/* Start / end caps — taller tick at axis endpoints when track has explicit bounds */}
          {trackStartTime && Object.keys(trackStartTime).length > 0 && (
            <line x1={LEFT_MARGIN} y1={axisY - 7} x2={LEFT_MARGIN} y2={axisY + 9}
              stroke="hsl(var(--muted-foreground))" strokeWidth={2} opacity={0.7} />
          )}
          {trackEndTime && Object.keys(trackEndTime).length > 0 && (
            <line x1={LEFT_MARGIN + trackW} y1={axisY - 7} x2={LEFT_MARGIN + trackW} y2={axisY + 9}
              stroke="hsl(var(--muted-foreground))" strokeWidth={2} opacity={0.7} />
          )}

          {/* Per-node: connector + dot */}
          {nodeData.map((nd, i) => (
            <g key={nodes[i].id} style={{ transition: "transform 300ms ease" }}>
              <path
                d={verticalConnectorPath(nd.x, nd.connTop, nd.x, nd.connTop + nd.connHeight)}
                fill="none"
                stroke={nd.dotColor}
                strokeWidth={1.2}
                opacity={0.4}
              />
              <circle
                cx={nd.x} cy={axisY} r={5}
                fill={`url(#${sphereGradientId(nd.dotColor)})`}
                stroke={nd.dotColor}
                strokeWidth={1}
                strokeOpacity={0.5}
              />
            </g>
          ))}
        </svg>

        {/* ── Start / end time labels (above the axis) ────────────────────── */}
        {trackStartTime && Object.keys(trackStartTime).length > 0 && (
          <span style={{
            position: "absolute", left: LEFT_MARGIN + 5, top: axisY - 30,
            fontSize: 10, color: "hsl(var(--muted-foreground))", whiteSpace: "pre",
            lineHeight: 1.4, pointerEvents: "none", opacity: 0.85, fontWeight: 500,
          }}>
            {tickToLabel(startTick, units, enabled.length - 1, true)}
          </span>
        )}
        {trackEndTime && Object.keys(trackEndTime).length > 0 && (
          <span style={{
            position: "absolute", left: LEFT_MARGIN + trackW - 5, top: axisY - 30,
            fontSize: 10, color: "hsl(var(--muted-foreground))", whiteSpace: "pre",
            lineHeight: 1.4, transform: "translateX(-100%)",
            pointerEvents: "none", opacity: 0.85, fontWeight: 500,
          }}>
            {tickToLabel(endTick, units, enabled.length - 1, true)}
          </span>
        )}

        {/* ── Ruler labels (HTML for crisp font rendering) ─────────────────── */}
        {tRuler.map((tick, i) => {
          const pct = trackW > 0 ? tick.x / trackW : 0.5;
          return (
            <span
              key={i}
              style={{
                position: "absolute",
                left: LEFT_MARGIN + tick.x,
                top: axisY + 12,
                fontSize: 10,
                color: "hsl(var(--muted-foreground))",
                whiteSpace: "pre",
                lineHeight: 1.4,
                pointerEvents: "none",
                transform: `translateX(${Math.round(pct * -100)}%)`,
              }}
            >
              {tick.label}
            </span>
          );
        })}

        {/* ── Node cards ────────────────────────────────────────────────────── */}
        {nodes.map((node, i) => {
          const { x, yOffset, cardTop, isScene, dotColor } = nodeData[i];
          return (
            <button
              key={node.id}
              onClick={() => {
                if (isScene && node.scene_id) onSceneClick(node.scene_id);
                else onEventClick(node);
              }}
              style={{
                position: "absolute",
                left: x,
                top: cardTop - (yOffset < 0 ? 32 : 0),
                transform: "translateX(-50%)",
                width: NODE_W,
                textAlign: "left",
                cursor: "pointer",
                // Inline transition overrides CARD_LIFT's transition-all, so
                // list every animated property here explicitly.
                transition: "left 300ms ease, top 300ms ease, box-shadow 200ms ease, background-color 150ms ease",
              }}
              className={cn(
                "rounded-md border border-border/60 bg-card px-2 py-1.5 hover:bg-secondary/60",
                CARD_LIFT,
              )}
              title={node.title}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
                <span className="text-xs font-medium truncate" style={{ maxWidth: 84 }}>
                  {node.title.length > 13 ? node.title.slice(0, 12) + "…" : node.title}
                </span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                {node.day_night === "Night" ? (
                  <Moon className="h-2.5 w-2.5 shrink-0 text-[hsl(262_80%_65%)]" />
                ) : node.day_night === "Day" ? (
                  <Sun className="h-2.5 w-2.5 shrink-0 text-[hsl(38_92%_55%)]" />
                ) : null}
                <span className="truncate">{node.time_display}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── TrackDialog ───────────────────────────────────────────────────────────────

interface TrackDialogProps {
  open: boolean;
  initial: Partial<TimelineTrack> | null;
  units: TimeUnit[];
  onClose: () => void;
  onSave: (data: Partial<TimelineTrack>) => void;
}

function TrackDialog({ open, initial, units, onClose, onSave }: TrackDialogProps) {
  const [name, setName] = useState("Timeline");
  const [color, setColor] = useState("#6b7280");
  const [trackType, setTrackType] = useState("parallel");
  const [startTime, setStartTime] = useState<SceneTime>({});
  const [endTime, setEndTime] = useState<SceneTime>({});

  const enabledUnits = units.filter(u => u.enabled);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "Timeline");
      setColor(initial?.color ?? "#6b7280");
      setTrackType(initial?.track_type ?? "parallel");
      setStartTime((initial?.start_time as SceneTime) ?? {});
      setEndTime((initial?.end_time as SceneTime) ?? {});
    }
  }, [open, initial]);

  const applyTimeVal = (setter: React.Dispatch<React.SetStateAction<SceneTime>>, unitId: string, raw: string) => {
    const n = raw === "" ? undefined : Number(raw);
    setter(prev => {
      const next = { ...prev };
      if (n == null || isNaN(n)) delete next[unitId];
      else next[unitId] = n;
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{initial?.id ? "Edit Track" : "New Track"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="flex gap-3">
            <div className="space-y-1 flex-1">
              <Label className="text-xs">Type</Label>
              <select
                value={trackType}
                onChange={e => setTrackType(e.target.value)}
                className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="parallel">Parallel</option>
                <option value="alternate">Alternate</option>
                <option value="past">Past</option>
                <option value="future">Future</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Color</Label>
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="h-8 w-14 rounded-md border border-input bg-background cursor-pointer"
              />
            </div>
          </div>
          {enabledUnits.length > 0 && (
            <>
              <TimeGrid
                label="Start time (optional)"
                units={enabledUnits}
                vals={startTime}
                onChange={(id, raw) => applyTimeVal(setStartTime, id, raw)}
              />
              <TimeGrid
                label="End time (optional)"
                units={enabledUnits}
                vals={endTime}
                onChange={(id, raw) => applyTimeVal(setEndTime, id, raw)}
              />
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            onClick={() => {
              onSave({
                name, color, track_type: trackType,
                start_time: Object.keys(startTime).length > 0 ? startTime : null,
                end_time: Object.keys(endTime).length > 0 ? endTime : null,
              });
              onClose();
            }}
            disabled={!name.trim()}
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── EventDialog ───────────────────────────────────────────────────────────────

interface EventDialogProps {
  open: boolean;
  initial: Partial<TimelineEventItem> | null;
  tracks: TimelineTrack[];
  units: TimeUnit[];
  defaultTrackId?: number | null;
  onClose: () => void;
  onSave: (data: Partial<TimelineEventItem>) => void;
  onDelete?: () => void;
}

function EventDialog({ open, initial, tracks, units, defaultTrackId, onClose, onSave, onDelete }: EventDialogProps) {
  const [title, setTitle] = useState("Untitled Event");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#6b7280");
  const [trackId, setTrackId] = useState<number | null>(null);
  const [timeVals, setTimeVals] = useState<SceneTime>({});

  const enabledUnits = units.filter(u => u.enabled);

  useEffect(() => {
    if (open) {
      setTitle(initial?.title ?? "Untitled Event");
      setDescription(initial?.description ?? "");
      setColor(initial?.color ?? "#6b7280");
      setTrackId(initial?.track_id ?? defaultTrackId ?? null);
      setTimeVals(initial?.scene_time ?? {});
    }
  }, [open, initial, defaultTrackId]);

  const setVal = (unitId: string, raw: string) => {
    const n = raw === "" ? undefined : Number(raw);
    setTimeVals(prev => {
      const next = { ...prev };
      if (n == null || isNaN(n)) delete next[unitId];
      else next[unitId] = n;
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{initial?.id ? "Edit Event" : "New Event"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>
          <div className="flex gap-3">
            {tracks.length > 0 && (
              <div className="space-y-1 flex-1">
                <Label className="text-xs">Track</Label>
                <select
                  value={trackId ?? ""}
                  onChange={e => setTrackId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">— none —</option>
                  {tracks.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Color</Label>
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="h-8 w-14 rounded-md border border-input bg-background cursor-pointer"
              />
            </div>
          </div>
          {enabledUnits.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">Time</Label>
              <div className="grid grid-cols-2 gap-2">
                {enabledUnits.map(unit => {
                  const hasNames = unit.value_names.length > 0;
                  const maxVal = unit.count_per_parent ?? undefined;
                  return (
                    <div key={unit.id} className="space-y-0.5">
                      <span className="text-[10px] text-muted-foreground">{unit.singular}</span>
                      {hasNames && unit.value_names.length <= 60 ? (
                        <select
                          value={timeVals[unit.id] ?? ""}
                          onChange={e => setVal(unit.id, e.target.value)}
                          className="w-full h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="">—</option>
                          {unit.value_names.map((name, i) => (
                            <option key={i} value={i + 1}>{name}</option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={timeVals[unit.id] ?? ""}
                          placeholder="—"
                          onChange={e => setVal(unit.id, e.target.value.replace(/[^0-9]/g, ""))}
                          className="h-7 text-xs"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 pt-1">
          {initial?.id && onDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto text-muted-foreground hover:text-destructive gap-1.5"
              onClick={() => {
                if (confirm("Delete this event?")) { onDelete(); onClose(); }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            onClick={() => {
              const sceneTime = Object.keys(timeVals).length > 0 ? timeVals : null;
              onSave({ title, description: description || null, color, track_id: trackId, scene_time: sceneTime });
              onClose();
            }}
            disabled={!title.trim()}
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TimelinePage() {
  const { id } = useParams();
  const projectId = Number(id);
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading, error } = useTimelineV2(projectId);
  const { data: configData } = useTimeConfig(projectId);
  const updateTimeConfig = useUpdateTimeConfig(projectId);

  const [configOpen, setConfigOpen] = useState(false);
  const [spacing, setSpacing] = useState(90);
  const [filter, setFilter] = useState<string>("all");
  const [trackDialogOpen, setTrackDialogOpen] = useState(false);
  const [editingTrack, setEditingTrack] = useState<TimelineTrack | null>(null);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TimelineEventItem | null>(null);
  const [newEventTrackId, setNewEventTrackId] = useState<number | null>(null);

  const timeConfig = configData ?? DEFAULT_TIME_CONFIG;
  const units = data?.config.units ?? timeConfig.units;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["timeline-v2", projectId] });
    qc.invalidateQueries({ queryKey: ["timeline-tracks", projectId] });
    qc.invalidateQueries({ queryKey: ["timeline-events", projectId] });
  };

  const [storedSubplots, setStoredSubplots] = useState<string[]>([]);
  const [colColors, setColColors] = useState<Record<string, string>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`lw_subplots_${projectId}`);
      const parsed = JSON.parse(raw ?? "[]");
      if (Array.isArray(parsed)) setStoredSubplots(parsed);
    } catch {}
    try {
      const raw = localStorage.getItem(`lw_col_colors_${projectId}`);
      const parsed = JSON.parse(raw ?? "{}");
      if (parsed && typeof parsed === "object") setColColors(parsed);
    } catch {}
  }, [projectId]);

  const availableSubplots = useMemo(() => {
    const fromApi = data?.available_subplots ?? [];
    return [...new Set([...storedSubplots, ...fromApi])];
  }, [storedSubplots, data]);

  const filteredStoryNodes = useMemo(() => {
    if (!data) return [];
    const nodes = data.story_nodes;
    if (filter === "main") return nodes.filter(n => !n.subplot);
    if (filter !== "all") return nodes.filter(n => n.subplot === filter);
    return nodes;
  }, [data, filter]);

  // ── Track CRUD ──────────────────────────────────────────────────────────────

  const handleSaveTrack = async (body: Partial<TimelineTrack>) => {
    if (editingTrack?.id) {
      await timelineTracksApi.update(projectId, editingTrack.id, body);
    } else {
      const nextOrder = (data?.tracks.length ?? 0);
      await timelineTracksApi.create(projectId, { ...body, order_index: nextOrder });
    }
    invalidate();
    setEditingTrack(null);
  };

  const handleDeleteTrack = async (trackId: number) => {
    if (!confirm("Delete this track and all its events?")) return;
    await timelineTracksApi.delete(projectId, trackId);
    invalidate();
  };

  // ── Event CRUD ──────────────────────────────────────────────────────────────

  const handleSaveEvent = async (body: Partial<TimelineEventItem>) => {
    if (editingEvent?.id) {
      await timelineEventsApi.update(projectId, editingEvent.id, body);
    } else {
      await timelineEventsApi.create(projectId, { ...body, track_id: newEventTrackId });
    }
    invalidate();
    setEditingEvent(null);
    setNewEventTrackId(null);
  };

  const handleDeleteEvent = async (eventId: number) => {
    // Confirmation is handled by the caller (the dialog's Delete button).
    await timelineEventsApi.delete(projectId, eventId);
    invalidate();
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading timeline…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-full text-destructive text-sm">
        Failed to load timeline
      </div>
    );
  }

  const { tracks, event_nodes } = data;

  const eventNodeForEdit = (node: TimelineNode): TimelineEventItem => ({
    id: node.event_id!,
    project_id: projectId,
    track_id: node.track_id ?? null,
    title: node.title,
    description: node.description ?? null,
    scene_time: node.sort_key.length > 0 ? Object.fromEntries(
      units.filter(u => u.enabled).map((u, i) => [u.id, node.sort_key[i]] as [string, number])
    ) : null,
    color: node.color ?? "#6b7280",
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <style>{CANVAS_MOTION_CSS}</style>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0 gap-4 flex-wrap">
        <div>
          <h1 className="text-base font-semibold">Timeline</h1>
          <p className="text-xs text-muted-foreground">
            {data.story_nodes.length} scene{data.story_nodes.length !== 1 ? "s" : ""} with time · {tracks.length} track{tracks.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Spacing
            <input
              type="range"
              min={40}
              max={200}
              value={spacing}
              onChange={e => setSpacing(Number(e.target.value))}
              className="w-20 accent-primary"
            />
          </label>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setConfigOpen(true)}>
            <Settings2 className="h-3.5 w-3.5" />
            Time config
          </Button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {/* Story track */}
        <div className="border-b border-border">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-secondary/20">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Story</span>
              <span className="text-xs text-muted-foreground">· {filteredStoryNodes.length} scenes</span>
            </div>
            <SubplotFilter
              filter={filter}
              onChange={setFilter}
              availableSubplots={availableSubplots}
              colColors={colColors}
            />
          </div>
          {filteredStoryNodes.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted-foreground text-xs">
              <Calendar className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>No scenes have a time set yet.</p>
              <p className="mt-1">Open a scene and use the Time button in the toolbar.</p>
            </div>
          ) : (
            <TrackVisualization
              nodes={filteredStoryNodes}
              units={units}
              onSceneClick={sceneId => router.push(`/projects/${projectId}/scenes/${sceneId}`)}
              onEventClick={() => {}}
              minSpacing={spacing}
            />
          )}
        </div>

        {/* User tracks */}
        {tracks.map(track => {
          const trackEvents = event_nodes.filter(n => n.track_id === track.id);
          return (
            <div key={track.id} className="border-b border-border">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
                <div className="flex items-center gap-2">
                  <span
                    style={{ width: 10, height: 10, borderRadius: "50%", background: track.color, flexShrink: 0 }}
                  />
                  <span className="text-sm font-medium">{track.name}</span>
                  <span className="text-xs text-muted-foreground capitalize opacity-70">{track.track_type}</span>
                  <span className="text-xs text-muted-foreground">· {trackEvents.length} events</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs gap-1"
                    onClick={() => {
                      setNewEventTrackId(track.id);
                      setEditingEvent(null);
                      setEventDialogOpen(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> Event
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => {
                      setEditingTrack(track);
                      setTrackDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDeleteTrack(track.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <TrackVisualization
                nodes={trackEvents}
                units={units}
                trackStartTime={track.start_time}
                trackEndTime={track.end_time}
                onSceneClick={() => {}}
                onEventClick={node => {
                  setEditingEvent(eventNodeForEdit(node));
                  setNewEventTrackId(null);
                  setEventDialogOpen(true);
                }}
                minSpacing={spacing}
              />
            </div>
          );
        })}

        {/* Add Track button */}
        <div className="px-4 py-3">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
            onClick={() => {
              setEditingTrack(null);
              setTrackDialogOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add Track
          </Button>
        </div>
      </div>

      {/* Dialogs */}
      <TrackDialog
        open={trackDialogOpen}
        initial={editingTrack}
        units={units}
        onClose={() => { setTrackDialogOpen(false); setEditingTrack(null); }}
        onSave={handleSaveTrack}
      />

      <EventDialog
        open={eventDialogOpen}
        initial={editingEvent}
        tracks={tracks}
        units={units}
        defaultTrackId={newEventTrackId}
        onClose={() => { setEventDialogOpen(false); setEditingEvent(null); setNewEventTrackId(null); }}
        onSave={handleSaveEvent}
        onDelete={editingEvent?.id ? () => handleDeleteEvent(editingEvent.id) : undefined}
      />

      <TimeConfigDialog
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        initial={timeConfig}
        onSave={cfg => { updateTimeConfig.mutate(cfg); invalidate(); }}
      />
    </div>
  );
}
