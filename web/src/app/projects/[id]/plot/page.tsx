"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, ChevronRight, RotateCcw, Copy, BookOpen, GraduationCap } from "lucide-react";
import Link from "next/link";
import { PLOT_TEMPLATES, TEMPLATE_COMPENDIUM_SECTION, type PlotTemplate } from "@/lib/plotTemplates";
import { WritersCompendium } from "@/components/WritersCompendium";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { scenesApi } from "@/lib/api";
import { useProjectScenes, useCorkboard } from "@/store/queries";

// ── Local-storage helpers ─────────────────────────────────────────────────────

function storageKey(projectId: number, templateId: string) {
  return `lw_plot_${projectId}_${templateId}`;
}

interface BeatState { checked: boolean; notes: string }
type TemplateState = Record<string, BeatState>;

function loadState(projectId: number, templateId: string): TemplateState {
  try {
    const raw = localStorage.getItem(storageKey(projectId, templateId));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveState(projectId: number, templateId: string, state: TemplateState) {
  localStorage.setItem(storageKey(projectId, templateId), JSON.stringify(state));
}

// ── Beat row ─────────────────────────────────────────────────────────────────

function BeatRow({
  beat,
  state,
  onChange,
}: {
  beat: PlotTemplate["beats"][0];
  state: BeatState;
  onChange: (s: BeatState) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn("border border-border rounded-lg transition-colors", state.checked && "opacity-60")}>
      <div className="flex items-start gap-3 px-3 py-2.5">
        <input
          type="checkbox"
          checked={state.checked}
          onChange={(e) => onChange({ ...state, checked: e.target.checked })}
          className="accent-primary mt-0.5 shrink-0 cursor-pointer"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className={cn("text-sm font-medium", state.checked && "line-through text-muted-foreground")}>
              {beat.name}
            </p>
            <span className="text-[10px] text-muted-foreground/50 tabular-nums">~{beat.position}%</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{beat.description}</p>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
          title="Add notes"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-3">
          <textarea
            value={state.notes}
            onChange={(e) => onChange({ ...state, notes: e.target.value })}
            placeholder="Notes for this beat…"
            rows={2}
            className="w-full text-xs bg-secondary/30 border border-border rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-ring text-foreground placeholder:text-muted-foreground/50"
          />
        </div>
      )}
    </div>
  );
}

// ── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground shrink-0">{done}/{total}</span>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PlotPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const qc = useQueryClient();

  const [activeTemplate, setActiveTemplate] = useState<PlotTemplate>(PLOT_TEMPLATES[0]);
  const [states, setStates] = useState<TemplateState>({});
  const [view, setView] = useState<"checklist" | "skeleton" | "scenes">("checklist");
  const [copied, setCopied] = useState(false);
  const [localBeat, setLocalBeat] = useState<Record<number, string | null>>({});
  const [compendiumOpen, setCompendiumOpen] = useState(false);
  const [compendiumSection, setCompendiumSection] = useState<string | undefined>();

  const { data: projectScenes = [] } = useProjectScenes(projectId);
  const { data: corkboard } = useCorkboard(projectId);

  // Beat map from corkboard
  const corkboardBeatMap = useMemo(() => {
    const map: Record<number, string | null> = {};
    for (const s of corkboard?.scenes ?? []) {
      map[s.id] = s.beat ?? null;
    }
    return map;
  }, [corkboard]);

  // All beat names for the current template
  const templateBeatNames = useMemo(
    () => activeTemplate.beats.map(b => b.name),
    [activeTemplate],
  );

  const updateBeatMutation = useMutation({
    mutationFn: ({ sceneId, beat }: { sceneId: number; beat: string | null }) =>
      scenesApi.update(sceneId, { beat }),
    onSuccess: (_, { sceneId, beat }) => {
      setLocalBeat(prev => ({ ...prev, [sceneId]: beat }));
      qc.invalidateQueries({ queryKey: ["corkboard", projectId] });
    },
  });

  const handleBeatChange = (sceneId: number, val: string) => {
    const beat = val || null;
    setLocalBeat(prev => ({ ...prev, [sceneId]: beat }));  // optimistic
    updateBeatMutation.mutate({ sceneId, beat });
  };

  // Load from localStorage when template changes
  useEffect(() => {
    setStates(loadState(projectId, activeTemplate.id));
  }, [projectId, activeTemplate.id]);

  const updateBeat = useCallback((beatId: string, beatState: BeatState) => {
    setStates((prev) => {
      const next = { ...prev, [beatId]: beatState };
      saveState(projectId, activeTemplate.id, next);
      return next;
    });
  }, [projectId, activeTemplate.id]);

  const resetAll = () => {
    if (!confirm(`Reset all checkboxes for "${activeTemplate.name}"?`)) return;
    saveState(projectId, activeTemplate.id, {});
    setStates({});
  };

  const beatState = (id: string): BeatState => states[id] ?? { checked: false, notes: "" };
  const done  = activeTemplate.beats.filter((b) => beatState(b.id).checked).length;
  const total = activeTemplate.beats.length;

  // Skeleton text
  const skeletonText = activeTemplate.beats
    .map((b, i) => `${i + 1}. ${b.name} (~${b.position}%)\n   ${b.description}`)
    .join("\n\n");

  const copyskeleton = async () => {
    await navigator.clipboard.writeText(skeletonText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      <header className="border-b border-border px-6 py-4 flex items-center gap-3 shrink-0">
        <Link
          href={`/projects/${projectId}`}
          className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/10 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-bold">Plot Beats</h1>
      </header>

      <main className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">

        {/* Template picker */}
        <div className="flex items-center gap-2">
          <select
            value={activeTemplate.id}
            onChange={(e) => {
              const tpl = PLOT_TEMPLATES.find((t) => t.id === e.target.value);
              if (tpl) setActiveTemplate(tpl);
            }}
            className="flex-1 text-sm bg-secondary border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {PLOT_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {TEMPLATE_COMPENDIUM_SECTION[activeTemplate.id] && (
            <button
              onClick={() => {
                setCompendiumSection(TEMPLATE_COMPENDIUM_SECTION[activeTemplate.id]);
                setCompendiumOpen(true);
              }}
              className="shrink-0 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-1.5 rounded border border-border hover:border-primary/40"
              title="Open in Writer's Guide"
            >
              <GraduationCap className="h-3.5 w-3.5" />
              Guide
            </button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">{activeTemplate.description}</p>

        {/* Writer's Compendium modal */}
        <WritersCompendium
          open={compendiumOpen}
          onClose={() => setCompendiumOpen(false)}
          initialSection={compendiumSection}
        />

        {/* View toggle + actions */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            {(["checklist", "scenes", "skeleton"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "text-xs px-3 py-1.5 capitalize transition-colors",
                  view === v ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          {view === "checklist" && (
            <Button size="sm" variant="ghost" className="gap-1.5 text-xs text-muted-foreground" onClick={resetAll}>
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
          {view === "skeleton" && (
            <Button size="sm" variant="ghost" className="gap-1.5 text-xs text-muted-foreground" onClick={copyskeleton}>
              <Copy className="h-3.5 w-3.5" />
              {copied ? "Copied!" : "Copy"}
            </Button>
          )}
        </div>

        {/* Checklist view */}
        {view === "checklist" && (
          <>
            <ProgressBar done={done} total={total} />
            <div className="space-y-2">
              {activeTemplate.beats.map((beat) => (
                <BeatRow
                  key={beat.id}
                  beat={beat}
                  state={beatState(beat.id)}
                  onChange={(s) => updateBeat(beat.id, s)}
                />
              ))}
            </div>
          </>
        )}

        {/* Skeleton view */}
        {view === "skeleton" && (
          <div className="bg-card border border-border rounded-lg p-4">
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed font-mono">
              {skeletonText}
            </pre>
          </div>
        )}

        {/* Scenes view — assign each scene to a beat */}
        {view === "scenes" && (
          <div>
            <p className="text-xs text-muted-foreground mb-4">
              Assign each scene to a beat from the <strong>{activeTemplate.name}</strong> template.
              Beats are also editable in the scene editor (More → Scene info).
            </p>
            {projectScenes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No scenes yet.</p>
            ) : (
              <>
                {/* Beat sections */}
                {[...activeTemplate.beats.map(b => b.name), null].map(beatName => {
                  const scenesForBeat = projectScenes.filter(s => {
                    const current = localBeat[s.id] !== undefined ? localBeat[s.id] : (corkboardBeatMap[s.id] ?? null);
                    return beatName === null ? !current || !templateBeatNames.includes(current) : current === beatName;
                  });
                  if (scenesForBeat.length === 0 && beatName !== null) return null;
                  const beatDef = beatName ? activeTemplate.beats.find(b => b.name === beatName) : null;
                  return (
                    <div key={beatName ?? "__unassigned"} className="mb-6">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-sm font-semibold">
                          {beatName ?? "Unassigned"}
                        </h3>
                        {beatDef && (
                          <span className="text-[10px] text-muted-foreground/60">~{beatDef.position}%</span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          ({scenesForBeat.length} scene{scenesForBeat.length !== 1 ? "s" : ""})
                        </span>
                      </div>
                      {beatDef && (
                        <p className="text-xs text-muted-foreground mb-2 ml-0.5">{beatDef.description}</p>
                      )}
                      {scenesForBeat.length === 0 ? (
                        <p className="text-xs text-muted-foreground/50 ml-0.5 italic">No scenes assigned.</p>
                      ) : (
                        <div className="space-y-1">
                          {scenesForBeat.map(s => {
                            const currentBeat = localBeat[s.id] !== undefined ? localBeat[s.id] : (corkboardBeatMap[s.id] ?? null);
                            return (
                              <div key={s.id} className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2">
                                <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <span className="text-sm font-medium truncate block">{s.title}</span>
                                  <span className="text-xs text-muted-foreground">{s.act_title} · {s.chapter_title}</span>
                                </div>
                                <select
                                  value={currentBeat ?? ""}
                                  onChange={e => handleBeatChange(s.id, e.target.value)}
                                  className="text-xs bg-secondary border border-border rounded px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer shrink-0"
                                >
                                  <option value="">— none —</option>
                                  {activeTemplate.beats.map(b => (
                                    <option key={b.id} value={b.name}>{b.name}</option>
                                  ))}
                                </select>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

      </div>
      </main>
    </div>
  );
}
