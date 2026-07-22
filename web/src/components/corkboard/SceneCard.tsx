"use client";

import { useCallback, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Sparkles, Loader2, ExternalLink, AlignJustify, ChevronDown, ChevronUp } from "lucide-react";
import { ColorPicker, hexToRgba } from "./ColorPicker";
import { useLanguage } from "@/contexts/LanguageContext";
import type { CorkboardScene } from "@/types";

// ── Card style helpers ────────────────────────────────────────────────────────

function cardStyle(color: string | null): React.CSSProperties {
  if (!color) return {};
  return {
    backgroundColor: hexToRgba(color, 0.14),
    borderColor:     hexToRgba(color, 0.40),
  };
}

// ── Single card ───────────────────────────────────────────────────────────────

interface SingleCardProps {
  scene: CorkboardScene;
  projectId: number;
  color: string | null;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  onTitleChange: (sceneId: number, title: string) => void;
  onSynopsisChange: (sceneId: number, synopsis: string | null) => void;
  onGenerateSynopsis: (sceneId: number) => Promise<string>;
  onColorChange: (sceneId: number, color: string | null) => void;
  isGenerating: boolean;
  showSynopsis?: boolean;
  compact?: boolean;
}

export function SingleCard({
  scene, projectId, color, dragHandleProps,
  onTitleChange, onSynopsisChange, onGenerateSynopsis, onColorChange,
  isGenerating, showSynopsis = true, compact = false,
}: SingleCardProps) {
  const { t } = useLanguage();

  // ── Title editing ──────────────────────────────────────────────────────────
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle]     = useState(scene.title ?? "");

  const prevTitle = useRef(scene.title);
  if (scene.title !== prevTitle.current) {
    prevTitle.current = scene.title;
    if (!editingTitle) setLocalTitle(scene.title ?? "");
  }

  const commitTitle = useCallback(() => {
    setEditingTitle(false);
    const value = localTitle.trim() || t("nav_untitled_scene");
    if (value !== (scene.title ?? t("nav_untitled_scene"))) {
      onTitleChange(scene.id, value);
    }
  }, [localTitle, scene.id, scene.title, onTitleChange]);

  // ── Synopsis editing ───────────────────────────────────────────────────────
  const [localSynopsis, setLocalSynopsis] = useState(scene.synopsis ?? "");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prevSynopsis = useRef(scene.synopsis);
  if (scene.synopsis !== prevSynopsis.current) {
    prevSynopsis.current = scene.synopsis;
    setLocalSynopsis(scene.synopsis ?? "");
  }

  const handleSynopsisChange = useCallback((val: string) => {
    setLocalSynopsis(val);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onSynopsisChange(scene.id, val || null);
    }, 800);
  }, [scene.id, onSynopsisChange]);

  const handleGenerateClick = async () => {
    const generated = await onGenerateSynopsis(scene.id);
    setLocalSynopsis(generated);
    onSynopsisChange(scene.id, generated);
  };

  const padding = compact ? "p-1.5" : "p-2.5";
  const titleSz = compact ? "text-[10px]" : "text-[11px]";
  const countSz = compact ? "text-[9px]"  : "text-[10px]";

  return (
    <div
      className={`rounded-lg border border-border bg-card flex flex-col gap-1 ${padding} shadow-sm transition-colors`}
      style={cardStyle(color)}
    >
      <div className="flex items-start gap-1">
        {dragHandleProps && (
          <button
            {...dragHandleProps}
            className="mt-0.5 text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing flex-shrink-0"
            tabIndex={-1}
          >
            <GripVertical className="h-3 w-3" />
          </button>
        )}

        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input
              autoFocus
              value={localTitle}
              onChange={(e) => setLocalTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") commitTitle(); }}
              className={`w-full bg-transparent ${titleSz} font-medium text-foreground focus:outline-none border-b border-primary/50`}
            />
          ) : (
            <span
              className={`${titleSz} font-medium text-foreground line-clamp-2 leading-tight cursor-text hover:text-primary/80 block`}
              onClick={() => setEditingTitle(true)}
              title={t("scene_click_rename")}
            >
              {scene.title || t("nav_untitled_scene")}
            </span>
          )}
          <div className="flex items-center gap-1 mt-0.5">
            <span className={`${countSz} text-muted-foreground/60`}>{scene.word_count} w</span>
            <a
              href={`/projects/${projectId}/scenes/${scene.id}`}
              className="text-muted-foreground/30 hover:text-muted-foreground/70 flex-shrink-0"
              title={t("scene_open_title")}
              tabIndex={-1}
            >
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
        </div>

        <ColorPicker
          color={color}
          onChange={(hex) => onColorChange(scene.id, hex)}
        />
      </div>

      {showSynopsis && !compact && (
        <>
          <textarea
            value={localSynopsis}
            onChange={(e) => handleSynopsisChange(e.target.value)}
            placeholder={t("scene_synopsis_placeholder")}
            className="w-full resize-none bg-transparent text-[11px] text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:text-foreground min-h-[48px]"
            rows={3}
          />
          <button
            onClick={handleGenerateClick}
            disabled={isGenerating}
            className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground disabled:opacity-40 self-end"
            title={t("scene_generate_synopsis_ai")}
          >
            {isGenerating
              ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
              : <Sparkles className="h-2.5 w-2.5" />}
            {isGenerating ? "…" : t("scene_ai_short")}
          </button>
        </>
      )}
    </div>
  );
}

