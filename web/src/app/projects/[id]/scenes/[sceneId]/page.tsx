"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { BookOpen, Sparkles, Clock, Moon, Sun, Archive, History, MessageSquare, Focus, Braces, ChevronDown, AlignCenter, Timer, Flag, BookMarked, MoreHorizontal, Check, SpellCheck, User, ListChecks, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TipTapEditor } from "@/components/editor/TipTapEditor";
import { StatusBar } from "@/components/editor/StatusBar";
import { ThesaurusPanel } from "@/components/editor/ThesaurusPanel";
import { GrammarPanel } from "@/components/grammar/GrammarPanel";
import { SENSITIVITY_TYPES, type FlagItem, type SensitivityType } from "@/components/editor/SensitivityExtension";
import { CodexSidebar } from "@/components/codex/CodexSidebar";
import { CodexEntryDialog } from "@/components/codex/CodexEntryDialog";
import { VersionHistoryPanel } from "@/components/editor/VersionHistoryPanel";
import { ChatPanel } from "@/components/editor/ChatPanel";
import { LinkPanel } from "@/components/editor/LinkPanel";
import { SceneTimePanel } from "@/components/time/SceneTimePanel";
import { TimeConfigDialog } from "@/components/time/TimeConfigDialog";
import { TimelineCommandDialog } from "@/components/timeline/TimelineCommandDialog";
import { useUIStore } from "@/store/ui";
import { useAutosave } from "@/hooks/useAutosave";
import { useQueryClient } from "@tanstack/react-query";
import {
  useScene, useUpdateScene, useCodexEntries,
  useCreateCodexEntry, useProject,
  useTimeConfig, useUpdateTimeConfig,
  useCreateFragment, useDeleteScene,
  useSyncSceneCommands, useCreateSceneVersion,
  useUpdateSettings, useSettings,
} from "@/store/queries";
import type { SceneTime, CodexEntry } from "@/types";
import type { SceneCommandIn } from "@/lib/api";
import { versionsApi } from "@/lib/api";
import { DEFAULT_TIME_CONFIG } from "@/types";
import { cn } from "@/lib/utils";
import { PLOT_TEMPLATES } from "@/lib/plotTemplates";

function getDayNightLabel(config: typeof DEFAULT_TIME_CONFIG, time: SceneTime | null): "Day" | "Night" | null {
  if (!time) return null;
  const hourUnit = config.units.find(u => u.id === "hour" && u.enabled);
  if (!hourUnit) return null;
  const hour = time["hour"];
  if (hour == null) return null;
  const dn = config.day_night;
  const nightEnd = (dn.night_start_hour + dn.night_duration) % dn.hours_per_day;
  let isNight: boolean;
  if (dn.night_duration <= 0) {
    isNight = false;
  } else if (nightEnd > dn.night_start_hour) {
    isNight = hour >= dn.night_start_hour && hour < nightEnd;
  } else {
    isNight = hour >= dn.night_start_hour || hour < nightEnd;
  }
  return isNight ? "Night" : "Day";
}

