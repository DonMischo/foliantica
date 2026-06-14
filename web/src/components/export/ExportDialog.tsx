"use client";

import { useState, useEffect, useRef } from "react";
import {
  FileText, FileCode2, BookOpen, FileDown, File,
  FolderOpen, Upload, Check, Loader2, ChevronDown, ChevronRight,
  Lock, Save, Star, Package, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { projectsApi, publishersApi } from "@/lib/api";
import type { ExportOptions, ExportAct, BatchExportRequest } from "@/lib/api";
import type { BookMeta, ExportProfile, PublisherProfile, PublisherCategory } from "@/types";
import { useSettings, usePandocFonts, useExportProfiles, useCreateExportProfile, useDeleteExportProfile, usePublisherProfiles } from "@/store/queries";
import { FontPicker } from "./FontPicker";

// ── Style presets ─────────────────────────────────────────────────────────────

type StylePreset = Partial<ExportOptions>;

const STYLE_PRESETS: Record<string, StylePreset> = {
  "Classic Novel": {
    font: "EB Garamond", heading_font: "", heading_align: "center",
    h1_size: "2em", h2_size: "1.5em", h3_size: "1.25em", h3_style: "italic",
    paragraph_indent: "1.5em", text_align: "justify",
    font_size: "12pt", line_spacing: "1.5", page_numbers: true, drop_caps: false,
  },
  "Modern": {
    font: "Open Sans", heading_font: "", heading_align: "left",
    h1_size: "1.75em", h2_size: "1.4em", h3_size: "1.15em", h3_style: "bold",
    paragraph_indent: "0", text_align: "left",
    font_size: "11pt", line_spacing: "1.5", page_numbers: true, drop_caps: false,
  },
  "Manuscript": {
    font: "Courier New", heading_font: "", heading_align: "center",
    h1_size: "1.5em", h2_size: "1.25em", h3_size: "1em", h3_style: "normal",
    paragraph_indent: "0", text_align: "left", paper_size: "letterpaper",
    font_size: "12pt", line_spacing: "2", page_numbers: true, drop_caps: false,
  },
};

const DEFAULT_OPTS: ExportOptions = {
  format: "md",
  scene_ids: null,
  include_act_headings: true,
  include_chapter_headings: true,
  include_scene_headings: true,
  font: "EB Garamond",
  font_size: "12pt",
  line_spacing: "1.5",
  paper_size: "a4paper",
  text_color: "#1a1a1a",
  bg_color: "#ffffff",
  page_margin: "2em",
  // Style defaults match "Classic Novel"
  heading_font: "",
  heading_align: "center",
  h1_size: "2em",
  h2_size: "1.5em",
  h3_size: "1.25em",
  h3_style: "italic",
  paragraph_indent: "1.5em",
  text_align: "justify",
  pdf_margin: "2.5cm",
  page_numbers: true,
  drop_caps: false,
};

// ── Small helpers ─────────────────────────────────────────────────────────────

function ToggleGroup<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex rounded-md border border-border overflow-hidden text-xs">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={cn("flex-1 px-3 py-1.5 transition-colors",
            value === o.value ? "bg-primary text-primary-foreground font-medium" : "hover:bg-secondary text-muted-foreground"
          )}
        >{o.label}</button>
      ))}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-5 mb-2 first:mt-0">{children}</p>;
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer py-0.5">
      <span className="text-sm">{label}</span>
      <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cn("relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors",
          checked ? "bg-primary" : "bg-input")}
      >
        <span className={cn("pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg transition-transform",
          checked ? "translate-x-4" : "translate-x-0")} />
      </button>
    </label>
  );
}

// ── Tri-state checkbox ────────────────────────────────────────────────────────

type CheckState = "all" | "none" | "partial";

function TriCheckbox({ state, onChange }: { state: CheckState; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = state === "partial";
      ref.current.checked = state === "all";
    }
  }, [state]);
  return (
    <input ref={ref} type="checkbox" onChange={onChange}
      className="h-3.5 w-3.5 rounded shrink-0 cursor-pointer accent-primary" />
  );
}

// ── 3-level content tree ──────────────────────────────────────────────────────