// ── Per-scene draggable wrapper (used inside StackCard) ───────────────────────

function DraggableScene({
  sceneId, children,
}: {
  sceneId: number;
  children: (dragHandleProps: React.HTMLAttributes<HTMLButtonElement>) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: sceneId });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.3 : 1,
      }}
    >
      {children({ ...(attributes as React.HTMLAttributes<HTMLButtonElement>), ...listeners })}
    </div>
  );
}

// ── Stack name helpers ────────────────────────────────────────────────────────

function loadStackName(stackGroup: string): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(`lw_stack_name_${stackGroup}`) ?? "";
}
function saveStackName(stackGroup: string, name: string) {
  if (name) localStorage.setItem(`lw_stack_name_${stackGroup}`, name);
  else localStorage.removeItem(`lw_stack_name_${stackGroup}`);
}

// ── Stack card ────────────────────────────────────────────────────────────────

interface StackCardProps {
  scenes: CorkboardScene[];
  projectId: number;
  colors: Record<number, string | null>;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  onTitleChange: (sceneId: number, title: string) => void;
  onSynopsisChange: (sceneId: number, synopsis: string | null) => void;
  onGenerateSynopsis: (sceneId: number) => Promise<string>;
  onColorChange: (sceneId: number, color: string | null) => void;
  generatingId: number | null;
  showSynopsis?: boolean;
  compact?: boolean;
}