export default function ScenePage() {
  const { id, sceneId } = useParams();
  const router = useRouter();
  const projectId = Number(id);
  const sceneIdNum = Number(sceneId);

  const { data: scene } = useScene(sceneIdNum);
  const { data: project } = useProject(projectId);
  const { data: appSettings } = useSettings();
  const { data: codexEntries = [] } = useCodexEntries(projectId);
  const { data: timeConfigData } = useTimeConfig(projectId);
  const updateScene = useUpdateScene(sceneIdNum);
  const updateTimeConfig = useUpdateTimeConfig(projectId);
  const createEntry = useCreateCodexEntry(projectId);
  const createFragment = useCreateFragment(projectId);
  // chapter_id is on scene; hook needs it — use 0 until scene loads, only called after
  const deleteScene = useDeleteScene(scene?.chapter_id ?? 0);
  const syncCommands = useSyncSceneCommands();
  const createVersion = useCreateSceneVersion(sceneIdNum);
  const updateSettings = useUpdateSettings();
  const qc = useQueryClient();

  const timeConfig = timeConfigData ?? DEFAULT_TIME_CONFIG;
  const aiDisabled = appSettings?.ai_disabled ?? false;

  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [wordCount, setWordCount] = useState(0);
  const [selectedCodexId, setSelectedCodexId] = useState<number>(-1);
  const [newEntryDialogOpen, setNewEntryDialogOpen] = useState(false);
  const [newEntryInitial, setNewEntryInitial] = useState<Partial<CodexEntry>>({});
  const [timePanelOpen, setTimePanelOpen] = useState(false);
  const [timeConfigOpen, setTimeConfigOpen] = useState(false);
  const [timelineCommandOpen, setTimelineCommandOpen] = useState(false);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const [linkPanelOpen, setLinkPanelOpen] = useState(false);

  const codexSidebarOpen    = useUIStore((s) => s.codexSidebarOpen);
  const setCodexSidebarOpen = useUIStore((s) => s.setCodexSidebarOpen);
  const focusMode           = useUIStore((s) => s.focusMode);
  const setFocusMode        = useUIStore((s) => s.setFocusMode);
  const typewriterMode      = useUIStore((s) => s.typewriterMode);
  const setTypewriterMode   = useUIStore((s) => s.setTypewriterMode);
  const sessionTimerEnabled = useUIStore((s) => s.sessionTimerEnabled);
  const sessionGoal         = useUIStore((s) => s.sessionGoal);
  const setSessionGoal      = useUIStore((s) => s.setSessionGoal);
  const clearSession        = useUIStore((s) => s.clearSession);

  const [ghostPopoverOpen, setGhostPopoverOpen]   = useState(false);
  const [menuOpen, setMenuOpen]                   = useState(false);
  const [flags, setFlags]                         = useState<FlagItem[]>([]);
  const [thesaurusOpen, setThesaurusOpen]         = useState(false);
  const [selectedWord, setSelectedWord]           = useState<string>("");
  const [grammarPanelOpen, setGrammarPanelOpen]   = useState(false);
  const replaceWordRef         = useRef<((word: string) => void) | null>(null);
  const applyFlagRef           = useRef<((type: string) => void) | null>(null);
  const applyGrammarFixRef     = useRef<((matched: string, replacement: string, offset: number) => void) | null>(null);
  const jumpToGrammarMatchRef  = useRef<((matched: string, offset: number) => void) | null>(null);
  const jumpToTextRef          = useRef<((text: string) => void) | null>(null);

  // Characters for POV selector
  const characters = useMemo(
    () => codexEntries
      .filter(e => e.entry_type === "character")
      .sort((a, b) => a.name.localeCompare(b.name)),
    [codexEntries],
  );

  // Deduplicated beat names from all plot templates
  const allBeats = useMemo(() => {
    const seen = new Set<string>();
    const beats: { id: string; name: string }[] = [];
    for (const template of PLOT_TEMPLATES) {
      for (const beat of template.beats) {
        if (!seen.has(beat.name)) {
          seen.add(beat.name);
          beats.push({ id: beat.id, name: beat.name });
        }
      }
    }
    return beats;
  }, []);

  // Count ghost-text placeholders in current content
  const ghostTexts = useMemo(() => {
    if (!content) return [] as string[];
    const dom = typeof document !== "undefined"
      ? new DOMParser().parseFromString(content, "text/html")
      : null;
    if (!dom) return [] as string[];
    return Array.from(dom.querySelectorAll("[data-ghost]")).map((el) => el.textContent ?? "");
  }, [content]);

  const editorRef = useRef<{ insertContent: (text: string) => void } | null>(null);
  const contentRef = useRef<string>("");
  const lastSnapshotContentRef = useRef<string>("");
  const prevSceneIdRef = useRef<number>(0);

  useEffect(() => {
    if (scene) {
      setContent(scene.content || "");
      setTitle(scene.title || "");
      setWordCount(scene.word_count);
      // Sync commands on every scene load so inventory is up-to-date even if the
      // user navigated away before the debounced sync fired in a previous session.
      if (scene.content) {
        const commands = extractCommands(scene.content);
        syncCommands.mutate({ sceneId: scene.id, commands });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.id]);

  // Extract trackable commands from HTML content
  const extractCommands = useCallback((html: string): SceneCommandIn[] => {
    if (!html || typeof document === "undefined") return [];
    const dom = new DOMParser().parseFromString(html, "text/html");
    const cmds: SceneCommandIn[] = [];
    let order = 0;
    dom.querySelectorAll('[data-type="currency"],[data-type="item"]').forEach((el) => {
      const type = el.getAttribute("data-type") as "currency" | "item";
      if (type === "currency") {
        cmds.push({
          command_type: "currency",
          character_id: parseInt(el.getAttribute("data-char-id") ?? "0"),
          data: {
            currencyName: el.getAttribute("data-currency-name") ?? "",
            delta: parseInt(el.getAttribute("data-delta") ?? "0"),
          },
          order_index: order++,
        });
      } else {
        cmds.push({
          command_type: "item",
          character_id: parseInt(el.getAttribute("data-char-id") ?? "0"),
          item_id: parseInt(el.getAttribute("data-item-id") ?? "0") || null,
          data: { qty: parseInt(el.getAttribute("data-qty") ?? "1") },
          order_index: order++,
        });
      }
    });
    return cmds;
  }, []);

  // Debounced command sync (fires 2s after last change, same rhythm as autosave)
  const syncRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The pending command sync, tagged with the scene it was extracted from.
  const pendingCmdRef = useRef<{ sceneId: number; html: string } | null>(null);
  // Keep a stable reference to the (stable) RQ mutate fn so flushCommands below
  // doesn't change identity every render.
  const syncMutateRef = useRef(syncCommands.mutate);
  syncMutateRef.current = syncCommands.mutate;

  const flushCommands = useCallback(() => {
    const pending = pendingCmdRef.current;
    if (!pending) return;
    pendingCmdRef.current = null;
    syncMutateRef.current({ sceneId: pending.sceneId, commands: extractCommands(pending.html) });
  }, [extractCommands]);

  const handleContentChange = useCallback((html: string) => {
    setContent(html);
    contentRef.current = html;
    const text = html.replace(/<[^>]+>/g, "");
    setWordCount(text.trim().split(/\s+/).filter(Boolean).length);
    // Debounce command sync, tagging the scene so a late fire targets the scene
    // the commands came from — not whatever scene is mounted when it fires.
    pendingCmdRef.current = { sceneId: sceneIdNum, html };
    if (syncRef.current) clearTimeout(syncRef.current);
    syncRef.current = setTimeout(flushCommands, 2000);
  }, [sceneIdNum, flushCommands]);

  // Flush any pending command sync when leaving the scene / unmounting, so the
  // last edits' inventory commands aren't dropped; also clears the stale timer.
  useEffect(() => {
    return () => {
      if (syncRef.current) { clearTimeout(syncRef.current); syncRef.current = null; }
      flushCommands();
    };
  }, [sceneIdNum, flushCommands]);

  const handleTitleBlur = () => {
    if (scene && title !== scene.title) {
      updateScene.mutate({ data: { title } });
    }
  };

  const { saveNow } = useAutosave({ sceneId: sceneIdNum, content, enabled: !!scene });

  // ESC exits focus mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && focusMode) setFocusMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode, setFocusMode]);

  // Clear session when navigating to a different scene
  useEffect(() => { clearSession(); }, [sceneIdNum]); // eslint-disable-line react-hooks/exhaustive-deps

  // 5-minute auto-snapshot
  useEffect(() => {
    if (!scene) return;
    const interval = setInterval(() => {
      const current = contentRef.current;
      if (current && current !== lastSnapshotContentRef.current) {
        lastSnapshotContentRef.current = current;
        createVersion.mutate(current);
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.id]);

  // Snapshot on scene navigation (fire-and-forget for the scene we just left)
  useEffect(() => {
    if (prevSceneIdRef.current !== 0 && prevSceneIdRef.current !== sceneIdNum) {
      const prev = prevSceneIdRef.current;
      const prevContent = contentRef.current;
      if (prevContent) {
        versionsApi.create(prev, prevContent)
          .then(() => qc.invalidateQueries({ queryKey: ["scene-versions", prev] }))
          .catch(() => {});
      }
    }
    prevSceneIdRef.current = sceneIdNum;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneIdNum]);

  // Snapshot on unmount (navigating away from scene entirely)
  useEffect(() => {
    return () => {
      const current = contentRef.current;
      const id = prevSceneIdRef.current;
      if (current && id > 0) {
        versionsApi.create(id, current).catch(() => {});
      }
    };
  }, []);

  const handleVersionRestored = (restoredContent: string) => {
    setContent(restoredContent);
    lastSnapshotContentRef.current = restoredContent;
  };

  const handleCodexEntryClick = (id: number) => {
    setSelectedCodexId(id);
    if (!codexSidebarOpen) setCodexSidebarOpen(true);
  };

  const handleInsertAI = (text: string) => {
    setContent((prev) => prev + `<p>${text.replace(/\n/g, "</p><p>")}</p>`);
  };

  const handleSceneTimeChange = (time: SceneTime | null) => {
    updateScene.mutate({ data: { scene_time: time as any } });
  };

  const handleOpenConfig = () => {
    setTimePanelOpen(false);
    setTimeConfigOpen(true);
  };

  const handleArchiveScene = async () => {
    if (!scene) return;
    if (!confirm(`Archive "${scene.title || "Untitled Scene"}"?\n\nThis will save the content as a fragment in the Archive tab. You can then choose to delete the scene.`)) return;
    await createFragment.mutateAsync({
      tab: "archive",
      title: scene.title || "Untitled Scene",
      content: scene.content || "",
    });
    if (confirm("Scene archived. Delete the original scene from the story?")) {
      deleteScene.mutate(sceneIdNum);
      router.push(`/projects/${projectId}`);
    }
  };

  // Day/night indicator for toolbar
  const dayNight = getDayNightLabel(timeConfig, scene?.scene_time ?? null);
  const hasTime = !!(scene?.scene_time && Object.keys(scene.scene_time).length > 0);

  if (!scene) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading scene...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ESC hint while in focus mode */}
      {focusMode && (
        <div className="fixed top-3 right-4 z-50 text-[11px] text-muted-foreground/40 pointer-events-none select-none">
          ESC — exit focus
        </div>
      )}

      {/* Toolbar — hidden in focus mode */}
      {!focusMode && <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          placeholder="Scene title..."
          className="border-0 bg-transparent text-sm font-medium h-8 px-2 focus-visible:ring-0 max-w-xs"
        />
        <div className="flex-1" />

        {/* Day/night badge */}
        {hasTime && dayNight && (
          <span className={cn(
            "flex items-center gap-1 text-xs px-2 py-0.5 rounded-full",
            dayNight === "Night"
              ? "bg-[hsl(262_80%_65%/0.2)] text-[hsl(262_80%_75%)]"
              : "bg-[hsl(38_92%_65%/0.2)] text-[hsl(38_92%_55%)]"
          )}>
            {dayNight === "Night" ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
            {dayNight}
          </span>
        )}

        {/* Ghost text placeholder badge */}
        {ghostTexts.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setGhostPopoverOpen((v) => !v)}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded text-amber-400 hover:bg-amber-400/10 transition-colors"
              title="Pending placeholders"
            >
              <Braces className="h-3.5 w-3.5" />
              {ghostTexts.length}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
            {ghostPopoverOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg p-2 min-w-[200px] max-w-[280px]">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 px-1">Placeholders</p>
                <div className="space-y-0.5 max-h-48 overflow-y-auto">
                  {ghostTexts.map((text, i) => (
                    <div key={i} className="text-xs px-2 py-1 rounded text-amber-300/80 bg-amber-400/5 font-mono truncate">
                      {text}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Save */}
        <Button
          size="sm"
          variant="ghost"
          onClick={saveNow}
          className="gap-1.5 text-xs"
          title="Save now (Ctrl+S)"
        >
          <Save className="h-3.5 w-3.5" />
          Save
        </Button>

        {/* History */}
        <Button
          size="sm"
          variant={historyPanelOpen ? "secondary" : "ghost"}
          onClick={() => {
            setHistoryPanelOpen(!historyPanelOpen);
            if (timePanelOpen) setTimePanelOpen(false);
          }}
          className="gap-1.5 text-xs"
        >
          <History className="h-3.5 w-3.5" />
          History
        </Button>

        {/* Codex */}
        <Button
          size="sm"
          variant={codexSidebarOpen ? "secondary" : "ghost"}
          onClick={() => {
            setCodexSidebarOpen(!codexSidebarOpen);
            if (timePanelOpen) setTimePanelOpen(false);
          }}
          className="gap-1.5 text-xs"
        >
          <BookOpen className="h-3.5 w-3.5" />
          Codex
        </Button>

        {/* Grammar — only when service is enabled */}
        {appSettings?.grammar_check_enabled && (
          <Button
            size="sm"
            variant={grammarPanelOpen ? "secondary" : "ghost"}
            onClick={() => setGrammarPanelOpen(v => !v)}
            className="gap-1.5 text-xs"
            title="Grammar check"
          >
            <SpellCheck className="h-3.5 w-3.5" />
            Grammar
          </Button>
        )}

        {/* ── Sandwich menu ──────────────────────────────────────────────── */}
        <div className="relative">
          <Button
            size="sm"
            variant={menuOpen ? "secondary" : "ghost"}
            onClick={() => setMenuOpen((v) => !v)}
            className="px-2"
            title="More options"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[200px]" onClick={(e) => e.stopPropagation()}>

              {/* Scene tools */}
              <button
                onClick={() => { setTimePanelOpen(!timePanelOpen); if (codexSidebarOpen) setCodexSidebarOpen(false); setMenuOpen(false); }}
                className={cn("w-full text-left text-xs px-3 py-2 hover:bg-secondary/50 flex items-center gap-2", timePanelOpen && "text-primary")}
              >
                <Clock className={cn("h-3.5 w-3.5", hasTime ? "text-primary" : "text-muted-foreground")} />
                Time
                {hasTime && <span className="ml-auto text-[10px] text-primary">set</span>}
              </button>
              {!aiDisabled && (
              <button
                onClick={() => { setChatPanelOpen(!chatPanelOpen); if (timePanelOpen) setTimePanelOpen(false); setMenuOpen(false); }}
                className={cn("w-full text-left text-xs px-3 py-2 hover:bg-secondary/50 flex items-center gap-2", chatPanelOpen && "text-primary")}
              >
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                Chat
                {chatPanelOpen && <Check className="ml-auto h-3 w-3 text-primary" />}
              </button>
              )}

              <div className="border-t border-border my-1" />

              {/* Scene metadata: POV + Beat */}
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-3 pt-1 pb-0.5">Scene info</p>
              <div className="px-3 py-1.5 flex items-center gap-2">
                <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground shrink-0 w-8">POV</span>
                <select
                  value={scene?.pov_character_id ?? ""}
                  onChange={e => {
                    const val = e.target.value ? Number(e.target.value) : null;
                    updateScene.mutate({ data: { pov_character_id: val } });
                  }}
                  onClick={e => e.stopPropagation()}
                  className="flex-1 text-xs bg-secondary border border-border rounded px-1.5 py-0.5 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">— none —</option>
                  {characters.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="px-3 py-1.5 flex items-center gap-2">
                <ListChecks className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground shrink-0 w-8">Beat</span>
                <select
                  value={scene?.beat ?? ""}
                  onChange={e => {
                    updateScene.mutate({ data: { beat: e.target.value || null } });
                  }}
                  onClick={e => e.stopPropagation()}
                  className="flex-1 text-xs bg-secondary border border-border rounded px-1.5 py-0.5 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">— none —</option>
                  {allBeats.map(b => (
                    <option key={b.id} value={b.name}>{b.name}</option>
                  ))}
                </select>
              </div>

              <div className="border-t border-border my-1" />

              {/* Writing tools */}
              <button
                onClick={() => { const next = !typewriterMode; setTypewriterMode(next); updateSettings.mutate({ typewriter_mode: next }); }}
                className="w-full text-left text-xs px-3 py-2 hover:bg-secondary/50 flex items-center gap-2"
              >
                <AlignCenter className="h-3.5 w-3.5 text-muted-foreground" />
                Typewriter
                {typewriterMode && <Check className="ml-auto h-3 w-3 text-primary" />}
              </button>
              <button
                onClick={() => { setThesaurusOpen((v) => !v); setMenuOpen(false); }}
                className={cn("w-full text-left text-xs px-3 py-2 hover:bg-secondary/50 flex items-center gap-2", thesaurusOpen && "text-primary")}
              >
                <BookMarked className="h-3.5 w-3.5 text-muted-foreground" />
                Thesaurus
                {thesaurusOpen && <Check className="ml-auto h-3 w-3 text-primary" />}
              </button>
              {appSettings?.grammar_check_enabled && (
                <button
                  onClick={() => { setGrammarPanelOpen((v) => !v); setMenuOpen(false); }}
                  className={cn("w-full text-left text-xs px-3 py-2 hover:bg-secondary/50 flex items-center gap-2", grammarPanelOpen && "text-primary")}
                >
                  <SpellCheck className="h-3.5 w-3.5 text-muted-foreground" />
                  Grammar
                  {grammarPanelOpen && <Check className="ml-auto h-3 w-3 text-primary" />}
                </button>
              )}

              <div className="border-t border-border my-1" />

              {/* Flag submenu */}
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-3 pt-1 pb-0.5">Flag selection</p>
              {SENSITIVITY_TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { applyFlagRef.current?.(t.id); setMenuOpen(false); }}
                  className={cn("w-full text-left text-xs px-3 py-1.5 hover:bg-secondary/50 flex items-center gap-2", t.color)}
                >
                  <Flag className="h-3 w-3" />
                  {t.label}
                </button>
              ))}

              {/* Flags list */}
              {flags.length > 0 && (
                <>
                  <div className="border-t border-border my-1" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-3 pt-1 pb-0.5">
                    Flagged passages ({flags.length})
                  </p>
                  <div className="max-h-32 overflow-y-auto">
                    {flags.map((f, i) => {
                      const type = SENSITIVITY_TYPES.find((t) => t.id === f.type);
                      return (
                        <div key={i} className="text-xs px-3 py-1">
                          <span className={cn("text-[10px] font-medium mr-1", type?.color)}>{type?.label}</span>
                          <span className="text-muted-foreground/70 truncate">{f.text}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Session goal */}
              {sessionTimerEnabled && (
                <>
                  <div className="border-t border-border my-1" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-3 pt-1 pb-1">Writing goal</p>
                  <div className="flex flex-wrap gap-1 px-3 pb-1.5">
                    {[250, 500, 1000, 1500].map((n) => (
                      <button
                        key={n}
                        onClick={() => { setSessionGoal(n, wordCount); setMenuOpen(false); }}
                        className={cn(
                          "text-xs px-2 py-0.5 rounded border transition-colors",
                          sessionGoal === n
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:bg-primary/10 hover:border-primary/40 hover:text-primary"
                        )}
                      >
                        {n}
                      </button>
                    ))}
                    {sessionGoal && (
                      <button
                        onClick={() => { clearSession(); setMenuOpen(false); }}
                        className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground"
                      >
                        Stop
                      </button>
                    )}
                  </div>
                </>
              )}

              <div className="border-t border-border my-1" />

              {/* Destructive / exit */}
              <button
                onClick={() => { handleArchiveScene(); setMenuOpen(false); }}
                className="w-full text-left text-xs px-3 py-2 hover:bg-secondary/50 flex items-center gap-2 text-muted-foreground"
              >
                <Archive className="h-3.5 w-3.5" />
                Archive scene
              </button>
              <button
                onClick={() => { setFocusMode(true); setCodexSidebarOpen(false); setTimePanelOpen(false); setHistoryPanelOpen(false); setChatPanelOpen(false); setMenuOpen(false); }}
                className="w-full text-left text-xs px-3 py-2 hover:bg-secondary/50 flex items-center gap-2 text-muted-foreground"
              >
                <Focus className="h-3.5 w-3.5" />
                Focus mode
              </button>
            </div>
          )}
        </div>
      </div>}

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Editor */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <TipTapEditor
            content={content}
            onChange={handleContentChange}
            codexEntries={codexEntries}
            onCodexEntryClick={handleCodexEntryClick}
            sceneId={sceneIdNum}
            aiDisabled={aiDisabled}
            onOpenChat={aiDisabled ? undefined : () => setChatPanelOpen(true)}
            onOpenTimeline={() => setTimelineCommandOpen(true)}
            onOpenLink={() => setLinkPanelOpen(true)}
            onWordSelect={(w) => { if (w) setSelectedWord(w); }}
            onFlagsChange={setFlags}
            replaceWordRef={replaceWordRef}
            applyFlagRef={applyFlagRef}
            applyGrammarFixRef={applyGrammarFixRef}
            jumpToGrammarMatchRef={jumpToGrammarMatchRef}
            jumpToTextRef={jumpToTextRef}
            onPrefillEntry={(data) => { setNewEntryInitial(data); setNewEntryDialogOpen(true); }}
          />
          <StatusBar sceneWordCount={wordCount} />
        </div>

        {/* Time panel */}
        {timePanelOpen && (
          <SceneTimePanel
            config={timeConfig}
            sceneTime={scene.scene_time ?? null}
            onChange={handleSceneTimeChange}
            onClose={() => setTimePanelOpen(false)}
            onOpenConfig={handleOpenConfig}
          />
        )}

        {/* Codex sidebar */}
        {codexSidebarOpen && (
          <CodexSidebar
            entries={codexEntries}
            selectedId={selectedCodexId >= 0 ? selectedCodexId : undefined}
            onSelect={(id) => setSelectedCodexId(id)}
            onClose={() => setCodexSidebarOpen(false)}
            onAdd={(initial) => { if (initial) setNewEntryInitial(initial); setNewEntryDialogOpen(true); }}
            onJumpToText={(text) => jumpToTextRef.current?.(text)}
            sceneContent={content}
            sceneId={Number(sceneId)}
          />
        )}

        {/* Version history panel */}
        {historyPanelOpen && (
          <VersionHistoryPanel
            sceneId={sceneIdNum}
            onClose={() => setHistoryPanelOpen(false)}
            onRestored={handleVersionRestored}
          />
        )}

        {/* Scene chat panel */}
        {!aiDisabled && chatPanelOpen && (
          <ChatPanel
            sceneId={sceneIdNum}
            onClose={() => setChatPanelOpen(false)}
          />
        )}

        {/* Scene links panel */}
        {linkPanelOpen && (
          <LinkPanel
            projectId={projectId}
            sceneId={sceneIdNum}
            onClose={() => setLinkPanelOpen(false)}
          />
        )}

        {/* Thesaurus panel */}
        {thesaurusOpen && (
          <ThesaurusPanel
            selectedWord={selectedWord}
            onReplaceWord={(word) => replaceWordRef.current?.(word)}
            onClose={() => setThesaurusOpen(false)}
            language={project?.book_meta?.language ?? "en"}
          />
        )}

        {/* Grammar check panel */}
        {grammarPanelOpen && (
          <GrammarPanel
            text={content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}
            language={project?.book_meta?.language ?? "auto"}
            onClose={() => setGrammarPanelOpen(false)}
            onJumpTo={(matched, offset) => jumpToGrammarMatchRef.current?.(matched, offset)}
            onApplySuggestion={(matched, replacement, offset) => applyGrammarFixRef.current?.(matched, replacement, offset)}
          />
        )}

      </div>

      <CodexEntryDialog
        open={newEntryDialogOpen}
        onClose={() => { setNewEntryDialogOpen(false); setNewEntryInitial({}); }}
        onSave={(data) => createEntry.mutate({ ...data, project_id: projectId } as any)}
        initial={newEntryInitial}
        title="New Codex Entry"
      />

      <TimeConfigDialog
        open={timeConfigOpen}
        onClose={() => setTimeConfigOpen(false)}
        initial={timeConfig}
        onSave={(cfg) => updateTimeConfig.mutate(cfg)}
      />
      <TimelineCommandDialog
        open={timelineCommandOpen}
        onClose={() => setTimelineCommandOpen(false)}
        projectId={projectId}
        sceneTitle={scene?.title ?? undefined}
        timeConfig={timeConfig}
      />
    </div>
  );
}
