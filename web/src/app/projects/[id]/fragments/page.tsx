"use client";

import { useState, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  Plus, Trash2, X, Check, GripVertical,
  Lightbulb, Archive, Scissors, MoreHorizontal,
  LayoutGrid, List, Microscope, Camera, ImageOff,
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
  useRefetchResearchUrl, useUploadResearchImage, useDeleteResearchImage,
  useUploadResearchPdf, useDeleteResearchPdf,
} from "@/store/queries";
import { imagesApi } from "@/lib/api";
import type { Fragment as FragmentItem, ResearchItem } from "@/types";
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

  // Image state
  const [pendingImage, setPendingImage]     = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  // PDF state
  const [pendingPdf, setPendingPdf]         = useState<File | null>(null);
  const [removingPdf, setRemovingPdf]       = useState(false);
  const [removingImage, setRemovingImage] = useState(false);

  const createResearch  = useCreateResearch(projectId);
  const updateResearch  = useUpdateResearch(projectId);
  const uploadImage     = useUploadResearchImage(projectId);
  const deleteImage     = useDeleteResearchImage(projectId);
  const uploadPdf       = useUploadResearchPdf(projectId);
  const deletePdf       = useDeleteResearchPdf(projectId);

  // Reset all fields when dialog opens or switches item
  useEffect(() => {
    if (open) {
      setTitle(initial?.title ?? "");
      setUrl(initial?.url ?? "");
      setText(initial?.text_content ?? "");
      setTags(initial?.tags ?? []);
      setTagInput("");
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
      setPendingImage(null);
      setPendingPreview(null);
      setRemovingImage(false);
      setPendingPdf(null);
      setRemovingPdf(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  // Revoke blob URL on unmount
  useEffect(() => {
    return () => { if (pendingPreview) URL.revokeObjectURL(pendingPreview); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The image currently shown in the preview area
  const dialogPreview = pendingPreview
    ?? (!removingImage && initial?.image_path ? imagesApi.url(initial.image_path) : null)
    ?? (!removingImage ? (initial?.url_image ?? null) : null);

  const [isDragOver, setIsDragOver] = useState(false);

  const setImageFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingImage(file);
    setPendingPreview(URL.createObjectURL(file));
    setRemovingImage(false);
  };

  const pickImage = () => {
    const input = document.createElement("input");
    input.type  = "file";
    input.accept = "image/jpeg,image/png,image/webp,image/gif";
    input.onchange = () => { if (input.files?.[0]) setImageFile(input.files[0]); };
    input.click();
  };

  // Global paste listener — intercepts only when clipboard contains an image.
  // Text-only pastes (e.g. into the title/url/tags fields) are unaffected.
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const imageItem = Array.from(e.clipboardData?.items ?? [])
        .find(i => i.type.startsWith("image/"));
      if (!imageItem) return;          // no image → let normal text paste happen
      const file = imageItem.getAsFile();
      if (file) { e.preventDefault(); setImageFile(file); }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [open]);

  const clearImage = () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingImage(null);
    setPendingPreview(null);
    if (initial?.image_path) setRemovingImage(true);
  };

  const pickPdf = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) { setPendingPdf(file); setRemovingPdf(false); }
    };
    input.click();
  };

  const clearPdf = () => {
    setPendingPdf(null);
    if (initial?.pdf_path) setRemovingPdf(true);
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) { setTags([...tags, t]); setTagInput(""); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        title: title.trim() || undefined,
        url: url.trim() || undefined,
        text_content: text.trim() || undefined,
        tags,
      };

      let itemId: number;
      if (initial) {
        await updateResearch.mutateAsync({ id: initial.id, data: payload });
        itemId = initial.id;
        // Remove existing uploaded image if user cleared it
        if (removingImage && initial.image_path) {
          await deleteImage.mutateAsync(initial.id);
        }
      } else {
        const created = await createResearch.mutateAsync(payload);
        itemId = created.id;
      }

      if (pendingImage) {
        await uploadImage.mutateAsync({ id: itemId, file: pendingImage });
      }
      if (removingPdf && initial?.pdf_path) {
        await deletePdf.mutateAsync(itemId);
      }
      if (pendingPdf) {
        await uploadPdf.mutateAsync({ id: itemId, file: pendingPdf });
      }

      onClose();
    } finally {
      setSaving(false);
    }
  };

  const canSave = !saving && (!!title.trim() || !!url.trim() || !!text.trim() || !!pendingImage || !!pendingPdf);

  const currentPdfName = pendingPdf?.name ?? (initial?.pdf_path ? initial.pdf_path.split("/").pop() : null);
  const hasPdf = !!pendingPdf || (!removingPdf && !!initial?.pdf_path);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Clipping" : "Add Clipping"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[1fr_200px] gap-6">
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
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Paste a passage, quote, or note…"
                rows={5}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Tags</Label>
              <div className="flex gap-2">
                <Input
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                  placeholder="Add tag…"
                />
                <Button type="button" variant="outline" size="sm" onClick={addTag}>Add</Button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {tags.map(t => (
                    <span key={t} className="flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      #{t}
                      <button onClick={() => setTags(tags.filter(x => x !== t))}><X className="h-2.5 w-2.5" /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Right: image + pdf + url preview ── */}
          <div className="space-y-3">
            {/* Image */}
            <div className="space-y-1.5">
              <Label>Image</Label>
              {dialogPreview ? (
                <div className="relative rounded-md overflow-hidden aspect-[3/4] bg-secondary/30 group/img">
                  <img src={dialogPreview} alt="" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 group-hover/img:opacity-100 bg-black/40 transition-opacity">
                    <button type="button" className="p-1.5 rounded bg-black/60 text-white hover:bg-black/80" onClick={pickImage}>
                      <Camera className="h-3.5 w-3.5" />
                    </button>
                    {(pendingImage || initial?.image_path) && (
                      <button type="button" className="p-1.5 rounded bg-black/60 text-white hover:bg-red-600/80" onClick={clearImage}>
                        <ImageOff className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div
                  className={cn(
                    "aspect-[3/4] flex flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed text-xs transition-colors cursor-pointer",
                    isDragOver ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/50 hover:text-primary",
                  )}
                  onClick={pickImage}
                  onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
                  onDrop={(e) => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer.files[0]; if (f) setImageFile(f); }}
                >
                  <Camera className="h-4 w-4" />
                  <span className="text-center px-2 leading-tight">
                    {isDragOver ? "Drop image" : removingImage ? "Removed" : "Click or drop"}
                  </span>
                  {!isDragOver && !removingImage && <span className="text-[10px] opacity-50">Ctrl+V to paste</span>}
                </div>
              )}
            </div>

            {/* PDF */}
            <div className="space-y-1.5">
              <Label>PDF</Label>
              {hasPdf ? (
                <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-2 py-1.5">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground truncate flex-1">{currentPdfName}</span>
                  <button type="button" className="text-muted-foreground hover:text-destructive" onClick={clearPdf}><X className="h-3 w-3" /></button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={pickPdf}
                  className="w-full flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
                >
                  <FileUp className="h-3.5 w-3.5" />
                  {removingPdf ? "Removed" : "Attach PDF"}
                </button>
              )}
            </div>

            {/* URL preview image */}
            {!dialogPreview && initial?.url_image && (
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Website preview</Label>
                <div className="rounded-md overflow-hidden border border-border">
                  <img src={initial.url_image} alt="" className="w-full object-cover" />
                </div>
              </div>
            )}
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
  item, projectId, onEdit,
}: { item: ResearchItem; projectId: number; onEdit: (item: ResearchItem) => void }) {
  const [isDragOver, setIsDragOver]   = useState(false);
  const [isHovered, setIsHovered]     = useState(false);
  const [lightbox, setLightbox]       = useState(false);
  const [pdfOpen, setPdfOpen]         = useState(false);

  const deleteItem  = useDeleteResearch(projectId);
  const refetchUrl  = useRefetchResearchUrl(projectId);
  const uploadImage = useUploadResearchImage(projectId);
  const deleteImage = useDeleteResearchImage(projectId);

  const displayTitle = item.title || item.url_title || item.url || "Untitled";
  const previewImage = item.image_path ? imagesApi.url(item.image_path) : item.url_image ?? null;

  const handleFile = (file: File) => {
    if (file.type.startsWith("image/")) uploadImage.mutate({ id: item.id, file });
  };

  const handleImageUpload = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp,image/gif";
    input.onchange = () => { if (input.files?.[0]) handleFile(input.files[0]); };
    input.click();
  };

  // Close lightbox / PDF popup on Escape
  useEffect(() => {
    if (!lightbox && !pdfOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setLightbox(false); setPdfOpen(false); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightbox, pdfOpen]);

  // Paste listener active while card is hovered — no click-to-focus required.
  // Only intercepts when clipboard contains an image; text pastes are unaffected.
  useEffect(() => {
    if (!isHovered) return;
    const onPaste = (e: ClipboardEvent) => {
      const imageItem = Array.from(e.clipboardData?.items ?? [])
        .find(i => i.type.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (file) { e.preventDefault(); handleFile(file); }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [isHovered, item.id]);

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
      onDrop={(e) => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
    >
      {/* Image preview */}
      {previewImage ? (
        <>
          <div className="relative rounded-md overflow-hidden bg-secondary/30 aspect-[3/4]">
            <img src={previewImage} alt="" className="w-full h-full object-contain" />
            <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 bg-black/40 transition-opacity">
              <button
                className="p-1.5 rounded bg-black/60 text-white hover:bg-black/80"
                title="Enlarge"
                onClick={() => setLightbox(true)}
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              <button
                className="p-1.5 rounded bg-black/60 text-white hover:bg-black/80"
                title="Replace image"
                onClick={handleImageUpload}
                disabled={uploadImage.isPending}
              >
                {uploadImage.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              </button>
              {item.image_path && (
                <button
                  className="p-1.5 rounded bg-black/60 text-white hover:bg-red-600/80"
                  title="Remove uploaded image"
                  onClick={() => deleteImage.mutate(item.id)}
                  disabled={deleteImage.isPending}
                >
                  <ImageOff className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          {/* Lightbox */}
          {lightbox && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
              onClick={() => setLightbox(false)}
            >
              <img
                src={previewImage}
                alt=""
                className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              />
              <button
                className="absolute top-4 right-4 p-2 rounded-full bg-black/60 text-white hover:bg-black/80"
                onClick={() => setLightbox(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="opacity-0 group-hover:opacity-100 transition-opacity aspect-[3/4] rounded-md border-2 border-dashed border-border/40 flex flex-col items-center justify-center gap-1 cursor-pointer" onClick={handleImageUpload}>
          {uploadImage.isPending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <Camera className="h-4 w-4 text-muted-foreground/50" />}
          <span className="text-[10px] text-muted-foreground/50">Add image</span>
        </div>
      )}

      {/* Title + actions */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm leading-snug line-clamp-2">{displayTitle}</p>
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
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
          <button
            className="p-1 hover:text-primary text-muted-foreground rounded"
            onClick={() => onEdit(item)}
          >
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

      {/* URL description */}
      {item.url_description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{item.url_description}</p>
      )}

      {/* Text excerpt */}
      {item.text_content && (
        <blockquote className="border-l-2 border-primary/30 pl-3 text-xs text-muted-foreground italic line-clamp-4">
          {item.text_content}
        </blockquote>
      )}

      {/* Tags */}
      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.tags.map(t => (
            <span key={t} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0 rounded-full">#{t}</span>
          ))}
        </div>
      )}

      {/* PDF attachment */}
      {item.pdf_path && (
        <>
          <button
            className="inline-flex items-center gap-1 text-[10px] text-primary/70 hover:text-primary"
            onClick={() => setPdfOpen(true)}
          >
            <FileText className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{item.pdf_path.split("/").pop()}</span>
          </button>
          {pdfOpen && (
            <PdfPopup
              url={imagesApi.url(item.pdf_path)}
              name={item.pdf_path.split("/").pop() ?? "document.pdf"}
              onClose={() => setPdfOpen(false)}
            />
          )}
        </>
      )}

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

// ── Fragment card (grid view) ─────────────────────────────────────────────────

function FragmentCard({
  fragment, projectId, allTabs,
}: { fragment: FragmentItem; projectId: number; allTabs: string[] }) {
  const {
    editingTitle, setEditingTitle, localTitle, setLocalTitle,
    localContent, setLocalContent, localCategory, setLocalCategory,
    editingCategory, setEditingCategory, showMove, setShowMove,
    scheduleContentSave, commitTitle, commitCategory, moveToTab,
    wordCount, deleteFragment,
  } = useFragmentEdit(fragment, projectId);

  const contentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [localContent]);

  const { text: labelText, derived } = fragmentLabel({ ...fragment, title: fragment.title });

  return (
    <div className="group relative bg-card border border-border rounded-lg p-3 space-y-2 hover:border-border/80 transition-colors">
      <div className="flex items-center gap-1.5 min-h-[24px]">
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
          <button
            className="flex-1 text-left text-xs font-medium truncate min-h-[20px]"
            onDoubleClick={() => setEditingTitle(true)}
            title="Double-click to rename"
          >
            {fragment.title ? (
              <span className="text-foreground/80 hover:text-foreground">{fragment.title}</span>
            ) : (
              <span className="text-muted-foreground italic">{derived ? labelText : "Untitled"}</span>
            )}
          </button>
        )}

        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 shrink-0 transition-opacity">
          <div className="relative">
            <button
              onClick={() => setShowMove((v) => !v)}
              className="text-muted-foreground hover:text-foreground p-0.5 rounded"
              title="Move to tab"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            {showMove && (
              <div className="absolute right-0 top-6 z-20 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[130px]">
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
            className="text-muted-foreground hover:text-destructive p-0.5 rounded"
            title="Delete fragment"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <textarea
        ref={contentRef}
        value={localContent}
        onChange={(e) => { setLocalContent(e.target.value); scheduleContentSave(e.target.value); }}
        placeholder="Write something..."
        className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none min-h-[60px] leading-relaxed"
        rows={3}
      />

      <div className="flex items-center justify-between text-[10px] text-muted-foreground/50">
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
              title="Set category"
            >
              {localCategory || "+ label"}
            </button>
          )}
        </div>
        <span>{wordCount} words</span>
      </div>

      {showMove && <div className="fixed inset-0 z-10" onClick={() => setShowMove(false)} />}
    </div>
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

  const [activeTab, setActiveTab]   = useState(RESEARCH_TAB);
  const [addingTab, setAddingTab]   = useState(false);
  const [newTabName, setNewTabName] = useState("");
  const [viewMode, setViewMode]     = useState<ViewMode>("grid");
  const [expandedId, setExpandedId] = useState<number | null>(null);

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

  // Reset list expansion when tab / view mode changes
  useEffect(() => { setExpandedId(null); }, [activeTab, viewMode]);

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

  // Newest first: sort by updated_at descending so just-created fragments surface to the top
  const tabFragments = fragments
    .filter((f) => f.tab === activeTab)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

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
                    #{tag}
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
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ── Fragment grid / list ────────────────────────────────────────── */
          <div className="p-4">
            {tabFragments.length === 0 ? (
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
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
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
