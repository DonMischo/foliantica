"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ChevronDown, ChevronRight, Plus, Trash2,
  GripVertical, Settings, Book, Download, Network, Calendar, Clock, Scissors, Info, ListChecks, MoreHorizontal, LayoutGrid, Users, BarChart2, Mail, Layers2, User, RefreshCw, Dices, GraduationCap,
} from "lucide-react";
import {
  DndContext, closestCenter, DragEndEvent,
  KeyboardSensor, PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCollabStore } from "@/store/collabStore";
import { PresenceBar } from "@/components/collab/PresenceBar";
import { ScenePlanPopover } from "./ScenePlanPopover";
import { useQueryClient } from "@tanstack/react-query";
import { scenesApi, syncApi } from "@/lib/api";
import {
  useActs, useChapters,
  useCreateAct, useCreateChapter, useCreateScene,
  useDeleteAct, useDeleteChapter, useDeleteScene,
  useReorderActs, useReorderChapters, useReorderScenes,
  useReorderScenesGlobal, useAllScenesForChapters,
  useUpdateAct, useUpdateChapter, useProject, useUpdateProject,
  useTimeConfig, useUpdateTimeConfig, useCodexEntries,
  useSyncStatus,
} from "@/store/queries";
import { ImportButton } from "@/components/layout/ImportButton";
import { TimeConfigDialog } from "@/components/time/TimeConfigDialog";
import { ExportDialog } from "@/components/export/ExportDialog";
import { BookMetaDialog } from "@/components/project/BookMetaDialog";
import { WritersCompendium } from "@/components/WritersCompendium";
import { MAIN_COLOR, SUBPLOT_PALETTE } from "@/components/corkboard/ColorPicker";
import { useColColorsStore } from "@/store/colColors";
import { DEFAULT_TIME_CONFIG } from "@/types";
import type { Act, Chapter, Scene } from "@/types";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatTimeDisplay } from "@/lib/sceneTime";

// ── Bar color helpers ─────────────────────────────────────────────────────────

/** Stable palette index for a subplot name not in codex — consistent across renders */
function subplotPaletteColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  return SUBPLOT_PALETTE[h % SUBPLOT_PALETTE.length];
}

interface Props { projectId: number }

// ── Scene divider (insert-between) ───────────────────────────────────────────

function SceneDivider({ onInsert }: { onInsert: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="group relative h-5 flex items-center px-12">
      <div className="w-full h-px bg-transparent group-hover:bg-border/60 transition-colors" />
      <button
        onClick={onInsert}
        className="absolute left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 h-4 w-4 rounded-full bg-card border border-border flex items-center justify-center hover:bg-primary hover:border-primary hover:text-primary-foreground transition-all"
        title={t("nav_insert_scene_here")}
      >
        <Plus className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

// ── Scene item ────────────────────────────────────────────────────────────────

function SceneItem({
  scene, projectId, currentSceneId, index, barColor,
}: { scene: Scene; projectId: number; currentSceneId?: number; index: number; barColor: string | null }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: scene.id, data: { type: "scene", chapterId: scene.chapter_id } });
  const deleteScene = useDeleteScene(scene.chapter_id);
  const router = useRouter();
  const { t } = useLanguage();
  const style = { transform: CSS.Transform.toString(transform), transition };
  const { data: timeConfigData } = useTimeConfig(projectId);
  const timeConfig = timeConfigData ?? DEFAULT_TIME_CONFIG;
  const sceneTimeDisplay = scene.scene_time && Object.keys(scene.scene_time).length > 0
    ? formatTimeDisplay(timeConfig, scene.scene_time)
    : null;

  // Presence dots — other sessions currently viewing this scene
  const presence    = useCollabStore((s) => s.presence);
  const mySessionId = useCollabStore((s) => s.mySessionId);
  const presenceDots = presence.filter(
    (r) => r.item_type === "scene" && r.item_id === scene.id && r.session_id !== mySessionId
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative group flex items-center gap-1 pl-12 pr-2 py-1 rounded hover:bg-secondary/50 text-sm",
        isDragging && "opacity-50",
        currentSceneId === scene.id && "bg-secondary text-foreground font-medium"
      )}
    >
      {/* Subplot / POV color bar */}
      {barColor && (
        <div
          className="absolute left-[40px] top-[3px] bottom-[3px] w-[3px] rounded-full"
          style={{ backgroundColor: barColor }}
        />
      )}
      <button {...attributes} {...listeners} className="opacity-0 group-hover:opacity-40 cursor-grab">
        <GripVertical className="h-3 w-3" />
      </button>
      <Link
        href={`/projects/${projectId}/scenes/${scene.id}`}
        className="flex-1 truncate text-muted-foreground hover:text-foreground flex items-center gap-1.5"
        title={scene.synopsis ?? undefined}
      >
        <span className="text-muted-foreground/50 text-[10px] tabular-nums shrink-0 w-4 text-right">{index}.</span>
        <span className="truncate">{scene.title || t("nav_untitled_scene")}</span>
        {sceneTimeDisplay && (
          <span title={sceneTimeDisplay}>
            <Clock className="h-2.5 w-2.5 shrink-0 text-primary/60" aria-label={t("nav_has_scene_time")} />
          </span>
        )}
        {presenceDots.map((r) => (
          <span
            key={r.session_id}
            className="h-1.5 w-1.5 rounded-full shrink-0"
            style={{ backgroundColor: r.color }}
            title={r.display_name}
          />
        ))}
      </Link>
      <ScenePlanPopover
        sceneId={scene.id}
        sceneTitle={scene.title || ""}
        sceneType={scene.scene_type}
        sceneSynopsis={scene.synopsis}
        sceneBeat={scene.beat}
        sceneTimeDisplay={sceneTimeDisplay}
      />
      <button
        className="opacity-0 group-hover:opacity-60 hover:opacity-100 hover:text-destructive"
        onClick={(e) => {
          e.preventDefault();
          if (confirm(t("common_delete") + "?")) {
            deleteScene.mutate(scene.id);
            if (currentSceneId === scene.id) router.push(`/projects/${projectId}`);
          }
        }}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

