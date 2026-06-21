"use client";

import { useState, useEffect, useCallback } from "react";
import { X, ChevronRight, ChevronDown, GraduationCap } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

// ── SVG section mapping ───────────────────────────────────────────────────────

const SECTION_SVG: Record<string, string> = {
  "5.1": "01_show_dont_tell.svg",
  "7.2": "02_editors_notes.svg",
  "4.2": "03_pacing_matrix.svg",
  "2.3": "04_character_arcs.svg",
  "10.1": "06_three_act_structure.svg",
  "6.1": "07_dialogue_rules.svg",
  "9.3": "08_self_edit_checklist.svg",
  "10.2": "10_save_the_cat_detail.svg",
};

// Beat structures SVG is shown at the chapter 10 overview level
const CHAPTER_SVG: Record<number, string> = {
  10: "09_beat_structures.svg",
};

// Maps section IDs to craft_examples topic keys
const SECTION_EXAMPLES: Record<string, string> = {
  "1.1": "rules_and_mindset",
  "1.2": "reading_habit",
  "1.3": "writing_habit",
  "2.4": "character_depth",
  "3.3": "info_dumping",
  "4.2": "pacing",
  "5.1": "show_dont_tell",
  "5.2": "purple_prose",
  "5.3": "active_passive_voice",
  "5.4": "adverb_dependency",
  "5.5": "cliches",
  "5.6": "pov_head_hopping",
  "5.7": "sentence_variety",
  "6.1": "dialogue",
};

// ── German SVG text substitutions ────────────────────────────────────────────

const SVG_DE: Record<string, string> = {
  "BEAT STRUCTURE FRAMEWORKS — AT A GLANCE": "BEATSTRUKTUR-ÜBERSICHT",
  "All six major frameworks mapped to story position · choose the one that fits your genre and working style":
    "Alle sechs Hauptstrukturen · wähle die, die zu deinem Genre und Arbeitsstil passt",
  "THREE-ACT": "DREIAKTER",
  "ACT I — Setup": "AKT I — Aufbau",
  "ACT II — Confrontation": "AKT II — Konfrontation",
  "HERO'S JOURNEY (12 STAGES)": "HELDENREISE (12 STUFEN)",
  "Ordinary World": "Gew. Welt",
  "Call to Adventure": "Ruf",
  "Refusal": "Verweigerung",
  "Meeting Mentor": "Mentor",
  "Threshold": "Schwelle",
  "Approach Cave": "Annäherung",
  "Ordeal": "Prüfung",
  "Reward": "Belohnung",
  "Road Back": "Rückweg",
  "Resurrection": "Auferstehung",
  "7-POINT STRUCTURE (Wells)": "7-PUNKTE-STRUKTUR (Wells)",
  "8-POINT ARC (Watts)": "8-PUNKTE-BOGEN (Watts)",
  "FREYTAG'S PYRAMID": "FREYTAGS PYRAMIDE",
  "QUICK COMPARISON": "KURZVERGLEICH",
  "FRAMEWORK": "STRUKTUR",
  "COMPLEXITY": "KOMPLEXITÄT",
  "BEST GENRE": "GENRE",
  "KEY STRENGTH": "STÄRKE",
  "KEY WEAKNESS": "SCHWÄCHE",
  "Universal": "Universell",
  "Genre fiction": "Genreliteratur",
  "Works with everything": "Für alles geeignet",
  "Too broad alone": "Allein zu grob",
  "Precise pacing targets": "Präzise Tempo-Ziele",
  "Can feel formulaic": "Kann formelhaft wirken",
  "Archetypal depth": "Archetypische Tiefe",
  "Return stage awkward": "Rückkehr schwierig",
  "Classical foundation": "Klassische Grundlage",
  "Modern pacing mismatch": "Modernes Tempo passt nicht",
  "MIDPOINT": "WENDEPUNKT",
  "ACT I → II": "AKT I → II",
  "II → III": "II → III",
};

function applyDeTranslation(svg: string): string {
  let out = svg;
  for (const [en, de] of Object.entries(SVG_DE)) {
    out = out.replaceAll(en, de);
  }
  return out;
}

// ── Module-level cache ────────────────────────────────────────────────────────

