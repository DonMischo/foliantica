"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen, Plus, Trash2, Calendar, BookCopy, Sparkles, TriangleAlert,
  Link2, ImageIcon, Settings, Upload, FileText, BookMarked, FolderOpen,
  Loader2, Download, Flame, BarChart2, BookMarked as SeriesIcon, GripVertical,
  ChevronUp, ChevronDown, Pencil, Check, X as XIcon,
} from "lucide-react";
import { imagesApi, importApi } from "@/lib/api";
import { AchievementToastQueue } from "@/components/AchievementToast";
import { useUploadProjectCover, useDeleteProjectCover, useGlobalWritingLog, useSeries, useUpdateProjectMeta } from "@/store/queries";
import type { WritingLogEntry, SeriesBook, SeriesGroup, BookMeta } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useProjects, useCreateProject, useDeleteProject } from "@/store/queries";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

// ── Series view ───────────────────────────────────────────────────────────────

function SeriesBookRow({
  book,
  onEdit,
}: {
  book: SeriesBook;
  onEdit: (book: SeriesBook) => void;
}) {
  return (
    <Link
      href={`/projects/${book.id}`}
      className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-secondary/40 transition-colors"
      onClick={(e) => {
        // Don't navigate if clicking the edit button
        if ((e.target as HTMLElement).closest("[data-edit]")) e.preventDefault();
      }}
    >
      {/* Cover thumbnail */}
      <div className="w-8 h-10 rounded border border-border overflow-hidden shrink-0 bg-muted/40 flex items-center justify-center">
        {book.cover_image ? (
          <img src={imagesApi.url(book.cover_image)} alt="" className="w-full h-full object-cover" />
        ) : (
          <BookOpen className="h-4 w-4 text-muted-foreground/40" />
        )}
      </div>

      {/* Index + role badge */}
      <div className="w-12 text-center shrink-0">
        {book.series_index ? (
          <span className="text-xs font-mono text-muted-foreground">{book.series_index}</span>
        ) : (
          <span className="text-xs text-muted-foreground/40">—</span>
        )}
      </div>

      {/* Title + role */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{book.title}</span>
          {book.series_role && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary/80 font-medium">
              {book.series_role}
            </span>
          )}
          {book.shared_codex_project_id && (
            <span className="shrink-0 text-[10px] text-muted-foreground/50 flex items-center gap-0.5">
              <Link2 className="h-2.5 w-2.5" /> shared
            </span>
          )}
        </div>
      </div>

      {/* Edit button */}
      <button
        data-edit
        onClick={() => onEdit(book)}
        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-opacity shrink-0"
        title="Edit series info"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </Link>
  );
}

interface SeriesEditState {
  book: SeriesBook;
  series: string;
  series_index: string;
  series_role: string;
}

