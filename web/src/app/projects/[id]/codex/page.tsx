"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  Plus, Pencil, Trash2, User, MapPin, Package, Scroll, Tag, Gem,
  LayoutGrid, LayoutList, FolderOpen, Loader2, CheckCircle2, X,
  ChevronDown, ChevronUp, ChevronsUpDown, CheckSquare, Square,
  Link2, Link2Off, AlertCircle, EyeOff, Users,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CodexEntryDialog } from "@/components/codex/CodexEntryDialog";
import { BulkEditDialog } from "@/components/codex/BulkEditDialog";
import { ImportButton } from "@/components/layout/ImportButton";
import { useCodexEntries, useCreateCodexEntry, useUpdateCodexEntry, useDeleteCodexEntry, useResyncProjectCommands, useProject, useDetachCodexSharing, useProjects } from "@/store/queries";
import { importApi } from "@/lib/api";
import type { CodexEntry } from "@/types";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_ICONS: Partial<Record<string, React.ElementType>> = {
  character: User, location: MapPin, item: Package, relic: Gem, lore: Scroll, custom: Tag,
};

// TYPE_LABELS built via t() inside the component; see typeLabel() helper below

// ── Sort types ────────────────────────────────────────────────────────────────

type SortKey = "name" | "color" | "group" | "type" | "tag";
type SortDir = "asc" | "desc";

// ── SortTh — sortable <th> for the list table ─────────────────────────────────

function SortTh({
  col, label, sortBy, sortDir, onSort, className,
}: {
  col: SortKey; label: string;
  sortBy: SortKey; sortDir: SortDir;
  onSort: (col: SortKey) => void;
  className?: string;
}) {
  const active = sortBy === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={cn(
        "px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer select-none whitespace-nowrap hover:text-foreground transition-colors",
        active && "text-primary",
        className,
      )}
    >
      <span className="flex items-center gap-1">
        {label}
        {active
          ? sortDir === "asc"
            ? <ChevronUp className="h-3 w-3 shrink-0" />
            : <ChevronDown className="h-3 w-3 shrink-0" />
          : <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-30" />
        }
      </span>
    </th>
  );
}

// ── FilterDropdown ─────────────────────────────────────────────────────────────

interface FilterDropdownProps {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  onClear: () => void;
  renderOption?: (v: string) => React.ReactNode;
}