let _data: any = null;
let _attrMap: Record<string, any> | null = null;
const _svgCache: Record<string, string> = {};

// ── Chapter label map (matches i18n keys) ─────────────────────────────────────

const CHAPTER_I18N: Record<number, string> = {
  1: "compendium_ch1",
  2: "compendium_ch2",
  3: "compendium_ch3",
  4: "compendium_ch4",
  5: "compendium_ch5",
  6: "compendium_ch6",
  7: "compendium_ch7",
  8: "compendium_ch8",
  9: "compendium_ch9",
  10: "compendium_ch10",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SvgPanel({ file, locale }: { file: string; locale: string }) {
  const [svg, setSvg] = useState<string | null>(_svgCache[file] ?? null);

  useEffect(() => {
    if (_svgCache[file]) { setSvg(_svgCache[file]); return; }
    fetch(`/compendium/${file}`)
      .then((r) => r.text())
      .then((raw) => {
        _svgCache[file] = raw;
        setSvg(raw);
      });
  }, [file]);

  if (!svg) return <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">Loading diagram…</div>;

  const content = locale === "de" ? applyDeTranslation(svg) : svg;
  return (
    <div
      className="w-full rounded-lg overflow-hidden border border-border/50 mb-6"
      dangerouslySetInnerHTML={{ __html: content.replace("<svg", '<svg style="width:100%;height:auto;display:block;"') }}
    />
  );
}

function Tag({ children, color = "secondary" }: { children: React.ReactNode; color?: "secondary" | "green" | "yellow" | "red" }) {
  return (
    <span className={cn(
      "inline-block text-[11px] rounded px-1.5 py-0.5 mr-1 mb-1",
      color === "secondary" && "bg-secondary text-muted-foreground",
      color === "green"     && "bg-green-500/10 text-green-500",
      color === "yellow"    && "bg-yellow-500/10 text-yellow-600",
      color === "red"       && "bg-red-500/10 text-red-500",
    )}>
      {children}
    </span>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-xs mb-1">
      <span className="text-muted-foreground w-28 shrink-0">{label}</span>
      <span className="text-foreground">{children}</span>
    </div>
  );
}

function BeatsList({ beats }: { beats: any[] }) {
  return (
    <div className="space-y-2 mt-3">
      {beats.map((b: any) => (
        <div key={b.number ?? b.id} className="border border-border rounded-lg p-3">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-xs font-bold text-foreground">{b.number ?? b.id}. {b.name}</span>
            {b.pct_start != null && (
              <span className="text-[10px] text-muted-foreground/60 tabular-nums">~{b.pct_start}–{b.pct_end}%</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{b.function ?? b.description}</p>
          {b.craft_note && (
            <p className="text-[11px] text-muted-foreground/70 italic mt-1 leading-relaxed border-l-2 border-border pl-2">{b.craft_note}</p>
          )}
          {b.key_events && (
            <ul className="mt-1 space-y-0.5">
              {b.key_events.map((e: string, i: number) => (
                <li key={i} className="text-[11px] text-muted-foreground flex gap-1.5">
                  <span className="text-muted-foreground/40 shrink-0">·</span>{e}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function SnowflakeSteps({ steps }: { steps: any[] }) {
  return (
    <div className="space-y-2 mt-3">
      {steps.map((s: any) => (
        <div key={s.number} className="border border-border rounded-lg p-3">
          <p className="text-xs font-bold text-foreground mb-1">{s.number}. {s.name}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{s.description}</p>
          {s.craft_note && (
            <p className="text-[11px] text-muted-foreground/70 italic mt-1 leading-relaxed border-l-2 border-border pl-2">{s.craft_note}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function CraftExamples({ examples, locale }: { examples: any; locale: string }) {
  if (!examples?.entries?.length) return null;
  const filtered = examples.entries.filter((e: any) => e.language === locale);
  const items = filtered.length > 0 ? filtered : examples.entries.filter((e: any) => e.language === "en");
  if (!items.length) return null;
  return (
    <div className="mt-6 border-t border-border pt-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Dos &amp; Don&apos;ts</p>
      <div className="space-y-3">
        {items.map((e: any) => (
          <div key={e.id} className="border border-border rounded-lg p-3 space-y-2">
            {e.principle && <p className="text-xs font-medium text-foreground/80">{e.principle}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="bg-red-500/5 border border-red-500/20 rounded p-2">
                <p className="text-[10px] font-bold text-red-400 mb-1">✗ Don&apos;t</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{e.bad}</p>
              </div>
              <div className="bg-green-500/5 border border-green-500/20 rounded p-2">
                <p className="text-[10px] font-bold text-green-500 mb-1">✓ Do</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{e.good}</p>
              </div>
            </div>
            {e.note && <p className="text-[11px] text-muted-foreground/70 italic border-l-2 border-border pl-2">{e.note}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountsList({ accounts }: { accounts: any[] }) {
  return (
    <div className="space-y-3">
      {accounts.map((a: any, i: number) => (
        <div key={i} className="border border-border rounded-lg p-3">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-xs font-bold text-primary">{a.handle}</span>
            <span className="text-[10px] text-muted-foreground/60">{a.platform}</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{a.description}</p>
          {a.url && (
            <a href={a.url} target="_blank" rel="noopener noreferrer"
              className="text-[11px] text-primary/70 hover:text-primary mt-1 block truncate">
              {a.url}
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function ClassicalResources({ resources }: { resources: any[] }) {
  return (
    <div className="space-y-3">
      {resources.map((r: any, i: number) => (
        <div key={i} className="border border-border rounded-lg p-3">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-xs font-bold text-foreground">{r.title}</span>
            <span className="text-[10px] text-muted-foreground/60">— {r.author}, {r.year}</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mt-1">{r.description}</p>
          {r.pdf_url && (
            <a href={r.pdf_url} target="_blank" rel="noopener noreferrer"
              className="text-[11px] text-primary/70 hover:text-primary mt-1.5 inline-block">
              PDF ↗
            </a>
          )}
          {r.gutenberg_url && (
            <a href={r.gutenberg_url} target="_blank" rel="noopener noreferrer"
              className="text-[11px] text-primary/70 hover:text-primary mt-1.5 inline-block">
              Project Gutenberg ↗
            </a>
          )}
          {r.free_url && (
            <a href={r.free_url} target="_blank" rel="noopener noreferrer"
              className="text-[11px] text-primary/70 hover:text-primary mt-1.5 inline-block">
              Full text ↗
            </a>
          )}
          {r.archive_url && (
            <a href={r.archive_url} target="_blank" rel="noopener noreferrer"
              className="text-[11px] text-primary/70 hover:text-primary mt-1.5 inline-block">
              Internet Archive ↗
            </a>
          )}
          {r.note && <p className="text-[11px] text-muted-foreground/60 italic mt-1">{r.note}</p>}
        </div>
      ))}
    </div>
  );
}

function Sources({ ids }: { ids: string[] }) {
  if (!ids?.length || !_attrMap) return null;
  const entries = ids.map((id) => _attrMap![id]).filter(Boolean);
  if (!entries.length) return null;
  return (
    <div className="mt-6 border-t border-border pt-4">
      <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2">Sources</p>
      <ul className="space-y-2">
        {entries.map((e: any) => (
          <li key={e.id} className="text-[11px] text-muted-foreground leading-relaxed">
            {e.type === "quote" ? (
              <>
                <span className="italic">&ldquo;{e.text}&rdquo;</span>
                {" — "}
                <span className="font-medium">{e.attributed_to}</span>
                {e.source_work && <span className="text-muted-foreground/60">, {e.source_work}</span>}
                {e.url && (
                  <a href={e.url} target="_blank" rel="noopener noreferrer"
                    className="ml-1 text-primary/60 hover:text-primary">↗</a>
                )}
              </>
            ) : (
              <>
                <span className="font-medium">{e.attributed_to}</span>
                {e.source_work && <span className="text-muted-foreground/60"> — {e.source_work}</span>}
                {e.url && (
                  <a href={e.url} target="_blank" rel="noopener noreferrer"
                    className="ml-1 text-primary/60 hover:text-primary">↗</a>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionContent({ section, chapter, t, locale, craftExamples }: { section: any; chapter: any; t: (k: string) => string; locale: string; craftExamples?: any }) {
  const svgFile = SECTION_SVG[section.id];

  return (
    <div>
      {/* SVG diagram at the top if this section has one */}
      {svgFile && <SvgPanel file={svgFile} locale={locale} />}

      {/* Summary */}
      {section.summary && (
        <p className="text-sm text-foreground/90 leading-relaxed mb-4">{section.summary}</p>
      )}

      {/* Description (beat structures) */}
      {section.description && !section.summary && (
        <p className="text-sm text-foreground/90 leading-relaxed mb-4">{section.description}</p>
      )}

      {/* Beat structure meta */}
      {section.beats_count != null && (
        <div className="bg-secondary/30 border border-border rounded-lg p-3 mb-4 space-y-1">
          {section.origin && <MetaRow label={t("compendium_origin")}>{section.origin}</MetaRow>}
          <MetaRow label={t("compendium_complexity")}>{section.complexity}</MetaRow>
          <MetaRow label={t("compendium_beats_count")}>{section.beats_count}</MetaRow>
        </div>
      )}

      {/* Key insight */}
      {section.key_insight && (
        <div className="border-l-2 border-primary/50 pl-3 mb-4">
          <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-wide mb-1">{t("compendium_key_insight")}</p>
          <p className="text-sm text-foreground/80 leading-relaxed italic">{section.key_insight}</p>
        </div>
      )}

      {/* Best for / Weaknesses */}
      {section.best_for && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-green-500 mb-1">{t("compendium_best_for")}</p>
          <div className="flex flex-wrap">
            {section.best_for.map((s: string, i: number) => <Tag key={i} color="green">{s}</Tag>)}
          </div>
        </div>
      )}
      {section.weaknesses && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-red-500 mb-1">{t("compendium_weaknesses")}</p>
          <div className="flex flex-wrap">
            {section.weaknesses.map((s: string, i: number) => <Tag key={i} color="red">{s}</Tag>)}
          </div>
        </div>
      )}

      {/* Key points */}
      {section.key_points && (
        <ul className="space-y-1.5 mb-4">
          {section.key_points.map((p: string, i: number) => (
            <li key={i} className="flex gap-2 text-sm text-foreground/80">
              <span className="text-primary/60 shrink-0 mt-0.5">·</span>
              <span className="leading-relaxed">{p}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Character dimensions */}
      {section.dimensions && (
        <div className="space-y-2 mb-4">
          {section.dimensions.map((d: any, i: number) => (
            <div key={i} className="border border-border rounded-lg p-3">
              <p className="text-xs font-bold text-foreground mb-1">{d.name}</p>
              <p className="text-xs text-muted-foreground mb-2">{d.definition}</p>
              <div className="space-y-1">
                <p className="text-[11px]"><span className="text-green-500 font-medium">✓ </span>{d.strong_example}</p>
                <p className="text-[11px]"><span className="text-red-400 font-medium">✗ </span>{d.weak_example}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Arc types */}
      {section.arc_types && (
        <div className="space-y-2 mb-4">
          {section.arc_types.map((a: any, i: number) => (
            <div key={i} className="border border-border rounded-lg p-3">
              <p className="text-xs font-bold text-foreground">{a.type}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>
              <p className="text-[11px] text-muted-foreground/70 italic mt-1">e.g. {a.example}</p>
            </div>
          ))}
        </div>
      )}

      {/* Common mistakes */}
      {section.common_mistakes && (
        <div className="space-y-2 mb-4">
          {section.common_mistakes.map((m: any, i: number) => (
            <div key={i} className="border border-red-500/20 rounded-lg p-3">
              <p className="text-xs font-bold text-red-400 mb-0.5">{m.name}</p>
              <p className="text-xs text-muted-foreground mb-1">{m.description}</p>
              <p className="text-[11px] text-green-500">Fix: {m.fix}</p>
            </div>
          ))}
        </div>
      )}

      {/* World-building pillars */}
      {section.pillars && (
        <div className="space-y-2 mb-4">
          {section.pillars.map((p: any, i: number) => (
            <div key={i} className="border border-border rounded-lg p-3">
              <p className="text-xs font-bold text-foreground mb-1">{p.name}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{p.questions}</p>
              {p.common_mistake && (
                <p className="text-[11px] text-red-400/80 mt-1 italic">⚠ {p.common_mistake}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Editing levels */}
      {section.editing_levels && (
        <div className="space-y-2 mb-4">
          {section.editing_levels.map((l: any) => (
            <div key={l.level} className="border border-border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] bg-primary/10 text-primary font-bold rounded px-1.5 py-0.5">Level {l.level}</span>
                <span className="text-xs font-bold text-foreground">{l.name}</span>
              </div>
              <p className="text-xs text-muted-foreground mb-1.5">{l.focus}</p>
              <ul className="space-y-0.5">
                {l.questions.map((q: string, i: number) => (
                  <li key={i} className="text-[11px] text-muted-foreground flex gap-1.5">
                    <span className="text-muted-foreground/40 shrink-0">·</span>{q}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Rules (7.3) */}
      {section.rules && (
        <ol className="space-y-2 mb-4">
          {section.rules.map((r: string, i: number) => (
            <li key={i} className="flex gap-2 text-sm text-foreground/80">
              <span className="text-primary font-bold shrink-0">{i + 1}.</span>
              <span className="leading-relaxed">{r}</span>
            </li>
          ))}
        </ol>
      )}

      {/* Beats (chapter 10 beat structures) */}
      {section.beats && <BeatsList beats={section.beats} />}

      {/* Snowflake steps */}
      {section.steps && <SnowflakeSteps steps={section.steps} />}

      {/* Social accounts (9.1) */}
      {section.accounts && <AccountsList accounts={section.accounts} />}

      {/* Classical resources (9.2) */}
      {section.classical_resources && <ClassicalResources resources={section.classical_resources} />}

      {/* Critical notes */}
      {section.critical_notes && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("compendium_notes")}</p>
          <ul className="space-y-1.5">
            {section.critical_notes.map((n: string, i: number) => (
              <li key={i} className="text-xs text-muted-foreground leading-relaxed flex gap-2">
                <span className="shrink-0 text-primary/50">→</span>{n}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Craft examples (dos & don'ts) */}
      {craftExamples && <CraftExamples examples={craftExamples} locale={locale} />}

      {/* Attributions / sources */}
      <Sources ids={section.attribution_ids ?? []} />
    </div>
  );
}

function ChapterOverview({ chapter, t, locale }: { chapter: any; t: (k: string) => string; locale: string }) {
  const svgFile = CHAPTER_SVG[chapter.number];
  return (
    <div>
      {svgFile && <SvgPanel file={svgFile} locale={locale} />}
      {chapter.summary && <p className="text-sm text-foreground/90 leading-relaxed mb-3">{chapter.summary}</p>}
      {chapter.key_insight && (
        <div className="border-l-2 border-primary/50 pl-3 mb-3">
          <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-wide mb-1">{t("compendium_key_insight")}</p>
          <p className="text-sm text-foreground/80 leading-relaxed italic">{chapter.key_insight}</p>
        </div>
      )}
      {chapter.planner_vs_pantser_note && (
        <p className="text-xs text-muted-foreground leading-relaxed">{chapter.planner_vs_pantser_note}</p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  initialSection?: string; // e.g. "10.2" or "chapter:10"
}

export function WritersCompendium({ open, onClose, initialSection }: Props) {
  const { t, locale } = useLanguage();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // active selection: either "chapter:N" for overview or "N.M" for a section
  const [active, setActive] = useState<string | null>(initialSection ?? null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set([1]));

  // Fetch JSON + attributions once
  useEffect(() => {
    if (!open) return;
    if (_data) { setData(_data); return; }
    setLoading(true);
    Promise.all([
      fetch("/compendium/writers_compendium.json").then((r) => r.json()),
      _attrMap
        ? Promise.resolve(_attrMap)
        : fetch("/compendium/attributions.json")
            .then((r) => r.json())
            .then((a) => {
              const map: Record<string, any> = {};
              for (const entry of a.attributions ?? []) map[entry.id] = entry;
              _attrMap = map;
              return map;
            }),
    ])
      .then(([d]) => { _data = d; setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [open]);

  // Sync initialSection prop
  useEffect(() => {
    if (initialSection) {
      setActive(initialSection);
      const num = initialSection.startsWith("chapter:")
        ? Number(initialSection.split(":")[1])
        : Number(initialSection.split(".")[0]);
      if (!isNaN(num)) setExpanded((prev) => new Set([...prev, num]));
    }
  }, [initialSection]);

  const toggleChapter = useCallback((num: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(num) ? next.delete(num) : next.add(num);
      return next;
    });
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const chapters: any[] = (data?.chapters ?? []).filter((c: any) => c.number !== 8);

  // Resolve active content
  let activeChapter: any = null;
  let activeSection: any = null;
  if (active && data) {
    if (active.startsWith("chapter:")) {
      const num = Number(active.split(":")[1]);
      activeChapter = chapters.find((c: any) => c.number === num);
    } else {
      const chNum = Number(active.split(".")[0]);
      activeChapter = chapters.find((c: any) => c.number === chNum);
      activeSection = activeChapter?.sections?.find((s: any) => s.id === active);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full h-full md:h-[92vh] md:max-w-6xl md:rounded-xl bg-background border border-border shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border shrink-0">
          <GraduationCap className="h-4 w-4 text-primary shrink-0" />
          <h2 className="font-semibold text-sm text-foreground flex-1">{t("compendium_title")}</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">

          {/* Sidebar */}
          <nav className="w-60 shrink-0 border-r border-border overflow-y-auto py-2">
            {loading && (
              <p className="text-xs text-muted-foreground px-4 py-3">{t("compendium_loading")}</p>
            )}
            {chapters.map((ch: any) => {
              const chLabel = t(CHAPTER_I18N[ch.number] ?? `compendium_ch${ch.number}`);
              const isExpanded = expanded.has(ch.number);
              const isChActive = active === `chapter:${ch.number}`;
              return (
                <div key={ch.number}>
                  {/* Chapter row */}
                  <button
                    onClick={() => {
                      toggleChapter(ch.number);
                      setActive(`chapter:${ch.number}`);
                    }}
                    className={cn(
                      "w-full flex items-center gap-1.5 px-3 py-1.5 text-left transition-colors",
                      isChActive ? "bg-primary/10 text-primary" : "text-foreground/80 hover:bg-secondary/50",
                    )}
                  >
                    {isExpanded
                      ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                      : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                    <span className="text-[11px] font-semibold uppercase tracking-wide">{ch.number}. {chLabel}</span>
                  </button>

                  {/* Section rows */}
                  {isExpanded && ch.sections?.map((sec: any) => {
                    const isSecActive = active === sec.id;
                    return (
                      <button
                        key={sec.id}
                        onClick={() => setActive(sec.id)}
                        className={cn(
                          "w-full flex items-center gap-1 pl-7 pr-3 py-1 text-left transition-colors",
                          isSecActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/30",
                        )}
                      >
                        <span className="text-[10px] tabular-nums text-muted-foreground/50 shrink-0 w-6">{sec.id}</span>
                        <span className="text-[11px] leading-tight">{sec.title}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          {/* Content panel */}
          <main className="flex-1 overflow-y-auto p-6">
            {!active && !loading && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                <GraduationCap className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">Select a chapter or section from the sidebar</p>
              </div>
            )}

            {loading && (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-muted-foreground">{t("compendium_loading")}</p>
              </div>
            )}

            {!loading && activeChapter && (
              <div>
                {/* Title */}
                <h3 className="text-lg font-bold text-foreground mb-1">
                  {activeSection ? activeSection.title : activeChapter.title}
                </h3>
                {activeSection && (
                  <p className="text-xs text-muted-foreground/60 mb-4">
                    {t(CHAPTER_I18N[activeChapter.number])} › {activeSection.id}
                  </p>
                )}
                {!activeSection && activeChapter.subtitle && (
                  <p className="text-sm text-muted-foreground mb-4">{activeChapter.subtitle}</p>
                )}

                {/* Content */}
                {activeSection
                  ? <SectionContent section={activeSection} chapter={activeChapter} t={t} locale={locale} craftExamples={SECTION_EXAMPLES[activeSection.id] ? data?.craft_examples?.[SECTION_EXAMPLES[activeSection.id]] : undefined} />
                  : <ChapterOverview chapter={activeChapter} t={t} locale={locale} />
                }
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
