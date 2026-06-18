"use client";

import { useState, useEffect } from "react";
import { X, ChevronDown, ChevronRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { projectsApi, collabApi, type AssignedItem } from "@/lib/api";
import type { CorkboardAct } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  invitationId:   string;
  invitationName: string;
  current:        AssignedItem[];
  onClose:        () => void;
  onSaved:        (items: AssignedItem[]) => void;
}

export function AssignmentPicker({ invitationId, invitationName, current, onClose, onSaved }: Props) {
  const [projects, setProjects] = useState<{ id: number; title: string }[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [structure, setStructure] = useState<CorkboardAct[]>([]);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);

  // Scene IDs currently selected
  const [selected, setSelected] = useState<Set<number>>(
    new Set(current.filter((a) => a.type === "scene").map((a) => a.id))
  );
  // Per-scene permissions (only meaningful when the scene is selected)
  const [permissions, setPermissions] = useState<Record<number, "edit" | "read_only">>(
    Object.fromEntries(
      current.filter((a) => a.type === "scene").map((a) => [a.id, a.permission ?? "edit"])
    )
  );
  // Chapter IDs with their scene list expanded
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Load project list on mount
  useEffect(() => {
    projectsApi.list().then((list) => {
      setProjects(list.map((p) => ({ id: p.id, title: p.title })));
      if (list.length === 1) setProjectId(list[0].id);
    }).catch(() => {});
  }, []);

  // Load structure when project changes
  useEffect(() => {
    if (!projectId) { setStructure([]); return; }
    setLoading(true);
    projectsApi.structure(projectId)
      .then((acts) => {
        setStructure(acts);
        // Auto-expand all chapters
        const ids = new Set<number>();
        for (const act of acts) for (const ch of act.chapters) ids.add(ch.id);
        setExpanded(ids);
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  function toggleScene(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleChapter(sceneIds: number[]) {
    const allSel = sceneIds.length > 0 && sceneIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSel) sceneIds.forEach((id) => next.delete(id));
      else        sceneIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleExpanded(chapterId: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId); else next.add(chapterId);
      return next;
    });
  }

  function setPermission(id: number, perm: "edit" | "read_only") {
    setPermissions((prev) => ({ ...prev, [id]: perm }));
  }

  async function handleSave() {
    setSaving(true);
    const items: AssignedItem[] = Array.from(selected).map((id) => ({
      type: "scene",
      id,
      permission: permissions[id] ?? "edit",
    }));
    try {
      await collabApi.updateInvitation(invitationId, { assigned_items: items });
      onSaved(items);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-border rounded-xl shadow-xl w-[480px] max-h-[80vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div>
            <h3 className="text-sm font-semibold">Assign scenes</h3>
            <p className="text-[11px] text-muted-foreground">{invitationName}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Project selector — only when multiple projects exist */}
        {projects.length > 1 && (
          <div className="px-4 pt-3 shrink-0">
            <select
              value={projectId ?? ""}
              onChange={(e) => setProjectId(Number(e.target.value) || null)}
              className="w-full text-xs h-8 rounded-md border border-input bg-background px-2"
            >
              <option value="">Select project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
        )}

        {/* Scene tree */}
        <div className="flex-1 overflow-y-auto px-2 py-2 min-h-0">
          {loading && (
            <p className="text-xs text-muted-foreground text-center py-6">Loading…</p>
          )}
          {!loading && !projectId && projects.length > 1 && (
            <p className="text-xs text-muted-foreground text-center py-6">Select a project above.</p>
          )}
          {!loading && structure.map((act) => (
            <div key={act.id}>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-2 pt-2.5 pb-1 font-medium select-none">
                {act.title}
              </p>
              {act.chapters.map((chapter) => {
                const sceneIds    = chapter.scenes.map((s) => s.id);
                const selCount    = sceneIds.filter((id) => selected.has(id)).length;
                const allSel      = sceneIds.length > 0 && selCount === sceneIds.length;
                const someSel     = selCount > 0 && !allSel;
                const isExpanded  = expanded.has(chapter.id);

                return (
                  <div key={chapter.id} className="mb-0.5">
                    {/* Chapter row */}
                    <div className="flex items-center gap-2 px-2 py-1 rounded hover:bg-secondary/40 group">
                      <button
                        onClick={() => toggleExpanded(chapter.id)}
                        className="text-muted-foreground shrink-0"
                      >
                        {isExpanded
                          ? <ChevronDown className="h-3 w-3" />
                          : <ChevronRight className="h-3 w-3" />}
                      </button>
                      {/* Chapter-level checkbox */}
                      <button
                        onClick={() => toggleChapter(sceneIds)}
                        className={cn(
                          "h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0",
                          allSel  ? "bg-primary border-primary" :
                          someSel ? "bg-primary/20 border-primary" : "border-border"
                        )}
                      >
                        {(allSel || someSel) && <Check className="h-2 w-2 text-white" />}
                      </button>
                      <span className="text-xs text-muted-foreground flex-1 truncate">
                        {chapter.title}
                      </span>
                      <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0">
                        {selCount}/{sceneIds.length}
                      </span>
                    </div>

                    {/* Scene rows */}
                    {isExpanded && (
                      <div className="ml-7 space-y-px">
                        {chapter.scenes.map((scene, idx) => {
                          const isSel = selected.has(scene.id);
                          const perm  = permissions[scene.id] ?? "edit";
                          return (
                            <div
                              key={scene.id}
                              className="w-full flex items-center gap-2 px-2 py-0.5 rounded hover:bg-secondary/40"
                            >
                              <button
                                onClick={() => toggleScene(scene.id)}
                                className="flex items-center gap-2 flex-1 min-w-0 text-left"
                              >
                                <div className={cn(
                                  "h-3 w-3 rounded border flex items-center justify-center shrink-0",
                                  isSel ? "bg-primary border-primary" : "border-border"
                                )}>
                                  {isSel && <Check className="h-2 w-2 text-white" />}
                                </div>
                                <span className="text-[10px] text-muted-foreground/50 tabular-nums w-4 text-right shrink-0">
                                  {idx + 1}.
                                </span>
                                <span className="text-xs text-muted-foreground truncate">
                                  {scene.title || "(untitled)"}
                                </span>
                              </button>
                              {isSel && (
                                <div className="flex items-center gap-0.5 shrink-0">
                                  <button
                                    onClick={() => setPermission(scene.id, "edit")}
                                    title="Editable"
                                    className={cn(
                                      "text-[9px] px-1.5 py-0.5 rounded font-medium leading-none",
                                      perm === "edit"
                                        ? "bg-primary/15 text-primary"
                                        : "text-muted-foreground/50 hover:text-muted-foreground"
                                    )}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => setPermission(scene.id, "read_only")}
                                    title="Read only"
                                    className={cn(
                                      "text-[9px] px-1.5 py-0.5 rounded font-medium leading-none",
                                      perm === "read_only"
                                        ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                                        : "text-muted-foreground/50 hover:text-muted-foreground"
                                    )}
                                  >
                                    R/O
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {chapter.scenes.length === 0 && (
                          <p className="text-[10px] text-muted-foreground/40 px-2 py-1">No scenes yet</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border shrink-0">
          <span className="text-xs text-muted-foreground">
            {selected.size} scene{selected.size !== 1 ? "s" : ""} assigned
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