// ── Chapter item ──────────────────────────────────────────────────────────────

function ChapterItem({
  chapter, projectId, currentSceneId, scenes, getBarColor,
}: { chapter: Chapter; projectId: number; currentSceneId?: number; scenes: Scene[]; getBarColor: (s: Scene) => string | null }) {
  const [expanded, setExpanded] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(chapter.title);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: chapter.id, data: { type: "chapter", chapterId: chapter.id } });

  const { t } = useLanguage();
  const createScene = useCreateScene(chapter.id);
  const deleteChapter = useDeleteChapter(chapter.act_id);
  const updateChapter = useUpdateChapter(chapter.act_id);
  const reorderScenes = useReorderScenes(chapter.id);

  const style = { transform: CSS.Transform.toString(transform), transition };

  const handleInsertAfter = async (afterIndex: number) => {
    const newScene = await createScene.mutateAsync({
      chapter_id: chapter.id,
      order_index: scenes.length + 1,
    });
    const newOrder = [
      ...scenes.slice(0, afterIndex + 1).map((s, i) => ({ id: s.id, order_index: i })),
      { id: newScene.id, order_index: afterIndex + 1 },
      ...scenes.slice(afterIndex + 1).map((s, i) => ({ id: s.id, order_index: afterIndex + 2 + i })),
    ];
    reorderScenes.mutate(newOrder);
  };

  const handleRename = () => {
    if (newTitle.trim() && newTitle !== chapter.title)
      updateChapter.mutate({ id: chapter.id, data: { title: newTitle.trim() } });
    setRenaming(false);
  };

  return (
    <div ref={setNodeRef} style={style} className={cn("select-none", isDragging && "opacity-50")}>
      {/* Chapter row */}
      <div className="group flex items-center gap-1 pl-4 pr-2 py-1 rounded hover:bg-secondary/40">
        <button {...attributes} {...listeners} className="opacity-0 group-hover:opacity-40 cursor-grab">
          <GripVertical className="h-3 w-3" />
        </button>
        <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>

        {renaming ? (
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            className="h-5 text-xs px-1 py-0 flex-1"
            autoFocus
          />
        ) : (
          <Link
            href={`/projects/${projectId}/chapters/${chapter.id}`}
            className="flex-1 text-xs text-muted-foreground hover:text-foreground truncate"
            onDoubleClick={(e) => { e.preventDefault(); setRenaming(true); }}
          >
            {chapter.title}
          </Link>
        )}

        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
          <button
            className="hover:text-primary"
            onClick={() => createScene.mutate({ chapter_id: chapter.id, order_index: scenes.length })}
          >
            <Plus className="h-3 w-3" />
          </button>
          <button
            className="hover:text-destructive"
            onClick={() => {
              if (confirm(`${t("common_delete")} "${chapter.title}"?`))
                deleteChapter.mutate(chapter.id);
            }}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Scene list — DndContext lives in parent ActItem for cross-chapter drag support */}
      {expanded && (
        <SortableContext items={scenes.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {scenes.map((scene, idx) => (
            <div key={scene.id}>
              <SceneItem scene={scene} projectId={projectId} currentSceneId={currentSceneId} index={idx + 1} barColor={getBarColor(scene)} />
              {idx < scenes.length - 1 && (
                <SceneDivider onInsert={() => handleInsertAfter(idx)} />
              )}
            </div>
          ))}
        </SortableContext>
      )}
    </div>
  );
}

