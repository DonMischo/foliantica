"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { X, Trophy } from "lucide-react";
import { AchievementIcon } from "@/components/AchievementIcon";
import { useAchievements } from "@/store/queries";
import type { Achievement } from "@/types";
import { cn } from "@/lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────────

const HOLD_MS = 3000;
const IN_MS   = 380;
const OUT_MS  = 260;

export const ACH_POPUPS_KEY = "ach_popups_enabled";
const SEEN_KEY = "seen_achievement_keys";

// ── Tier styles ───────────────────────────────────────────────────────────────

const TIER_COLOR: Record<number, string> = {
  1: "text-zinc-400",
  2: "text-blue-400",
  3: "text-violet-400",
  4: "text-amber-400",
  5: "text-rose-400",
};

const TIER_BORDER: Record<number, string> = {
  1: "border-zinc-400/30",
  2: "border-blue-400/30",
  3: "border-violet-400/30",
  4: "border-amber-400/30",
  5: "border-rose-400/30",
};

const TIER_BG: Record<number, string> = {
  1: "bg-zinc-400",
  2: "bg-blue-400",
  3: "bg-violet-400",
  4: "bg-amber-400",
  5: "bg-rose-400",
};

const TIER_STYLES: Record<number, string> = {
  1: "text-zinc-400 bg-zinc-400/10 border-zinc-400/20",
  2: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  3: "text-violet-400 bg-violet-400/10 border-violet-400/20",
  4: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  5: "text-rose-400 bg-rose-400/10 border-rose-400/20",
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
  time_system_used: "Custom time system",
  project_info_set: "Project metadata",
  project_info_full:"Project metadata",
  queries_sent:     "AI writing queries sent",
  queries_partial:  "AI queries with partial suggestions",
  queries_full:     "AI queries accepted in full",
  queries_offer:    "AI suggestions offered",
  export_count:     "Documents exported",
  grammar_enabled:  "Grammar checker",
  pandoc_enabled:   "Pandoc export",
  research_items:   "Research items saved",
  stats_views:      "Stats page visits",
  all_human:        "AI features disabled",
  all_achievements: "All achievements earned",
  // Hidden achievement metrics
  comeback_gap:         "Largest gap between writing sessions (days)",
  perfect_month:        "Wrote every day of a calendar month",
  max_scene_words:      "Longest single scene (words)",
  lore_bomb:            "Most scenes a single codex entry appears in",
  all_codex_types:      "Built-in codex types used",
  custom_type_count:    "Custom codex types created",
  phantom_project:      "Project with 10+ codex entries and no scenes",
  projects_20k:         "Projects with 20,000+ words each",
  pantser_condition:    "10,000 words with zero codex entries",
  mirror_condition:     "Scene count matches codex entry count",
  planner_condition:    "Over half your scenes are on the corkboard",
  bibliophile_condition:"50+ research items and 50+ fragments",
  iceberg_count:        "Codex entries never mentioned in prose",
};

// ── Keyframe CSS ─────────────────────────────────────────────────────────────

const KEYFRAMES = `
@keyframes ach-plop-in {
  0%   { opacity: 0; transform: translateY(24px) scale(0.82); }
  60%  { opacity: 1; transform: translateY(-5px) scale(1.04); }
  100% { opacity: 1; transform: translateY(0)    scale(1);    }
}
@keyframes ach-plop-out {
  0%   { opacity: 1; transform: translateY(0)   scale(1);    }
  100% { opacity: 0; transform: translateY(12px) scale(0.90); }
}
@keyframes ach-timer {
  from { width: 100%; }
  to   { width: 0%;   }
}
`;

// ── Single toast ──────────────────────────────────────────────────────────────

function AchievementToast({ ach, onDone }: { ach: Achievement; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), IN_MS + HOLD_MS);
    const t2 = setTimeout(() => onDoneRef.current(), IN_MS + HOLD_MS + OUT_MS);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const dismiss = () => {
    setLeaving(true);
    setTimeout(() => onDoneRef.current(), OUT_MS);
  };

  const tierColor  = TIER_COLOR[ach.tier]  ?? TIER_COLOR[1];
  const tierBorder = TIER_BORDER[ach.tier] ?? TIER_BORDER[1];
  const tierBg     = TIER_BG[ach.tier]     ?? TIER_BG[1];

  return (
    <>
      <style>{KEYFRAMES}</style>
      <div
        style={{
          animation: leaving
            ? `ach-plop-out ${OUT_MS}ms ease-in forwards`
            : `ach-plop-in ${IN_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards`,
        }}
        className={cn(
          "w-72 rounded-xl border bg-card/95 backdrop-blur-sm shadow-2xl overflow-hidden",
          tierBorder,
        )}
      >
        <Link href="/stats" onClick={dismiss} className="block">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
            <div className="flex items-center gap-1.5">
              <Trophy className={cn("h-3.5 w-3.5", tierColor)} />
              <span className={cn("text-[11px] font-semibold uppercase tracking-wide", tierColor)}>
                Achievement Unlocked
              </span>
            </div>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismiss(); }}
              className="text-muted-foreground/40 hover:text-foreground transition-colors p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {/* Body */}
          <div className="flex items-center gap-3 px-3 py-3">
            <div className={cn(
              "w-11 h-11 shrink-0 rounded-lg flex items-center justify-center bg-muted/20 ring-1",
              tierBorder,
            )}>
              <AchievementIcon achievementKey={ach.key} className={cn("w-7 h-7", tierColor)} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight">{ach.name}</p>
              {METRIC_LABEL[ach.metric] && (
                <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wide mt-0.5">
                  {METRIC_LABEL[ach.metric]}
                </p>
              )}
            </div>
            <span className={cn(
              "shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded border",
              TIER_STYLES[ach.tier] ?? TIER_STYLES[1],
            )}>
              T{ach.tier}
            </span>
          </div>

          {/* Depleting timer bar */}
          <div className="h-0.5 bg-muted/20 overflow-hidden">
            <div
              className={cn("h-full", tierBg)}
              style={leaving ? { width: "0%" } : {
                width: "100%",
                animation: `ach-timer ${HOLD_MS}ms linear forwards`,
                animationDelay: `${IN_MS}ms`,
              }}
            />
          </div>
        </Link>
      </div>
    </>
  );
}

// ── Queue manager (exported) ──────────────────────────────────────────────────

export function AchievementToastQueue() {
  const { data: achievements = [] } = useAchievements();
  const [queue, setQueue] = useState<Achievement[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!achievements.length || initialized) return;

    const enabled = localStorage.getItem(ACH_POPUPS_KEY) !== "false";
    if (!enabled) { setInitialized(true); return; }

    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"); } catch {}
    const seenSet = new Set(seen);

    // Newly earned = earned now but not in the seen list
    const newlyEarned = achievements.filter((a) => a.earned && !seenSet.has(a.key));

    // Mark all currently earned as seen so they won't pop again next visit
    const allEarned = achievements.filter((a) => a.earned).map((a) => a.key);
    localStorage.setItem(SEEN_KEY, JSON.stringify(allEarned));

    if (newlyEarned.length) setQueue(newlyEarned);
    setInitialized(true);
  }, [achievements, initialized]);

  if (!queue.length) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 pointer-events-auto">
      <AchievementToast
        key={queue[0].key}
        ach={queue[0]}
        onDone={() => setQueue((prev) => prev.slice(1))}
      />
    </div>
  );
}
