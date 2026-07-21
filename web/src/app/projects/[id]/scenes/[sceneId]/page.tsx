"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { BookOpen, Sparkles, Clock, Moon, Sun, Archive, History, MessageSquare, Focus, Braces, ChevronDown, AlignCenter, Timer, Flag, BookMarked, MoreHorizontal, Check, SpellCheck, User, ListChecks, Save, MessageCircle, BarChart2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TipTapEditor } from "@/components/editor/TipTapEditor";
import { StatusBar, SaveIndicator } from "@/components/editor/StatusBar";
import { ThesaurusPanel } from "@/components/editor/ThesaurusPanel";
import { GrammarPanel } from "@/components/grammar/GrammarPanel";
import { ValePanel } from "@/components/vale/ValePanel";
import { ProseMetricsDialog } from "@/components/vale/ProseMetricsDialog";
import { SENSITIVITY_TYPES, type FlagItem, type SensitivityType } from "@/components/editor/SensitivityExtension";
import { CodexSidebar } from "@/components/codex/CodexSidebar";
import { CodexEntryDialog } from "@/components/codex/CodexEntryDialog";
import { CommentsPanel } from "@/components/collab/CommentsPanel";
import { VersionHistoryPanel } from "@/components/editor/VersionHistoryPanel";
import { ChatPanel } from "@/components/editor/ChatPanel";
import { LinkPanel } from "@/components/editor/LinkPanel";
import { SceneTimePanel } from "@/components/time/SceneTimePanel";
import { TimeConfigDialog } from "@/components/time/TimeConfigDialog";
import { TimelineCommandDialog } from "@/components/timeline/TimelineCommandDialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { useUIStore } from "@/store/ui";
import { useCollabStore, getLockHolder } from "@/store/collabStore";
import { getCoworkIdentity } from "@/lib/api";
import type { CommentHighlight } from "@/components/editor/CommentHighlightExtension";
import { useAutosave } from "@/hooks/useAutosave";
import { useQueryClient } from "@tanstack/react-query";
import {
  useScene, useUpdateScene, useCodexEntries,
  useCreateCodexEntry, useUpdateCodexEntry, useProject,
  useTimeConfig, useUpdateTimeConfig,
  useCreateFragment, useDeleteScene,
  useSyncSceneCommands, useCreateSceneVersion,
  useUpdateSettings, useSettings,
  useComments, useCreateComment, useSyncCommentPositions,
  useProseCheck,
} from "@/store/queries";
import type { SceneTime, CodexEntry } from "@/types";
import type { SceneCommandIn } from "@/lib/api";
import { versionsApi } from "@/lib/api";
import { DEFAULT_TIME_CONFIG } from "@/types";
import { cn } from "@/lib/utils";
import { htmlToGrammarPlainText } from "@/lib/grammarUtils";
import { PLOT_TEMPLATES } from "@/lib/plotTemplates";