// ── Act item ──────────────────────────────────────────────────────────────────

function ActItem({
  act, projectId, currentSceneId, getBarColor,
}: { act: Act; projectId: number; currentSceneId?: number; getBarColor: (s: Scene) => string | null }) {
  const [expanded, setExpanded] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(act.title);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: act.id });

  const { t } = useLanguage();
  const { data: chapters = [] } = useChapters(act.id);
  const allScenesData = useAllScenesForChapters(chapters.map((c) => c.id));
  const createChapter = useCreateChapter(act.id);
  const deleteAct = useDeleteAct(projectId);
  const updateAct = useUpdateAct(projectId);
  const reorderChapters = useReorderChapters(act.id);
  const reorderScenesGlobal = useReorderScenesGlobal(projectId);
  const qc = useQueryClient();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const style = { transform: CSS.Transform.toString(transform), transition };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeData = active.data.current as { type?: string; chapterId?: number } | undefined;
    const overData   = over.data.current   as { type?: string; chapterId?: number } | undefined;

    // ── Chapter reorder ───────────────────────────────────────────────────────
    if (activeData?.type !== "scene") {
      const oldIdx = chapters.findIndex((c) => c.id === active.id);
      const newIdx = chapters.findIndex((c) => c.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return;
      reorderChapters.mutate(arrayMove(chapters, oldIdx, newIdx).map((c, i) => ({ id: c.id, order_index: i })));
      return;
    }

    // ── Scene reorder / cross-chapter move ────────────────────────────────────
    const srcChapterId = activeData.chapterId!;
    const tgtChapterId = overData?.chapterId ?? srcChapterId;
    const sceneId      = active.id as number;
    const srcIdx  = chapters.findIndex((c) => c.id === srcChapterId);
    const tgtIdx  = chapters.findIndex((c) => c.id === tgtChapterId);
    const srcScenes = allScenesData[srcIdx] ?? [];
    const tgtScenes = allScenesData[tgtIdx] ?? [];

    if (srcChapterId === tgtChapterId) {
      // Same chapter: reorder
      const from = srcScenes.findIndex((s) => s.id === sceneId);
      const to   = srcScenes.findIndex((s) => s.id === (over.id as number));
      if (from < 0 || to < 0) return;
      reorderScenesGlobal.mutate(arrayMove(srcScenes, from, to).map((s, i) => ({ id: s.id, order_index: i })));
    } else {
      // Cross-chapter: move scene, insert at drop position
      const overSceneId  = over.id as number;
      const insertBefore = overData?.type === "scene" ? tgtScenes.findIndex((s) => s.id === overSceneId) : -1;
      const insertAt     = insertBefore >= 0 ? insertBefore : tgtScenes.length;
      const newTgt = [...tgtScenes];
      newTgt.splice(insertAt, 0, { id: sceneId } as Scene);

      scenesApi.update(sceneId, { chapter_id: tgtChapterId })
        .then(() => Promise.all([
          scenesApi.reorder(newTgt.map((s, i) => ({ id: s.id, order_index: i }))),
          srcScenes.length > 1
            ? scenesApi.reorder(srcScenes.filter((s) => s.id !== sceneId).map((s, i) => ({ id: s.id, order_index: i })))
            : Promise.resolve(),
        ]))
        .then(() => {
          qc.invalidateQueries({ queryKey: ["scenes", srcChapterId] });
          qc.invalidateQueries({ queryKey: ["scenes", tgtChapterId] });
          qc.invalidateQueries({ queryKey: ["structure", projectId] });
          qc.invalidateQueries({ queryKey: ["corkboard", projectId] });
        });
    }
  };

  const handleRename = () => {
    if (newTitle.trim() && newTitle !== act.title)
      updateAct.mutate({ id: act.id, data: { title: newTitle.trim() } });
    setRenaming(false);
  };

  return (
    <div ref={setNodeRef} style={style} className={cn("select-none", isDragging && "opacity-50")}>
      {/* Act row */}
      <div className="group flex items-center gap-1 px-2 py-1.5 rounded hover:bg-secondary/50">
        <button {...attributes} {...listeners} className="opacity-0 group-hover:opacity-40 cursor-grab">
          <GripVertical className="h-3 w-3" />
        </button>
        <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>

        {renaming ? (
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            className="h-5 text-xs px-1 py-0 flex-1"
            autoFocus
          />
        ) : (
          <Link
            href={`/projects/${projectId}/acts/${act.id}`}
            className="flex-1 text-sm font-medium hover:text-foreground truncate"
            onDoubleClick={(e) => { e.preventDefault(); setRenaming(true); }}
          >
            {act.title}
          </Link>
        )}

        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
          <button
            className="hover:text-primary"
            onClick={() => createChapter.mutate({
              act_id: act.id,
              title: `${t("nav_chapter_word")} ${chapters.length + 1}`,
              order_index: chapters.length,
            })}
            title={t("nav_add_chapter")}
          >
            <Plus className="h-3 w-3" />
          </button>
          <button
            className="hover:text-destructive"
            onClick={() => {
              if (confirm(`${t("common_delete")} "${act.title}"?`))
                deleteAct.mutate(act.id);
            }}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Chapter list — single DndContext handles both chapter reorder and cross-chapter scene drag */}
      {expanded && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={chapters.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {chapters.map((chapter, idx) => (
              <ChapterItem
                key={chapter.id}
                chapter={chapter}
                scenes={allScenesData[idx] ?? []}
                projectId={projectId}
                currentSceneId={currentSceneId}
                getBarColor={getBarColor}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

// ── Project sidebar ───────────────────────────────────────────────────────────

export function ProjectSidebar({ projectId }: Props) {
  const params = useParams();
  const currentSceneId = params?.sceneId ? Number(params.sceneId) : undefined;

  const { t } = useLanguage();
  const { data: project }        = useProject(projectId);
  const isRpg = project?.kind === "rpg";
  const { data: acts = [] }      = useActs(projectId);
  const { data: codexEntries = [] } = useCodexEntries(projectId);

  // ── Sidebar bar mode ──────────────────────────────────────────────────────
  const [barMode, setBarMode] = useState<"subplot" | "pov">(() => {
    if (typeof window === "undefined") return "subplot";
    return (localStorage.getItem("lw_sidebar_bar_mode") as "subplot" | "pov") ?? "subplot";
  });
  const toggleBarMode = () => setBarMode((prev) => {
    const next = prev === "subplot" ? "pov" : "subplot";
    localStorage.setItem("lw_sidebar_bar_mode", next);
    return next;
  });

  // Shared column colors (written by corkboard, read here for live sync)
  const ensureColColorsLoaded = useColColorsStore((s) => s.ensureLoaded);
  const storedColColors       = useColColorsStore((s) => s.byProject[projectId] ?? {});
  useEffect(() => { ensureColColorsLoaded(projectId); }, [projectId, ensureColColorsLoaded]);

  // Codex lookup maps (stable across renders if entries don't change)
  const codexColorById = useMemo(() => {
    const m: Record<number, string> = {};
    for (const e of codexEntries as { id: number; color: string }[]) m[e.id] = e.color;
    return m;
  }, [codexEntries]);
  const codexColorByName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of codexEntries as { name: string; color: string }[]) m[e.name.toLowerCase()] = e.color;
    return m;
  }, [codexEntries]);

  // Returns the accent color for a scene in the sidebar list
  const getBarColor = useMemo(() => (scene: Scene): string | null => {
    if (barMode === "pov") {
      if (!scene.pov_character_id) return null;
      return codexColorById[scene.pov_character_id] ?? null;
    }
    // subplot mode — priority: codex entry color → custom picker color → hash palette
    if (!scene.subplot) return storedColColors["__main__"] ?? project?.main_plot_color ?? MAIN_COLOR;
    return (
      codexColorByName[scene.subplot.toLowerCase()] ??
      storedColColors[scene.subplot] ??
      subplotPaletteColor(scene.subplot)
    );
  }, [barMode, codexColorById, codexColorByName, project?.main_plot_color, storedColColors]);
  const { data: syncStatus }    = useSyncStatus();
  const collabConnected         = useCollabStore((s) => s.connected);
  const [syncing, setSyncing] = useState(false);


  const handleSyncNow = async () => {
    setSyncing(true);
    try { await syncApi.trigger(); } catch {}
    // Give the backend thread a moment, then let the poll refresh the status
    setTimeout(() => setSyncing(false), 1500);
  };

  const createAct = useCreateAct(projectId);
  const reorderActs = useReorderActs(projectId);
  const updateProject = useUpdateProject();
  const { data: timeConfigData } = useTimeConfig(projectId);
  const updateTimeConfig = useUpdateTimeConfig(projectId);
  const [timeConfigOpen, setTimeConfigOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [compendiumOpen, setCompendiumOpen] = useState(false);
  const timeConfig = timeConfigData ?? DEFAULT_TIME_CONFIG;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleActDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = acts.findIndex((a) => a.id === active.id);
      const newIdx = acts.findIndex((a) => a.id === over.id);
      const reordered = arrayMove(acts, oldIdx, newIdx);
      reorderActs.mutate(reordered.map((a, i) => ({ id: a.id, order_index: i })));
    }
  };

  return (
    <aside className="flex flex-col h-full w-64 border-r border-border bg-card">
      <div className="flex items-center justify-between px-3 py-3 border-b border-border">
        <div className="flex flex-col min-w-0">
          <Link href="/" className="flex items-center gap-2 font-semibold text-sm hover:text-primary transition-colors">
            <img src="/icon.svg" alt="" className="h-4 w-4" />
            Foliantica
          </Link>
        </div>
        {/* Live / Offline indicator — only shown when co-work WS is active */}
        {collabConnected && (
          <span className="flex items-center gap-1 text-[10px] text-emerald-500 font-medium">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            {t("nav_live")}
          </span>
        )}
      </div>

      {/* Presence strip — avatar chips for other connected sessions */}
      {collabConnected && <PresenceBar hostName={project?.book_meta?.author || undefined} />}

      {isRpg ? (
        /* RPG campaign: no acts/chapters tree — a single Play entry instead */
        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          <Link
            href={`/projects/${projectId}/dm`}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
          >
            <Dices className="h-4 w-4" />
            {t("nav_play")}
          </Link>
        </div>
      ) : (<>
      <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground uppercase tracking-wider">
        <span>{t("nav_story")}</span>
        <div className="flex items-center gap-1">
          {/* Bar mode toggle: subplot ↔ POV character */}
          <button
            onClick={toggleBarMode}
            title={barMode === "subplot" ? t("nav_bar_mode_subplot") : t("nav_bar_mode_pov")}
            className="hover:text-foreground"
          >
            {barMode === "subplot" ? <Layers2 className="h-3 w-3" /> : <User className="h-3 w-3" />}
          </button>
          <button
            className="hover:text-foreground"
            title={t("nav_add_act")}
            onClick={() => createAct.mutate({
              project_id: projectId,
              title: `${t("nav_act_word")} ${acts.length + 1}`,
              order_index: acts.length,
            })}
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-1 pb-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleActDragEnd}>
          <SortableContext items={acts.map((a) => a.id)} strategy={verticalListSortingStrategy}>
            {acts.map((act) => (
              <ActItem
                key={act.id}
                act={act}
                projectId={projectId}
                currentSceneId={currentSceneId}
                getBarColor={getBarColor}
              />
            ))}
          </SortableContext>
        </DndContext>
        {acts.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">{t("nav_no_acts")}</p>
        )}
      </div>
      </>)}

      <div className="border-t border-border p-2">
        <div className="flex items-center gap-1">
          <Link
            href={`/projects/${projectId}/codex`}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
          >
            <Book className="h-4 w-4" />
            {t("nav_codex")}
          </Link>
          <Link
            href={`/projects/${projectId}/relations`}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
          >
            <Network className="h-4 w-4" />
            {t("nav_relations")}
          </Link>

          {/* Sandwich menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className={cn(
                "flex items-center justify-center h-8 w-8 rounded hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors",
                menuOpen && "bg-secondary/50 text-foreground"
              )}
              title={t("nav_more")}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>

            {menuOpen && (
              <div className="absolute bottom-full right-0 mb-1 z-50 bg-popover border border-foreground/25 rounded-lg shadow-[0_0_0_1px_hsl(var(--foreground)/0.1),0_8px_28px_hsl(var(--foreground)/0.22)] py-1 min-w-[190px]">

                {!isRpg && (<>
                {/* Pages */}
                <Link
                  href={`/projects/${projectId}/corkboard`}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  {t("sidebar_corkboard")}
                </Link>
                <Link
                  href={`/projects/${projectId}/plot`}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                >
                  <ListChecks className="h-3.5 w-3.5" />
                  {t("sidebar_plot_beats")}
                </Link>
                <Link
                  href={`/projects/${projectId}/pov`}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                >
                  <Users className="h-3.5 w-3.5" />
                  {t("sidebar_pov_balance")}
                </Link>
                <Link
                  href={`/projects/${projectId}/timeline`}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                >
                  <Calendar className="h-3.5 w-3.5" />
                  {t("nav_timeline")}
                </Link>
                <Link
                  href={`/projects/${projectId}/fragments`}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                >
                  <Scissors className="h-3.5 w-3.5" />
                  {t("nav_fragments")}
                </Link>
                <Link
                  href={`/projects/${projectId}/analytics`}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                >
                  <BarChart2 className="h-3.5 w-3.5" />
                  {t("sidebar_analytics")}
                </Link>
                <Link
                  href={`/projects/${projectId}/queries`}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                >
                  <Mail className="h-3.5 w-3.5" />
                  {t("sidebar_query_tracker")}
                </Link>
                <div className="border-t border-border/50 my-1" />

                {/* Project config */}
                <button
                  onClick={() => { setTimeConfigOpen(true); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                >
                  <Clock className="h-3.5 w-3.5" />
                  {t("nav_time_system")}
                </button>
                <button
                  onClick={() => { setMetaOpen(true); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                >
                  <Info className="h-3.5 w-3.5" />
                  {t("nav_project_info")}
                </button>
                <button
                  onClick={() => { setCompendiumOpen(true); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                >
                  <GraduationCap className="h-3.5 w-3.5" />
                  {t("guide_menu_label")}
                </button>

                <div className="border-t border-border/50 my-1" />

                {/* Import / Export */}
                <ImportButton projectId={projectId} mode="story" buttonClassName="text-xs px-3 py-2 [&>svg]:h-3.5 [&>svg]:w-3.5" />
                <button
                  onClick={() => { setExportOpen(true); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                >
                  <Download className="h-3.5 w-3.5" />
                  {t("nav_export")}
                </button>

                <div className="border-t border-border/50 my-1" />
                </>)}

                <Link
                  href="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                >
                  <Settings className="h-3.5 w-3.5" />
                  {t("nav_settings")}
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sync strip — only visible when mirror sync is enabled */}
      {syncStatus && syncStatus.mode !== "disabled" && (
        <div className="border-t border-border/50 px-3 py-1.5 flex items-center gap-2">
          <div className={cn(
            "h-1.5 w-1.5 rounded-full shrink-0",
            syncStatus.mode === "online"  ? "bg-emerald-400" :
            syncStatus.mode === "offline" ? "bg-amber-400"   : "bg-muted-foreground/40"
          )} />
          <span className="flex-1 text-[10px] text-muted-foreground truncate">
            {syncStatus.last_sync_at
              ? t("sync_synced_at", { time: new Date(syncStatus.last_sync_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })
              : syncStatus.mode === "offline" ? t("sync_offline") : t("sync_not_yet")}
          </span>
          <button
            onClick={handleSyncNow}
            disabled={syncing || syncStatus.mode !== "online"}
            title={t("sync_now")}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            <RefreshCw className={cn("h-3 w-3", syncing && "animate-spin")} />
          </button>
        </div>
      )}

      <TimeConfigDialog
        open={timeConfigOpen}
        onClose={() => setTimeConfigOpen(false)}
        initial={timeConfig}
        onSave={(cfg) => updateTimeConfig.mutate(cfg)}
      />

      <ExportDialog
        projectId={projectId}
        projectTitle={project?.title ?? ""}
        bookMeta={project?.book_meta ?? null}
        open={exportOpen}
        onClose={() => setExportOpen(false)}
      />

      <BookMetaDialog
        projectId={projectId}
        projectTitle={project?.title ?? ""}
        initial={project?.book_meta ?? null}
        open={metaOpen}
        onClose={() => setMetaOpen(false)}
        onSave={(meta) => updateProject.mutate({ id: projectId, data: { book_meta: meta } })}
      />

      <WritersCompendium open={compendiumOpen} onClose={() => setCompendiumOpen(false)} />
    </aside>
  );
}
