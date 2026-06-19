"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ProseCheckResult } from "@/lib/api";

// ── Shared primitives ─────────────────────────────────────────────────────────

function MeterBar({ ratio, level }: { ratio: number; level: "ok" | "elevated" | "high" }) {
  const colors = {
    ok:       "bg-green-500",
    elevated: "bg-amber-500",
    high:     "bg-red-500",
  };
  return (
    <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
      <div
        className={cn("h-full rounded-full transition-all", colors[level])}
        style={{ width: `${Math.min(100, ratio * 100 * 6)}%` }}
      />
    </div>
  );
}

function LevelBadge({ level }: { level: "ok" | "elevated" | "high" | "good" | "moderate" | "low" | "n/a" }) {
  const map = {
    ok:       { label: "OK",       cls: "text-green-500  bg-green-500/10  border-green-500/20" },
    good:     { label: "Good",     cls: "text-green-500  bg-green-500/10  border-green-500/20" },
    elevated: { label: "Elevated", cls: "text-amber-500  bg-amber-500/10  border-amber-500/20" },
    moderate: { label: "Moderate", cls: "text-amber-500  bg-amber-500/10  border-amber-500/20" },
    high:     { label: "High",     cls: "text-red-500    bg-red-500/10    border-red-500/20" },
    low:      { label: "Low",      cls: "text-red-500    bg-red-500/10    border-red-500/20" },
    "n/a":    { label: "N/A",      cls: "text-muted-foreground bg-secondary border-border" },
  } as const;
  const cfg = map[level] ?? map["n/a"];
  return (
    <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border", cfg.cls)}>
      {cfg.label}
    </span>
  );
}

function MetricCard({ title, badge, hint, children }: {
  title: string;
  badge: React.ReactNode;
  hint: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{title}</span>
        {badge}
      </div>
      {children}
      <p className="text-[11px] text-muted-foreground leading-snug">{hint}</p>
    </div>
  );
}

// ── Sentence Variety ──────────────────────────────────────────────────────────

function SentenceVarietyCard({ data }: { data: ProseCheckResult["sentence_variety"] }) {
  const variety = data.variety as "good" | "moderate" | "low" | "n/a";
  const hints = {
    good:     "Sentence lengths vary well — readers feel natural rhythm.",
    moderate: "Some length variation, but more contrast between short and long sentences would improve pacing.",
    low:      "Most sentences are nearly the same length. Mix short punchy sentences with longer ones to create rhythm.",
    "n/a":    "Not enough text to analyse.",
  };

  return (
    <MetricCard
      title="Sentence Rhythm"
      badge={<LevelBadge level={variety} />}
      hint={hints[variety]}
    >
      <div className="flex gap-4 text-[11px]">
        <div>
          <span className="text-muted-foreground">Avg length</span>
          <span className="ml-1 font-mono tabular-nums font-semibold">{data.avg_length}w</span>
        </div>
        <div>
          <span className="text-muted-foreground">Variation (σ)</span>
          <span className="ml-1 font-mono tabular-nums font-semibold">{data.length_stddev}</span>
        </div>
      </div>

      {data.repetitive_starts.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-amber-500 font-semibold uppercase tracking-wide">Same-start runs</p>
          {data.repetitive_starts.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px]">
              <span className="font-mono bg-amber-500/10 border border-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded">
                {r.word}
              </span>
              <span className="text-muted-foreground">
                {r.count} sentences in a row (from #{r.from_sentence + 1})
              </span>
            </div>
          ))}
        </div>
      )}
    </MetricCard>
  );
}

// ── Auxiliary Density ─────────────────────────────────────────────────────────

