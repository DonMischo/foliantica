"use client";

import { useState, useRef } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ClipboardList, Plus, X, Check, Trash2, Clock, ListChecks } from "lucide-react";
import { useScenePlansStore } from "@/store/scenePlans";
import { scenesApi } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";

const SCENE_TYPES = [
  { value: "action",        label: "Action",        color: "#ef4444" },
  { value: "dialogue",      label: "Dialogue",      color: "#3b82f6" },
  { value: "introspection", label: "Introspection",  color: "#8b5cf6" },
  { value: "description",  label: "Description",    color: "#22c55e" },
  { value: "transition",   label: "Transition",     color: "#94a3b8" },
] as const;

interface Props {
  sceneId: number;
  sceneTitle: string;
  sceneType?: string | null;
  sceneSynopsis?: string | null;
  sceneBeat?: string | null;
  sceneTimeDisplay?: string | null;
}

export function ScenePlanPopover({
  sceneId, sceneTitle, sceneType: initialSceneType = null,
  sceneSynopsis, sceneBeat, sceneTimeDisplay,
}: Props) {
  const { t } = useLanguage();
  const { plans, addItem, toggleItem, updateItem, deleteItem, clearDone } =
    useScenePlansStore();
  const items      = plans[sceneId] ?? [];
  const doneCount  = items.filter((i) => i.done).length;
  const totalCount = items.length;
  const allDone    = totalCount > 0 && doneCount === totalCount;

  const [newText, setNewText]   = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText]   = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const [sceneType, setSceneTypeState] = useState<string | null>(initialSceneType);
  const qc = useQueryClient();
  const handleSceneType = async (val: string | null) => {
    const next = val === sceneType ? null : val;
    setSceneTypeState(next);
    await scenesApi.update(sceneId, { scene_type: next });
    // Invalidate scenes and analytics
    qc.invalidateQueries({ queryKey: ["scenes"] });
    qc.invalidateQueries({ queryKey: ["analytics"] });
  };

  const handleAdd = () => {
    const text = newText.trim();
    if (!text) return;
    addItem(sceneId, text);
    setNewText("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const startEdit = (id: string, text: string) => {
    setEditingId(id);
    setEditText(text);
  };

  const commitEdit = () => {
    if (!editingId) return;
    const text = editText.trim();
    if (text) updateItem(sceneId, editingId, text);
    else      deleteItem(sceneId, editingId);
    setEditingId(null);
  };

  return (
    <Popover.Root>
      {/* ── Trigger icon ── */}
      <Popover.Trigger asChild>
        <button
          title={t("scene_plan_header")}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "relative transition-opacity",
            totalCount > 0
              ? "opacity-60 hover:opacity-100"
              : "opacity-0 group-hover:opacity-40 hover:opacity-80"
          )}
        >
          <ClipboardList className={cn("h-3 w-3", allDone && "text-green-500")} />

          {/* Badge: remaining count, or green checkmark if all done */}
          {totalCount > 0 && (
            <span
              className={cn(
                "absolute -top-1.5 -right-1.5 h-3 w-3 rounded-full flex items-center justify-center text-[7px] font-bold leading-none",
                allDone
                  ? "bg-green-500 text-white"
                  : "bg-primary text-primary-foreground"
              )}
            >
              {allDone ? "✓" : totalCount - doneCount}
            </span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={10}
          onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
          className={cn(
            "z-50 w-64 rounded-lg border border-border bg-popover shadow-xl",
            "outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
            "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          )}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <ClipboardList className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="flex-1 text-xs font-medium truncate">
              {sceneTitle || t("scene_plan_header")}
            </span>
            {doneCount > 0 && (
              <button
                title="Clear completed"
                onClick={() => clearDone(sceneId)}
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
            <Popover.Close asChild>
              <button className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                <X className="h-3 w-3" />
              </button>
            </Popover.Close>
          </div>

          {/* Synopsis / beat / time info */}
          {(sceneSynopsis || sceneBeat || sceneTimeDisplay) && (
            <div className="px-3 py-2 border-b border-border space-y-1.5">
              {sceneSynopsis && (
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{sceneSynopsis}</p>
              )}
              {sceneBeat && (
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <ListChecks className="h-3 w-3 shrink-0" />
                  <span>{t("corkboard_beat")}:</span>
                  <span className="text-foreground truncate">{sceneBeat}</span>
                </div>
              )}
              {sceneTimeDisplay && (
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <Clock className="h-3 w-3 shrink-0" />
                  <span className="text-foreground truncate">{sceneTimeDisplay}</span>
                </div>
              )}
            </div>
          )}

          {/* Scene type row */}
          <div className="px-3 py-2 border-b border-border">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Scene type</p>
            <div className="flex flex-wrap gap-1">
              {SCENE_TYPES.map(st => (
                <button
                  key={st.value}
                  onMouseDown={e => { e.preventDefault(); handleSceneType(st.value); }}
                  className={cn(
                    "text-[10px] px-2 py-0.5 rounded-full border transition-all",
                    sceneType === st.value
                      ? "text-white border-transparent"
                      : "border-border text-muted-foreground hover:border-muted-foreground/50"
                  )}
                  style={sceneType === st.value ? { backgroundColor: st.color } : undefined}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          {/* Item list */}
          <div className="max-h-56 overflow-y-auto py-1">
            {items.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4 px-3">
                No tasks yet — add one below
              </p>
            )}

            {items.map((item) => (
              <div
                key={item.id}
                className="group/item flex items-start gap-2 px-3 py-1.5 hover:bg-secondary/30"
              >
                {/* Checkbox */}
                <button
                  onMouseDown={(e) => { e.preventDefault(); toggleItem(sceneId, item.id); }}
                  className={cn(
                    "mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm border transition-colors flex items-center justify-center",
                    item.done
                      ? "bg-primary border-primary"
                      : "border-border hover:border-primary/60"
                  )}
                >
                  {item.done && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                </button>

                {/* Text — click to edit, Enter/Esc/blur to save */}
                {editingId === item.id ? (
                  <input
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "Escape") {
                        e.preventDefault();
                        commitEdit();
                      }
                    }}
                    className="flex-1 text-xs bg-transparent outline-none border-b border-primary/60 pb-px"
                  />
                ) : (
                  <span
                    className={cn(
                      "flex-1 text-xs leading-relaxed cursor-text select-none",
                      item.done
                        ? "line-through text-muted-foreground"
                        : "text-foreground"
                    )}
                    onDoubleClick={() => startEdit(item.id, item.text)}
                  >
                    {item.text}
                  </span>
                )}

                {/* Delete */}
                <button
                  onMouseDown={(e) => { e.preventDefault(); deleteItem(sceneId, item.id); }}
                  className="opacity-0 group-hover/item:opacity-60 hover:opacity-100 text-muted-foreground hover:text-destructive mt-0.5 shrink-0 transition-opacity"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Footer — add new task */}
          <div className="flex items-center gap-2 px-3 py-2 border-t border-border">
            <input
              ref={inputRef}
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); handleAdd(); }
              }}
              placeholder="Add task…"
              className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50 min-w-0"
            />
            <button
              onMouseDown={(e) => { e.preventDefault(); handleAdd(); }}
              disabled={!newText.trim()}
              className="text-muted-foreground hover:text-primary disabled:opacity-30 transition-colors shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Progress line when there are items */}
          {totalCount > 0 && (
            <div className="h-0.5 bg-border rounded-b-lg overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${(doneCount / totalCount) * 100}%` }}
              />
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