function SeriesBookEditDialog({
  state,
  allSeriesNames,
  onSave,
  onClose,
}: {
  state: SeriesEditState | null;
  allSeriesNames: string[];
  onSave: (bookId: number, meta: Partial<BookMeta>) => void;
  onClose: () => void;
}) {
  const [series, setSeries]       = useState(state?.series ?? "");
  const [index, setIndex]         = useState(state?.series_index ?? "");
  const [role, setRole]           = useState(state?.series_role ?? "");
  const [newSeries, setNewSeries] = useState(false);
  const { data: projects = [] } = useProjects();

  // Sync from state when it changes
  if (state && series !== state.series && !newSeries) setSeries(state.series);

  const project = projects.find(p => p.id === state?.book.id);

  const handleSave = () => {
    if (!state) return;
    const existingMeta: BookMeta = project?.book_meta ?? {};
    onSave(state.book.id, {
      ...existingMeta,
      series: series.trim() || undefined,
      series_index: index.trim() || undefined,
      series_role: role.trim() || undefined,
    });
    onClose();
  };

  return (
    <Dialog open={!!state} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SeriesIcon className="h-4 w-4" />
            Series Info — {state?.book.title}
          </DialogTitle>
          <DialogDescription>
            Set the series, position, and role for this book.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {/* Series name */}
          <div className="space-y-1.5">
            <Label>Series name</Label>
            {allSeriesNames.length > 0 && !newSeries ? (
              <div className="flex gap-2">
                <select
                  value={series}
                  onChange={e => { if (e.target.value === "__new__") { setNewSeries(true); setSeries(""); } else setSeries(e.target.value); }}
                  className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">— No series —</option>
                  {allSeriesNames.map(n => <option key={n} value={n}>{n}</option>)}
                  <option value="__new__">+ New series…</option>
                </select>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. The Shadow Chronicles"
                  value={series}
                  onChange={e => setSeries(e.target.value)}
                  autoFocus
                />
                {allSeriesNames.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setNewSeries(false); setSeries(state?.series ?? ""); }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Back
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Series index */}
          <div className="space-y-1.5">
            <Label>
              Position in series
              <span className="ml-1 text-xs text-muted-foreground font-normal">(e.g. 0.5, 1, 2)</span>
            </Label>
            <Input
              placeholder="1"
              value={index}
              onChange={e => setIndex(e.target.value)}
              type="text"
              inputMode="decimal"
            />
          </div>

          {/* Series role */}
          <div className="space-y-1.5">
            <Label>
              Role label
              <span className="ml-1 text-xs text-muted-foreground font-normal">(optional)</span>
            </Label>
            <div className="flex gap-2 flex-wrap">
              {["Prequel", "Book 1", "Book 2", "Book 3", "Sequel", "Interlude", "Short Story", "Novella"].map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(prev => prev === r ? "" : r)}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-full border transition-colors",
                    role === r
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <Input
              placeholder="Custom role…"
              value={role}
              onChange={e => setRole(e.target.value)}
              className="mt-1"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SeriesView() {
  const { data: seriesData, isLoading } = useSeries();
  const updateMeta = useUpdateProjectMeta();
  const [editState, setEditState] = useState<SeriesEditState | null>(null);

  const allSeriesNames = seriesData?.series.map(s => s.name) ?? [];

  const handleEditBook = (book: SeriesBook) => {
    setEditState({
      book,
      series: seriesData?.series.find(s => s.books.some(b => b.id === book.id))?.name ?? "",
      series_index: book.series_index ?? "",
      series_role: book.series_role ?? "",
    });
  };

  const handleSaveMeta = (bookId: number, meta: Partial<BookMeta>) => {
    updateMeta.mutate({ id: bookId, data: { book_meta: meta as BookMeta } });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2].map(i => <div key={i} className="h-32 rounded-lg bg-card animate-pulse" />)}
      </div>
    );
  }

  const series = seriesData?.series ?? [];
  const unserialized = seriesData?.unserialized ?? [];

  return (
    <div className="space-y-6">
      {series.length === 0 && unserialized.length === 0 && (
        <div className="text-center py-20">
          <SeriesIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-medium mb-2">No series yet</h2>
          <p className="text-muted-foreground text-sm">
            Open a project, go to Project Info, and set a Series name to group books together.
          </p>
        </div>
      )}

      {/* Series groups */}
      {series.map(group => (
        <div key={group.name} className="rounded-lg border border-border bg-card overflow-hidden">
          {/* Series header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-secondary/20">
            <SeriesIcon className="h-4 w-4 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm">{group.name}</h3>
              <p className="text-[11px] text-muted-foreground">
                {group.books.length} book{group.books.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>

          {/* Table header */}
          <div className="flex items-center gap-3 px-3 py-1.5 text-[10px] text-muted-foreground/60 uppercase tracking-wide border-b border-border/50">
            <div className="w-8 shrink-0" />
            <div className="w-12 text-center shrink-0">Index</div>
            <div className="flex-1">Title · Role</div>
          </div>

          {/* Books */}
          <div className="divide-y divide-border/30">
            {group.books.map(book => (
              <SeriesBookRow key={book.id} book={book} onEdit={handleEditBook} />
            ))}
          </div>

          {/* Add book to this series */}
          {unserialized.length > 0 && (
            <div className="px-3 py-2 border-t border-border/50">
              <select
                defaultValue=""
                onChange={e => {
                  const id = Number(e.target.value);
                  if (!id) return;
                  const book = unserialized.find(b => b.id === id);
                  if (!book) return;
                  handleEditBook({ ...book, series_index: String(group.books.length + 1) });
                  e.target.value = "";
                }}
                className="w-full h-7 text-xs rounded border border-dashed border-border bg-background px-2 text-muted-foreground hover:text-foreground focus:outline-none cursor-pointer"
              >
                <option value="" disabled>+ Add a project to this series…</option>
                {unserialized.map(b => (
                  <option key={b.id} value={b.id}>{b.title}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      ))}

      {/* Unserialized projects */}
      {unserialized.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-secondary/10">
            <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <h3 className="font-semibold text-sm text-muted-foreground">Not in a series</h3>
              <p className="text-[11px] text-muted-foreground/70">
                {unserialized.length} project{unserialized.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <div className="divide-y divide-border/30">
            {unserialized.map(book => (
              <SeriesBookRow key={book.id} book={book} onEdit={handleEditBook} />
            ))}
          </div>
        </div>
      )}

      {/* Edit dialog */}
      <SeriesBookEditDialog
        state={editState}
        allSeriesNames={allSeriesNames}
        onSave={handleSaveMeta}
        onClose={() => setEditState(null)}
      />
    </div>
  );
}

type CodexOption = "fresh" | "copy" | "share";

function ProjectCard({
  project,
  onDelete,
}: {
  project: import("@/types").Project;
  onDelete: (id: number, title: string) => void;
}) {
  const { t } = useLanguage();
  const uploadCover = useUploadProjectCover(project.id);
  const deleteCover = useDeleteProjectCover(project.id);

  const handleCoverClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp,image/gif";
    input.onchange = () => {
      if (input.files?.[0]) uploadCover.mutate(input.files[0]);
    };
    input.click();
  };

  return (
    <div className="group relative bg-card border border-border rounded-lg overflow-hidden hover:border-primary/50 transition-colors">
      {/* Cover image area */}
      <div
        className="relative w-full h-32 bg-muted/40 flex items-center justify-center cursor-pointer overflow-hidden"
        onClick={handleCoverClick}
        title={project.cover_image ? t("img_change") : t("img_upload")}
      >
        {project.cover_image ? (
          <>
            <img
              src={imagesApi.url(project.cover_image)}
              alt=""
              className="w-full h-full object-cover"
            />
            <button
              className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 bg-background/80 rounded p-0.5 hover:text-destructive transition-opacity"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteCover.mutate(); }}
              title={t("img_remove")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground/50 group-hover:text-muted-foreground/80 transition-colors">
            <ImageIcon className="h-8 w-8" />
            <span className="text-[10px]">{t("img_upload")}</span>
          </div>
        )}
      </div>

      {/* Card content */}
      <Link href={`/projects/${project.id}`} className="block p-4">
        <div className="mb-2 min-w-0">
          <h3 className="font-semibold truncate">{project.title}</h3>
          {project.description && (
            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{project.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {new Date(project.updated_at).toLocaleDateString()}
          </span>
          {project.shared_codex_project_id && (
            <span className="flex items-center gap-1 text-primary/70">
              <Link2 className="h-3 w-3" />
              {t("dash_shared_codex")}
            </span>
          )}
        </div>
      </Link>

      <button
        className="absolute top-2 left-2 opacity-0 group-hover:opacity-60 hover:opacity-100 hover:text-destructive transition-opacity bg-background/70 rounded p-0.5"
        onClick={(e) => { e.preventDefault(); onDelete(project.id, project.title); }}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

interface DeleteTarget { id: number; title: string }

// ── Streak helpers ────────────────────────────────────────────────────────────

function computeStreak(log: WritingLogEntry[]): number {
  const active = new Set(log.filter((e) => e.words > 0).map((e) => e.date));
  let streak = 0;
  const d = new Date();
  while (true) {
    const key = d.toISOString().split("T")[0];
    if (!active.has(key)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function MiniHeatmap({ log }: { log: WritingLogEntry[] }) {
  const WEEKS = 12;
  const map = new Map(log.map((e) => [e.date, e.words]));
  const max = Math.max(...log.map((e) => e.words), 1);

  // Build cells for the last WEEKS*7 days, aligned to start-of-week (Mon)
  const today = new Date();
  const cells: { date: string; words: number }[] = [];
  for (let i = WEEKS * 7 - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().split("T")[0];
    cells.push({ date: key, words: map.get(key) ?? 0 });
  }

  function intensity(words: number): string {
    if (!words) return "bg-muted/40";
    const pct = words / max;
    if (pct < 0.25) return "bg-primary/25";
    if (pct < 0.5)  return "bg-primary/50";
    if (pct < 0.75) return "bg-primary/70";
    return "bg-primary";
  }

  // 7 rows (days), WEEKS columns
  return (
    <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${WEEKS}, 1fr)`, gridTemplateRows: "repeat(7, 1fr)" }}>
      {Array.from({ length: WEEKS }, (_, w) =>
        Array.from({ length: 7 }, (_, d) => {
          const cell = cells[w * 7 + d];
          return (
            <div
              key={`${w}-${d}`}
              className={`w-2.5 h-2.5 rounded-[2px] ${intensity(cell?.words ?? 0)}`}
              title={cell ? `${cell.date}: ${cell.words} words` : ""}
            />
          );
        })
      )}
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const { data: projects = [], isLoading } = useProjects();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const { t } = useLanguage();
  const { data: writingLog = [] } = useGlobalWritingLog();
  const streak = computeStreak(writingLog);

  const [dashView, setDashView] = useState<"projects" | "series">("projects");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [codexOption, setCodexOption] = useState<CodexOption>("fresh");
  const [copyFromId, setCopyFromId] = useState<number | "">("");
  const [shareFromId, setShareFromId] = useState<number | "">("");

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Import dialog state
  type ImportMode = "existing" | "new";
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>("existing");
  const [importTargetId, setImportTargetId] = useState<number | "">("");
  const [importStoryFile, setImportStoryFile] = useState<File | null>(null);
  const [importCodexFile, setImportCodexFile] = useState<File | null>(null);
  const [importCodexFolder, setImportCodexFolder] = useState<File[]>([]);
  const [importNewTitle, setImportNewTitle] = useState("");
  const [importNewDesc, setImportNewDesc] = useState("");
  const [importPending, setImportPending] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const handleOpenImport = () => {
    setImportMode("existing");
    setImportTargetId("");
    setImportStoryFile(null);
    setImportCodexFile(null);
    setImportCodexFolder([]);
    setImportNewTitle("");
    setImportNewDesc("");
    setImportResult(null);
    setImportError(null);
    setImportProgress(null);
    setImportOpen(true);
  };

  const handleImport = async () => {
    setImportPending(true);
    setImportResult(null);
    setImportError(null);
    setImportProgress(null);
    try {
      let projectId: number;
      if (importMode === "new") {
        if (!importNewTitle.trim()) return;
        const project = await createProject.mutateAsync({ title: importNewTitle.trim(), description: importNewDesc.trim() || undefined });
        projectId = project.id;
      } else {
        if (importTargetId === "") return;
        projectId = importTargetId;
      }
      const messages: string[] = [];
      if (importStoryFile) {
        const r = await importApi.story(projectId, importStoryFile);
        messages.push(r.message);
      }
      if (importCodexFile) {
        const r = await importApi.codex(projectId, importCodexFile);
        messages.push(r.message);
      }
      // Codex folder: import each .md file individually
      if (importCodexFolder.length > 0) {
        let created = 0, skipped = 0, errors = 0;
        setImportProgress({ done: 0, total: importCodexFolder.length });
        for (let i = 0; i < importCodexFolder.length; i++) {
          try {
            const r = await importApi.codex(projectId, importCodexFolder[i]);
            created += r.created ?? 0;
            skipped += r.skipped ?? 0;
          } catch { errors++; }
          setImportProgress({ done: i + 1, total: importCodexFolder.length });
        }
        messages.push(`Folder: ${created} imported, ${skipped} skipped${errors ? `, ${errors} error(s)` : ""} from ${importCodexFolder.length} file(s).`);
      }
      setImportProgress(null);
      setImportResult(messages.join(" "));
      if (importMode === "new") router.push(`/projects/${projectId}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message.replace(/^\d+: /, "") : "Import failed.");
    } finally {
      setImportPending(false);
      setImportProgress(null);
    }
  };

  const otherProjects = projects;

  const handleOpen = () => {
    setTitle("");
    setDescription("");
    setCodexOption("fresh");
    setCopyFromId("");
    setShareFromId("");
    setDialogOpen(true);
  };

  const handleCreate = async () => {
    if (!title.trim()) return;
    const payload: { title: string; description?: string; copy_codex_from?: number; share_codex_from?: number } = {
      title: title.trim(),
      description: description.trim() || undefined,
    };
    if (codexOption === "copy" && copyFromId !== "") {
      payload.copy_codex_from = Number(copyFromId);
    }
    if (codexOption === "share" && shareFromId !== "") {
      payload.share_codex_from = Number(shareFromId);
    }
    const project = await createProject.mutateAsync(payload);
    setDialogOpen(false);
    router.push(`/projects/${project.id}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/icon.svg" alt="" className="h-6 w-6" />
          <h1 className="text-xl font-bold">Foliantica</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleOpenImport}>
            <Upload className="h-4 w-4" />
            Import
          </Button>
          <Button onClick={handleOpen} size="sm">
            <Plus className="h-4 w-4" />
            {t("dash_new_project")}
          </Button>
          {/* Streak widget */}
          {streak > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card">
              <Flame className="h-4 w-4 text-orange-400" />
              <span className="text-sm font-medium tabular-nums">{streak}</span>
              <span className="text-xs text-muted-foreground">day{streak !== 1 ? "s" : ""}</span>
            </div>
          )}
          <Link
            href="/stats"
            className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-input bg-background text-muted-foreground hover:text-foreground hover:bg-accent/10 transition-colors"
            title="Writing stats"
          >
            <BarChart2 className="h-4 w-4" />
          </Link>
          <Link
            href="/settings"
            className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-input bg-background text-muted-foreground hover:text-foreground hover:bg-accent/10 transition-colors"
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* View tabs — only shown once there are projects */}
        {(projects.length > 0 || !isLoading) && (
          <div className="flex items-center gap-0 mb-6 border-b border-border">
            <button
              onClick={() => setDashView("projects")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                dashView === "projects"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <BookOpen className="h-4 w-4" />
              All Projects
            </button>
            <button
              onClick={() => setDashView("series")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                dashView === "series"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <SeriesIcon className="h-4 w-4" />
              Series
            </button>
          </div>
        )}

        {dashView === "projects" && (
          isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-36 rounded-lg bg-card animate-pulse" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-20">
              <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-lg font-medium mb-2">{t("dash_no_projects")}</h2>
              <p className="text-muted-foreground mb-6 text-sm">{t("dash_no_projects_desc")}</p>
              <Button onClick={handleOpen}>
                <Plus className="h-4 w-4" />
                {t("dash_new_project")}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onDelete={(id, title) => { setDeleteTarget({ id, title }); setDeleteConfirm(""); }}
                />
              ))}
            </div>
          )
        )}

        {dashView === "series" && <SeriesView />}
      </main>

      {/* Mini heatmap strip */}
      {writingLog.length > 0 && (
        <div className="max-w-4xl mx-auto px-6 pb-6">
          <div className="flex items-center gap-4 bg-card border border-border rounded-lg px-4 py-3">
            <div className="shrink-0">
              <p className="text-xs font-medium mb-0.5">Last 12 weeks</p>
              <p className="text-[10px] text-muted-foreground">
                {writingLog.reduce((s, e) => s + e.words, 0).toLocaleString()} words total
              </p>
            </div>
            <div className="flex-1 flex justify-end">
              <MiniHeatmap log={writingLog} />
            </div>
            <Link href="/stats" className="text-xs text-primary hover:underline shrink-0">
              Full stats →
            </Link>
          </div>
        </div>
      )}

      <footer className="text-center pb-4 pt-2">
        <a
          href="https://tanstack.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="256" height="256" rx="48" fill="currentColor"/>
            <path d="M64 80h128M128 80v96" stroke="white" strokeWidth="28" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Powered by TanStack
        </a>
      </footer>

      {/* ── Import dialog ── */}
      <Dialog open={importOpen} onOpenChange={(open) => { if (!open) setImportOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Import Project
            </DialogTitle>
            <DialogDescription>
              Import a story or codex from Markdown files.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">

            {/* Mode selector */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setImportMode("existing")}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs transition-colors",
                  importMode === "existing"
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground",
                  projects.length === 0 && "opacity-40 cursor-not-allowed"
                )}
                disabled={projects.length === 0}
              >
                <BookMarked className="h-5 w-5" />
                <span className="font-medium">Add to existing project</span>
              </button>
              <button
                type="button"
                onClick={() => setImportMode("new")}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs transition-colors",
                  importMode === "new"
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
                )}
              >
                <Plus className="h-5 w-5" />
                <span className="font-medium">Create new project</span>
              </button>
            </div>

            {/* Existing project selector */}
            {importMode === "existing" && (
              <div className="space-y-1.5">
                <Label>Target Project</Label>
                <select
                  value={importTargetId}
                  onChange={(e) => setImportTargetId(e.target.value === "" ? "" : Number(e.target.value))}
                  className={cn(
                    "w-full h-9 rounded-md border border-input bg-background px-3 text-sm",
                    "focus:outline-none focus:ring-1 focus:ring-ring"
                  )}
                >
                  <option value="">Select a project…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </div>
            )}

            {/* New project fields */}
            {importMode === "new" && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Project Title</Label>
                  <Input
                    placeholder="My Novel"
                    value={importNewTitle}
                    onChange={(e) => setImportNewTitle(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>
                    Description <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Textarea
                    placeholder="A brief synopsis…"
                    value={importNewDesc}
                    onChange={(e) => setImportNewDesc(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>
            )}

            {/* File pickers */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  Story file <span className="text-muted-foreground font-normal">(Markdown — optional)</span>
                </Label>
                <input
                  type="file"
                  accept=".md,.txt"
                  onChange={(e) => setImportStoryFile(e.target.files?.[0] ?? null)}
                  className="text-sm text-muted-foreground file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-border file:text-xs file:bg-background file:text-foreground hover:file:bg-secondary/50 file:cursor-pointer"
                />
                <p className="text-[11px] text-muted-foreground">Use ## Acts, ### Chapters, #### Scenes.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center justify-between gap-1.5">
                  <span className="flex items-center gap-1.5">
                    <BookMarked className="h-3.5 w-3.5" />
                    Codex file <span className="text-muted-foreground font-normal">(single .md — optional)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const SAMPLE = `# Codex Sample\n\n## character: Aria Voss\nalias: The Wanderer\ncolor: #a855f7\ndescription: A seasoned explorer with a mysterious past.\ntags: protagonist, explorer\n\n## location: The Hollow Keep\ncolor: #3b82f6\ndescription: An ancient fortress carved into a cliffside.\ntags: fortress, ancient\n\n## item: Starstone Amulet\ncolor: #f59e0b\ndescription: A glowing amulet said to grant visions of the future.\ntags: artifact, magical\n`;
                      const blob = new Blob([SAMPLE], { type: "text/markdown" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url; a.download = "codex-sample.md"; a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    <Download className="h-3 w-3" /> sample file
                  </button>
                </Label>
                <input
                  type="file"
                  accept=".md,.txt"
                  onChange={(e) => { setImportCodexFile(e.target.files?.[0] ?? null); setImportCodexFolder([]); }}
                  className="text-sm text-muted-foreground file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-border file:text-xs file:bg-background file:text-foreground hover:file:bg-secondary/50 file:cursor-pointer"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <FolderOpen className="h-3.5 w-3.5" />
                  Codex folder <span className="text-muted-foreground font-normal">(all .md files — optional)</span>
                </Label>
                <input
                  type="file"
                  accept=".md"
                  // @ts-ignore
                  webkitdirectory="" multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []).filter(f => f.name.endsWith(".md"));
                    setImportCodexFolder(files);
                    if (files.length) setImportCodexFile(null);
                  }}
                  className="text-sm text-muted-foreground file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-border file:text-xs file:bg-background file:text-foreground hover:file:bg-secondary/50 file:cursor-pointer"
                />
                {importCodexFolder.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">{importCodexFolder.length} .md file(s) selected</p>
                )}
              </div>
            </div>
            {importProgress && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Importing {importProgress.done} / {importProgress.total}…
              </div>
            )}

            {importResult && (
              <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-foreground">
                {importResult}
              </div>
            )}
            {importError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {importError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
              <Button
                onClick={handleImport}
                disabled={
                  importPending ||
                  (!importStoryFile && !importCodexFile && importCodexFolder.length === 0) ||
                  (importMode === "existing" && importTargetId === "") ||
                  (importMode === "new" && !importNewTitle.trim())
                }
              >
                {importPending ? "Importing…" : "Import"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── New project dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("dash_new_project")}</DialogTitle>
            <DialogDescription>{t("dash_project_subtitle")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="title">{t("dash_project_title")}</Label>
              <Input
                id="title"
                placeholder="My Novel"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="desc">
                {t("dash_project_desc")} <span className="text-muted-foreground font-normal">{t("dash_desc_optional")}</span>
              </Label>
              <Textarea
                id="desc"
                placeholder="A brief synopsis..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("dash_codex_section")}</Label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setCodexOption("fresh")}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs transition-colors",
                    codexOption === "fresh"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
                  )}
                >
                  <Sparkles className="h-5 w-5" />
                  <span className="font-medium">{t("dash_fresh_codex")}</span>
                  <span className="text-[10px] opacity-70 text-center">{t("dash_fresh_codex_desc")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCodexOption("copy")}
                  disabled={otherProjects.length === 0}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs transition-colors",
                    codexOption === "copy"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground",
                    otherProjects.length === 0 && "opacity-40 cursor-not-allowed"
                  )}
                >
                  <BookCopy className="h-5 w-5" />
                  <span className="font-medium">{t("dash_copy_codex")}</span>
                  <span className="text-[10px] opacity-70 text-center">{t("dash_copy_codex_desc")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCodexOption("share")}
                  disabled={otherProjects.length === 0}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs transition-colors",
                    codexOption === "share"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground",
                    otherProjects.length === 0 && "opacity-40 cursor-not-allowed"
                  )}
                >
                  <Link2 className="h-5 w-5" />
                  <span className="font-medium">{t("dash_share_codex")}</span>
                  <span className="text-[10px] opacity-70 text-center">{t("dash_share_codex_desc")}</span>
                </button>
              </div>

              {codexOption === "copy" && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("dash_copy_from")}</Label>
                  <select
                    value={copyFromId}
                    onChange={(e) => setCopyFromId(e.target.value === "" ? "" : Number(e.target.value))}
                    className={cn(
                      "w-full h-9 rounded-md border border-input bg-background px-3 text-sm",
                      "focus:outline-none focus:ring-1 focus:ring-ring"
                    )}
                  >
                    <option value="">{t("common_select_project")}</option>
                    {otherProjects.map((p) => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground pt-0.5">{t("dash_copy_note")}</p>
                </div>
              )}

              {codexOption === "share" && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("dash_share_from")}</Label>
                  <select
                    value={shareFromId}
                    onChange={(e) => setShareFromId(e.target.value === "" ? "" : Number(e.target.value))}
                    className={cn(
                      "w-full h-9 rounded-md border border-input bg-background px-3 text-sm",
                      "focus:outline-none focus:ring-1 focus:ring-ring"
                    )}
                  >
                    <option value="">{t("common_select_project")}</option>
                    {otherProjects.map((p) => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground pt-0.5">{t("dash_share_note")}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common_cancel")}</Button>
              <Button
                onClick={handleCreate}
                disabled={
                  !title.trim() ||
                  createProject.isPending ||
                  (codexOption === "copy" && copyFromId === "") ||
                  (codexOption === "share" && shareFromId === "")
                }
              >
                {createProject.isPending ? t("dash_creating") : t("dash_create_project")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation dialog ── */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteConfirm(""); setDeleteError(null); } }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <TriangleAlert className="h-5 w-5 shrink-0" />
              {t("dash_delete_project")}
            </DialogTitle>
            <DialogDescription>
              {t("dash_delete_warning", { title: deleteTarget?.title ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            {deleteError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {deleteError}
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {t("dash_type_delete")}
              </Label>
              <Input
                value={deleteConfirm}
                onChange={(e) => { setDeleteConfirm(e.target.value); setDeleteError(null); }}
                onKeyDown={async (e) => {
                  if (e.key === "Enter" && deleteConfirm === "DELETE" && deleteTarget) {
                    try {
                      await deleteProject.mutateAsync(deleteTarget.id);
                      setDeleteTarget(null);
                      setDeleteConfirm("");
                      setDeleteError(null);
                    } catch (err) {
                      setDeleteError(err instanceof Error ? err.message.replace(/^\d+: /, "") : t("dash_delete_failed"));
                    }
                  }
                }}
                placeholder="DELETE"
                autoFocus
                className="font-mono"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteConfirm(""); setDeleteError(null); }}>
                {t("common_cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={deleteConfirm !== "DELETE" || deleteProject.isPending}
                onClick={async () => {
                  if (!deleteTarget) return;
                  try {
                    await deleteProject.mutateAsync(deleteTarget.id);
                    setDeleteTarget(null);
                    setDeleteConfirm("");
                    setDeleteError(null);
                  } catch (err) {
                    setDeleteError(err instanceof Error ? err.message.replace(/^\d+: /, "") : t("dash_delete_failed"));
                  }
                }}
              >
                {t("dash_delete_project")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AchievementToastQueue />
    </div>
  );
}