function AuxiliaryCard({ data }: { data: ProseCheckResult["auxiliary_density"] }) {
  const flagged = data.flagged_paragraphs;
  const overall = flagged.length === 0 ? "ok"
    : flagged.some(p => p.level === "high") ? "high" : "elevated";

  const hints = {
    ok:       "Auxiliary verb usage looks balanced — no paragraphs dominated by 'was/had/wurde/était'.",
    elevated: "Some paragraphs lean heavily on auxiliary verbs. These often signal passive constructions or static description. Try replacing them with active, present-action verbs.",
    high:     "Several paragraphs are flooded with auxiliaries (was, were, had, wurde, était…). This usually makes prose feel distant and static. Rewrite key sentences with active main verbs.",
  };

  return (
    <MetricCard
      title="Auxiliary / Hilfsverb Density"
      badge={<LevelBadge level={overall} />}
      hint={hints[overall]}
    >
      {flagged.length > 0 && (
        <div className="space-y-1.5">
          {flagged.map((p, i) => (
            <div key={i} className="space-y-0.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">Paragraph {p.paragraph + 1}</span>
                <span className={cn("font-semibold tabular-nums", p.level === "high" ? "text-red-500" : "text-amber-500")}>
                  {Math.round(p.ratio * 100)}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                <div
                  className={cn("h-full rounded-full", p.level === "high" ? "bg-red-500" : "bg-amber-500")}
                  style={{ width: `${Math.min(100, p.ratio * 400)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      {flagged.length === 0 && (
        <p className="text-[11px] text-green-500 font-semibold">No paragraphs flagged ✓</p>
      )}
    </MetricCard>
  );
}

// ── Adverb Density ────────────────────────────────────────────────────────────

function AdverbCard({ data, wordCount }: { data: ProseCheckResult["adverb_density"]; wordCount: number }) {
  const level = data.level as "ok" | "elevated" | "high";
  const hints = {
    ok:       "Adverb usage is within normal range. Adverbs aren't inherently bad — only overuse weakens prose.",
    elevated: "Adverb density is above average. Check if some adverbs prop up weak verbs ('ran quickly' → 'sprinted').",
    high:     "High adverb density often signals over-modified prose. Replace adverb+verb pairs with precise single verbs where possible.",
  };

  return (
    <MetricCard
      title="Adverb Density"
      badge={<LevelBadge level={level} />}
      hint={hints[level]}
    >
      <div className="space-y-1.5">
        <MeterBar ratio={data.ratio} level={level} />
        <div className="flex gap-4 text-[11px]">
          <div>
            <span className="text-muted-foreground">Count</span>
            <span className="ml-1 font-mono font-semibold">{data.count}</span>
          </div>
          <div>
            <span className="text-muted-foreground">of words</span>
            <span className="ml-1 font-mono font-semibold">{Math.round(data.ratio * 100)}%</span>
          </div>
          <div>
            <span className="text-muted-foreground">per 100w</span>
            <span className="ml-1 font-mono font-semibold">
              {wordCount > 0 ? Math.round((data.count / wordCount) * 100) : 0}
            </span>
          </div>
        </div>
      </div>
    </MetricCard>
  );
}

// ── Dialogue Ratio ────────────────────────────────────────────────────────────

function DialogueCard({ data }: { data: ProseCheckResult["dialog"] }) {
  const pct = Math.round(data.ratio * 100);
  const narrativePct = 100 - pct;

  return (
    <MetricCard
      title="Dialogue Ratio"
      badge={<span className="text-[11px] font-mono font-semibold tabular-nums">{pct}%</span>}
      hint={
        pct === 0
          ? "No dialogue detected. If this is a dialogue-heavy scene, check that opening quotes are used."
          : pct < 20
          ? "Mostly narration. Dialogue can quicken pace and reveal character — consider if this scene needs a voice."
          : pct > 75
          ? "Scene is mostly dialogue. Make sure there's enough action and description to ground the reader."
          : "Dialogue and narration are balanced."
      }
    >
      {/* Stacked bar: dialogue vs narrative */}
      <div className="space-y-1">
        <div className="flex h-3 w-full rounded-full overflow-hidden gap-px">
          <div className="bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
          <div className="bg-secondary flex-1" />
        </div>
        <div className="flex gap-3 text-[10px] text-muted-foreground">
          <span><span className="inline-block w-2 h-2 rounded-sm bg-blue-500 mr-1 align-middle" />Dialogue {pct}%</span>
          <span><span className="inline-block w-2 h-2 rounded-sm bg-secondary mr-1 align-middle" />Narration {narrativePct}%</span>
        </div>
      </div>
    </MetricCard>
  );
}

// ── Overview stats ────────────────────────────────────────────────────────────

function OverviewRow({ result }: { result: ProseCheckResult }) {
  const stats = [
    { label: "Words",      value: result.word_count },
    { label: "Sentences",  value: result.sentence_count },
    { label: "Paragraphs", value: result.paragraph_count },
  ];
  return (
    <div className="flex gap-4 px-1">
      {stats.map(s => (
        <div key={s.label} className="text-center">
          <div className="text-lg font-bold tabular-nums">{s.value}</div>
          <div className="text-[10px] text-muted-foreground">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Dialog ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: ProseCheckResult;
}

export function ProseMetricsDialog({ open, onOpenChange, result }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Prose Metrics</DialogTitle>
          <DialogDescription>Structural analysis of your scene's prose style.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pb-2">
          <OverviewRow result={result} />

          <SentenceVarietyCard data={result.sentence_variety} />
          <AuxiliaryCard data={result.auxiliary_density} />
          <AdverbCard data={result.adverb_density} wordCount={result.word_count} />
          <DialogueCard data={result.dialog} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