export function StackCard({
  scenes, projectId, colors, dragHandleProps,
  onTitleChange, onSynopsisChange, onGenerateSynopsis, onColorChange, generatingId,
  showSynopsis: globalShowSynopsis = true, compact = false,
}: StackCardProps) {
  const { t } = useLanguage();
  const stackGroup = scenes[0].stack_group ?? `tmp-${scenes[0].id}`;

  // ── Stack name (editable, persisted in localStorage) ──────────────────────
  const [stackName, setStackName]     = useState(() => loadStackName(stackGroup));
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName]     = useState(stackName);

  const commitName = useCallback(() => {
    setEditingName(false);
    setStackName(draftName);
    saveStackName(stackGroup, draftName);
  }, [draftName, stackGroup]);

  const displayName = stackName.trim() || t("corkboard_stack_count_dot", { count: scenes.length });

  // ── Collapse / expand ──────────────────────────────────────────────────────
  const [collapsed, setCollapsed] = useState(false);

  // ── Synopsis toggle (per-stack, collapsed by default) ─────────────────────
  const [stackSynopsis, setStackSynopsis] = useState(false);
  const effectiveShowSynopsis = globalShowSynopsis && stackSynopsis;

  // ── Collapsed view: single strip with editable name ───────────────────────
  if (collapsed) {
    return (
      <div className="rounded-lg border border-border bg-card flex items-center gap-1.5 px-2.5 py-1.5 shadow-sm">
        {dragHandleProps && (
          <button
            {...dragHandleProps}
            className="text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing flex-shrink-0"
            tabIndex={-1}
          >
            <GripVertical className="h-3 w-3" />
          </button>
        )}

        {editingName ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") commitName(); }}
            className="flex-1 min-w-0 bg-transparent text-[11px] font-medium text-foreground focus:outline-none border-b border-primary/50"
          />
        ) : (
          <span
            className="flex-1 min-w-0 text-[11px] font-medium text-foreground truncate cursor-text"
            onClick={() => { setDraftName(stackName); setEditingName(true); }}
            title={t("corkboard_stack_click_rename")}
          >
            {displayName}
          </span>
        )}

        <span className="text-[9px] text-muted-foreground/40 flex-shrink-0">{scenes.length}</span>
        <button
          onClick={() => setCollapsed(false)}
          className="text-muted-foreground/40 hover:text-muted-foreground flex-shrink-0"
          title={t("corkboard_stack_expand")}
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
    );
  }

  // ── Expanded view: solitaire fan ───────────────────────────────────────────
  return (
    <div className="flex flex-col gap-1">
      {/* Stack header */}
      <div className="flex items-center gap-1 px-0.5">
        {dragHandleProps && (
          <button
            {...dragHandleProps}
            className="text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing flex-shrink-0"
            tabIndex={-1}
          >
            <GripVertical className="h-3 w-3" />
          </button>
        )}

        {editingName ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") commitName(); }}
            className="flex-1 min-w-0 bg-transparent text-[9px] font-medium text-foreground focus:outline-none border-b border-primary/50 uppercase tracking-wide"
          />
        ) : (
          <span
            className="flex-1 min-w-0 text-[9px] text-muted-foreground/50 uppercase tracking-wide select-none cursor-text truncate"
            onClick={() => { setDraftName(stackName); setEditingName(true); }}
            title={t("corkboard_stack_click_rename")}
          >
            {displayName}
          </span>
        )}

        {/* Collapse button */}
        <button
          onClick={() => setCollapsed(true)}
          className="text-muted-foreground/30 hover:text-muted-foreground/70 flex-shrink-0"
          title={t("corkboard_stack_collapse")}
        >
          <ChevronUp className="h-3 w-3" />
        </button>

        {/* Synopsis toggle */}
        {globalShowSynopsis && !compact && (
          <button
            onClick={() => setStackSynopsis((v) => !v)}
            title={stackSynopsis ? t("corkboard_synopsis_collapse") : t("corkboard_synopsis_expand")}
            className={`flex-shrink-0 transition-colors ${
              stackSynopsis ? "text-muted-foreground/70" : "text-muted-foreground/25 hover:text-muted-foreground/50"
            }`}
          >
            <AlignJustify className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Each scene individually draggable (pull from stack) */}
      {scenes.map((scene) => (
        <DraggableScene key={scene.id} sceneId={scene.id}>
          {(handleProps) => (
            <SingleCard
              scene={scene}
              projectId={projectId}
              color={colors[scene.id] ?? null}
              dragHandleProps={handleProps}
              onTitleChange={onTitleChange}
              onSynopsisChange={onSynopsisChange}
              onGenerateSynopsis={onGenerateSynopsis}
              onColorChange={onColorChange}
              isGenerating={generatingId === scene.id}
              showSynopsis={effectiveShowSynopsis}
              compact={compact}
            />
          )}
        </DraggableScene>
      ))}
    </div>
  );
}

// ── Drag overlay ghost ────────────────────────────────────────────────────────

export function CardOverlay({ scene, color }: { scene: CorkboardScene; color: string | null }) {
  const { t } = useLanguage();
  return (
    <div
      className="rounded-lg border border-border bg-card p-2.5 shadow-2xl opacity-90 w-[200px]"
      style={cardStyle(color)}
    >
      <p className="text-[11px] font-medium text-foreground line-clamp-2">
        {scene.title || t("nav_untitled_scene")}
      </p>
      <p className="text-[10px] text-muted-foreground/60 mt-0.5">{scene.word_count} w</p>
    </div>
  );
}