const COMMENT_CATEGORIES = ["Plot", "Character", "Style", "Language", "Continuity", "Research"];
const CUSTOM_CATEGORIES_KEY = "fol_comment_categories";

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
  const { t } = useLanguage();
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
  const updateEntry = useUpdateCodexEntry(projectId);
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

  // ── Identity (read once; getCoworkIdentity reads localStorage — no hook needed) ──
  const identity   = useMemo(() => getCoworkIdentity(), []);
  const isHost     = !identity;
  const isEditor   = identity?.role === "editor";
  const canComment = identity?.role !== "student";

  // ── Co-work soft lock + presence ────────────────────────────────────────
  const locks          = useCollabStore((s) => s.locks);
  const mySessionId    = useCollabStore((s) => s.mySessionId);
  const requestLock    = useCollabStore((s) => s.requestLock);
  const releaseLock    = useCollabStore((s) => s.releaseLock);
  const sendHeartbeat  = useCollabStore((s) => s.sendHeartbeat);
  const sendPresence   = useCollabStore((s) => s.sendPresence);
  const collabConn     = useCollabStore((s) => s.connected);
  const [lockDenied, setLockDenied]         = useState<string | null>(null);
  const [lockDeniedReason, setLockDeniedReason] = useState<string | null>(null);

  const lockHolder = getLockHolder(locks, "scene", sceneIdNum, mySessionId);

  // Request lock + announce presence on mount; release/clear on unmount.
  // Editors skip the lock request — they can never edit, so acquiring the
  // lock would just block the actual author without granting any benefit.
  useEffect(() => {
    if (!collabConn) return;
    if (!isEditor) requestLock("scene", sceneIdNum);
    sendPresence("scene", sceneIdNum);
    const hb = setInterval(() => sendHeartbeat("scene", sceneIdNum), 20_000);
    return () => {
      clearInterval(hb);
      if (!isEditor) releaseLock("scene", sceneIdNum);
      sendPresence(null, null);
    };
  }, [collabConn, sceneIdNum, isEditor, requestLock, releaseLock, sendHeartbeat, sendPresence]);

  // Listen for lock_denied custom events from the WS hook
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.item_type === "scene" && detail?.item_id === sceneIdNum) {
        // holder is null for "not_assigned" denials — fall back to reason so
        // lockDenied is always truthy and isReadOnly triggers correctly.
        setLockDenied((detail.holder as string) || (detail.reason as string) || "denied");
        setLockDeniedReason(detail.reason as string | null);
      }
    };
    window.addEventListener("cowork:lock_denied", handler);
    return () => window.removeEventListener("cowork:lock_denied", handler);
  }, [sceneIdNum]);

  const isReadOnly = isEditor || !!(lockHolder || lockDenied);
  const hostAuthorName = project?.book_meta?.author || "Main author";

  // ── Comments ─────────────────────────────────────────────────────────────────
  const presence       = useCollabStore((s) => s.presence);
  const myColor        = useMemo(() => {
    if (isHost) return "#6366f1";
    const own = presence.find((p) => p.display_name === identity?.name);
    return own?.color ?? "#f59e0b";
  }, [isHost, identity, presence]);

  const { data: sceneComments = [] } = useComments(sceneIdNum);
  const createComment    = useCreateComment(sceneIdNum);
  const syncPositions    = useSyncCommentPositions(sceneIdNum);

  const commentHighlights: CommentHighlight[] = useMemo(
    () => sceneComments.map((c) => ({ id: c.id, from: c.from_pos, to: c.to_pos, color: c.color })),
    [sceneComments],
  );

  function handleCommentRequest(from: number, to: number, text: string) {
    setPendingComment({ from, to, text });
    setCommentBody("");
    setAddCommentOpen(true);
  }

  async function handleSubmitComment() {
    if (!pendingComment || !commentBody.trim()) return;
    const cat = commentCategory.trim();
    if (customCategoryMode && cat) {
      try {
        const stored: string[] = JSON.parse(localStorage.getItem(CUSTOM_CATEGORIES_KEY) ?? "[]");
        if (!stored.includes(cat)) {
          localStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify([...stored, cat]));
        }
      } catch { /* ignore */ }
    }
    await createComment.mutateAsync({
      from_pos:    pendingComment.from,
      to_pos:      pendingComment.to,
      anchor_text: pendingComment.text.slice(0, 200),
      body:        commentBody.trim(),
      color:       myColor,
      category:    cat,
    });
    setAddCommentOpen(false);
    setPendingComment(null);
    setCommentBody("");
    setCommentCategory("");
    setCustomCategoryMode(false);
    setCommentsPanelOpen(true);
  }

  function handleJumpToComment(from: number) {
    if (!jumpToTextRef.current) return;
    // Find the comment's anchor text and jump there via the grammar-style text finder
    const comment = sceneComments.find((c) => c.from_pos === from);
    if (comment) jumpToTextRef.current(comment.anchor_text);
  }

  const codexSidebarOpen    = useUIStore((s) => s.codexSidebarOpen);
  const setCodexSidebarOpen = useUIStore((s) => s.setCodexSidebarOpen);
  const focusMode           = useUIStore((s) => s.focusMode);
  const setFocusMode        = useUIStore((s) => s.setFocusMode);
  const typewriterMode      = useUIStore((s) => s.typewriterMode);
  const setTypewriterMode   = useUIStore((s) => s.setTypewriterMode);
  const sessionTimerEnabled  = useUIStore((s) => s.sessionTimerEnabled);
  const showCodexHighlights  = useUIStore((s) => s.showCodexHighlights);
  const sessionGoal          = useUIStore((s) => s.sessionGoal);
  const setSessionGoal      = useUIStore((s) => s.setSessionGoal);
  const clearSession        = useUIStore((s) => s.clearSession);

  const [ghostPopoverOpen, setGhostPopoverOpen]   = useState(false);
  const [menuOpen, setMenuOpen]                   = useState(false);
  const [flags, setFlags]                         = useState<FlagItem[]>([]);
  const [thesaurusOpen, setThesaurusOpen]         = useState(false);
  const [selectedWord, setSelectedWord]           = useState<string>("");
  const [grammarPanelOpen, setGrammarPanelOpen]   = useState(false);
  const [valePanelOpen, setValePanelOpen]         = useState(false);
  const [proseMetricsOpen, setProseMetricsOpen]   = useState(false);
  const proseCheck = useProseCheck();
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
  const [addCommentOpen, setAddCommentOpen]       = useState(false);
  const [pendingComment, setPendingComment]       = useState<{ from: number; to: number; text: string } | null>(null);
  const [commentBody, setCommentBody]             = useState("");
  const [commentCategory, setCommentCategory]     = useState("");
  const [customCategoryMode, setCustomCategoryMode] = useState(false);
  const replaceWordRef         = useRef<((word: string) => void) | null>(null);
  const applyFlagRef           = useRef<((type: string) => void) | null>(null);
  const applyGrammarFixRef       = useRef<((matched: string, replacement: string, offset: number) => void) | null>(null);
  const jumpToGrammarMatchRef    = useRef<((matched: string, offset: number) => void) | null>(null);
  const jumpToValeMatchRef       = useRef<((matched: string, skipCount: number) => void) | null>(null);
  const jumpToTextRef            = useRef<((text: string) => void) | null>(null);
  const getCommentPositionsRef   = useRef<(() => CommentHighlight[]) | null>(null);
  const triggerCommentRef        = useRef<(() => void) | null>(null);
  const hasSelectionRef          = useRef<(() => boolean) | null>(null);

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

  // Keep contentRef mirroring `content` at all times so the Save button and
  // Ctrl+S always persist the actual current content — including after
  // programmatic updates (scene load, History restore) that set `content` but
  // would otherwise leave the ref stale, causing Save to write the wrong data.
  useEffect(() => { contentRef.current = content; }, [content]);

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

  const { saveNow: _saveNow, markDirty } = useAutosave({ sceneId: sceneIdNum, enabled: !!scene });

  const handleContentChange = useCallback((html: string) => {
    setContent(html);
    contentRef.current = html;
    const text = html.replace(/<[^>]+>/g, "");
    setWordCount(text.trim().split(/\s+/).filter(Boolean).length);
    markDirty(html);
    // Debounce command sync, tagging the scene so a late fire targets the scene
    // the commands came from — not whatever scene is mounted when it fires.
    pendingCmdRef.current = { sceneId: sceneIdNum, html };
    if (syncRef.current) clearTimeout(syncRef.current);
    syncRef.current = setTimeout(flushCommands, 2000);
  }, [sceneIdNum, flushCommands, markDirty]);

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

  const saveNow = useCallback(() => {
    _saveNow(contentRef.current);
    // Sync drift-corrected comment positions (host and coauthors only)
    if (isHost || identity?.role === "coauthor") {
      const positions = getCommentPositionsRef.current?.() ?? [];
      if (positions.length > 0) {
        syncPositions.mutate(
          positions.map((p) => ({ id: p.id, from_pos: p.from, to_pos: p.to }))
        );
      }
    }
  }, [_saveNow, isHost, identity, syncPositions]);

  // ESC exits focus mode; Ctrl/Cmd+S saves immediately
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && focusMode) setFocusMode(false);
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode, setFocusMode, saveNow]);

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
    contentRef.current = restoredContent;
    lastSnapshotContentRef.current = restoredContent;
    // A restore is a real content change the user wants kept — flag it dirty so
    // it persists via autosave / navigation flush even without pressing Save.
    markDirty(restoredContent);
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
              <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-foreground/25 rounded-lg shadow-[0_0_0_1px_hsl(var(--foreground)/0.1),0_8px_28px_hsl(var(--foreground)/0.22)] p-2 min-w-[200px] max-w-[280px]">
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

        {/* Add Comment */}
        {canComment && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => triggerCommentRef.current?.()}
            className="gap-1.5 text-xs"
            title="Add comment on selection"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Comment
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
            <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-foreground/25 rounded-lg shadow-[0_0_0_1px_hsl(var(--foreground)/0.1),0_8px_28px_hsl(var(--foreground)/0.22)] py-1 min-w-[200px]" onClick={(e) => e.stopPropagation()}>

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
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-3 pt-1 pb-0.5">{t("scene_info_header")}</p>
              <div className="px-3 py-1.5 flex items-center gap-2">
                <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground shrink-0 w-8">{t("pov_label")}</span>
                <select
                  value={scene?.pov_character_id ?? ""}
                  onChange={e => {
                    const val = e.target.value ? Number(e.target.value) : null;
                    updateScene.mutate({ data: { pov_character_id: val } });
                  }}
                  onClick={e => e.stopPropagation()}
                  className="flex-1 text-xs bg-secondary border border-border rounded px-1.5 py-0.5 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">{t("common_none_option")}</option>
                  {characters.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="px-3 py-1.5 flex items-center gap-2">
                <ListChecks className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground shrink-0 w-8">{t("corkboard_beat")}</span>
                <select
                  value={scene?.beat ?? ""}
                  onChange={e => {
                    updateScene.mutate({ data: { beat: e.target.value || null } });
                  }}
                  onClick={e => e.stopPropagation()}
                  className="flex-1 text-xs bg-secondary border border-border rounded px-1.5 py-0.5 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">{t("common_none_option")}</option>
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
                {t("thesaurus_label")}
                {thesaurusOpen && <Check className="ml-auto h-3 w-3 text-primary" />}
              </button>
              <button
                onClick={() => { setCommentsPanelOpen((v) => !v); setMenuOpen(false); }}
                className={cn("w-full text-left text-xs px-3 py-2 hover:bg-secondary/50 flex items-center gap-2", commentsPanelOpen && "text-primary")}
              >
                <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
                {t("comments_label")}
                {sceneComments.filter(c => !c.resolved).length > 0 && (
                  <span className="ml-auto bg-primary/20 text-primary text-[10px] rounded-full px-1 py-0.5 leading-none">
                    {sceneComments.filter(c => !c.resolved).length}
                  </span>
                )}
                {commentsPanelOpen && sceneComments.filter(c => !c.resolved).length === 0 && <Check className="ml-auto h-3 w-3 text-primary" />}
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
              {appSettings?.vale_enabled && (
                <button
                  onClick={() => { setValePanelOpen((v) => !v); setMenuOpen(false); }}
                  className={cn("w-full text-left text-xs px-3 py-2 hover:bg-secondary/50 flex items-center gap-2", valePanelOpen && "text-primary")}
                >
                  <SpellCheck className="h-3.5 w-3.5 text-muted-foreground" />
                  Style Checker
                  {valePanelOpen && <Check className="ml-auto h-3 w-3 text-primary" />}
                </button>
              )}
              {appSettings?.vale_enabled && (
                <button
                  onClick={() => {
                    const plain = contentRef.current
                      .replace(/<\/?(p|div|br|li|h[1-6]|blockquote|hr)[^>]*>/gi, "\n")
                      .replace(/<[^>]+>/g, "")
                      .trim();
                    proseCheck.mutate(
                      { text: plain, language: project?.book_meta?.language ?? undefined },
                      { onSuccess: () => setProseMetricsOpen(true) },
                    );
                    setMenuOpen(false);
                  }}
                  disabled={proseCheck.isPending}
                  className="w-full text-left text-xs px-3 py-2 hover:bg-secondary/50 flex items-center gap-2"
                >
                  {proseCheck.isPending
                    ? <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
                    : <BarChart2 className="h-3.5 w-3.5 text-muted-foreground" />}
                  Prose Metrics
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
        <div className="relative flex-1 overflow-hidden flex flex-col">
          <SaveIndicator />
          {/* Co-work lock / editor banner */}
          {isEditor ? (
            <div className="flex items-center gap-2 px-4 py-1.5 bg-emerald-50 dark:bg-emerald-950/30 border-b border-emerald-200 dark:border-emerald-900/40 text-xs text-emerald-700 dark:text-emerald-400 shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span>Editor mode — Welcome, <strong>{identity?.name ?? "Editor"}</strong></span>
            </div>
          ) : isReadOnly && (
            <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/40 text-xs text-amber-700 dark:text-amber-400 shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
              {lockDeniedReason === "not_assigned"
                ? <span>This scene is not in your assignment — read-only.</span>
                : lockDeniedReason === "read_only"
                  ? <span>This scene is read-only for you.</span>
                  : <span>
                      <strong>
                        {lockHolder
                          ? (lockHolder.display_name === "Host" ? hostAuthorName : lockHolder.display_name)
                          : lockDenied}
                      </strong>
                      {" "}is editing this scene — read-only for now.
                    </span>
              }
            </div>
          )}
          <TipTapEditor
            content={content}
            onChange={handleContentChange}
            codexEntries={codexEntries}
            onCodexEntryClick={handleCodexEntryClick}
            sceneId={sceneIdNum}
            aiDisabled={aiDisabled}
            readOnly={isReadOnly}
            onOpenChat={aiDisabled ? undefined : () => setChatPanelOpen(true)}
            onOpenTimeline={() => setTimelineCommandOpen(true)}
            onOpenLink={() => setLinkPanelOpen(true)}
            onWordSelect={(w) => { if (w) setSelectedWord(w); }}
            onFlagsChange={setFlags}
            replaceWordRef={replaceWordRef}
            applyFlagRef={applyFlagRef}
            applyGrammarFixRef={applyGrammarFixRef}
            jumpToGrammarMatchRef={jumpToGrammarMatchRef}
            jumpToValeMatchRef={jumpToValeMatchRef}
            jumpToTextRef={jumpToTextRef}
            onPrefillEntry={(data) => { setNewEntryInitial(data); setNewEntryDialogOpen(true); }}
            commentHighlights={commentHighlights}
            getCommentPositionsRef={getCommentPositionsRef}
            onCommentRequest={canComment ? handleCommentRequest : undefined}
            triggerCommentRef={triggerCommentRef}
            hasSelectionRef={hasSelectionRef}
            showCodexHighlights={showCodexHighlights}
            language={project?.book_meta?.language}
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
            onOpenEntry={(entry) => { setNewEntryInitial(entry); setNewEntryDialogOpen(true); }}
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
            text={htmlToGrammarPlainText(content)}
            language={project?.book_meta?.language ?? "auto"}
            onClose={() => setGrammarPanelOpen(false)}
            onJumpTo={(matched, offset) => jumpToGrammarMatchRef.current?.(matched, offset)}
            onApplySuggestion={(matched, replacement, offset) => applyGrammarFixRef.current?.(matched, replacement, offset)}
          />
        )}

        {/* Vale prose check panel */}
        {valePanelOpen && (
          <ValePanel
            text={content.replace(/<\/?(p|div|br|li|h[1-6]|blockquote|hr)[^>]*>/gi, "\n").replace(/<[^>]+>/g, "").trim()}
            language={project?.book_meta?.language ?? undefined}
            onClose={() => setValePanelOpen(false)}
            onJumpTo={(matched, skipCount) => jumpToValeMatchRef.current?.(matched, skipCount)}
          />
        )}

        {/* Prose metrics dialog — run individually from the scene menu */}
        {proseCheck.data && (
          <ProseMetricsDialog
            open={proseMetricsOpen}
            onOpenChange={setProseMetricsOpen}
            result={proseCheck.data}
          />
        )}

        {/* Comments panel */}
        {commentsPanelOpen && (
          <CommentsPanel
            sceneId={sceneIdNum}
            isHost={isHost}
            onClose={() => setCommentsPanelOpen(false)}
            onJumpTo={handleJumpToComment}
          />
        )}

      </div>

      {/* Add Comment dialog */}
      {addCommentOpen && pendingComment && (() => {
        let customCats: string[] = [];
        try { customCats = JSON.parse(localStorage.getItem(CUSTOM_CATEGORIES_KEY) ?? "[]"); } catch { /* */ }
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={(e) => { if (e.target === e.currentTarget) { setAddCommentOpen(false); setCustomCategoryMode(false); setCommentCategory(""); } }}
          >
            <div className="bg-card border border-border rounded-xl shadow-xl w-[420px] p-4 space-y-3">
              <h3 className="text-sm font-semibold">Add Comment</h3>
              <div
                className="text-xs italic text-muted-foreground border-l-2 pl-2 line-clamp-2"
                style={{ borderColor: myColor }}
              >
                {pendingComment.text}
              </div>
              <textarea
                autoFocus
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Write your comment…"
                className="w-full h-24 text-xs bg-background border border-input rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSubmitComment();
                  if (e.key === "Escape") { setAddCommentOpen(false); setCustomCategoryMode(false); setCommentCategory(""); }
                }}
              />
              {/* Category */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground shrink-0">Category</span>
                {customCategoryMode ? (
                  <>
                    <input
                      autoFocus
                      value={commentCategory}
                      onChange={(e) => setCommentCategory(e.target.value)}
                      placeholder="Category name…"
                      className="flex-1 text-xs bg-background border border-input rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                      onKeyDown={(e) => {
                        if (e.key === "Escape") { setCustomCategoryMode(false); setCommentCategory(""); }
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => { setCustomCategoryMode(false); setCommentCategory(""); }}
                    >✕</button>
                  </>
                ) : (
                  <select
                    value={commentCategory}
                    onChange={(e) => {
                      if (e.target.value === "__custom__") {
                        setCustomCategoryMode(true);
                        setCommentCategory("");
                      } else {
                        setCommentCategory(e.target.value);
                      }
                    }}
                    className="flex-1 text-xs bg-background border border-input rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">— none —</option>
                    {COMMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    {customCats.filter((c) => !COMMENT_CATEGORIES.includes(c)).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                    <option value="__custom__">+ Add custom…</option>
                  </select>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => { setAddCommentOpen(false); setCustomCategoryMode(false); setCommentCategory(""); }}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={handleSubmitComment}
                  disabled={!commentBody.trim() || createComment.isPending}
                >
                  {createComment.isPending ? "Posting…" : "Post comment"}
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      <CodexEntryDialog
        open={newEntryDialogOpen}
        onClose={() => { setNewEntryDialogOpen(false); setNewEntryInitial({}); }}
        onSave={(data) => {
          if (newEntryInitial.id) updateEntry.mutate({ id: newEntryInitial.id, data });
          else createEntry.mutate({ ...data, project_id: projectId } as any);
        }}
        initial={newEntryInitial}
        title={newEntryInitial.id ? "Update Codex Entry" : "New Codex Entry"}
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