function ContentTree({
  acts,
  selected,
  onToggleAll,
  onToggleAct,
  onToggleChapter,
  onToggleScene,
}: {
  acts: ExportAct[];
  selected: Set<number>;
  onToggleAll: () => void;
  onToggleAct: (sceneIds: number[]) => void;
  onToggleChapter: (sceneIds: number[]) => void;
  onToggleScene: (id: number) => void;
}) {
  const allSceneIds = acts.flatMap(a => a.chapters.flatMap(c => c.scenes.map(s => s.id)));
  const totalSelected = allSceneIds.filter(id => selected.has(id)).length;
  const globalState: CheckState = totalSelected === 0 ? "none" : totalSelected === allSceneIds.length ? "all" : "partial";

  const [expandedActs, setExpandedActs] = useState<Set<number>>(new Set(acts.map(a => a.id)));
  const [expandedChapters, setExpandedChapters] = useState<Set<number>>(
    new Set(acts.flatMap(a => a.chapters.map(c => c.id)))
  );

  const toggleExpandAct = (id: number) =>
    setExpandedActs(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleExpandChapter = (id: number) =>
    setExpandedChapters(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="border border-border rounded-md overflow-hidden text-sm select-none">
      {/* Global select-all row */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-secondary/40 border-b border-border">
        <div className="w-3.5 shrink-0" />
        <TriCheckbox state={globalState} onChange={onToggleAll} />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          All content ({totalSelected}/{allSceneIds.length} scenes)
        </span>
      </div>

      {acts.map(act => {
        const actSceneIds = act.chapters.flatMap(c => c.scenes.map(s => s.id));
        const actSel = actSceneIds.filter(id => selected.has(id)).length;
        const actState: CheckState = actSel === 0 ? "none" : actSel === actSceneIds.length ? "all" : "partial";
        const actOpen = expandedActs.has(act.id);

        return (
          <div key={act.id} className="border-b border-border last:border-b-0">
            {/* Act row */}
            <div className="flex items-center gap-2 px-2 py-1.5 bg-secondary/20 hover:bg-secondary/30 transition-colors">
              <button onClick={() => toggleExpandAct(act.id)} className="shrink-0">
                {actOpen
                  ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
              <TriCheckbox state={actState} onChange={() => onToggleAct(actSceneIds)} />
              <span className="font-medium truncate">{act.title}</span>
              {actState === "partial" && (
                <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{actSel}/{actSceneIds.length}</span>
              )}
            </div>

            {actOpen && act.chapters.map(chapter => {
              const chapSceneIds = chapter.scenes.map(s => s.id);
              const chapSel = chapSceneIds.filter(id => selected.has(id)).length;
              const chapState: CheckState = chapSel === 0 ? "none" : chapSel === chapSceneIds.length ? "all" : "partial";
              const chapOpen = expandedChapters.has(chapter.id);

              return (
                <div key={chapter.id} className="border-t border-border/50">
                  {/* Chapter row */}
                  <div className="flex items-center gap-2 pl-6 pr-2 py-1 hover:bg-secondary/20 transition-colors">
                    <button onClick={() => toggleExpandChapter(chapter.id)} className="shrink-0">
                      {chapOpen
                        ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                    </button>
                    <TriCheckbox state={chapState} onChange={() => onToggleChapter(chapSceneIds)} />
                    <span className="text-xs truncate text-foreground/80">{chapter.title}</span>
                    {chapState === "partial" && (
                      <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{chapSel}/{chapSceneIds.length}</span>
                    )}
                  </div>

                  {chapOpen && chapter.scenes.map(scene => {
                    const sceneSel = selected.has(scene.id);
                    return (
                      <div key={scene.id}
                        className="flex items-center gap-2 pl-12 pr-2 py-0.5 hover:bg-secondary/10 transition-colors cursor-pointer"
                        onClick={() => onToggleScene(scene.id)}
                      >
                        <input type="checkbox" checked={sceneSel} onChange={() => onToggleScene(scene.id)}
                          className="h-3 w-3 rounded shrink-0 accent-primary cursor-pointer" />
                        <span className="text-[11px] truncate text-muted-foreground">{scene.title}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Publisher Pack section (extracted from ExportDialog to avoid IIFE) ────────

interface PublisherPackSectionProps {
  publishers: PublisherProfile[];
  selectedPublishers: Set<number>;
  collapsedCats: Set<string>;
  setCollapsedCats: (value: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  togglePublisher: (id: number) => void;
  toggleCategory: (ids: number[]) => void;
  allContent: boolean;
  setAllContent: (v: boolean) => void;
  selectedSceneIds: Set<number>;
  acts: ExportAct[];
  toggleAll: () => void;
  toggleGroup: (ids: number[]) => void;
  toggleScene: (id: number) => void;
}

function PublisherPackSection({
  publishers, selectedPublishers, collapsedCats, setCollapsedCats,
  togglePublisher, toggleCategory, allContent, setAllContent,
  selectedSceneIds, acts, toggleAll, toggleGroup, toggleScene,
}: PublisherPackSectionProps) {
  const activeCats = (Object.keys(CATEGORY_LABELS) as PublisherCategory[])
    .filter(cat => publishers.some(p => p.category === cat));
  const allCollapsed = activeCats.length > 0 && activeCats.every(c => collapsedCats.has(c));

  const toggleAllCats = () =>
    setCollapsedCats(allCollapsed ? new Set<string>() : new Set<string>(activeCats));

  const toggleCollapse = (cat: PublisherCategory) =>
    setCollapsedCats(prev => {
      const n = new Set(prev);
      n.has(cat) ? n.delete(cat) : n.add(cat);
      return n;
    });

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Files named <span className="font-mono text-foreground/70">Publisher_Title.ext</span>, downloaded as ZIP.
        </p>
        <button
          type="button"
          onClick={toggleAllCats}
          className="text-[11px] text-muted-foreground hover:text-foreground shrink-0 ml-3 flex items-center gap-1 transition-colors"
        >
          {allCollapsed
            ? <><ChevronRight className="h-3 w-3" />Expand all</>
            : <><ChevronDown className="h-3 w-3" />Collapse all</>}
        </button>
      </div>

      {(Object.entries(CATEGORY_LABELS) as [PublisherCategory, string][]).map(([cat, catLabel]) => {
        const catPubs = publishers.filter(p => p.category === cat);
        if (catPubs.length === 0) return null;
        const catIds = catPubs.map(p => p.id);
        const catSel = catIds.filter(id => selectedPublishers.has(id)).length;
        const catState: CheckState = catSel === 0 ? "none" : catSel === catIds.length ? "all" : "partial";
        const isCollapsed = collapsedCats.has(cat);
        return (
          <div key={cat} className="mb-3 last:mb-1">
            {/* Category header */}
            <div
              className="flex items-center gap-2 mb-1 py-1 border-b border-border/50 cursor-pointer group"
              onClick={() => toggleCollapse(cat)}
            >
              <span
                className="text-muted-foreground group-hover:text-foreground transition-colors shrink-0"
                onClick={e => { e.stopPropagation(); toggleCollapse(cat); }}
              >
                {isCollapsed
                  ? <ChevronRight className="h-3.5 w-3.5" />
                  : <ChevronDown className="h-3.5 w-3.5" />}
              </span>
              <span
                className="shrink-0"
                onClick={e => { e.stopPropagation(); toggleCategory(catIds); }}
              >
                <TriCheckbox state={catState} onChange={() => toggleCategory(catIds)} />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex-1 group-hover:text-foreground transition-colors">
                {catLabel}
              </span>
              <span className="text-[10px] text-muted-foreground/50 shrink-0">
                {catSel}/{catIds.length}
              </span>
            </div>

            {/* Publisher rows */}
            {!isCollapsed && <div className="space-y-0.5 ml-5">
              {catPubs.map(pub => {
                const pubOpts = (() => { try { return JSON.parse(pub.options_json) as Record<string, unknown>; } catch { return {}; } })();
                const fmt = ((pubOpts.format ?? "docx") as string).toUpperCase();
                const fmtColor =
                  fmt === "DOCX" ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" :
                  fmt === "EPUB" ? "bg-purple-500/10 text-purple-600 dark:text-purple-400" :
                  "bg-red-500/10 text-red-600 dark:text-red-400";
                const wMin = pub.word_count_min;
                const wMax = pub.word_count_max;
                return (
                  <label
                    key={pub.id}
                    className="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-secondary/40 cursor-pointer group transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedPublishers.has(pub.id)}
                      onChange={() => togglePublisher(pub.id)}
                      className="h-3.5 w-3.5 rounded accent-primary shrink-0 cursor-pointer"
                    />
                    <span className="text-sm flex-1 truncate">{pub.name}</span>
                    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0", fmtColor)}>
                      {fmt}
                    </span>
                    {(wMin || wMax) && (
                      <span className="text-[10px] text-muted-foreground/60 shrink-0 font-mono">
                        {wMin ? `${Math.round(wMin / 1000)}K` : ""}
                        {wMin && wMax ? "–" : ""}
                        {wMax ? `${Math.round(wMax / 1000)}K` : "+"}
                      </span>
                    )}
                    {pub.accepts_unagented === 1 ? (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">Open</span>
                    ) : (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-secondary text-muted-foreground/70 shrink-0">Agented</span>
                    )}
                    {pub.submission_url && (
                      <a
                        href={pub.submission_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-muted-foreground hover:text-primary shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Submission guidelines"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </label>
                );
              })}
            </div>}
          </div>
        );
      })}

      {/* Content selection for pack */}
      <SectionHeading>Content</SectionHeading>
      <div className="mb-2">
        <ToggleGroup
          value={allContent ? "all" : "custom"}
          onChange={v => setAllContent(v === "all")}
          options={[{ value: "all", label: "All content" }, { value: "custom", label: "Select scenes" }]}
        />
      </div>
      {!allContent && acts.length > 0 && (
        <ContentTree
          acts={acts}
          selected={selectedSceneIds}
          onToggleAll={toggleAll}
          onToggleAct={toggleGroup}
          onToggleChapter={toggleGroup}
          onToggleScene={toggleScene}
        />
      )}
    </>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

interface Props {
  projectId: number;
  projectTitle: string;
  bookMeta?: BookMeta | null;
  open: boolean;
  onClose: () => void;
}

const hasFolderPicker = typeof window !== "undefined" && "showDirectoryPicker" in window;

const CATEGORY_LABELS: Record<PublisherCategory, string> = {
  standard: "Standard Formats",
  us_trade: "US Trade Publishers",
  uk_trade: "UK Publishers",
  agency:   "Literary Agencies",
  genre:    "Genre Imprints",
  selfpub:  "Self-Publishing",
  de_trade: "German Publishers (DE)",
  fr_trade: "French Publishers (FR)",
  es_trade: "Spanish Publishers (ES)",
};

export function ExportDialog({ projectId, projectTitle, bookMeta, open, onClose }: Props) {
  const { data: appSettings } = useSettings();
  const pandocEnabled  = appSettings?.pandoc_enabled  ?? false;
  const calibreEnabled = appSettings?.calibre_enabled ?? false;
  const calibreMode    = appSettings?.calibre_mode    ?? "off";

  const [opts, setOpts]       = useState<ExportOptions>({ ...DEFAULT_OPTS });

  const [acts, setActs]       = useState<ExportAct[]>([]);
  const [allContent, setAllContent]           = useState(true);
  const [selectedSceneIds, setSelectedSceneIds] = useState<Set<number>>(new Set());
  const [dirHandle, setDirHandle]             = useState<FileSystemDirectoryHandle | null>(null);
  const [coverFile, setCoverFile]             = useState<File | null>(null);
  const [status, setStatus]   = useState<"idle" | "busy" | "done" | "error">("idle");
  const [statusMsg, setStatusMsg]             = useState("");
  const [activePreset, setActivePreset]       = useState<string | null>("Classic Novel");
  const [showStyle, setShowStyle]             = useState(false);
  const [saveProfileName, setSaveProfileName] = useState("");
  const [showSaveProfile, setShowSaveProfile] = useState(false);
  const [mode, setMode] = useState<"single" | "pack">("single");
  const [selectedPublishers, setSelectedPublishers] = useState<Set<number>>(new Set());
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [packStatus, setPackStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [packMsg, setPackMsg] = useState("");
  const coverRef = useRef<HTMLInputElement>(null);

  // Fetch Pandoc font list when Pandoc is enabled
  const { data: fontsData } = usePandocFonts(pandocEnabled);

  // Export profiles + publisher profiles
  const { data: profiles = [] } = useExportProfiles(projectId);
  const { data: publishers = [] } = usePublisherProfiles();
  const createProfile = useCreateExportProfile(projectId);
  const deleteProfile = useDeleteExportProfile(projectId);

  const loadProfile = (profile: ExportProfile) => {
    try {
      const saved = JSON.parse(profile.options_json) as Partial<ExportOptions>;
      setOpts(o => ({ ...o, ...saved }));
      setActivePreset(profile.name);
    } catch { /* bad JSON */ }
  };

  const handleSaveProfile = async () => {
    if (!saveProfileName.trim()) return;
    const { format: _fmt, scene_ids: _sc, save_to_disk: _sd, ...styleOpts } = opts;
    await createProfile.mutateAsync({
      name: saveProfileName.trim(),
      options_json: JSON.stringify(styleOpts),
    });
    setSaveProfileName("");
    setShowSaveProfile(false);
  };

  const togglePublisher = (id: number) =>
    setSelectedPublishers(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const toggleCategory = (ids: number[]) => {
    const allIn = ids.every(id => selectedPublishers.has(id));
    setSelectedPublishers(prev => {
      const n = new Set(prev);
      allIn ? ids.forEach(id => n.delete(id)) : ids.forEach(id => n.add(id));
      return n;
    });
  };

  const handleBatchExport = async () => {
    if (selectedPublishers.size === 0) return;
    setPackStatus("busy"); setPackMsg("");
    try {
      const body: BatchExportRequest = {
        publisher_ids: Array.from(selectedPublishers),
        include_act_headings: false,
        include_chapter_headings: true,
        include_scene_headings: false,
        scene_ids: allContent ? null : Array.from(selectedSceneIds),
      };
      const res = await publishersApi.batchExport(projectId, body);
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeName = projectTitle.replace(/[^a-zA-Z0-9_\-]/g, "_");
      a.href = url; a.download = `${safeName}_submissions.zip`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setPackStatus("done");
      setPackMsg(`ZIP downloaded — ${selectedPublishers.size} manuscript${selectedPublishers.size > 1 ? "s" : ""}`);
    } catch (e: unknown) {
      setPackStatus("error");
      setPackMsg(e instanceof Error ? e.message : "Batch export failed");
    }
  };

  useEffect(() => {
    if (!open) return;
    setStatus("idle"); setStatusMsg("");
    let mounted = true;
    projectsApi.exportStructure(projectId).then(s => {
      if (!mounted) return;
      setActs(s.acts);
      const allIds = new Set(s.acts.flatMap(a => a.chapters.flatMap(c => c.scenes.map(sc => sc.id))));
      setSelectedSceneIds(allIds);
    });
    return () => { mounted = false; };
  }, [open, projectId]);

  if (!open) return null;

  const set = <K extends keyof ExportOptions>(k: K, v: ExportOptions[K]) => {
    setOpts(o => ({ ...o, [k]: v }));
    // Any manual change breaks out of a preset
    const styleKeys: (keyof ExportOptions)[] = [
      "font","heading_font","heading_align","h1_size","h2_size","h3_size",
      "h3_style","paragraph_indent","text_align","font_size","line_spacing",
      "page_numbers","drop_caps","paper_size",
    ];
    if (styleKeys.includes(k)) setActivePreset(null);
  };

  const applyPreset = (name: string) => {
    const preset = STYLE_PRESETS[name];
    if (!preset) return;
    setOpts(o => ({ ...o, ...preset }));
    setActivePreset(name);
  };

  // Tree toggle helpers
  const toggleAll = () => {
    const allIds = acts.flatMap(a => a.chapters.flatMap(c => c.scenes.map(s => s.id)));
    const allSelected = allIds.every(id => selectedSceneIds.has(id));
    setSelectedSceneIds(allSelected ? new Set() : new Set(allIds));
  };
  const toggleGroup = (ids: number[]) => {
    const allSelected = ids.every(id => selectedSceneIds.has(id));
    setSelectedSceneIds(prev => {
      const next = new Set(prev);
      allSelected ? ids.forEach(id => next.delete(id)) : ids.forEach(id => next.add(id));
      return next;
    });
  };
  const toggleScene = (id: number) => {
    setSelectedSceneIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const pickFolder = async () => {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
      setDirHandle(handle);
    } catch { /* cancelled */ }
  };

  const handleExport = async () => {
    setStatus("busy"); setStatusMsg("");
    // Use the user-picked folder only for text formats; everything else goes to dataDir
    const useDirHandle = !!dirHandle && !isBinary;

    const payload: ExportOptions = {
      ...opts,
      scene_ids: allContent ? null : Array.from(selectedSceneIds),
      font: opts.font || undefined,
      save_to_disk: !useDirHandle,
    };

    try {
      const res = await projectsApi.export(projectId, payload);
      if (!res.ok) throw new Error(await res.text());

      if (payload.save_to_disk) {
        // Backend saved the file — response is JSON {saved_to, filename}
        const { saved_to, filename } = await res.json() as { saved_to: string; filename: string };
        setStatus("done");
        setStatusMsg(`Saved: ${saved_to}`);
        return;
      }

      // ── dirHandle path (text formats, user picked a folder) ──────────────
      const mimeMap: Record<string, string> = {
        md: "text/markdown", tex: "application/x-tex", "epub-style": "text/css",
      };
      const extMap: Record<string, string> = { md: "md", tex: "tex", "epub-style": "css" };
      const ext = extMap[opts.format] ?? opts.format;
      const suffix = opts.format === "epub-style" ? "-style" : "";
      const safeName = projectTitle.replace(/[^a-zA-Z0-9_\-]/g, "_");
      const filename = `${safeName}${suffix}.${ext}`;
      const mimeType = mimeMap[opts.format] ?? "application/octet-stream";

      const text = await res.text();
      const fh = await dirHandle!.getFileHandle(filename, { create: true });
      const w = await fh.createWritable();
      await w.write(text); await w.close();

      if (opts.format === "epub-style" && coverFile) {
        const coverExt = coverFile.name.split(".").pop() ?? "jpg";
        const ch = await dirHandle!.getFileHandle(`cover.${coverExt}`, { create: true });
        const cw = await ch.createWritable();
        await cw.write(await coverFile.arrayBuffer()); await cw.close();
      }

      setStatus("done");
      setStatusMsg(`Saved to "${dirHandle!.name}/" — ${filename}${opts.format === "epub-style" && coverFile ? " + cover" : ""}`);
    } catch (e: unknown) {
      setStatus("error");
      setStatusMsg(e instanceof Error ? e.message : "Export failed");
    }
  };

  const isBinary = ["pdf", "epub", "docx", "mobi", "azw3", "epub-calibre"].includes(opts.format);

  const fmtLabel: Record<string, string> = {
    md: "Markdown", tex: "LaTeX", "epub-style": "EPUB Style",
    pdf: "PDF", epub: "EPUB", docx: "DOCX",
    mobi: "MOBI", azw3: "AZW3", "epub-calibre": "EPUB (Calibre)",
  };
  const fmtLabelStr = fmtLabel[opts.format] ?? opts.format;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-semibold">Export</h2>
            <p className="text-xs text-muted-foreground">{projectTitle}</p>
          </div>
          <div className="flex items-center gap-3">
            {pandocEnabled && (
              <div className="flex rounded-md border border-border overflow-hidden text-xs">
                <button
                  onClick={() => setMode("single")}
                  className={cn("px-3 py-1.5 transition-colors flex items-center gap-1.5",
                    mode === "single" ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:bg-secondary/50")}
                >
                  <FileDown className="h-3 w-3" /> Single
                </button>
                <button
                  onClick={() => setMode("pack")}
                  className={cn("px-3 py-1.5 transition-colors flex items-center gap-1.5 border-l border-border",
                    mode === "pack" ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:bg-secondary/50")}
                >
                  <Package className="h-3 w-3" /> Publisher Pack
                </button>
              </div>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none px-1">×</button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* ── Publisher Pack mode ─────────────────────────────────────────── */}
          {mode === "pack" && (
            <PublisherPackSection
              publishers={publishers}
              selectedPublishers={selectedPublishers}
              collapsedCats={collapsedCats}
              setCollapsedCats={setCollapsedCats}
              togglePublisher={togglePublisher}
              toggleCategory={toggleCategory}
              allContent={allContent}
              setAllContent={setAllContent}
              selectedSceneIds={selectedSceneIds}
              acts={acts}
              toggleAll={toggleAll}
              toggleGroup={toggleGroup}
              toggleScene={toggleScene}
            />
          )}

          {/* ── Single export mode ──────────────────────────────────────────── */}
          {mode === "single" && (<>

          {/* Format */}
          <SectionHeading>Format</SectionHeading>
          <select
            value={opts.format}
            onChange={e => set("format", e.target.value as ExportOptions["format"])}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {calibreEnabled && (
              <optgroup label="Calibre">
                <option value="epub-calibre">EPUB</option>
                <option value="mobi">MOBI — Kindle (legacy)</option>
                <option value="azw3">AZW3 — Kindle KF8</option>
              </optgroup>
            )}
            <optgroup label="E-books">
              {pandocEnabled && <option value="epub">EPUB — via Pandoc</option>}
              <option value="epub-style">EPUB Style — CSS + cover</option>
            </optgroup>
            <optgroup label="Documents &amp; Print">
              {pandocEnabled && <option value="pdf">PDF — via Pandoc + LaTeX</option>}
              {pandocEnabled && <option value="docx">DOCX — Word document</option>}
              <option value="tex">LaTeX — LuaLaTeX / fontspec</option>
            </optgroup>
            <optgroup label="Text">
              <option value="md">Markdown</option>
            </optgroup>
          </select>

          {/* Export profiles */}
          {profiles.length > 0 && (
            <>
              <SectionHeading>Saved Profiles</SectionHeading>
              <div className="flex flex-wrap gap-1.5">
                {profiles.map(p => (
                  <div key={p.id} className="flex items-center gap-0.5 rounded-md border border-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => loadProfile(p)}
                      title={p.description ?? p.name}
                      className={cn(
                        "flex items-center gap-1 px-2.5 py-1 text-xs transition-colors",
                        activePreset === p.name
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                      )}
                    >
                      {p.is_builtin ? <Star className="h-3 w-3 shrink-0" /> : <Save className="h-3 w-3 shrink-0" />}
                      {p.name}
                      {p.is_builtin && <Lock className="h-2.5 w-2.5 ml-0.5 opacity-50" />}
                    </button>
                    {!p.is_builtin && (
                      <button
                        onClick={() => deleteProfile.mutate(p.id)}
                        className="px-1.5 py-1 text-muted-foreground hover:text-destructive hover:bg-secondary/50 transition-colors border-l border-border"
                        title="Delete profile"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Content selection */}
          <SectionHeading>Content</SectionHeading>
          <div className="mb-2">
            <ToggleGroup
              value={allContent ? "all" : "custom"}
              onChange={v => setAllContent(v === "all")}
              options={[{ value: "all", label: "All content" }, { value: "custom", label: "Select scenes" }]}
            />
          </div>

          {!allContent && acts.length > 0 && (
            <ContentTree
              acts={acts}
              selected={selectedSceneIds}
              onToggleAll={toggleAll}
              onToggleAct={toggleGroup}
              onToggleChapter={toggleGroup}
              onToggleScene={toggleScene}
            />
          )}

          <div className="mt-3 space-y-1">
            <ToggleRow label="Include act headings"     checked={opts.include_act_headings}     onChange={v => set("include_act_headings", v)} />
            <ToggleRow label="Include chapter headings" checked={opts.include_chapter_headings} onChange={v => set("include_chapter_headings", v)} />
            <ToggleRow label="Include scene headings"   checked={opts.include_scene_headings}   onChange={v => set("include_scene_headings", v)} />
          </div>

          {/* Metadata summary — set via Project Info in the sidebar */}
          <SectionHeading>Metadata</SectionHeading>
          <div className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs space-y-0.5">
            {bookMeta?.author || bookMeta?.publisher || bookMeta?.published_date || bookMeta?.language ? (
              <>
                {bookMeta.author      && <p><span className="text-muted-foreground w-20 inline-block">Author</span>{bookMeta.author}</p>}
                {bookMeta.subtitle    && <p><span className="text-muted-foreground w-20 inline-block">Subtitle</span>{bookMeta.subtitle}</p>}
                {bookMeta.language    && <p><span className="text-muted-foreground w-20 inline-block">Language</span>{bookMeta.language}</p>}
                {bookMeta.publisher   && <p><span className="text-muted-foreground w-20 inline-block">Publisher</span>{bookMeta.publisher}</p>}
                {bookMeta.published_date && <p><span className="text-muted-foreground w-20 inline-block">Date</span>{bookMeta.published_date}</p>}
                {bookMeta.series      && <p><span className="text-muted-foreground w-20 inline-block">Series</span>{bookMeta.series}{bookMeta.series_index ? ` #${bookMeta.series_index}` : ""}</p>}
              </>
            ) : (
              <p className="text-muted-foreground italic">No metadata set — use <strong className="font-medium not-italic">Project Info</strong> in the sidebar to add author, language, publisher, etc.</p>
            )}
          </div>

          {/* Typography + Style (all non-md formats) */}
          {opts.format !== "md" && (
            <>
              <SectionHeading>Typography</SectionHeading>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs">Body font</Label>
                  <div className="mt-1">
                    <FontPicker
                      value={opts.font ?? ""}
                      onChange={v => set("font", v)}
                      fonts={fontsData?.fonts ?? []}
                      placeholder="e.g. EB Garamond"
                    />
                  </div>
                  {!pandocEnabled && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Font must be installed on the compilation machine (LaTeX). Enable Pandoc to see available fonts.
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-xs">Font size</Label>
                  <ToggleGroup value={opts.font_size} onChange={v => set("font_size", v)}
                    options={[{ value: "10pt", label: "10pt" }, { value: "11pt", label: "11pt" }, { value: "12pt", label: "12pt" }]} />
                </div>
                <div>
                  <Label className="text-xs">Line spacing</Label>
                  <ToggleGroup value={opts.line_spacing} onChange={v => set("line_spacing", v)}
                    options={[{ value: "1", label: "Single" }, { value: "1.5", label: "1.5×" }, { value: "2", label: "Double" }]} />
                </div>
              </div>

              {/* Style accordion */}
              <button
                type="button"
                onClick={() => setShowStyle(s => !s)}
                className="w-full flex items-center justify-between mt-4 mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              >
                <span>Style</span>
                {showStyle
                  ? <ChevronDown className="h-3.5 w-3.5" />
                  : <ChevronRight className="h-3.5 w-3.5" />}
              </button>

              {showStyle && (
                <div className="space-y-4 border border-border rounded-lg p-3 bg-secondary/10">

                  {/* Presets */}
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-1.5">Preset</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {Object.keys(STYLE_PRESETS).map(name => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => applyPreset(name)}
                          className={cn(
                            "text-xs px-2.5 py-1 rounded-md border transition-colors",
                            activePreset === name
                              ? "border-primary bg-primary/10 text-primary font-medium"
                              : "border-border hover:border-primary/50 text-muted-foreground hover:text-foreground",
                          )}
                        >{name}</button>
                      ))}
                      {activePreset === null && (
                        <span className="text-xs px-2.5 py-1 rounded-md border border-dashed border-border text-muted-foreground/60 italic">
                          Custom
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Headings */}
                  <div className="space-y-2">
                    <p className="text-[11px] text-muted-foreground font-medium">Headings</p>
                    <div>
                      <Label className="text-xs">Heading font <span className="text-muted-foreground/60 font-normal">(leave blank = same as body)</span></Label>
                      <div className="mt-1">
                        <FontPicker
                          value={opts.heading_font ?? ""}
                          onChange={v => set("heading_font", v)}
                          fonts={fontsData?.fonts ?? []}
                          placeholder="Same as body font"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Alignment</Label>
                      <ToggleGroup
                        value={(opts.heading_align ?? "center") as "center" | "left"}
                        onChange={v => set("heading_align", v)}
                        options={[{ value: "center", label: "Centered" }, { value: "left", label: "Left" }]}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {(["h1_size", "h2_size", "h3_size"] as const).map((k, i) => (
                        <div key={k}>
                          <Label className="text-xs">H{i + 1} size</Label>
                          <ToggleGroup
                            value={(opts[k] ?? ["2em","1.5em","1.25em"][i]) as string}
                            onChange={v => set(k, v)}
                            options={[
                              { value: "1em",    label: "1×" },
                              { value: "1.25em", label: "1.25×" },
                              { value: "1.5em",  label: "1.5×" },
                              { value: "1.75em", label: "1.75×" },
                              { value: "2em",    label: "2×" },
                            ]}
                          />
                        </div>
                      ))}
                    </div>
                    <div>
                      <Label className="text-xs">Scene heading style (H3)</Label>
                      <ToggleGroup
                        value={(opts.h3_style ?? "italic") as "italic" | "normal" | "bold"}
                        onChange={v => set("h3_style", v)}
                        options={[
                          { value: "italic", label: "Italic" },
                          { value: "bold",   label: "Bold" },
                          { value: "normal", label: "Normal" },
                        ]}
                      />
                    </div>
                  </div>

                  {/* Paragraph */}
                  <div className="space-y-2">
                    <p className="text-[11px] text-muted-foreground font-medium">Paragraphs</p>
                    <div>
                      <Label className="text-xs">First-line indent</Label>
                      <ToggleGroup
                        value={(opts.paragraph_indent ?? "1.5em") as string}
                        onChange={v => set("paragraph_indent", v)}
                        options={[
                          { value: "1.5em", label: "Indented" },
                          { value: "0",     label: "Block (no indent)" },
                        ]}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Text alignment</Label>
                      <ToggleGroup
                        value={(opts.text_align ?? "justify") as "justify" | "left"}
                        onChange={v => set("text_align", v)}
                        options={[
                          { value: "justify", label: "Justified" },
                          { value: "left",    label: "Left" },
                        ]}
                      />
                    </div>
                  </div>

                  {/* PDF / LaTeX / DOCX extras */}
                  {(opts.format === "pdf" || opts.format === "tex" || opts.format === "docx") && (
                    <div className="space-y-2">
                      <p className="text-[11px] text-muted-foreground font-medium">
                        {opts.format === "docx" ? "Word / DOCX" : "PDF / LaTeX"}
                      </p>
                      <div>
                        <Label className="text-xs">Page margin</Label>
                        <Input
                          value={opts.pdf_margin ?? "2.5cm"}
                          onChange={e => set("pdf_margin", e.target.value)}
                          placeholder="e.g. 2.5cm or 1in"
                          className="h-8 text-sm mt-1"
                        />
                      </div>
                      <div className="space-y-1">
                        <ToggleRow
                          label="Page numbers"
                          checked={opts.page_numbers ?? true}
                          onChange={v => set("page_numbers", v)}
                        />
                        <ToggleRow
                          label="Drop caps (first letter of each chapter)"
                          checked={opts.drop_caps ?? false}
                          onChange={v => set("drop_caps", v)}
                        />
                      </div>
                    </div>
                  )}

                </div>
              )}
            </>
          )}

          {/* LaTeX-specific */}
          {opts.format === "tex" && (
            <>
              <SectionHeading>LaTeX Settings</SectionHeading>
              <div>
                <Label className="text-xs">Paper size</Label>
                <ToggleGroup value={opts.paper_size} onChange={v => set("paper_size", v)}
                  options={[{ value: "a4paper", label: "A4" }, { value: "letterpaper", label: "Letter" }]} />
              </div>
            </>
          )}

          {/* EPUB-specific */}
          {opts.format === "epub-style" && (
            <>
              <SectionHeading>EPUB Style</SectionHeading>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Text colour</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="color" value={opts.text_color} onChange={e => set("text_color", e.target.value)}
                      className="h-8 w-10 rounded cursor-pointer border border-border bg-transparent p-0.5" />
                    <Input value={opts.text_color} onChange={e => set("text_color", e.target.value)} className="h-8 text-sm flex-1" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Background colour</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="color" value={opts.bg_color} onChange={e => set("bg_color", e.target.value)}
                      className="h-8 w-10 rounded cursor-pointer border border-border bg-transparent p-0.5" />
                    <Input value={opts.bg_color} onChange={e => set("bg_color", e.target.value)} className="h-8 text-sm flex-1" />
                  </div>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Page margin</Label>
                  <Input value={opts.page_margin} onChange={e => set("page_margin", e.target.value)}
                    placeholder="e.g. 2em or 1.5cm" className="h-8 text-sm mt-1" />
                </div>
              </div>

              <SectionHeading>Cover Image</SectionHeading>
              <input ref={coverRef} type="file" accept="image/*" className="hidden"
                onChange={e => setCoverFile(e.target.files?.[0] ?? null)} />
              <button onClick={() => coverRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-dashed border-border hover:border-primary/50 hover:text-primary text-muted-foreground transition-colors w-full"
              >
                <Upload className="h-4 w-4 shrink-0" />
                {coverFile ? coverFile.name : "Upload cover image (optional)"}
              </button>
              {coverFile && (
                <button onClick={() => setCoverFile(null)} className="text-xs text-muted-foreground hover:text-destructive mt-1 block">
                  Remove cover
                </button>
              )}
            </>
          )}

          {/* Output */}
          <SectionHeading>Output</SectionHeading>
          {!isBinary ? (
            <div className="space-y-2">
              {hasFolderPicker && (
                <button onClick={pickFolder}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 text-sm rounded-md border transition-colors w-full",
                    dirHandle
                      ? "border-primary/50 text-foreground bg-primary/5"
                      : "border-dashed border-border hover:border-primary/50 hover:text-primary text-muted-foreground"
                  )}
                >
                  <FolderOpen className="h-4 w-4 shrink-0" />
                  {dirHandle ? (
                    <span className="truncate">
                      <span className="font-medium">{dirHandle.name}/</span>
                      <span className="text-muted-foreground text-xs ml-1">— click to change</span>
                    </span>
                  ) : (
                    <span>Choose a different output folder <span className="text-muted-foreground/70">(optional)</span></span>
                  )}
                </button>
              )}
              {!dirHandle && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs rounded-md border border-border text-muted-foreground">
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                  Saved to your data folder → <span className="font-mono">exports/</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 text-xs rounded-md border border-border text-muted-foreground">
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              {["mobi", "azw3", "epub-calibre"].includes(opts.format)
                ? <>Generated by Calibre{calibreMode === "docker" ? " (Docker)" : " (system)"} and saved to your data folder → <span className="font-mono">exports/</span></>
                : <>Generated by the Pandoc container and saved to your data folder → <span className="font-mono">exports/</span></>
              }
            </div>
          )}
          </>)}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border shrink-0 space-y-2">

          {/* ── Publisher Pack footer ─── */}
          {mode === "pack" && (
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 text-xs min-w-0">
                {packStatus === "done"  && <span className="text-green-500 flex items-center gap-1 truncate"><Check className="h-3.5 w-3.5 shrink-0" />{packMsg}</span>}
                {packStatus === "error" && <span className="text-destructive truncate">{packMsg}</span>}
                {packStatus === "busy"  && <span className="text-muted-foreground flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />Generating manuscripts…</span>}
                {packStatus === "idle" && selectedPublishers.size > 0 && (
                  <span className="text-muted-foreground">
                    {selectedPublishers.size} publisher{selectedPublishers.size > 1 ? "s" : ""} selected
                  </span>
                )}
                {packStatus === "idle" && selectedPublishers.size === 0 && (
                  <span className="text-muted-foreground/50 italic">No publishers selected</span>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
              <Button
                size="sm"
                onClick={handleBatchExport}
                disabled={packStatus === "busy" || selectedPublishers.size === 0}
                className="gap-1.5 shrink-0"
              >
                {packStatus === "busy"
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Package className="h-3.5 w-3.5" />}
                Export Pack{selectedPublishers.size > 0 ? ` (${selectedPublishers.size})` : ""}
              </Button>
            </div>
          )}

          {/* ── Single export footer ─── */}
          {mode === "single" && (<>
            {/* Save-as-profile row */}
            {showSaveProfile ? (
              <div className="flex items-center gap-2">
                <Input
                  value={saveProfileName}
                  onChange={e => setSaveProfileName(e.target.value)}
                  placeholder="Profile name…"
                  className="h-7 text-xs flex-1"
                  onKeyDown={e => { if (e.key === "Enter") handleSaveProfile(); if (e.key === "Escape") setShowSaveProfile(false); }}
                  autoFocus
                />
                <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => setShowSaveProfile(false)}>Cancel</Button>
                <Button size="sm" className="h-7 text-xs px-2 gap-1" onClick={handleSaveProfile} disabled={!saveProfileName.trim()}>
                  <Save className="h-3 w-3" /> Save
                </Button>
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 text-xs min-w-0">
                {status === "done"  && <span className="text-green-500 flex items-center gap-1 truncate"><Check className="h-3.5 w-3.5 shrink-0" />{statusMsg}</span>}
                {status === "error" && <span className="text-destructive truncate">{statusMsg}</span>}
              </div>
              {!showSaveProfile && opts.format !== "md" && (
                <button
                  type="button"
                  onClick={() => setShowSaveProfile(true)}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 shrink-0"
                  title="Save current settings as a profile"
                >
                  <Save className="h-3 w-3" /> Save profile
                </button>
              )}
              <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" onClick={handleExport} disabled={status === "busy"} className="gap-1.5 shrink-0">
                {status === "busy"
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <FolderOpen className="h-3.5 w-3.5" />}
                Export {fmtLabelStr}
              </Button>
            </div>
          </>)}
        </div>
      </div>
    </div>
  );
}
