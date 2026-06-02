"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft, Flame, Trophy, PenLine, Braces,
  BookOpen, Layers, Send, Search, Star, ChevronDown,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { AchievementIcon } from "@/components/AchievementIcon";
import { useGlobalWritingLog, useProjects, useProjectGhostTexts, useAchievements, useStatsTotals, useSettings } from "@/store/queries";
import type { WritingLogEntry, Achievement, AchievementCategory } from "@/types";
import type { StatsTotals } from "@/lib/api";
import { statsApi } from "@/lib/api";
import { cn } from "@/lib/utils";

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeCurrentStreak(log: WritingLogEntry[]): number {
  const active = new Set(log.filter((e) => e.words > 0).map((e) => e.date));
  let streak = 0;
  const d = new Date();
  while (true) {
    const key = d.toISOString().split("T")[0];
    if (!active.has(key)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function computeLongestStreak(log: WritingLogEntry[]): number {
  const sorted = log
    .filter((e) => e.words > 0)
    .map((e) => e.date)
    .sort();
  if (!sorted.length) return 0;
  let max = 1, cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diff = (curr.getTime() - prev.getTime()) / 86400000;
    if (diff === 1) { cur++; if (cur > max) max = cur; }
    else cur = 1;
  }
  return max;
}

function intensity(words: number, max: number): string {
  if (!words) return "bg-muted/30";
  const pct = words / max;
  if (pct < 0.2)  return "bg-primary/20";
  if (pct < 0.4)  return "bg-primary/40";
  if (pct < 0.65) return "bg-primary/65";
  return "bg-primary";
}

// ── Full 52-week heatmap ──────────────────────────────────────────────────────

function FullHeatmap({ log }: { log: WritingLogEntry[] }) {
  const WEEKS = 52;
  const map = new Map(log.map((e) => [e.date, e.words]));
  const max = Math.max(...log.map((e) => e.words), 1);

  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - WEEKS * 7 + 1);

  const cells: { date: string; words: number; dayOfWeek: number }[] = [];
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const key = d.toISOString().split("T")[0];
    cells.push({ date: key, words: map.get(key) ?? 0, dayOfWeek: d.getDay() });
  }

  const months: { label: string; col: number }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < WEEKS; w++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + w * 7);
    const m = d.getMonth();
    if (m !== lastMonth) {
      months.push({ label: d.toLocaleString("default", { month: "short" }), col: w + 1 });
      lastMonth = m;
    }
  }

  const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];

  return (
    <div className="overflow-x-auto">
      <div className="flex mb-1 ml-8">
        <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${WEEKS}, 12px)` }}>
          {months.map(({ label, col }) => (
            <span
              key={`${label}-${col}`}
              className="text-[10px] text-muted-foreground"
              style={{ gridColumn: col }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex gap-1">
        <div className="flex flex-col gap-px mr-1">
          {DAY_LABELS.map((d, i) => (
            <span key={i} className="text-[10px] text-muted-foreground w-6 h-3 flex items-center justify-end">
              {d}
            </span>
          ))}
        </div>
        <div
          className="grid gap-px"
          style={{ gridTemplateColumns: `repeat(${WEEKS}, 12px)`, gridTemplateRows: "repeat(7, 12px)" }}
        >
          {Array.from({ length: WEEKS }, (_, w) =>
            Array.from({ length: 7 }, (_, d) => {
              const cell = cells[w * 7 + d];
              return (
                <div
                  key={`${w}-${d}`}
                  className={cn("w-3 h-3 rounded-[2px]", intensity(cell?.words ?? 0, max))}
                  title={cell ? `${cell.date}: ${cell.words.toLocaleString()} words` : ""}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ── Achievements ──────────────────────────────────────────────────────────────

const CATEGORIES: { key: AchievementCategory | "all"; label: string; icon: React.ReactNode }[] = [
  { key: "all",        label: "All",        icon: <Star className="h-3 w-3" /> },
  { key: "streaks",    label: "Streaks",    icon: <Flame className="h-3 w-3" /> },
  { key: "words",      label: "Words",      icon: <PenLine className="h-3 w-3" /> },
  { key: "codex",      label: "Codex",      icon: <BookOpen className="h-3 w-3" /> },
  { key: "story",      label: "Story",      icon: <Layers className="h-3 w-3" /> },
  { key: "publishing", label: "Publishing", icon: <Send className="h-3 w-3" /> },
  { key: "research",   label: "Research",   icon: <Search className="h-3 w-3" /> },
];

const TIER_STYLES: Record<number, string> = {
  1: "text-zinc-400 bg-zinc-400/10 border-zinc-400/20",
  2: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  3: "text-violet-400 bg-violet-400/10 border-violet-400/20",
  4: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  5: "text-rose-400 bg-rose-400/10 border-rose-400/20",
};

const TIER_COLOR: Record<number, string> = {
  1: "text-zinc-400",
  2: "text-blue-400",
  3: "text-violet-400",
  4: "text-amber-400",
  5: "text-rose-400",
};

const TIER_BG: Record<number, string> = {
  1: "bg-zinc-400",
  2: "bg-blue-400",
  3: "bg-violet-400",
  4: "bg-amber-400",
  5: "bg-rose-400",
};

const TIER_GLOW: Record<number, string> = {
  1: "",
  2: "shadow-[0_0_10px_0_rgba(96,165,250,0.12)]",
  3: "shadow-[0_0_10px_0_rgba(167,139,250,0.16)]",
  4: "shadow-[0_0_12px_0_rgba(251,191,36,0.2)]",
  5: "shadow-[0_0_14px_0_rgba(251,113,133,0.24)]",
};

const TIER_RING: Record<number, string> = {
  1: "ring-zinc-400/30",
  2: "ring-blue-400/30",
  3: "ring-violet-400/30",
  4: "ring-amber-400/30",
  5: "ring-rose-400/30",
};

const METRIC_LABEL: Record<string, string> = {
  longest_streak:   "Consecutive writing days",
  total_words:      "Total words written",
  best_day:         "Most words in a single day",
  codex_entries:    "Codex entries created",
  codex_relations:  "Relationships between characters",
  codex_mentioned:  "Codex entries mentioned in scenes",
  inventory_items:    "Items carried by characters",
  inventory_currency: "Characters with currency",
  inventory_relics:   "Relics bound to characters",
  projects:         "Projects created",
  scene_count:      "Scenes written",
  typed_scene_count:"Scenes with a type assigned",
  scene_types_used: "Different scene types used",
  corkboard_scenes: "Scenes viewed on the corkboard",
  timeline_events:  "Events on the timeline",
  fragment_count:   "Saved fragments / snippets",
  time_system_used: "Set up a custom time system in settings",
  project_info_set: "Fill in project metadata",
  project_info_full:"Complete all project metadata fields",
  queries_sent:     "AI writing queries sent",
  queries_partial:  "AI queries with partial suggestions",
  queries_full:     "AI queries accepted in full",
  queries_offer:    "AI suggestions offered",
  export_count:     "Documents exported",
  grammar_enabled:  "Enable the grammar checker in settings",
  pandoc_enabled:   "Set up Pandoc export in settings",
  research_items:   "Research items saved",
  stats_views:      "Visits to the stats page",
  all_human:        "AI features disabled — every word your own",
  all_achievements: "All achievements earned",
  // Hidden achievement metrics
  comeback_gap:         "Largest gap between writing sessions (days)",
  perfect_month:        "Wrote every day of a calendar month",
  max_scene_words:      "Longest single scene (words)",
  lore_bomb:            "Most scenes a single codex entry appears in",
  all_codex_types:      "Built-in codex types used",
  custom_type_count:    "Custom codex types created",
  phantom_project:      "Project with 10+ codex entries and no scenes",
  largest_series:       "Books in your longest series",
  pantser_condition:    "10,000 words written with zero codex entries",
  mirror_condition:     "Scene count matches codex entry count",
  planner_condition:    "Over half your scenes are on the corkboard",
  bibliophile_condition:"50+ research items and 50+ fragments",
  iceberg_count:        "Codex entries never mentioned in prose",
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

type SortMode = "smart" | "original";

// ── Chain grouping ────────────────────────────────────────────────────────────

interface AchChain {
  chain: string;
  items: Achievement[];        // sorted tier ASC, threshold ASC
  highestEarned: Achievement | null;
  nextUnearned: Achievement | null;
  earnedCount: number;
}

function groupChains(achievements: Achievement[]): AchChain[] {
  const map = new Map<string, Achievement[]>();
  for (const a of achievements) {
    if (!map.has(a.chain)) map.set(a.chain, []);
    map.get(a.chain)!.push(a);
  }
  return Array.from(map.entries()).map(([chain, raw]) => {
    const items = [...raw].sort((a, b) =>
      a.tier !== b.tier ? a.tier - b.tier : a.threshold - b.threshold
    );
    const earned   = items.filter((a) => a.earned);
    const unearned = items.filter((a) => !a.earned);
    return {
      chain,
      items,
      highestEarned: earned.at(-1) ?? null,
      nextUnearned: unearned[0] ?? null,
      earnedCount: earned.length,
    };
  });
}

function sortChains(chains: AchChain[], mode: SortMode): AchChain[] {
  if (mode === "original") return chains;
  return [...chains].sort((a, b) => {
    const aT = a.highestEarned?.tier ?? 0;
    const bT = b.highestEarned?.tier ?? 0;
    if (aT !== bT) return bT - aT;
    const aProg = a.nextUnearned ? a.nextUnearned.progress / a.nextUnearned.progress_max : 1;
    const bProg = b.nextUnearned ? b.nextUnearned.progress / b.nextUnearned.progress_max : 1;
    return bProg - aProg;
  });
}

// ── Showcase ──────────────────────────────────────────────────────────────────

function ShowcaseCard({ ach, onUnpin }: { ach: Achievement; onUnpin: () => void }) {
  const tierColor = TIER_COLOR[ach.tier] ?? TIER_COLOR[1];
  const tierStyle = TIER_STYLES[ach.tier] ?? TIER_STYLES[1];
  const tierRing  = TIER_RING[ach.tier]  ?? TIER_RING[1];
  const glow      = TIER_GLOW[ach.tier]  ?? "";
  return (
    <div className={cn(
      "relative flex flex-col items-center text-center gap-2 p-4 rounded-lg border border-border/60 bg-card/60",
      glow,
    )}>
      <button
        onClick={onUnpin}
        className="absolute top-2 right-2 text-amber-400 hover:text-amber-300 transition-colors"
        title="Remove from showcase"
      >
        <Star className="h-3.5 w-3.5 fill-amber-400" />
      </button>
      <div className={cn(
        "w-12 h-12 rounded-lg flex items-center justify-center bg-muted/20 ring-1",
        tierRing,
      )}>
        <AchievementIcon achievementKey={ach.key} className={cn("w-8 h-8", tierColor)} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold leading-tight">{ach.name}</p>
        {ach.description && (
          <p className="text-[10px] text-muted-foreground/60 italic mt-0.5 line-clamp-3 leading-snug">
            {ach.description}
          </p>
        )}
        {ach.unlocked_at && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {new Date(ach.unlocked_at).toLocaleDateString()}
          </p>
        )}
      </div>
      <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border", tierStyle)}>
        T{ach.tier}
      </span>
    </div>
  );
}

function ShowcaseSection({ achievements, pinned, onUnpin }: {
  achievements: Achievement[];
  pinned: string[];
  onUnpin: (chain: string) => void;
}) {
  const items = pinned.flatMap((chainId) => {
    const best = achievements
      .filter((a) => a.chain === chainId && a.earned)
      .sort((a, b) => b.tier - a.tier)[0];
    return best ? [{ chainId, ach: best }] : [];
  });
  if (!items.length) return null;
  return (
    <div className="mb-6">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <Star className="h-3 w-3 text-amber-400 fill-amber-400" /> Showcase
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {items.map(({ chainId, ach }) => (
          <ShowcaseCard key={chainId} ach={ach} onUnpin={() => onUnpin(chainId)} />
        ))}
      </div>
    </div>
  );
}

// ── Chain card ────────────────────────────────────────────────────────────────

function ChainCard({ chain, pinned, onPin, onUnpin }: {
  chain: AchChain;
  pinned: string[];
  onPin: (chainId: string) => void;
  onUnpin: (chainId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { items, highestEarned, nextUnearned, earnedCount } = chain;

  const displayAch = highestEarned ?? items[0];
  const tierColor  = TIER_COLOR[displayAch.tier]  ?? TIER_COLOR[1];
  const tierBg     = TIER_BG[displayAch.tier]     ?? TIER_BG[1];
  const tierStyle  = TIER_STYLES[displayAch.tier] ?? TIER_STYLES[1];
  const tierRing   = TIER_RING[displayAch.tier]   ?? TIER_RING[1];
  const glow       = highestEarned ? (TIER_GLOW[displayAch.tier] ?? "") : "";
  const isPinned   = pinned.includes(chain.chain);
  const canPin     = !!highestEarned && (isPinned || pinned.length < 6);

  return (
    <div className={cn(
      "rounded-lg border bg-card/60 overflow-hidden transition-all",
      highestEarned ? `border-border/60 ${glow}` : "border-border/25 opacity-55",
    )}>
      {/* Main row */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className={cn(
          "shrink-0 w-10 h-10 rounded-md flex items-center justify-center bg-muted/20",
          highestEarned && `ring-1 ${tierRing}`,
        )}>
          <AchievementIcon
            achievementKey={displayAch.key}
            className={cn("w-7 h-7", tierColor, !highestEarned && "opacity-30")}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5 mb-0.5">
            <p className="text-sm font-semibold leading-tight truncate">{displayAch.name}</p>
            {highestEarned?.unlocked_at && (
              <span className="text-[10px] text-muted-foreground/50 shrink-0">
                {new Date(highestEarned.unlocked_at).toLocaleDateString()}
              </span>
            )}
          </div>

          {METRIC_LABEL[displayAch.metric] && (
            <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wide mb-0.5">
              {METRIC_LABEL[displayAch.metric]}
            </p>
          )}

          {highestEarned && displayAch.description && (
            <p className="text-[11px] text-muted-foreground/60 italic leading-snug mb-1 line-clamp-2">
              {displayAch.description}
            </p>
          )}

          {/* Tier pills — shown when chain has multiple items */}
          {items.length > 1 && (
            <div className="flex items-center gap-1 mt-0.5">
              {items.map((a) => (
                <div
                  key={a.key}
                  title={`T${a.tier}: ${a.name}`}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    a.earned ? (TIER_BG[a.tier] ?? TIER_BG[1]) : "bg-muted/40",
                  )}
                  style={{ width: items.length > 8 ? "10px" : "14px" }}
                />
              ))}
              <span className="text-[10px] text-muted-foreground/60 ml-0.5 tabular-nums">
                {earnedCount}/{items.length}
              </span>
            </div>
          )}

          {/* Progress bar for next unearned */}
          {nextUnearned && (
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-1 bg-muted/30 rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full", TIER_BG[nextUnearned.tier] ?? TIER_BG[1])}
                  style={{ width: `${Math.min(100, Math.round((nextUnearned.progress / nextUnearned.progress_max) * 100))}%` }}
                />
              </div>
              <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                {fmt(nextUnearned.progress)}/{fmt(nextUnearned.progress_max)}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Pin to showcase button */}
          {highestEarned && (
            <button
              onClick={() => isPinned ? onUnpin(chain.chain) : onPin(chain.chain)}
              disabled={!canPin}
              title={isPinned ? "Remove from showcase" : pinned.length >= 6 ? "Showcase full (max 6)" : "Add to showcase"}
              className={cn(
                "p-1 rounded transition-colors",
                isPinned
                  ? "text-amber-400 hover:text-amber-300"
                  : canPin
                    ? "text-muted-foreground/30 hover:text-muted-foreground"
                    : "text-muted-foreground/15 cursor-not-allowed",
              )}
            >
              <Star className={cn("h-3.5 w-3.5", isPinned && "fill-amber-400")} />
            </button>
          )}

          <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border", tierStyle)}>
            T{displayAch.tier}
          </span>

          {items.length > 1 && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="text-muted-foreground/50 hover:text-foreground transition-colors p-0.5"
            >
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", expanded && "rotate-180")} />
            </button>
          )}
        </div>
      </div>

      {/* Expanded tier history */}
      {expanded && items.length > 1 && (
        <div className="border-t border-border/20 px-3 py-2 space-y-2 bg-muted/5">
          {items.map((a) => (
            <div key={a.key} className="flex items-start gap-2">
              <span className={cn(
                "shrink-0 mt-0.5 text-[9px] font-mono px-1 py-0.5 rounded border w-6 text-center",
                TIER_STYLES[a.tier] ?? TIER_STYLES[1],
              )}>
                T{a.tier}
              </span>
              <div className="flex-1 min-w-0">
                <p className={cn("text-xs leading-tight", a.earned ? "" : "text-muted-foreground/50")}>
                  {a.name}
                </p>
                {a.earned && a.description && (
                  <p className="text-[10px] text-muted-foreground/50 italic leading-snug mt-0.5">
                    {a.description}
                  </p>
                )}
              </div>
              {a.earned && a.unlocked_at ? (
                <span className="text-[10px] text-muted-foreground/50 shrink-0 mt-0.5">
                  {new Date(a.unlocked_at).toLocaleDateString()}
                </span>
              ) : !a.earned ? (
                <div className="flex items-center gap-1.5 shrink-0 mt-1">
                  <div className="w-14 h-1 bg-muted/30 rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", TIER_BG[a.tier] ?? TIER_BG[1])}
                      style={{ width: `${Math.min(100, Math.round((a.progress / a.progress_max) * 100))}%` }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums text-muted-foreground/50">
                    {fmt(a.progress)}/{fmt(a.progress_max)}
                  </span>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Achievements section ──────────────────────────────────────────────────────

function AchievementsSection({ achievements, aiDisabled }: { achievements: Achievement[]; aiDisabled: boolean }) {
  const [activeCategory, setActiveCategory] = useState<AchievementCategory | "all">("all");
  const [sortMode, setSortMode] = useState<SortMode>("smart");
  const [pinned, setPinned] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("ach_showcase") ?? "[]"); }
    catch { return []; }
  });

  const onPin = (chainId: string) => setPinned((prev) => {
    if (prev.includes(chainId) || prev.length >= 6) return prev;
    const next = [...prev, chainId];
    localStorage.setItem("ach_showcase", JSON.stringify(next));
    return next;
  });

  const onUnpin = (chainId: string) => setPinned((prev) => {
    const next = prev.filter((c) => c !== chainId);
    localStorage.setItem("ach_showcase", JSON.stringify(next));
    return next;
  });

  // Hidden achievements — revealed only when earned
  const hiddenAchs = achievements.filter((a) => a.hidden);

  // Visible achievements: exclude all hidden + exclude all_human when AI is on and not yet earned
  const visibleAchs = useMemo(() => achievements.filter((a) => {
    if (a.hidden) return false;
    if (a.chain === "all_human" && !aiDisabled && !a.earned) return false;
    return true;
  }), [achievements, aiDisabled]);

  const filtered = useMemo(() =>
    activeCategory === "all" ? visibleAchs : visibleAchs.filter((a) => a.category === activeCategory),
  [visibleAchs, activeCategory]);

  const chains = useMemo(() => sortChains(groupChains(filtered), sortMode), [filtered, sortMode]);

  const earnedCount = visibleAchs.filter((a) => a.earned).length;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold">Achievements</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">{earnedCount} / {visibleAchs.length}</span>
          <button
            onClick={() => setSortMode((m) => m === "smart" ? "original" : "smart")}
            className="text-[10px] text-muted-foreground hover:text-foreground border border-border/50 rounded px-1.5 py-0.5 transition-colors"
          >
            {sortMode === "smart" ? "Smart" : "Default"}
          </button>
        </div>
      </div>

      <ShowcaseSection achievements={visibleAchs} pinned={pinned} onUnpin={onUnpin} />

      <div className="flex flex-wrap gap-1.5 mb-5">
        {CATEGORIES.map(({ key, label, icon }) => {
          const count = key === "all"
            ? visibleAchs.filter((a) => a.earned).length
            : visibleAchs.filter((a) => a.category === key && a.earned).length;
          return (
            <button
              key={key}
              onClick={() => setActiveCategory(key)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                activeCategory === key
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "bg-transparent border-border/50 text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {icon}
              {label}
              <span className="text-[10px] opacity-60 tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-1.5">
        {chains.map((chain) => (
          <ChainCard key={chain.chain} chain={chain} pinned={pinned} onPin={onPin} onUnpin={onUnpin} />
        ))}
      </div>

      {/* Hidden challenges — chain revealed once any tier is earned */}
      {(() => {
        const hiddenChains = groupChains(hiddenAchs).filter((c) => c.earnedCount > 0);
        if (!hiddenChains.length) return null;
        return (
          <div className="mt-6">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Trophy className="h-3 w-3 text-rose-400" /> Hidden Challenges
            </p>
            <div className="space-y-1.5">
              {hiddenChains.map((chain) => (
                <ChainCard key={chain.chain} chain={chain} pinned={pinned} onPin={onPin} onUnpin={onUnpin} />
              ))}
            </div>
          </div>
        );
      })()}
    </section>
  );
}

// ── Chart helpers ────────────────────────────────────────────────────────────

const PIE_COLORS = ["#6366f1", "#8b5cf6", "#3b82f6", "#14b8a6", "#f59e0b", "#f43f5e", "#10b981", "#f97316"];

const AXIS = { tick: { fill: "#6b7280", fontSize: 11 }, axisLine: { stroke: "#1f2937" }, tickLine: false as const };
const GRID = { stroke: "#1f2937", vertical: false as const };
const TIP  = { contentStyle: { background: "#111827", border: "1px solid #1f2937", borderRadius: 6, fontSize: 12 }, labelStyle: { color: "#9ca3af" }, itemStyle: { color: "#e5e7eb" }, cursor: { fill: "rgba(255,255,255,0.03)" } };

function ChartCard({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-card border border-border rounded-lg p-4", className)}>
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">{title}</p>
      {children}
    </div>
  );
}

function ThisWeekChart({ log }: { log: WritingLogEntry[] }) {
  const data = useMemo(() => {
    const today = new Date();
    const dow = today.getDay();
    const mondayOffset = dow === 0 ? 6 : dow - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - mondayOffset);
    const map = new Map(log.map((e) => [e.date, e.words]));
    const todayKey = today.toISOString().split("T")[0];
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const key = d.toISOString().split("T")[0];
      return { day, words: map.get(key) ?? 0, today: key === todayKey };
    });
  }, [log]);

  return (
    <ChartCard title="This week">
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={data} barSize={24} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="day" {...AXIS} />
          <YAxis {...AXIS} width={40} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)} />
          <Tooltip {...TIP} />
          <Bar dataKey="words" radius={[3, 3, 0, 0]}>
            {data.map((e, i) => (
              <Cell key={i} fill={e.today ? "#6366f1" : "#4f46e5"} fillOpacity={e.words === 0 ? 0.2 : 0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function DayOfWeekChart({ data }: { data: StatsTotals["day_of_week"] }) {
  const maxWords = Math.max(...data.map((d) => d.words), 1);
  const best  = data.reduce((a, b) => (b.words > a.words ? b : a), data[0])?.day;
  const least = data.filter((d) => d.words > 0).reduce((a, b) => (b.words < a.words ? b : a), data.find((d) => d.words > 0) ?? data[0])?.day;

  return (
    <ChartCard title="By day of week">
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={data} barSize={24} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="day" {...AXIS} />
          <YAxis {...AXIS} width={40} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)} />
          <Tooltip {...TIP} />
          <Bar dataKey="words" radius={[3, 3, 0, 0]}>
            {data.map((e, i) => (
              <Cell key={i} fill={e.day === best ? "#f59e0b" : "#4f46e5"} fillOpacity={e.words === 0 ? 0.15 : 0.8} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {best && maxWords > 0 && (
        <p className="text-[10px] text-muted-foreground mt-1">
          Most productive: <span className="text-amber-400">{best}</span>
          {least && least !== best && <> · Least: <span className="opacity-60">{least}</span></>}
        </p>
      )}
    </ChartCard>
  );
}

function CumulativeChart({ log }: { log: WritingLogEntry[] }) {
  const data = useMemo(() => {
    const sorted = [...log].filter((e) => e.words > 0).sort((a, b) => a.date.localeCompare(b.date));
    let cum = 0;
    return sorted.map((e) => ({ date: e.date.slice(5), words: (cum += e.words) }));
  }, [log]);

  if (data.length < 2) return null;
  return (
    <ChartCard title="Cumulative activity growth">
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="date" {...AXIS} interval="preserveStartEnd" />
          <YAxis {...AXIS} width={44} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
          <Tooltip {...TIP} cursor={{ stroke: "#6366f1", strokeWidth: 1, fill: "transparent" }} />
          <Area type="monotone" dataKey="words" stroke="#6366f1" strokeWidth={2} fill="url(#cumGrad)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function ProjectWordsChart({ data }: { data: StatsTotals["project_words"] }) {
  const filtered = data.filter((p) => p.words > 0);
  if (!filtered.length) return null;
  const total = filtered.reduce((s, p) => s + p.words, 0);
  return (
    <ChartCard title="Words per project">
      <div className="flex items-center gap-4">
        <ResponsiveContainer width={110} height={110}>
          <PieChart>
            <Pie data={filtered} dataKey="words" cx="50%" cy="50%" outerRadius={52} innerRadius={28} strokeWidth={0}>
              {filtered.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} fillOpacity={0.85} />)}
            </Pie>
            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 6, fontSize: 12 }} formatter={(v) => [Number(v).toLocaleString(), "words"]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex-1 space-y-1.5 min-w-0">
          {filtered.map((p, i) => (
            <div key={p.id} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
              <p className="text-xs text-muted-foreground truncate flex-1">{p.title}</p>
              <p className="text-xs tabular-nums shrink-0 text-muted-foreground">{Math.round((p.words / total) * 100)}%</p>
            </div>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

function PovChart({ data }: { data: StatsTotals["pov_words"] }) {
  if (!data.length) return null;
  const total = data.reduce((s, p) => s + p.words, 0);
  return (
    <ChartCard title="POV screen time">
      <div className="flex items-center gap-4">
        <ResponsiveContainer width={110} height={110}>
          <PieChart>
            <Pie data={data} dataKey="words" cx="50%" cy="50%" outerRadius={52} innerRadius={28} strokeWidth={0}>
              {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} fillOpacity={0.85} />)}
            </Pie>
            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 6, fontSize: 12 }} formatter={(v) => [Number(v).toLocaleString(), "words"]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex-1 space-y-1.5 min-w-0">
          {data.map((p, i) => (
            <div key={p.name} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
              <p className="text-xs text-muted-foreground truncate flex-1">{p.name}</p>
              <p className="text-xs tabular-nums shrink-0 text-muted-foreground">{Math.round((p.words / total) * 100)}%</p>
            </div>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

function SceneLengthChart({ data }: { data: StatsTotals["scene_length_buckets"] }) {
  if (!data.length) return null;
  return (
    <ChartCard title="Scene length distribution">
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={data} barSize={36} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="range" {...AXIS} />
          <YAxis {...AXIS} width={36} allowDecimals={false} />
          <Tooltip {...TIP} formatter={(v) => [`${Number(v)} scenes`, "count"]} />
          <Bar dataKey="count" radius={[3, 3, 0, 0]} fill="#8b5cf6" fillOpacity={0.8} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function MovingAverageChart({ log }: { log: WritingLogEntry[] }) {
  const data = useMemo(() => {
    const sorted = [...log].sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length < 2) return [];
    const map = new Map(sorted.map((e) => [e.date, e.words]));
    const first = new Date(sorted[0].date);
    const last  = new Date(sorted[sorted.length - 1].date);
    const days: { date: string; words: number; avg: number }[] = [];
    const cur = new Date(first);
    while (cur <= last) {
      const key = cur.toISOString().split("T")[0];
      days.push({ date: key, words: map.get(key) ?? 0, avg: 0 });
      cur.setDate(cur.getDate() + 1);
    }
    for (let i = 0; i < days.length; i++) {
      const slice = days.slice(Math.max(0, i - 6), i + 1);
      days[i].avg = Math.round(slice.reduce((s, d) => s + d.words, 0) / slice.length);
    }
    return days.slice(-90).map((d) => ({ ...d, date: d.date.slice(5) }));
  }, [log]);

  if (data.length < 7) return null;
  return (
    <ChartCard title="Daily output & 7-day average">
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="date" {...AXIS} interval={Math.floor(data.length / 6)} />
          <YAxis {...AXIS} width={44} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
          <Tooltip {...TIP} />
          <Line type="monotone" dataKey="words" stroke="#4f46e5" strokeWidth={1} dot={false} strokeOpacity={0.35} name="Daily" />
          <Line type="monotone" dataKey="avg"   stroke="#f59e0b" strokeWidth={2} dot={false} name="7-day avg" />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StatsPage() {
  useEffect(() => { statsApi.pingView().catch(() => {}); }, []);

  const { data: log = [] } = useGlobalWritingLog();
  const { data: projects = [] } = useProjects();
  const { data: achievements = [] } = useAchievements();
  const { data: totals } = useStatsTotals();
  const { data: settings } = useSettings();
  const aiDisabled = settings?.ai_disabled ?? false;

  const firstProject = projects[0];
  const { data: ghostScenes = [] } = useProjectGhostTexts(firstProject?.id ?? 0);

  const currentStreak = computeCurrentStreak(log);
  const longestStreak = computeLongestStreak(log);
  const totalWords    = totals?.total_words ?? 0;

  const thisWeek = useMemo(() => {
    const d = new Date();
    const start = new Date(d);
    start.setDate(d.getDate() - 6);
    const startKey = start.toISOString().split("T")[0];
    return log.filter((e) => e.date >= startKey).reduce((s, e) => s + e.words, 0);
  }, [log]);

  const thisMonth = useMemo(() => {
    const prefix = new Date().toISOString().slice(0, 7);
    return log.filter((e) => e.date.startsWith(prefix)).reduce((s, e) => s + e.words, 0);
  }, [log]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4 flex items-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/10 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-bold">Writing Stats</h1>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-10">

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { icon: Flame,   label: "Current streak", value: `${currentStreak}d`, color: "text-orange-400" },
            { icon: Trophy,  label: "Longest streak",  value: `${longestStreak}d`, color: "text-yellow-400" },
            { icon: PenLine, label: "This week",        value: thisWeek.toLocaleString(), color: "text-primary" },
            { icon: PenLine, label: "This month",       value: thisMonth.toLocaleString(), color: "text-primary" },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="bg-card border border-border rounded-lg p-4 flex flex-col gap-1">
              <Icon className={cn("h-4 w-4 mb-1", color)} />
              <p className="text-2xl font-bold tabular-nums">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        {/* Heatmap */}
        <section>
          <h2 className="text-sm font-semibold mb-4">Activity — last 52 weeks</h2>
          {log.length === 0 ? (
            <p className="text-sm text-muted-foreground">No writing activity recorded yet. Start writing to see your heatmap!</p>
          ) : (
            <div className="bg-card border border-border rounded-lg p-4">
              <FullHeatmap log={log} />
              <div className="flex items-center gap-1.5 mt-3 justify-end">
                <span className="text-[10px] text-muted-foreground">Less</span>
                {["bg-muted/30", "bg-primary/20", "bg-primary/40", "bg-primary/65", "bg-primary"].map((c) => (
                  <div key={c} className={cn("w-3 h-3 rounded-[2px]", c)} />
                ))}
                <span className="text-[10px] text-muted-foreground">More</span>
              </div>
            </div>
          )}
        </section>

        {/* Analytics charts */}
        {(log.length > 0 || totals) && (
          <section>
            <h2 className="text-sm font-semibold mb-4">Analytics</h2>
            <div className="space-y-4">
              {log.length > 0 && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <ThisWeekChart log={log} />
                    {totals?.day_of_week.some((d) => d.words > 0) && (
                      <DayOfWeekChart data={totals.day_of_week} />
                    )}
                  </div>
                  <CumulativeChart log={log} />
                  <MovingAverageChart log={log} />
                </>
              )}
              {totals && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <ProjectWordsChart data={totals.project_words} />
                    <PovChart data={totals.pov_words} />
                  </div>
                  <SceneLengthChart data={totals.scene_length_buckets} />
                </>
              )}
            </div>
          </section>
        )}

        {/* Ghost text tracker */}
        {ghostScenes.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Braces className="h-4 w-4 text-amber-400" />
              <h2 className="text-sm font-semibold">Pending placeholders — {firstProject?.title}</h2>
            </div>
            <div className="space-y-2">
              {ghostScenes.map((scene) => (
                <Link
                  key={scene.scene_id}
                  href={`/projects/${firstProject?.id}/scenes/${scene.scene_id}`}
                  className="block bg-card border border-border rounded-lg px-4 py-3 hover:border-amber-400/40 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-sm font-medium">{scene.scene_title}</p>
                    <span className="text-[10px] text-muted-foreground">{scene.act_title} › {scene.chapter_title}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {scene.ghost_texts.map((t, i) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded bg-amber-400/10 text-amber-300 font-mono italic">
                        {t}
                      </span>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Achievements */}
        {achievements.length > 0 && <AchievementsSection achievements={achievements} aiDisabled={aiDisabled} />}

        <p className="text-xs text-muted-foreground text-center pb-4">
          {totalWords.toLocaleString()} words tracked in total
        </p>
      </main>
    </div>
  );
}