function FilterDropdown({ label, options, selected, onToggle, onClear, renderOption }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useLanguage();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const active = selected.length > 0;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "flex items-center gap-1 text-xs px-2.5 py-1 rounded-full transition-colors",
          active
            ? "bg-primary/20 text-primary border border-primary/30"
            : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
        )}
      >
        {label}{active && ` (${selected.length})`}
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 min-w-44 bg-popover border border-border rounded-lg shadow-lg py-1 max-h-56 overflow-y-auto">
          {options.map(opt => (
            <label
              key={opt}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-secondary cursor-pointer text-sm"
            >
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => onToggle(opt)}
                className="accent-primary"
              />
              {renderOption ? renderOption(opt) : opt}
            </label>
          ))}
          {active && (
            <button
              onClick={onClear}
              className="w-full text-left text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 border-t border-border mt-1"
            >
              {t("codex_clear_filter")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Directory import hook ─────────────────────────────────────────────────────

function useDirImport(projectId: number) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const all = Array.from(e.target.files ?? []).filter(f => f.name.endsWith(".md"));
    if (inputRef.current) inputRef.current.value = "";
    if (!all.length) return;

    setProgress({ done: 0, total: all.length });
    let created = 0, skipped = 0, errors = 0;
    for (let i = 0; i < all.length; i++) {
      try {
        const r = await importApi.codex(projectId, all[i]);
        created += r.created ?? 0;
        skipped += r.skipped ?? 0;
      } catch { errors++; }
      setProgress({ done: i + 1, total: all.length });
    }
    qc.invalidateQueries({ queryKey: ["codex", projectId] });
    setProgress(null);
    setResult({ ok: errors < all.length, msg: `${created} imported, ${skipped} skipped${errors ? `, ${errors} error(s)` : ""} from ${all.length} file(s).` });
    setTimeout(() => setResult(null), 5000);
  };

  return { inputRef, progress, result, handleChange };
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CodexPage() {
  const { id } = useParams();
  const projectId = Number(id);

  const { t } = useLanguage();
  const typeLabel = (type: string) => t(`type_${type}`) || type;

  const { data: project } = useProject(projectId);
  const { data: entries = [], isLoading } = useCodexEntries(projectId);
  const { data: allProjects = [] } = useProjects();

  // Follow the sharing chain to the actual codex owner (this project if it owns its own codex,
  // or the upstream owner if this project is a consumer).
  const codexOwnerId = project?.shared_codex_project_id ?? projectId;
  // All projects that link to that owner — shown in the per-entry sharing checklist.
  const sharingProjects = allProjects
    .filter(p => p.shared_codex_project_id === codexOwnerId)
    .map(p => ({ id: p.id, title: p.title }));
  const createEntry = useCreateCodexEntry(projectId);
  const updateEntry = useUpdateCodexEntry(projectId);
  const deleteEntry = useDeleteCodexEntry(projectId);
  const resync = useResyncProjectCommands(projectId);
  const detachSharing = useDetachCodexSharing(projectId);

  // Re-extract commands from all scene HTML on mount so inventory / logs are always
  // current even if the debounced sync never fired in a previous session.
  useEffect(() => {
    if (projectId) resync.mutate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ── View / sort state (persisted) ────────────────────────────────────────
  const [view, setViewState] = useState<"grid" | "list">(() =>
    (typeof window !== "undefined" ? (localStorage.getItem("codex-view") as "grid" | "list") : null) ?? "list"
  );
  const setView = (v: "grid" | "list") => { setViewState(v); localStorage.setItem("codex-view", v); };

  const [sortBy, setSortByState] = useState<SortKey>(() =>
    (typeof window !== "undefined" ? (localStorage.getItem("codex-sort") as SortKey) : null) ?? "name"
  );
  const [sortDir, setSortDirState] = useState<SortDir>(() =>
    (typeof window !== "undefined" ? (localStorage.getItem("codex-sort-dir") as SortDir) : null) ?? "asc"
  );

  const handleSort = (col: SortKey) => {
    if (col === sortBy) {
      const next: SortDir = sortDir === "asc" ? "desc" : "asc";
      setSortDirState(next);
      localStorage.setItem("codex-sort-dir", next);
    } else {
      setSortByState(col);
      localStorage.setItem("codex-sort", col);
      setSortDirState("asc");
      localStorage.setItem("codex-sort-dir", "asc");
    }
  };

  // ── Filter state ─────────────────────────────────────────────────────────
  const [search, setSearch]           = useState("");
  const [typeFilter, setTypeFilter]   = useState<string>("all");
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  const [groupFilter, setGroupFilter]     = useState<string[]>([]);
  const [speciesFilter, setSpeciesFilter] = useState<string[]>([]);
  const [subtypeFilter, setSubtypeFilter] = useState<string[]>([]);
  const [tagFilter, setTagFilter]         = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // ── Dialog state ─────────────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen]   = useState(false);
  const [editing, setEditing]         = useState<CodexEntry | null>(null);
  const [bulkOpen, setBulkOpen]       = useState(false);

  // ── Custom categories (localStorage-persisted, per project) ───────────────
  const [newCatInput, setNewCatInput] = useState<string | null>(null);
  const [customCategories, setCustomCategories] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem(`codex-categories-${projectId}`) ?? "[]"); } catch { return []; }
  });
  const updateCustomCategories = (cats: string[]) => {
    setCustomCategories(cats);
    localStorage.setItem(`codex-categories-${projectId}`, JSON.stringify(cats));
  };

  // ── Selection state ───────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // ── Dir import ───────────────────────────────────────────────────────────
  const dir = useDirImport(projectId);

  // ── Derived filter options ───────────────────────────────────────────────
  const uniqueColors   = [...new Set(entries.map(e => e.color))].sort();
  const uniqueGroups   = [...new Set(entries.flatMap(e => e.groups ?? []))].sort();
  const uniqueSpecies  = [...new Set(entries.map(e => e.species).filter(Boolean) as string[])].sort();
  const uniqueSubtypes = [...new Set(entries.map(e => e.subtype).filter(Boolean) as string[])].sort();
  const uniqueTags     = [...new Set(entries.flatMap(e => e.tags))].sort();
  const BUILT_IN_FILTER = ["character", "location", "item", "relic", "lore", "custom"];
  const uniqueCustomTypes = [...new Set(entries.map(e => e.entry_type).filter(t => !BUILT_IN_FILTER.includes(t)))].sort();
  // Merge explicit (localStorage) + implicit (entry-derived) custom categories
  const allCustomTypes = [...new Set([...customCategories, ...uniqueCustomTypes])].sort();
  const hasExtraFilters = uniqueGroups.length > 0 || uniqueSpecies.length > 0 || uniqueSubtypes.length > 0 || uniqueColors.length > 1 || uniqueTags.length > 0;

  // ── Filtering ────────────────────────────────────────────────────────────
  const filtered = entries.filter(e => {
    if (typeFilter !== "all" && e.entry_type !== typeFilter) return false;
    if (colorFilter && e.color !== colorFilter) return false;
    if (groupFilter.length > 0 && !groupFilter.some(g => (e.groups ?? []).includes(g))) return false;
    if (speciesFilter.length > 0 && !speciesFilter.includes(e.species ?? "")) return false;
    if (subtypeFilter.length > 0 && !subtypeFilter.includes(e.subtype ?? "")) return false;
    if (tagFilter.length > 0 && !tagFilter.every(t => e.tags.includes(t))) return false;
    const q = search.toLowerCase();
    if (q && !e.name.toLowerCase().includes(q) && !e.aliases.some(a => a.toLowerCase().includes(q)) && !e.tags.some(t => t.includes(q))) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case "color": cmp = a.color.localeCompare(b.color); break;
      case "group": cmp = (a.groups[0] ?? "").localeCompare(b.groups[0] ?? ""); break;
      case "type":  cmp = a.entry_type.localeCompare(b.entry_type); break;
      case "tag":   cmp = (a.tags[0] ?? "").localeCompare(b.tags[0] ?? ""); break;
      default:      cmp = a.name.localeCompare(b.name);
    }
    if (cmp === 0) cmp = a.name.localeCompare(b.name); // stable secondary
    return sortDir === "asc" ? cmp : -cmp;
  });

  const activeFilterCount = (colorFilter ? 1 : 0) + groupFilter.length + speciesFilter.length + subtypeFilter.length + tagFilter.length;
  const clearAllFilters = () => { setColorFilter(null); setGroupFilter([]); setSpeciesFilter([]); setSubtypeFilter([]); setTagFilter([]); };

  // ── Handlers ─────────────────────────────────────────────────────────────
  const openEdit = useCallback((entry: CodexEntry) => {
    setEditing(entry);
    setDialogOpen(true);
  }, []);

  const handleCardClick = useCallback((entry: CodexEntry, e: React.MouseEvent) => {
    if (selectedIds.size > 0) {
      // Selection mode: toggle
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id);
        return next;
      });
    } else {
      openEdit(entry);
    }
  }, [selectedIds.size, openEdit]);

  const toggleSelect = useCallback((id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAll = () => setSelectedIds(new Set(filtered.map(e => e.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const handleSave = (data: Partial<CodexEntry>) => {
    if (editing) {
      updateEntry.mutate({ id: editing.id, data });
    } else {
      createEntry.mutate({ ...data, project_id: projectId } as any);
    }
    setEditing(null);
  };

  const selectedEntries = entries.filter(e => selectedIds.has(e.id));
  const selectionActive = selectedIds.size > 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col overflow-hidden relative">

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Codex</h1>
          <p className="text-xs text-muted-foreground">
            {entries.length} {entries.length === 1 ? t("codex_entry") : t("codex_entries")}
            {filtered.length !== entries.length && ` · ${filtered.length} ${t("codex_shown")}`}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Dir import status */}
          {(dir.progress || dir.result) && (
            <span className={cn(
              "text-xs px-2 py-1 rounded flex items-center gap-1",
              dir.result ? (dir.result.ok ? "text-green-500" : "text-destructive") : "text-muted-foreground"
            )}>
              {dir.progress
                ? <><Loader2 className="h-3 w-3 animate-spin" />{dir.progress.done}/{dir.progress.total}</>
                : <><CheckCircle2 className="h-3 w-3" />{dir.result!.msg}</>
              }
            </span>
          )}
          <input
            ref={dir.inputRef} type="file"
            // @ts-ignore
            webkitdirectory="" multiple className="hidden"
            onChange={dir.handleChange}
          />
          <ImportButton projectId={projectId} mode="codex" className="w-auto" />
          <Button size="sm" variant="ghost" className="gap-1.5 text-xs text-muted-foreground"
            title="Import all .md files from a folder"
            onClick={() => dir.inputRef.current?.click()}
            disabled={!!dir.progress}
          >
            <FolderOpen className="h-3.5 w-3.5" /> {t("codex_import_folder")}
          </Button>
          <button
            onClick={() => setView(view === "grid" ? "list" : "grid")}
            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title={view === "grid" ? "Switch to list view" : "Switch to grid view"}
          >
            {view === "grid" ? <LayoutList className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
          </button>
          <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> {t("codex_new_entry")}
          </Button>
        </div>
      </header>

      {/* Sharing banner */}
      {project?.shared_codex_project_id && (
        <div className="flex items-center gap-3 px-6 py-2 bg-primary/5 border-b border-primary/20 shrink-0 text-sm">
          <Link2 className="h-4 w-4 text-primary shrink-0" />
          <span className="flex-1 text-muted-foreground">
            Shared codex from{" "}
            <span className="font-medium text-foreground">
              {project.shared_codex_project_title ?? `Project #${project.shared_codex_project_id}`}
            </span>
            . Changes are shared with all linked projects.
          </span>
          <button
            onClick={() => {
              if (!confirm(
                `Detach from shared codex?\n\nThis will copy all entries to this project and break the link. The original project's codex will not be affected.`
              )) return;
              detachSharing.mutate();
            }}
            disabled={detachSharing.isPending}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
          >
            <Link2Off className="h-3.5 w-3.5" />
            {detachSharing.isPending ? "Detaching…" : "Detach"}
          </button>
        </div>
      )}

      {/* Filter bar */}
      <div className="px-6 py-2 border-b border-border space-y-2 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            className="max-w-xs h-8 text-sm"
            placeholder={t("codex_search")}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          {/* Type chips */}
          <div className="flex gap-1 flex-wrap items-center">
            {(["all", "character", "location", "item", "relic", "lore", "custom"] as const).map(tp => (
              <button
                key={tp}
                onClick={() => setTypeFilter(tp)}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-full transition-colors",
                  typeFilter === tp
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                )}
              >
                {tp === "all" ? t("codex_all") : typeLabel(tp)}
              </button>
            ))}
            {allCustomTypes.map(ct => (
              <div
                key={ct}
                className={cn(
                  "group flex items-center text-xs rounded-full transition-colors",
                  typeFilter === ct
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                )}
              >
                <button onClick={() => setTypeFilter(ct)} className="pl-2.5 pr-1.5 py-1 leading-none">
                  {ct}
                </button>
                {customCategories.includes(ct) && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      updateCustomCategories(customCategories.filter(c => c !== ct));
                      if (typeFilter === ct) setTypeFilter("all");
                    }}
                    className="pr-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                    title="Remove category"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            ))}

            {/* Add custom category */}
            {newCatInput === null ? (
              <button
                onClick={() => setNewCatInput("")}
                className="text-xs px-1.5 py-1 rounded-full bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-colors"
                title="Add custom category"
              >
                <Plus className="h-3 w-3" />
              </button>
            ) : (
              <form
                className="flex items-center gap-1"
                onSubmit={e => {
                  e.preventDefault();
                  const name = newCatInput.trim();
                  if (name && !BUILT_IN_FILTER.includes(name) && !customCategories.includes(name)) {
                    updateCustomCategories([...customCategories, name]);
                  }
                  setNewCatInput(null);
                }}
              >
                <input
                  autoFocus
                  value={newCatInput}
                  onChange={e => setNewCatInput(e.target.value)}
                  placeholder="Category name…"
                  className="h-6 text-xs rounded-full border border-border bg-background px-2.5 w-28 focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button type="submit" className="text-muted-foreground hover:text-foreground" title="Create">
                  <Plus className="h-3 w-3" />
                </button>
                <button type="button" onClick={() => setNewCatInput(null)} className="text-muted-foreground hover:text-foreground" title="Cancel">
                  <X className="h-3 w-3" />
                </button>
              </form>
            )}
          </div>

          {/* Extra filters toggle */}
          {hasExtraFilters && (
            <button
              onClick={() => setFiltersOpen(o => !o)}
              className={cn(
                "text-xs px-2.5 py-1 rounded-full flex items-center gap-1 transition-colors",
                (filtersOpen || activeFilterCount > 0)
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "bg-secondary text-muted-foreground hover:bg-secondary/80"
              )}
            >
              {t("codex_filters")}{activeFilterCount > 0 && ` (${activeFilterCount})`}
            </button>
          )}

          {activeFilterCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
            >
              <X className="h-3 w-3" /> {t("common_clear")}
            </button>
          )}
        </div>

        {/* Extra filter dropdowns */}
        {filtersOpen && hasExtraFilters && (
          <div className="flex flex-wrap gap-2 pt-1 items-center">

            {/* Color (keep as swatches) */}
            {uniqueColors.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground shrink-0">{t("codex_color")}</span>
                <div className="flex gap-1">
                  {uniqueColors.map(c => (
                    <button
                      key={c}
                      onClick={() => setColorFilter(colorFilter === c ? null : c)}
                      title={c}
                      className={cn(
                        "w-4 h-4 rounded-full border-2 transition-all",
                        colorFilter === c ? "border-foreground scale-110" : "border-transparent hover:border-muted-foreground"
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Group dropdown */}
            {uniqueGroups.length > 0 && (
              <FilterDropdown
                label={t("codex_group")}
                options={uniqueGroups}
                selected={groupFilter}
                onToggle={v => setGroupFilter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])}
                onClear={() => setGroupFilter([])}
              />
            )}

            {/* Species dropdown */}
            {uniqueSpecies.length > 0 && (
              <FilterDropdown
                label={t("codex_species")}
                options={uniqueSpecies}
                selected={speciesFilter}
                onToggle={v => setSpeciesFilter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])}
                onClear={() => setSpeciesFilter([])}
              />
            )}

            {/* Subtype dropdown */}
            {uniqueSubtypes.length > 0 && (
              <FilterDropdown
                label={t("codex_subtype")}
                options={uniqueSubtypes}
                selected={subtypeFilter}
                onToggle={v => setSubtypeFilter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])}
                onClear={() => setSubtypeFilter([])}
              />
            )}

            {/* Tags dropdown */}
            {uniqueTags.length > 0 && (
              <FilterDropdown
                label={t("codex_tags")}
                options={uniqueTags}
                selected={tagFilter}
                onToggle={v => setTagFilter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])}
                onClear={() => setTagFilter([])}
                renderOption={v => <span className="text-primary">#{v}</span>}
              />
            )}
          </div>
        )}
      </div>

      {/* Entry list / grid */}
      <div className="flex-1 overflow-y-auto p-6 pb-20">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[...Array(6)].map((_, i) => <div key={i} className="h-28 rounded-lg bg-card animate-pulse" />)}
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            {entries.length === 0 ? t("codex_empty") : t("codex_no_match")}
          </div>
        ) : view === "grid" ? (
          <>
          {/* Grid sort bar */}
          <div className="flex items-center gap-1 mb-3 flex-wrap">
            <span className="text-xs text-muted-foreground mr-1">{t("codex_sort")}</span>
            {(["name","type","group","color","tag"] as SortKey[]).map(col => (
              <button
                key={col}
                onClick={() => handleSort(col)}
                className={cn(
                  "flex items-center gap-0.5 text-xs px-2 py-1 rounded transition-colors",
                  sortBy === col
                    ? "bg-primary/20 text-primary"
                    : "bg-secondary text-muted-foreground hover:text-foreground"
                )}
              >
                {col === "name" ? t("codex_col_name") : col === "type" ? t("codex_col_type") : col === "group" ? t("codex_group") : col === "tag" ? t("codex_tags") : t("codex_color")}
                {sortBy === col
                  ? sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                  : <ChevronsUpDown className="h-3 w-3 opacity-30" />
                }
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sorted.map(entry => {
              const Icon = TYPE_ICONS[entry.entry_type] ?? Tag;
              const isSelected = selectedIds.has(entry.id);
              return (
                <div
                  key={entry.id}
                  onClick={e => handleCardClick(entry, e)}
                  className={cn(
                    "group bg-card border rounded-lg p-4 relative cursor-pointer transition-colors",
                    isSelected
                      ? "border-primary ring-1 ring-primary/30 bg-primary/5"
                      : "border-border hover:border-border/80 hover:bg-secondary/20"
                  )}
                >
                  {/* Selection checkbox */}
                  <button
                    onClick={e => toggleSelect(entry.id, e)}
                    className={cn(
                      "absolute top-2 left-2 transition-opacity",
                      isSelected || selectionActive ? "opacity-100" : "opacity-0 group-hover:opacity-60"
                    )}
                  >
                    {isSelected
                      ? <CheckSquare className="h-4 w-4 text-primary" />
                      : <Square className="h-4 w-4 text-muted-foreground" />
                    }
                  </button>

                  <div className="flex items-start gap-3">
                    <div className="w-3 h-3 rounded-full mt-1 shrink-0" style={{ backgroundColor: entry.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <h3 className="font-medium text-sm truncate">{entry.name}</h3>
                        {sharingProjects.length > 0 && entry.share_mode === "none" && (
                          <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground" title="Private — not shared with any linked project">
                            <EyeOff className="h-2.5 w-2.5" /> Private
                          </span>
                        )}
                        {sharingProjects.length > 0 && entry.share_mode === "specific" && (
                          <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary/70" title="Shared with specific projects only">
                            <Users className="h-2.5 w-2.5" /> Selected
                          </span>
                        )}
                      </div>
                      {entry.aliases.length > 0 && (
                        <p className="text-xs text-muted-foreground mb-1">{entry.aliases.join(", ")}</p>
                      )}
                      {((entry.groups?.length) || entry.species || entry.subtype) && (
                        <p className="text-xs text-muted-foreground/70 mb-1">
                          {[...(entry.groups ?? []), entry.species, entry.subtype].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {entry.tags.length > 0 && (
                        <div className="flex flex-wrap gap-0.5 mb-1">
                          {entry.tags.map(tag => (
                            <span key={tag} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0 rounded-full">#{tag}</span>
                          ))}
                        </div>
                      )}
                      {entry.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{entry.description}</p>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  {!selectionActive && (
                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 flex gap-1">
                      <button
                        className="p-1 hover:text-primary rounded"
                        onClick={e => { e.stopPropagation(); openEdit(entry); }}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        className="p-1 hover:text-destructive rounded"
                        onClick={e => { e.stopPropagation(); if (confirm(`Delete "${entry.name}"?`)) deleteEntry.mutate(entry.id); }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          </>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-secondary/50 border-b border-border sticky top-0 z-10">
                <tr>
                  {/* Checkbox col */}
                  <th className="w-8 px-3 py-2">
                    <button
                      onClick={() => selectedIds.size === sorted.length ? clearSelection() : selectAll()}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {selectedIds.size === sorted.length && sorted.length > 0
                        ? <CheckSquare className="h-3.5 w-3.5 text-primary" />
                        : <Square className="h-3.5 w-3.5" />
                      }
                    </button>
                  </th>
                  {/* Color col */}
                  <SortTh col="color" label={t("codex_color")} sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="w-16" />
                  {/* Name col */}
                  <SortTh col="name"  label={t("codex_col_name")} sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  {/* Type col */}
                  <SortTh col="type"  label={t("codex_col_type")} sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="w-40" />
                  {/* Group col */}
                  <SortTh col="group" label={t("codex_group")} sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="w-32" />
                  {/* Tags col */}
                  <SortTh col="tag" label={t("codex_tags")} sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="w-48" />
                  {/* Sharing col */}
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-24">Sharing</th>
                  {/* Description col */}
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("codex_col_description")}</th>
                  {/* Actions col */}
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {sorted.map(entry => {
                  const Icon = TYPE_ICONS[entry.entry_type] ?? Tag;
                  const isSelected = selectedIds.has(entry.id);
                  const subtypeLabel = entry.entry_type === "character" ? entry.species : entry.subtype;
                  return (
                    <tr
                      key={entry.id}
                      onClick={e => handleCardClick(entry, e)}
                      className={cn(
                        "group cursor-pointer transition-colors",
                        isSelected ? "bg-primary/10" : "bg-card hover:bg-secondary/30"
                      )}
                    >
                      {/* Checkbox */}
                      <td className="px-3 py-2.5 w-8">
                        <button
                          onClick={e => toggleSelect(entry.id, e)}
                          className={cn(
                            "transition-opacity",
                            isSelected || selectionActive ? "opacity-100" : "opacity-0 group-hover:opacity-60"
                          )}
                        >
                          {isSelected
                            ? <CheckSquare className="h-3.5 w-3.5 text-primary" />
                            : <Square className="h-3.5 w-3.5 text-muted-foreground" />
                          }
                        </button>
                      </td>

                      {/* Color */}
                      <td className="px-3 py-2.5">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
                      </td>

                      {/* Name */}
                      <td className="px-3 py-2.5 max-w-[180px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-medium truncate">{entry.name}</span>
                          {sharingProjects.length > 0 && entry.share_mode === "none" && (
                            <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground" title="Private">
                              <EyeOff className="h-2.5 w-2.5" />
                            </span>
                          )}
                          {sharingProjects.length > 0 && entry.share_mode === "specific" && (
                            <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary/70" title="Specific projects only">
                              <Users className="h-2.5 w-2.5" />
                            </span>
                          )}
                        </div>
                        {entry.aliases.length > 0 && (
                          <div className="text-xs text-muted-foreground truncate">{entry.aliases.join(", ")}</div>
                        )}
                      </td>

                      {/* Type / Subtype */}
                      <td className="px-3 py-2.5 w-40">
                        <div className="flex items-center gap-1.5 text-xs">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span>{typeLabel(entry.entry_type)}</span>
                        </div>
                        {subtypeLabel && (
                          <div className="text-xs text-muted-foreground mt-0.5">{subtypeLabel}</div>
                        )}
                      </td>

                      {/* Group */}
                      <td className="px-3 py-2.5 w-32">
                        <div className="flex flex-wrap gap-0.5">
                          {(entry.groups ?? []).map(g => (
                            <span key={g} className="text-xs bg-secondary px-1.5 py-0.5 rounded">{g}</span>
                          ))}
                        </div>
                      </td>

                      {/* Tags */}
                      <td className="px-3 py-2.5 w-48">
                        <div className="flex flex-wrap gap-0.5">
                          {entry.tags.slice(0, 4).map(tag => (
                            <span key={tag} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0 rounded-full">#{tag}</span>
                          ))}
                          {entry.tags.length > 4 && (
                            <span className="text-[10px] text-muted-foreground">+{entry.tags.length - 4}</span>
                          )}
                        </div>
                      </td>

                      {/* Sharing */}
                      <td className="px-3 py-2.5 w-24">
                        {entry.share_mode === "none" ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground" title="Private — not shared with linked projects">
                            <EyeOff className="h-3 w-3" /> Private
                          </span>
                        ) : entry.share_mode === "specific" ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-primary/70" title="Shared with specific projects only">
                            <Users className="h-3 w-3" /> Selected
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/40">All</span>
                        )}
                      </td>

                      {/* Description */}
                      <td className="px-3 py-2.5 max-w-xs">
                        {entry.description && (
                          <span className="text-xs text-muted-foreground line-clamp-1">{entry.description}</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-3 py-2.5 w-16">
                        {!selectionActive && (
                          <div className="opacity-0 group-hover:opacity-100 flex gap-1 justify-end">
                            <button
                              className="p-1 hover:text-primary rounded"
                              onClick={e => { e.stopPropagation(); openEdit(entry); }}
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              className="p-1 hover:text-destructive rounded"
                              onClick={e => { e.stopPropagation(); if (confirm(`Delete "${entry.name}"?`)) deleteEntry.mutate(entry.id); }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Selection action bar ──────────────────────────────────────────────── */}
      {selectionActive && (
        <div className="absolute bottom-0 left-0 right-0 flex items-center gap-3 px-6 py-3 bg-card border-t border-border shadow-lg z-20">
          <span className="text-sm font-medium text-primary">
            {selectedIds.size} {t("codex_selected")}
          </span>
          <button
            onClick={selectAll}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t("codex_select_all")} ({filtered.length})
          </button>
          <button
            onClick={clearSelection}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
          >
            <X className="h-3 w-3" /> {t("codex_deselect")}
          </button>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBulkOpen(true)}
            >
              {t("common_apply")} {selectedIds.size} {selectedIds.size === 1 ? t("codex_entry") : t("codex_entries")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (!confirm(`Delete ${selectedIds.size} entries?`)) return;
                selectedEntries.forEach(e => deleteEntry.mutate(e.id));
                clearSelection();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Dialogs ────────────────────────────────────────────────────────────── */}
      <CodexEntryDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSave={handleSave}
        initial={editing ?? undefined}
        title={editing ? t("entry_edit_title") : t("entry_new_title")}
        allEntries={entries}
        sharingProjects={sharingProjects}
        onOpenEntry={(id) => {
          const entry = entries.find(e => e.id === id);
          if (entry) setEditing(entry);
        }}
        onOpenRelation={(id) => {
          const entry = entries.find(e => e.id === id);
          if (entry) setEditing(entry);
        }}
      />

      <BulkEditDialog
        open={bulkOpen}
        onClose={() => { setBulkOpen(false); clearSelection(); }}
        selectedEntries={selectedEntries}
        allEntries={entries}
        projectId={projectId}
        sharingProjects={sharingProjects}
      />
    </div>
  );
}
