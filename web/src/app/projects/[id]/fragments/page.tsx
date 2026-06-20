"use client";

import { useState, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  Plus, Trash2, X, Check, GripVertical,
  Lightbulb, Archive, Scissors, MoreHorizontal,
  LayoutGrid, List, Microscope, Camera,
  Link as LinkIcon, ExternalLink, RefreshCw, Film, Tag, Loader2, FileText,
  FileUp, Maximize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  useFragmentTabs, useUpdateFragmentTabs,
  useFragments, useCreateFragment, useUpdateFragment, useDeleteFragment,
  useResearch, useCreateResearch, useUpdateResearch, useDeleteResearch,
  useRefetchResearchUrl, useUploadResearchMedia, useDeleteResearchMedia,
} from "@/store/queries";
import { imagesApi } from "@/lib/api";
import type { Fragment as FragmentItem, ResearchItem, ResearchMedia } from "@/types";
import { BUILTIN_TABS } from "@/types";
import { cn } from "@/lib/utils";
import { FragmentImportButton } from "@/components/fragments/FragmentImportButton";

// ── Constants ─────────────────────────────────────────────────────────────────

const RESEARCH_TAB = "research";

// ── Clipping dialog (add / edit) ──────────────────────────────────────────────

function ClippingDialog({
  open, onClose, projectId, initial,
}: {
  open: boolean;
  onClose: () => void;
  projectId: number;
  initial?: ResearchItem | null;
}) {
  const [title, setTitle]       = useState(initial?.title ?? "");
  const [url, setUrl]           = useState(initial?.url ?? "");
  const [text, setText]         = useState(initial?.text_content ?? "");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags]         = useState<string[]>(initial?.tags ?? []);
  const [saving, setSaving]     = useState(false);

  // Gallery state
  // pending: new files to upload on save, with local preview URLs
  const [pending, setPending]       = useState<Array<{ file: File; preview: string; kind: 'image' | 'pdf' }>>([]);
  // ids of existing media items the user wants to remove on save
  const [removingIds, setRemovingIds] = useState<number[]>([]);
  // index within the combined (existing + pending) list
  const [activeIdx, setActiveIdx]   = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const createResearch = useCreateResearch(projectId);
  const updateResearch = useUpdateResearch(projectId);
  const uploadMedia    = useUploadResearchMedia(projectId);
  const deleteMedia    = useDeleteResearchMedia(projectId);

  // Reset when dialog opens or switches item
  useEffect(() => {
    if (open) {
      setTitle(initial?.title ?? "");
      setUrl(initial?.url ?? "");
      setText(initial?.text_content ?? "");
      setTags(initial?.tags ?? []);
      setTagInput("");
      pending.forEach(p => URL.revokeObjectURL(p.preview));
      setPending([]);
      setRemovingIds([]);
      setActiveIdx(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => pending.forEach(p => URL.revokeObjectURL(p.preview));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Combined gallery: existing (not removed) + pending
  const existingMedia = (initial?.media ?? []).filter(m => !removingIds.includes(m.id));
  const totalCount    = existingMedia.length + pending.length;
  const safeIdx       = Math.min(activeIdx, Math.max(0, totalCount - 1));

  const addFile = (file: File) => {
    const isImage = file.type.startsWith("image/") && file.type !== "image/svg+xml";
    const isPdf   = file.type === "application/pdf";
    if (!isImage && !isPdf) return;
    const kind    = isPdf ? "pdf" : "image";
    const preview = isImage ? URL.createObjectURL(file) : "";
    setPending(prev => [...prev, { file, preview, kind }]);
    setActiveIdx(existingMedia.length + pending.length); // point to the new item
  };

  const pickImage = () => {
    const input = document.createElement("input");
    input.type = "file"; input.multiple = true;
    input.accept = "image/jpeg,image/png,image/webp,image/gif,image/avif";
    input.onchange = () => { Array.from(input.files ?? []).forEach(addFile); };
    input.click();
  };

  const pickPdf = () => {
    const input = document.createElement("input");
    input.type = "file"; input.multiple = true;
    input.accept = "application/pdf";
    input.onchange = () => { Array.from(input.files ?? []).forEach(addFile); };
    input.click();
  };

  // Global paste listener — appends image to gallery, no text-paste interference
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith("image/"));
      if (!item) return;
      const file = item.getAsFile();
      if (file) { e.preventDefault(); addFile(file); }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existingMedia.length, pending.length]);

  const removeAt = (idx: number) => {
    if (idx < existingMedia.length) {
      setRemovingIds(prev => [...prev, existingMedia[idx].id]);
    } else {
      const pi = idx - existingMedia.length;
      URL.revokeObjectURL(pending[pi].preview);
      setPending(prev => prev.filter((_, i) => i !== pi));
    }
    setActiveIdx(idx => Math.max(0, idx - 1));
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (!t || tags.includes(t)) { setTagInput(""); return; }
    const next = [...tags, t];
    setTags(next);
    setTagInput("");
    if (initial) updateResearch.mutate({ id: initial.id, data: { tags: next } });
  };

  const removeTagFromDialog = (tag: string) => {
    const next = tags.filter((x) => x !== tag);
    setTags(next);
    if (initial) updateResearch.mutate({ id: initial.id, data: { tags: next } });
  };

  const handleSave = async () => {
    // Flush any tag typed but not yet committed via Enter / Add button
    const pendingTag = tagInput.trim().toLowerCase();
    const finalTags = pendingTag && !tags.includes(pendingTag)
      ? [...tags, pendingTag]
      : tags;

    setSaving(true);
    try {
      const payload = {
        title: title.trim() || undefined,
        url: url.trim() || undefined,
        text_content: text.trim() || undefined,
        tags: finalTags,
      };
      let itemId: number;
      if (initial) {
        await updateResearch.mutateAsync({ id: initial.id, data: payload });
        itemId = initial.id;
        for (const id of removingIds) await deleteMedia.mutateAsync(id);
      } else {
        const created = await createResearch.mutateAsync(payload);
        itemId = created.id;
      }
      for (const p of pending) await uploadMedia.mutateAsync({ id: itemId, file: p.file });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const canSave = !saving && (!!title.trim() || !!url.trim() || !!text.trim() || totalCount > 0);

  // Render the active item in the main preview area
  const renderActivePreview = () => {
    if (totalCount === 0) {
      return (
        <div
          className={cn(
            "h-[min(60vh,480px)] flex flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed text-xs transition-colors cursor-pointer",
            isDragOver ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/50 hover:text-primary",
          )}
          onClick={pickImage}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
          onDrop={(e) => { e.preventDefault(); setIsDragOver(false); Array.from(e.dataTransfer.files).forEach(addFile); }}
        >
          <Camera className="h-5 w-5" />
          <span className="text-center px-2 leading-tight">{isDragOver ? "Drop here" : "Click or drop"}</span>
          <span className="text-[10px] opacity-50">Images or PDFs · Ctrl+V to paste</span>
        </div>
      );
    }

    let src: string | null = null;
    let isPdf = false;
    let pdfName = "";

    if (safeIdx < existingMedia.length) {
      const m = existingMedia[safeIdx];
      isPdf = m.kind === "pdf";
      if (isPdf) pdfName = m.path.split("/").pop() ?? "document.pdf";
      else src = imagesApi.url(m.path);
    } else {
      const p = pending[safeIdx - existingMedia.length];
      isPdf = p.kind === "pdf";
      if (isPdf) pdfName = p.file.name;
      else src = p.preview;
    }

    return (
      <div className="relative h-[min(60vh,480px)] rounded-md overflow-hidden bg-secondary/30 group/prev">
        {isPdf ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <FileText className="h-8 w-8" />
            <span className="text-xs text-center px-3 leading-tight break-all">{pdfName}</span>
          </div>
        ) : src ? (
          <img src={src} alt="" className="w-full h-full object-cover" />
        ) : null}
        {/* Remove button */}
        <button
          type="button"
          className="absolute top-1.5 right-1.5 p-1 rounded bg-black/60 text-white hover:bg-red-600/80 opacity-0 group-hover/prev:opacity-100 transition-opacity"
          onClick={() => removeAt(safeIdx)}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-[80vw] max-w-5xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Clipping" : "Add Clipping"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[minmax(0,420px)_1fr] gap-6">
          {/* ── Left: text fields ── */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Title (optional)</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Label this clipping…" />
            </div>
            <div className="space-y-1.5">
              <Label>URL (optional)</Label>
              <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" type="url" />
              <p className="text-xs text-muted-foreground">Title and preview will be auto-fetched from the page.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Text excerpt (optional)</Label>
              <textarea
                value={text} onChange={e => setText(e.target.value)}
                placeholder="Paste a passage, quote, or note…" rows={5}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tags</Label>
              <div className="flex gap-2">
                <Input value={tagInput} onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                  placeholder="Add tag…" />
                <Button type="button" variant="outline" size="sm" onClick={addTag}>Add</Button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {tags.map(t => (
                    <span key={t} className="flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      {t}
                      <button onClick={() => removeTagFromDialog(t)}><X className="h-2.5 w-2.5" /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Right: media gallery ── */}
          <div className="space-y-2">
            <Label>Media</Label>

            {/* Main preview */}
            {renderActivePreview()}

            {/* URL image fallback (only when no uploaded media) */}
            {totalCount === 0 && initial?.url_image && (
              <div className="rounded-md overflow-hidden border border-border">
                <img src={initial.url_image} alt="" className="w-full object-cover" />
              </div>
            )}

            {/* Thumbnail strip */}
            {totalCount > 1 && (
              <div className="flex gap-1 overflow-x-auto pb-0.5">
                {existingMedia.map((m, i) => (
                  <button
                    key={m.id} type="button"
                    onClick={() => setActiveIdx(i)}
                    className={cn(
                      "relative shrink-0 w-10 h-14 rounded overflow-hidden border-2 transition-colors",
                      safeIdx === i ? "border-primary" : "border-transparent opacity-60 hover:opacity-100",
                    )}
                  >
                    {m.kind === "pdf"
                      ? <div className="w-full h-full bg-secondary flex items-center justify-center"><FileText className="h-4 w-4 text-muted-foreground" /></div>
                      : <img src={imagesApi.url(m.path)} alt="" className="w-full h-full object-cover" />}
                  </button>
                ))}
                {pending.map((p, pi) => {
                  const i = existingMedia.length + pi;
                  return (
                    <button
                      key={`p${pi}`} type="button"
                      onClick={() => setActiveIdx(i)}
                      className={cn(
                        "relative shrink-0 w-10 h-14 rounded overflow-hidden border-2 transition-colors",
                        safeIdx === i ? "border-primary" : "border-transparent opacity-60 hover:opacity-100",
                      )}
                    >
                      {p.kind === "pdf"
                        ? <div className="w-full h-full bg-secondary flex items-center justify-center"><FileText className="h-4 w-4 text-muted-foreground" /></div>
                        : <img src={p.preview} alt="" className="w-full h-full object-cover" />}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Add buttons */}
            <div className="flex gap-1">
              <button type="button" onClick={pickImage}
                className="flex-1 flex items-center justify-center gap-1 rounded border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors">
                <Camera className="h-3 w-3" /> Image
              </button>
              <button type="button" onClick={pickPdf}
                className="flex-1 flex items-center justify-center gap-1 rounded border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors">
                <FileUp className="h-3 w-3" /> PDF
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : initial ? "Save" : "Add Clipping"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Clipping card ─────────────────────────────────────────────────────────────

// ── PDF popup (react-pdf / PDF.js canvas renderer) ───────────────────────────

function PdfPopup({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const [Document, setDocument] = useState<React.ComponentType<any> | null>(null);
  const [Page, setPage]         = useState<React.ComponentType<any> | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNum, setPageNum]   = useState(1);
  const [width, setWidth]       = useState(700);
  const containerRef = useRef<HTMLDivElement>(null);

  // Dynamically import react-pdf (avoids SSR issues and loads PDF.js lazily)
  useEffect(() => {
    import("react-pdf").then(({ Document: D, Page: P, pdfjs }) => {
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      setDocument(() => D);
      setPage(() => P);
    });
  }, []);

  // Size the PDF to the container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - 32));
    ro.observe(el);
    setWidth(el.clientWidth - 32);
    return () => ro.disconnect();
  }, [Document]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-background rounded-lg shadow-2xl flex flex-col"
        style={{ width: "min(90vw, 860px)", height: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
          <span className="text-sm font-medium truncate flex-1">{name}</span>
          <div className="flex items-center gap-3 ml-4 shrink-0">
            {numPages > 1 && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <button className="px-1.5 py-0.5 rounded hover:bg-secondary disabled:opacity-40" onClick={() => setPageNum(p => Math.max(1, p - 1))} disabled={pageNum <= 1}>‹</button>
                <span>{pageNum} / {numPages}</span>
                <button className="px-1.5 py-0.5 rounded hover:bg-secondary disabled:opacity-40" onClick={() => setPageNum(p => Math.min(numPages, p + 1))} disabled={pageNum >= numPages}>›</button>
              </div>
            )}
            <button className="p-1 rounded hover:bg-secondary" onClick={onClose}><X className="h-4 w-4" /></button>
          </div>
        </div>
        {/* PDF canvas */}
        <div ref={containerRef} className="flex-1 overflow-y-auto p-4 flex flex-col items-center">
          {Document && Page ? (
            <Document
              file={url}
              onLoadSuccess={({ numPages: n }: { numPages: number }) => setNumPages(n)}
              loading={<Loader2 className="h-6 w-6 animate-spin text-muted-foreground mt-8" />}
            >
              <Page pageNumber={pageNum} width={width} renderTextLayer={false} renderAnnotationLayer={false} />
            </Document>
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mt-8" />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Clipping card ─────────────────────────────────────────────────────────────

function ClippingCard({
  item, projectId, onEdit, onTagClick,
}: { item: ResearchItem; projectId: number; onEdit: (item: ResearchItem) => void; onTagClick?: (tag: string) => void }) {
  const [isDragOver, setIsDragOver]   = useState(false);
  const [isHovered, setIsHovered]     = useState(false);
  const [activeIdx, setActiveIdx]     = useState(0);
  const [lightbox, setLightbox]       = useState(false);
  const [pdfOpen, setPdfOpen]         = useState<number | null>(null);
  const [addingTag, setAddingTag]     = useState(false);
  const [tagInput, setTagInput]       = useState("");
  const tagInputRef                   = useRef<HTMLInputElement>(null);

  const deleteItem   = useDeleteResearch(projectId);
  const updateItem   = useUpdateResearch(projectId);
  const refetchUrl   = useRefetchResearchUrl(projectId);
  const uploadMedia  = useUploadResearchMedia(projectId);
  const deleteMedia  = useDeleteResearchMedia(projectId);

  const commitTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !item.tags.includes(t)) {
      updateItem.mutate({ id: item.id, data: { tags: [...item.tags, t] } });
    }
    setTagInput("");
    setAddingTag(false);
  };

  const removeTag = (tag: string) => {
    updateItem.mutate({ id: item.id, data: { tags: item.tags.filter((t) => t !== tag) } });
  };

  const displayTitle  = item.title || item.url_title || item.url || "Untitled";
  const uploadedMedia = item.media;
  const count         = uploadedMedia.length;
  // Keep activeIdx in bounds when media list changes (e.g. after delete)
  const safeIdx       = count > 0 ? Math.min(activeIdx, count - 1) : 0;
  const activeMedia   = uploadedMedia[safeIdx] ?? null;

  // Fallback image from scraped URL when no uploaded media
  const urlFallback   = !count && item.url_image ? item.url_image : null;

  const handleFile = (file: File) => {
    const isImage = file.type.startsWith("image/") && file.type !== "image/svg+xml";
    const isPdf   = file.type === "application/pdf";
    if (!isImage && !isPdf) return;
    uploadMedia.mutate({ id: item.id, file }, {
      onSuccess: () => setActiveIdx(count), // new item will be last
    });
  };

  const handleAddFile = (accept: string) => {
    const input = document.createElement("input");
    input.type = "file"; input.multiple = true; input.accept = accept;
    input.onchange = () => { Array.from(input.files ?? []).forEach(handleFile); };
    input.click();
  };

  useEffect(() => {
    if (addingTag) tagInputRef.current?.focus();
  }, [addingTag]);

  // Close lightbox / PDF on Escape
  useEffect(() => {
    if (!lightbox && pdfOpen === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setLightbox(false); setPdfOpen(null); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightbox, pdfOpen]);

  // Paste — appends to gallery, only when card is hovered
  useEffect(() => {
    if (!isHovered) return;
    const onPaste = (e: ClipboardEvent) => {
      const imgItem = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith("image/"));
      if (!imgItem) return;
      const file = imgItem.getAsFile();
      if (file) { e.preventDefault(); handleFile(file); }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHovered, item.id, count]);

  const prev = () => setActiveIdx(i => Math.max(0, i - 1));
  const next = () => setActiveIdx(i => Math.min(count - 1, i + 1));

  // ── Media area ────────────────────────────────────────────────────────────────
  const renderMediaArea = () => {
    if (!activeMedia && !urlFallback) {
      return (
        <div
          className="opacity-0 group-hover:opacity-100 transition-opacity aspect-[3/4] rounded-md border-2 border-dashed border-border/40 flex flex-col items-center justify-center gap-1 cursor-pointer"
          onClick={() => handleAddFile("image/jpeg,image/png,image/webp,image/gif,image/avif")}
        >
          {uploadMedia.isPending
            ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            : <Camera className="h-4 w-4 text-muted-foreground/50" />}
          <span className="text-[10px] text-muted-foreground/50">Add image or PDF · Ctrl+V to paste</span>
        </div>
      );
    }

    const isActivePdf = activeMedia?.kind === "pdf";
    const imgSrc = !isActivePdf && activeMedia ? imagesApi.url(activeMedia.path) : urlFallback;

    return (
      <>
        <div className="relative rounded-md overflow-hidden bg-secondary/30 aspect-[3/4] group/media">
          {isActivePdf ? (
            <button
              className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setPdfOpen(activeMedia!.id)}
            >
              <FileText className="h-8 w-8" />
              <span className="text-[10px] text-center px-2 leading-tight break-all">
                {activeMedia!.path.split("/").pop()}
              </span>
            </button>
          ) : imgSrc ? (
            <img src={imgSrc} alt="" className="w-full h-full object-contain" />
          ) : null}

          {/* Hover overlay */}
          <div className="absolute inset-0 opacity-0 group-hover/media:opacity-100 transition-opacity pointer-events-none">
            <div className="absolute inset-0 bg-black/40" />
          </div>

          {/* Top-right: enlarge + remove */}
          <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover/media:opacity-100 transition-opacity">
            {!isActivePdf && imgSrc && (
              <button
                className="p-1.5 rounded bg-black/60 text-white hover:bg-black/80"
                title="Enlarge"
                onClick={() => setLightbox(true)}
              >
                <Maximize2 className="h-3 w-3" />
              </button>
            )}
            {activeMedia && (
              <button
                className="p-1.5 rounded bg-black/60 text-white hover:bg-red-600/80"
                title="Remove"
                onClick={() => deleteMedia.mutate(activeMedia.id)}
                disabled={deleteMedia.isPending}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Left / right navigation arrows */}
          {count > 1 && (
            <>
              <button
                className="absolute left-1 top-1/2 -translate-y-1/2 p-1 rounded bg-black/50 text-white hover:bg-black/70 opacity-0 group-hover/media:opacity-100 transition-opacity disabled:opacity-0"
                onClick={prev} disabled={safeIdx === 0}
              >‹</button>
              <button
                className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded bg-black/50 text-white hover:bg-black/70 opacity-0 group-hover/media:opacity-100 transition-opacity disabled:opacity-0"
                onClick={next} disabled={safeIdx === count - 1}
              >›</button>
            </>
          )}

          {/* Bottom-left: add more + paste hint */}
          <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 opacity-0 group-hover/media:opacity-100 transition-opacity">
            <button
              className="p-1.5 rounded bg-black/60 text-white hover:bg-black/80"
              title="Add image"
              onClick={() => handleAddFile("image/jpeg,image/png,image/webp,image/gif,image/avif")}
            ><Camera className="h-3 w-3" /></button>
            <button
              className="p-1.5 rounded bg-black/60 text-white hover:bg-black/80"
              title="Add PDF"
              onClick={() => handleAddFile("application/pdf")}
            ><FileUp className="h-3 w-3" /></button>
            <span className="text-[9px] text-white/60 ml-0.5 select-none">Ctrl+V</span>
          </div>
        </div>

        {/* Dot indicators */}
        {count > 1 && (
          <div className="flex items-center justify-center gap-1">
            {uploadedMedia.map((_, i) => (
              <button
                key={i}
                onClick={() => setActiveIdx(i)}
                className={cn(
                  "rounded-full transition-colors",
                  i === safeIdx ? "w-2 h-2 bg-primary" : "w-1.5 h-1.5 bg-border hover:bg-muted-foreground",
                )}
              />
            ))}
          </div>
        )}

        {/* Lightbox for images */}
        {lightbox && imgSrc && !isActivePdf && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setLightbox(false)}
          >
            <img
              src={imgSrc} alt=""
              className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
              onClick={e => e.stopPropagation()}
            />
            <button
              className="absolute top-4 right-4 p-2 rounded-full bg-black/60 text-white hover:bg-black/80"
              onClick={() => setLightbox(false)}
            ><X className="h-5 w-5" /></button>
          </div>
        )}

        {/* PDF popup */}
        {pdfOpen !== null && (() => {
          const m = uploadedMedia.find(x => x.id === pdfOpen);
          return m ? (
            <PdfPopup
              url={imagesApi.url(m.path)}
              name={m.path.split("/").pop() ?? "document.pdf"}
              onClose={() => setPdfOpen(null)}
            />
          ) : null;
        })()}
      </>
    );
  };

  return (
    <div
      className={cn(
        "group bg-card border rounded-lg p-4 flex flex-col gap-3 hover:shadow-sm transition-all",
        isDragOver ? "border-primary ring-1 ring-primary" : "border-border hover:border-border/60",
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
      onDrop={(e) => { e.preventDefault(); setIsDragOver(false); Array.from(e.dataTransfer.files).forEach(handleFile); }}
    >
      {renderMediaArea()}

      {/* Title + actions */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <button
            className="font-medium text-sm leading-snug line-clamp-2 text-left hover:text-primary transition-colors cursor-pointer"
            onClick={() => onEdit(item)}
          >{displayTitle}</button>
          {item.url && (
            <a
              href={item.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-primary/70 hover:text-primary mt-0.5 truncate max-w-full"
            >
              <LinkIcon className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{item.url}</span>
              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
            </a>
          )}
        </div>
        <div className="opacity-0 group-hover:opacity-100 flex gap-1 shrink-0 transition-opacity">
          {item.url && (
            <button
              className="p-1 hover:text-primary text-muted-foreground rounded"
              title="Re-fetch URL metadata"
              onClick={() => refetchUrl.mutate(item.id)}
              disabled={refetchUrl.isPending}
            >
              <RefreshCw className={cn("h-3 w-3", refetchUrl.isPending && "animate-spin")} />
            </button>
          )}
          <button className="p-1 hover:text-primary text-muted-foreground rounded" onClick={() => onEdit(item)}>
            <FileText className="h-3 w-3" />
          </button>
          <button
            className="p-1 hover:text-destructive text-muted-foreground rounded"
            onClick={() => { if (confirm("Delete this clipping?")) deleteItem.mutate(item.id); }}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {item.url_description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{item.url_description}</p>
      )}
      {item.text_content && (
        <blockquote className="border-l-2 border-primary/30 pl-3 text-xs text-muted-foreground italic line-clamp-4">
          {item.text_content}
        </blockquote>
      )}
      <div className="flex flex-wrap gap-1 items-center">
        {item.tags.map((t) => (
          <span key={t} className="group/tag inline-flex items-center gap-0.5 text-[10px] bg-primary/10 text-primary rounded-full">
            <button
              onClick={() => onTagClick?.(t)}
              className="pl-1.5 pr-0.5 py-px hover:bg-primary/25 rounded-l-full transition-colors"
            >
              {t}
            </button>
            <button
              onClick={() => removeTag(t)}
              className="pr-1 pl-0 py-px opacity-0 group-hover/tag:opacity-100 hover:text-destructive transition-opacity rounded-r-full"
              title="Remove tag"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}

        {addingTag ? (
          <input
            ref={tagInputRef}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onBlur={commitTag}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitTag(); }
              if (e.key === "Escape") { setTagInput(""); setAddingTag(false); }
            }}
            placeholder="tag…"
            className="text-[10px] bg-secondary/60 border border-border rounded px-1.5 py-0.5 focus:outline-none w-20"
          />
        ) : (
          <button
            onClick={() => setAddingTag(true)}
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded transition-colors",
              item.tags.length > 0
                ? "text-muted-foreground/40 hover:text-muted-foreground hover:bg-secondary/60 opacity-0 group-hover:opacity-100"
                : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-secondary/60"
            )}
          >
            + tag
          </button>
        )}
      </div>

      {/* Link chips */}
      <div className="flex flex-wrap gap-1 mt-auto">
        {item.linked_scene_id && (
          <span className="inline-flex items-center gap-1 text-[10px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground">
            <Film className="h-2.5 w-2.5" /> Scene #{item.linked_scene_id}
          </span>
        )}
        {item.linked_codex_id && (
          <span className="inline-flex items-center gap-1 text-[10px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground">
            <Tag className="h-2.5 w-2.5" /> Codex #{item.linked_codex_id}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function fragmentLabel(fragment: FragmentItem): { text: string; derived: boolean } {
  if (fragment.title) return { text: fragment.title, derived: false };
  const plain = stripHtml(fragment.content ?? "").trim();
  if (!plain) return { text: "Untitled", derived: false };
  const sentence = plain.split(/[.!?\n]/)[0].trim();
  const label = sentence.length > 60 ? sentence.slice(0, 60) + "…" : sentence;
  return { text: label || "Untitled", derived: true };
}

function TabIcon({ tab, className }: { tab: string; className?: string }) {
  if (tab === RESEARCH_TAB) return <Microscope className={cn("h-3.5 w-3.5", className)} />;
  if (tab === "snippets")   return <Scissors   className={cn("h-3.5 w-3.5", className)} />;
  if (tab === "ideas")      return <Lightbulb  className={cn("h-3.5 w-3.5", className)} />;
  if (tab === "archive")    return <Archive    className={cn("h-3.5 w-3.5", className)} />;
  return <GripVertical className={cn("h-3.5 w-3.5", className)} />;
}

// ── Shared editing logic (hook) ───────────────────────────────────────────────

function useFragmentEdit(fragment: FragmentItem, projectId: number) {
  const updateFragment = useUpdateFragment(projectId);
  const deleteFragment = useDeleteFragment(projectId);

  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(fragment.title ?? "");
  const [localContent, setLocalContent] = useState(fragment.content ?? "");
  const [localCategory, setLocalCategory] = useState(fragment.category ?? "");
  const [editingCategory, setEditingCategory] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleContentSave = (val: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateFragment.mutate({ id: fragment.id, data: { content: val } });
    }, 800);
  };

  const commitTitle = () => {
    setEditingTitle(false);
    const next = localTitle.trim() || null;
    if (next !== fragment.title) {
      updateFragment.mutate({ id: fragment.id, data: { title: next } });
    }
  };

  const commitCategory = () => {
    setEditingCategory(false);
    const next = localCategory.trim() || null;
    if (next !== fragment.category) {
      updateFragment.mutate({ id: fragment.id, data: { category: next } });
    }
  };

  const moveToTab = (tab: string) => {
    updateFragment.mutate({ id: fragment.id, data: { tab } });
    setShowMove(false);
  };

  const wordCount = localContent.trim() ? localContent.trim().split(/\s+/).length : 0;

  return {
    editingTitle, setEditingTitle,
    localTitle, setLocalTitle,
    localContent, setLocalContent,
    localCategory, setLocalCategory,
    editingCategory, setEditingCategory,
    showMove, setShowMove,
    scheduleContentSave, commitTitle, commitCategory, moveToTab,
    wordCount, deleteFragment,
  };
}

// ── Fragment popup (focused editor) ──────────────────────────────────────────

function FragmentPopup({
  fragment, projectId, allTabs, onClose,
}: { fragment: FragmentItem; projectId: number; allTabs: string[]; onClose: () => void }) {
  const {
    editingTitle, setEditingTitle, localTitle, setLocalTitle,
    localContent, setLocalContent, localCategory, setLocalCategory,
    editingCategory, setEditingCategory, showMove, setShowMove,
    scheduleContentSave, commitTitle, commitCategory, moveToTab,
    wordCount, deleteFragment,
  } = useFragmentEdit(fragment, projectId);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { text: labelText, derived } = fragmentLabel({ ...fragment, title: fragment.title });

  // Focus textarea on open (unless title is being edited)
  useEffect(() => {
    if (!fragment.title) textareaRef.current?.focus();
  }, [fragment.title]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="flex flex-col gap-0 p-0 overflow-hidden max-w-2xl"
        style={{ height: "min(80vh, 640px)" }}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{fragment.title || "Fragment"}</DialogTitle>
        {/* Header */}
        <div className="shrink-0 flex items-center gap-2 pl-4 pr-10 py-3 border-b border-border">
          {editingTitle ? (
            <Input
              value={localTitle}
              onChange={(e) => setLocalTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") commitTitle(); }}
              className="h-7 text-sm px-2 flex-1"
              autoFocus
            />
          ) : (
            <button
              className="flex-1 text-left text-sm font-medium truncate min-h-[28px] hover:text-primary transition-colors"
              onDoubleClick={() => setEditingTitle(true)}
              title="Double-click to rename"
            >
              {fragment.title
                ? <span className="text-foreground/90">{fragment.title}</span>
                : <span className="text-muted-foreground italic">{derived ? labelText : "Untitled"}</span>
              }
            </button>
          )}
          <div className="flex items-center gap-0.5 shrink-0">
            <div className="relative">
              <button
                onClick={() => setShowMove((v) => !v)}
                className="text-muted-foreground hover:text-foreground p-1 rounded"
                title="Move to tab"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {showMove && (
                <div className="absolute right-0 top-8 z-20 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[130px]">
                  {allTabs.filter((t) => t !== fragment.tab).map((t) => (
                    <button
                      key={t}
                      onClick={() => { moveToTab(t); onClose(); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-secondary text-left capitalize"
                    >
                      <TabIcon tab={t} />
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => { deleteFragment.mutate(fragment.id); onClose(); }}
              className="text-muted-foreground hover:text-destructive p-1 rounded"
              title="Delete fragment"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <textarea
          ref={textareaRef}
          value={localContent}
          onChange={(e) => { setLocalContent(e.target.value); scheduleContentSave(e.target.value); }}
          placeholder="Write something…"
          className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none px-4 py-3 leading-relaxed"
        />

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-t border-border text-[10px] text-muted-foreground/60">
          <div className="flex items-center gap-2">
            <span>{new Date(fragment.updated_at).toLocaleDateString()}</span>
            {editingCategory ? (
              <input
                value={localCategory}
                onChange={e => setLocalCategory(e.target.value)}
                onBlur={commitCategory}
                onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") commitCategory(); }}
                placeholder="category…"
                className="text-[10px] bg-secondary/60 border border-border rounded px-1.5 py-0.5 focus:outline-none w-24"
                autoFocus
              />
            ) : (
              <button
                onClick={() => setEditingCategory(true)}
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded transition-colors",
                  localCategory
                    ? "bg-primary/15 text-primary hover:bg-primary/25"
                    : "text-muted-foreground/30 hover:text-muted-foreground hover:bg-secondary/60"
                )}
              >
                {localCategory || "+ label"}
              </button>
            )}
          </div>
          <span>{wordCount} words</span>
        </div>

        {showMove && <div className="fixed inset-0 z-10" onClick={() => setShowMove(false)} />}
      </DialogContent>
    </Dialog>
  );
}

// ── Fragment card (grid view) ─────────────────────────────────────────────────

function FragmentCard({
  fragment, projectId, allTabs,
}: { fragment: FragmentItem; projectId: number; allTabs: string[] }) {
  const [popupOpen, setPopupOpen] = useState(false);
  const {
    editingTitle, setEditingTitle, localTitle, setLocalTitle,
    localContent, setLocalContent, localCategory, setLocalCategory,
    editingCategory, setEditingCategory, showMove, setShowMove,
    scheduleContentSave, commitTitle, commitCategory, moveToTab,
    wordCount, deleteFragment,
  } = useFragmentEdit(fragment, projectId);

  const { text: labelText, derived } = fragmentLabel({ ...fragment, title: fragment.title });

  return (
    <>
      <div
        className={cn(
          "group relative bg-card border border-border rounded-lg flex flex-col h-56 transition-colors cursor-pointer",
          "hover:border-primary/40 hover:shadow-sm",
        )}
        onClick={() => setPopupOpen(true)}
      >
        {/* Header */}
        <div
          className="shrink-0 flex items-center gap-1.5 px-3 pt-3 pb-1.5 min-h-[36px]"
          onClick={(e) => e.stopPropagation()}
        >
          {editingTitle ? (
            <Input
              value={localTitle}
              onChange={(e) => setLocalTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") commitTitle(); }}
              className="h-6 text-xs px-1 flex-1"
              autoFocus
            />
          ) : (
            <span
              className="flex-1 text-xs font-medium truncate text-foreground/80"
              onDoubleClick={() => setEditingTitle(true)}
              title={fragment.title ?? undefined}
            >
              {fragment.title
                ? fragment.title
                : <span className="text-muted-foreground italic">{derived ? labelText : "Untitled"}</span>
              }
            </span>
          )}

          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); setPopupOpen(true); }}
              className="text-muted-foreground hover:text-foreground p-0.5 rounded"
              title="Expand"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setShowMove((v) => !v); }}
                className="text-muted-foreground hover:text-foreground p-0.5 rounded"
                title="Move to tab"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
              {showMove && (
                <div className="absolute right-0 top-6 z-20 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[130px]">
                  {allTabs.filter((t) => t !== fragment.tab).map((t) => (
                    <button
                      key={t}
                      onClick={(e) => { e.stopPropagation(); moveToTab(t); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-secondary text-left capitalize"
                    >
                      <TabIcon tab={t} />
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); deleteFragment.mutate(fragment.id); }}
              className="text-muted-foreground hover:text-destructive p-0.5 rounded"
              title="Delete fragment"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Scrollable content — click inside textarea doesn't bubble to card */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3">
          <textarea
            value={localContent}
            onChange={(e) => { setLocalContent(e.target.value); scheduleContentSave(e.target.value); }}
            placeholder="Click to expand…"
            className="w-full min-h-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none leading-relaxed"
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        {/* Footer */}
        <div
          className="shrink-0 flex items-center justify-between px-3 pb-2.5 pt-1.5 text-[10px] text-muted-foreground/50"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1.5">
            <span>{new Date(fragment.updated_at).toLocaleDateString()}</span>
            {editingCategory ? (
              <input
                value={localCategory}
                onChange={e => setLocalCategory(e.target.value)}
                onBlur={commitCategory}
                onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") commitCategory(); }}
                placeholder="category…"
                className="text-[10px] bg-secondary/60 border border-border rounded px-1.5 py-0.5 focus:outline-none w-24"
                autoFocus
              />
            ) : (
              <button
                onClick={() => setEditingCategory(true)}
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded transition-colors",
                  localCategory
                    ? "bg-primary/15 text-primary hover:bg-primary/25"
                    : "text-muted-foreground/30 hover:text-muted-foreground hover:bg-secondary/60"
                )}
              >
                {localCategory || "+ label"}
              </button>
            )}
          </div>
          <span>{wordCount} w</span>
        </div>

        {showMove && <div className="fixed inset-0 z-10" onClick={() => setShowMove(false)} />}
      </div>

      {popupOpen && (
        <FragmentPopup
          fragment={fragment}
          projectId={projectId}
          allTabs={allTabs}
          onClose={() => setPopupOpen(false)}
        />
      )}
    </>
  );
}

// ── Fragment row (list view) ──────────────────────────────────────────────────

function FragmentRow({
  fragment, projectId, allTabs, expanded, onToggle,
}: {
  fragment: FragmentItem; projectId: number; allTabs: string[];
  expanded: boolean; onToggle: () => void;
}) {
  const {
    editingTitle, setEditingTitle, localTitle, setLocalTitle,
    localContent, setLocalContent, localCategory, setLocalCategory,
    editingCategory, setEditingCategory, showMove, setShowMove,
    scheduleContentSave, commitTitle, commitCategory, moveToTab,
    wordCount, deleteFragment,
  } = useFragmentEdit(fragment, projectId);

  const contentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const el = contentRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [localContent, expanded]);

  const { text: labelText, derived } = fragmentLabel(fragment);

  const preview = (() => {
    const plain = stripHtml(fragment.content ?? "").trim();
    if (!plain || derived) return "";
    return plain.length > 120 ? plain.slice(0, 120) + "…" : plain;
  })();

  return (
    <div className="group border-b border-border last:border-b-0">
      <div
        className="flex items-center gap-2 px-3 py-2 hover:bg-secondary/30 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <svg
          className={cn("h-3 w-3 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>

        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          {editingTitle ? (
            <Input
              value={localTitle}
              onChange={(e) => setLocalTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") commitTitle(); e.stopPropagation(); }}
              onClick={(e) => e.stopPropagation()}
              className="h-6 text-xs px-1 w-48"
              autoFocus
            />
          ) : (
            <span
              className={cn("text-xs font-medium truncate", derived ? "text-muted-foreground italic" : "text-foreground/90")}
              onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }}
              title="Double-click to rename"
            >
              {labelText}
            </span>
          )}
          {preview && (
            <span className="text-[11px] text-muted-foreground/60 truncate hidden sm:block">{preview}</span>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[10px] text-muted-foreground/50 hidden md:block">{wordCount} words</span>
          {editingCategory ? (
            <input
              value={localCategory}
              onChange={e => setLocalCategory(e.target.value)}
              onBlur={commitCategory}
              onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Escape") commitCategory(); }}
              onClick={e => e.stopPropagation()}
              placeholder="category…"
              className="text-[10px] bg-secondary/60 border border-border rounded px-1.5 py-0.5 focus:outline-none w-20"
              autoFocus
            />
          ) : localCategory ? (
            <button
              onClick={e => { e.stopPropagation(); setEditingCategory(true); }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors hidden sm:block"
            >
              {localCategory}
            </button>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); setEditingCategory(true); }}
              className="text-[10px] px-1.5 py-0.5 rounded text-muted-foreground/30 hover:text-muted-foreground hover:bg-secondary/60 transition-colors opacity-0 group-hover:opacity-100 hidden sm:block"
              title="Set category"
            >
              + label
            </button>
          )}
          <span className="text-[10px] text-muted-foreground/50 hidden lg:block">
            {new Date(fragment.updated_at).toLocaleDateString()}
          </span>

          <div
            className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative">
              <button
                onClick={() => setShowMove((v) => !v)}
                className="text-muted-foreground hover:text-foreground p-1 rounded"
                title="Move to tab"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
              {showMove && (
                <div className="absolute right-0 top-7 z-20 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[130px]">
                  {allTabs
                    .filter((t) => t !== fragment.tab)
                    .map((t) => (
                      <button
                        key={t}
                        onClick={() => moveToTab(t)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-secondary text-left capitalize"
                      >
                        <TabIcon tab={t} />
                        {t}
                      </button>
                    ))}
                </div>
              )}
            </div>
            <button
              onClick={() => deleteFragment.mutate(fragment.id)}
              className="text-muted-foreground hover:text-destructive p-1 rounded"
              title="Delete fragment"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="px-8 pb-3 pt-1">
          <textarea
            ref={contentRef}
            value={localContent}
            onChange={(e) => { setLocalContent(e.target.value); scheduleContentSave(e.target.value); }}
            placeholder="Write something..."
            className="w-full resize-none bg-secondary/20 rounded-md text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring px-3 py-2 min-h-[80px] leading-relaxed"
            rows={4}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {showMove && <div className="fixed inset-0 z-10" onClick={() => setShowMove(false)} />}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type ViewMode = "grid" | "list";

export default function FragmentsPage() {
  const { id } = useParams();
  const projectId = Number(id);

  // Fragment data
  const { data: tabsData } = useFragmentTabs(projectId);
  const { data: fragments = [] } = useFragments(projectId);
  const updateTabs    = useUpdateFragmentTabs(projectId);
  const createFragment = useCreateFragment(projectId);

  // Research data
  const { data: researchItems = [], isLoading: researchLoading } = useResearch(projectId);

  const allTabs: string[]   = tabsData?.all ?? (BUILTIN_TABS as unknown as string[]);
  const customTabs: string[] = tabsData?.custom ?? [];

  // Research is always the first tab (not stored in DB — it's special)
  const allDisplayTabs = [RESEARCH_TAB, ...allTabs];

  const [activeTab, setActiveTab]           = useState(RESEARCH_TAB);
  const [addingTab, setAddingTab]           = useState(false);
  const [newTabName, setNewTabName]         = useState("");
  const [viewMode, setViewMode]             = useState<ViewMode>("grid");
  const [expandedId, setExpandedId]         = useState<number | null>(null);
  const [fragmentCategoryFilter, setFragmentCategoryFilter] = useState<string | null>(null);

  // Research search / filter state
  const [researchSearch, setResearchSearch]   = useState("");
  const [researchTagFilter, setResearchTagFilter] = useState<string[]>([]);

  // Clipping dialog state (accessible from any tab)
  const [clippingOpen, setClippingOpen]       = useState(false);
  const [editingClipping, setEditingClipping] = useState<ResearchItem | null>(null);

  // Keep active fragment tab valid when custom tabs change
  useEffect(() => {
    if (activeTab !== RESEARCH_TAB && allTabs.length > 0 && !allTabs.includes(activeTab)) {
      setActiveTab(allTabs[0]);
    }
  }, [allTabs, activeTab]);

  // Reset list expansion and category filter when tab / view mode changes
  useEffect(() => { setExpandedId(null); setFragmentCategoryFilter(null); }, [activeTab, viewMode]);

  // Derived research data
  const allResearchTags = [...new Set(researchItems.flatMap(i => i.tags))].sort();
  const filteredResearch = researchItems.filter(item => {
    if (researchTagFilter.length > 0 && !researchTagFilter.every(t => item.tags.includes(t))) return false;
    if (researchSearch) {
      const q = researchSearch.toLowerCase();
      return (
        item.title?.toLowerCase().includes(q) ||
        item.url_title?.toLowerCase().includes(q) ||
        item.url?.toLowerCase().includes(q) ||
        item.text_content?.toLowerCase().includes(q) ||
        item.tags.some(t => t.includes(q))
      );
    }
    return true;
  });

  // All fragments in the active tab — unfiltered (used for category pills)
  const rawTabFragments = fragments.filter((f) => f.tab === activeTab);
  const allTabCategories = [...new Set(
    rawTabFragments.filter((f) => f.category).map((f) => f.category as string)
  )].sort();

  // Apply category filter then sort newest first
  const tabFragments = (
    fragmentCategoryFilter
      ? rawTabFragments.filter((f) => f.category === fragmentCategoryFilter)
      : rawTabFragments
  ).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  const openAddClipping = () => { setEditingClipping(null); setClippingOpen(true); };
  const openEditClipping = (item: ResearchItem) => { setEditingClipping(item); setClippingOpen(true); };

  const handleAddTab = () => {
    const name = newTabName.trim().toLowerCase();
    if (!name || allTabs.includes(name)) return;
    updateTabs.mutate([...customTabs, name]);
    setNewTabName("");
    setAddingTab(false);
    setActiveTab(name);
  };

  const handleDeleteTab = (tab: string) => {
    const count = fragments.filter((f) => f.tab === tab).length;
    const msg = count > 0
      ? `Delete tab "${tab}"? Its ${count} fragment(s) will become inaccessible.`
      : `Delete tab "${tab}"?`;
    if (!confirm(msg)) return;
    updateTabs.mutate(customTabs.filter((t) => t !== tab));
    if (activeTab === tab) setActiveTab(RESEARCH_TAB);
  };

  const isResearch = activeTab === RESEARCH_TAB;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold">Fragments</h1>
          <p className="text-xs text-muted-foreground">
            {fragments.length} fragment{fragments.length !== 1 ? "s" : ""} · {researchItems.length} clipping{researchItems.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <FragmentImportButton projectId={projectId} />

          {/* View toggle — only for fragment tabs */}
          {!isResearch && (
            <div className="flex items-center rounded-md border border-border overflow-hidden mr-0.5">
              <button
                onClick={() => setViewMode("grid")}
                className={cn("p-1.5 transition-colors", viewMode === "grid" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50")}
                title="Grid view"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={cn("p-1.5 transition-colors", viewMode === "list" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50")}
                title="List view"
              >
                <List className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Add Clipping — always available regardless of active tab */}
          <Button
            size="sm"
            variant={isResearch ? "default" : "outline"}
            onClick={openAddClipping}
            className="gap-1.5 text-xs"
          >
            <Camera className="h-3.5 w-3.5" />
            Add Clipping
          </Button>

          {/* New Fragment — only on fragment tabs */}
          {!isResearch && (
            <Button
              size="sm"
              onClick={() => createFragment.mutate({ tab: activeTab })}
              className="gap-1.5 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              New fragment
            </Button>
          )}
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-0 border-b border-border shrink-0 overflow-x-auto">

        {/* Research tab — always first, always present */}
        <button
          onClick={() => setActiveTab(RESEARCH_TAB)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs rounded-t-md border-b-2 transition-colors shrink-0",
            isResearch
              ? "border-primary text-foreground font-medium"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Microscope className="h-3.5 w-3.5" />
          Research
          {researchItems.length > 0 && (
            <span className={cn(
              "text-[10px] rounded-full px-1.5 py-px",
              isResearch ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"
            )}>
              {researchItems.length}
            </span>
          )}
        </button>

        {/* Fragment tabs */}
        {allTabs.map((tab) => {
          const isBuiltin = (BUILTIN_TABS as readonly string[]).includes(tab);
          const count = fragments.filter((f) => f.tab === tab).length;
          const isActive = activeTab === tab;
          return (
            <div key={tab} className="flex items-center group/tab shrink-0">
              <button
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 text-xs rounded-t-md border-b-2 transition-colors capitalize",
                  isActive
                    ? "border-primary text-foreground font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <TabIcon tab={tab} />
                {tab}
                {count > 0 && (
                  <span className={cn(
                    "text-[10px] rounded-full px-1.5 py-px",
                    isActive ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"
                  )}>
                    {count}
                  </span>
                )}
              </button>
              {!isBuiltin && (
                <button
                  onClick={() => handleDeleteTab(tab)}
                  className="opacity-0 group-hover/tab:opacity-60 hover:!opacity-100 hover:text-destructive ml-0.5 mb-1"
                  title={`Delete tab "${tab}"`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}

        {/* Add custom tab */}
        {addingTab ? (
          <div className="flex items-center gap-1 ml-1 mb-1 shrink-0">
            <Input
              value={newTabName}
              onChange={(e) => setNewTabName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddTab();
                if (e.key === "Escape") { setAddingTab(false); setNewTabName(""); }
              }}
              placeholder="Tab name..."
              className="h-6 text-xs w-28 px-2"
              autoFocus
            />
            <button onClick={handleAddTab} className="text-primary hover:text-primary/80">
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => { setAddingTab(false); setNewTabName(""); }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAddingTab(true)}
            className="flex items-center gap-0.5 px-2 py-2 text-xs text-muted-foreground hover:text-foreground mb-px ml-1 shrink-0"
            title="Add custom tab"
          >
            <Plus className="h-3 w-3" />
            Add tab
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isResearch ? (
          /* ── Research grid ──────────────────────────────────────────────── */
          <div className="p-4 flex flex-col gap-4">
            {/* Search + tag filter */}
            {(researchItems.length > 0 || researchSearch) && (
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  className="max-w-xs h-8 text-sm"
                  placeholder="Search clippings…"
                  value={researchSearch}
                  onChange={e => setResearchSearch(e.target.value)}
                />
                {allResearchTags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => setResearchTagFilter(prev =>
                      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
                    )}
                    className={cn(
                      "text-xs px-2.5 py-1 rounded-full transition-colors",
                      researchTagFilter.includes(tag)
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    )}
                  >
                    {tag}
                  </button>
                ))}
                {(researchSearch || researchTagFilter.length > 0) && (
                  <button
                    onClick={() => { setResearchSearch(""); setResearchTagFilter([]); }}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                  >
                    <X className="h-3 w-3" /> Clear
                  </button>
                )}
              </div>
            )}

            {/* Grid */}
            {researchLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {[...Array(6)].map((_, i) => <div key={i} className="h-40 rounded-lg bg-card animate-pulse" />)}
              </div>
            ) : filteredResearch.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
                <Microscope className="h-8 w-8 opacity-20" />
                <div>
                  <p className="font-medium">
                    {researchItems.length === 0 ? "No clippings yet" : "No clippings match your filter"}
                  </p>
                  <p className="text-xs mt-1">
                    {researchItems.length === 0 && "Save URLs, images, quotes, or notes alongside your manuscript."}
                  </p>
                </div>
                {researchItems.length === 0 && (
                  <Button size="sm" variant="outline" onClick={openAddClipping}>
                    <Camera className="h-3.5 w-3.5 mr-1" />
                    Add Clipping
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {filteredResearch.map(item => (
                  <ClippingCard
                    key={item.id}
                    item={item}
                    projectId={projectId}
                    onEdit={openEditClipping}
                    onTagClick={(tag) => setResearchTagFilter((prev) =>
                      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                    )}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ── Fragment grid / list ────────────────────────────────────────── */
          <div className="p-4">
            {/* Category filter pills */}
            {allTabCategories.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap mb-3">
                {allTabCategories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setFragmentCategoryFilter((prev) => prev === cat ? null : cat)}
                    className={cn(
                      "text-xs px-2.5 py-1 rounded-full transition-colors",
                      fragmentCategoryFilter === cat
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    )}
                  >
                    {cat}
                  </button>
                ))}
                {fragmentCategoryFilter && (
                  <button
                    onClick={() => setFragmentCategoryFilter(null)}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                  >
                    <X className="h-3 w-3" /> Clear
                  </button>
                )}
              </div>
            )}

            {rawTabFragments.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-3 py-16">
                <TabIcon tab={activeTab} className="h-8 w-8 opacity-20" />
                <div>
                  <p className="font-medium capitalize">{activeTab} is empty</p>
                  <p className="text-xs mt-1">
                    {activeTab === "archive"
                      ? "Use the Archive button in the scene editor to send scenes here."
                      : "Click New fragment to add one."}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => createFragment.mutate({ tab: activeTab })}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  New fragment
                </Button>
              </div>
            ) : tabFragments.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-3 py-16">
                <TabIcon tab={activeTab} className="h-8 w-8 opacity-20" />
                <p className="font-medium">No fragments match "{fragmentCategoryFilter}"</p>
                <button
                  onClick={() => setFragmentCategoryFilter(null)}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                >
                  <X className="h-3 w-3" /> Clear filter
                </button>
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))" }}>
                {tabFragments.map((fragment) => (
                  <FragmentCard
                    key={fragment.id}
                    fragment={fragment}
                    projectId={projectId}
                    allTabs={allTabs}
                  />
                ))}
                <button
                  onClick={() => createFragment.mutate({ tab: activeTab })}
                  className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors min-h-[120px] text-xs"
                >
                  <Plus className="h-5 w-5" />
                  New fragment
                </button>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-card overflow-hidden">
                {tabFragments.map((fragment) => (
                  <FragmentRow
                    key={fragment.id}
                    fragment={fragment}
                    projectId={projectId}
                    allTabs={allTabs}
                    expanded={expandedId === fragment.id}
                    onToggle={() => setExpandedId(expandedId === fragment.id ? null : fragment.id)}
                  />
                ))}
                <div className="border-t border-border">
                  <button
                    onClick={() => createFragment.mutate({ tab: activeTab })}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground hover:text-primary hover:bg-secondary/30 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New fragment
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Clipping dialog — accessible from any tab */}
      <ClippingDialog
        open={clippingOpen}
        onClose={() => { setClippingOpen(false); setEditingClipping(null); }}
        projectId={projectId}
        initial={editingClipping}
      />
    </div>
  );
}
