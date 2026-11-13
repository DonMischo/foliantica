"use client";
/**
 * Mind map / workflow — a research clipping with `kind = "workflow"`: notes in
 * Markdown (text_content) next to a D2 diagram (source in `d2`). The diagram can
 * be generated from the notes by the built-in AI (Settings → Default Diagram
 * Model) or via a prompt copied into any outside AI chat.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCreateResearch, useUpdateResearch, useDeleteResearch, useSettings } from "@/store/queries";
import { diagramApi } from "@/lib/api";
import { Markdown } from "@/components/Markdown";
import { DIAGRAM_STYLES, EXAMPLE_D2, codeFromReply, diagramPrompt, readErrors, renderD2, type DiagramStyle } from "@/lib/d2";
import type { ResearchItem } from "@/types";
import { cn } from "@/lib/utils";

export const WORKFLOW_LABEL = "Mind Map / Workflow";

/** Draws D2 code (loads the D2 compiler on first use). Click to enlarge. */
export function D2Diagram({ code, large = false, onErrors }: { code: string; large?: boolean; onErrors?: (e: string[]) => void }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [zoom, setZoom] = useState(false);
  const report = useRef(onErrors);
  report.current = onErrors;

  useEffect(() => {
    if (!code.trim()) { setSvg(null); setErrors([]); report.current?.([]); return; }
    let current = true;
    const t = setTimeout(async () => {
      try {
        const out = await renderD2(code);
        if (!current) return;
        setSvg(out); setErrors([]); report.current?.([]);
      } catch (e) {
        if (!current) return;
        const f = readErrors(e);
        setErrors(f); report.current?.(f);
      }
    }, 400);
    return () => { current = false; clearTimeout(t); };
  }, [code]);

  if (!code.trim()) return null;
  if (!svg) {
    return <p className="text-[11px] text-muted-foreground italic">{errors.length ? `⚠ ${errors[0]}` : "Drawing diagram…"}</p>;
  }
  return (
    <>
      <div
        className={cn("rounded-md bg-white p-1 cursor-zoom-in flex justify-center [&_svg]:max-w-full [&_svg]:w-auto [&_svg]:h-auto",
          large ? "[&_svg]:max-h-[420px]" : "[&_svg]:max-h-72")}
        onClick={() => setZoom(true)} title="Enlarge" data-testid="d2-diagram"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {errors.length > 0 && <p className="text-[11px] text-destructive">⚠ {errors[0]} (showing the last valid version)</p>}
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-w-[94vw] w-auto bg-white" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Diagram</DialogTitle>
          <div className="overflow-auto [&_svg]:max-w-[90vw] [&_svg]:max-h-[85vh] [&_svg]:w-auto [&_svg]:h-auto"
            dangerouslySetInnerHTML={{ __html: svg }} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function AiFromNotes({ title, notes, d2, onCode }: { title: string; notes: string; d2: string; onCode: (c: string) => void }) {
  const { data: settings } = useSettings();
  const aiOn = !!settings && !settings.ai_disabled;
  const [style, setStyle] = useState<DiagramStyle>("mindmap");
  const [buildOn, setBuildOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const prompt = diagramPrompt({ style, title, notes, current: buildOn ? d2 : undefined });
  const empty = !title.trim() && !notes.trim();

  const generate = async () => {
    setBusy(true); setStatus("");
    try {
      onCode((await diagramApi.generate(prompt)).d2);
      setStatus("✓ Diagram generated.");
    } catch (e) {
      // req() throws "400: {\"detail\": …}" — show just the detail
      const msg = e instanceof Error ? e.message : "AI request failed";
      let detail = msg;
      try { detail = JSON.parse(msg.replace(/^\d+:\s*/, "")).detail ?? msg; } catch { /* plain text */ }
      setStatus(`⚠ ${detail} — you can copy the prompt below instead.`);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus("✓ Copied — paste it into an AI chat, then paste the reply into the code field.");
    } catch {
      promptRef.current?.select();
      setStatus("Selected — press Ctrl+C.");
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-medium mr-1">Build diagram from notes:</span>
        {(Object.keys(DIAGRAM_STYLES) as DiagramStyle[]).map(s => (
          <button key={s} type="button" onClick={() => setStyle(s)}
            className={cn("px-2 py-0.5 rounded-full border", style === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
            {DIAGRAM_STYLES[s].label}
          </button>
        ))}
      </div>
      {d2.trim() && (
        <label className="flex items-center gap-2 text-muted-foreground">
          <input type="checkbox" checked={buildOn} onChange={e => setBuildOn(e.target.checked)} />
          Build on the current diagram
        </label>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {aiOn && (
          <Button type="button" size="sm" className="gap-1.5 text-xs" onClick={generate} disabled={busy || empty}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Generate with AI
          </Button>
        )}
        <span className="text-muted-foreground">{status || (empty ? "Write a title or notes first." : "")}</span>
      </div>
      <details open={!aiOn}>
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          {aiOn ? "Or copy the prompt for another AI chat" : "Copy the prompt into an AI chat (built-in AI is off)"}
        </summary>
        <div className="flex flex-col gap-2 pt-2">
          <Button type="button" size="sm" variant="outline" className="self-start text-xs" onClick={copy} disabled={empty}>Copy prompt</Button>
          <textarea ref={promptRef} readOnly value={prompt} aria-label="Prompt for the AI"
            className="h-28 w-full rounded-md border border-border bg-background p-2 font-mono text-[11px]" />
        </div>
      </details>
    </div>
  );
}

export function WorkflowDialog({ open, onClose, projectId, initial, defaultTab }: {
  open: boolean;
  onClose: () => void;
  projectId: number;
  initial?: ResearchItem | null;
  defaultTab: string;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [d2, setD2] = useState("");
  const [preview, setPreview] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const createResearch = useCreateResearch(projectId);
  const updateResearch = useUpdateResearch(projectId);

  useEffect(() => {
    if (!open) return;
    setTitle(initial?.title ?? "");
    setNotes(initial?.text_content ?? "");
    // New ones start with an example, existing ones with their own code
    setD2(initial ? initial.d2 ?? "" : EXAMPLE_D2);
    setPreview(false);
  }, [open, initial]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { title: title.trim() || undefined, text_content: notes.trim() || undefined, d2: d2.trim() ? d2 : null };
      if (initial) await updateResearch.mutateAsync({ id: initial.id, data: payload });
      else await createResearch.mutateAsync({ ...payload, tab: defaultTab, kind: "workflow" });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const canSave = !saving && (!!title.trim() || !!notes.trim() || (!!d2.trim() && d2 !== EXAMPLE_D2));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-[80vw] max-w-5xl max-h-[92vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{initial ? `Edit ${WORKFLOW_LABEL}` : `New ${WORKFLOW_LABEL}`}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wf-title">Title</Label>
            <Input id="wf-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Act two beats, Revision routine…" />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="wf-notes">Notes (Markdown)</Label>
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setPreview(v => !v)}>
                {preview ? "Edit" : "Preview"}
              </button>
            </div>
            {preview
              ? <div className="rounded-md border border-border p-3 text-sm min-h-[120px]"><Markdown text={notes || "_(empty)_"} /></div>
              : <textarea id="wf-notes" value={notes} onChange={e => setNotes(e.target.value)}
                  className="w-full min-h-[140px] resize-y rounded-md border border-border bg-background p-2 font-mono text-sm"
                  placeholder={"## Hero\n- wants revenge\n- fears water\n\n## Steps\n1. Draft\n2. Read aloud\n- [ ] Cut adverbs"} />}
            <p className="text-[10px] text-muted-foreground"># Heading · 1. Step · - Point · - [ ] Task · **bold** · *italic* · [link](https://…)</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wf-d2">Diagram (<a href="https://d2lang.com/tour/intro" target="_blank" rel="noopener noreferrer" className="underline">D2</a>)</Label>
            <div className="grid gap-3 md:grid-cols-2">
              <textarea id="wf-d2" value={d2} spellCheck={false} wrap="off"
                onChange={e => setD2(e.target.value.includes("```") ? codeFromReply(e.target.value) : e.target.value)}
                className={cn("w-full min-h-[300px] resize-y rounded-md border bg-background p-2 font-mono text-[13px] leading-5",
                  errors.length ? "border-destructive" : "border-border")} />
              <div className="min-w-0">
                {d2.trim()
                  ? <D2Diagram code={d2} large onErrors={setErrors} />
                  : <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => setD2(EXAMPLE_D2)}>Start from an example</button>}
              </div>
            </div>
          </div>

          <AiFromNotes title={title} notes={notes} d2={d2} onCode={setD2} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : initial ? "Save" : "Add"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WorkflowCard({ item, projectId, onEdit }: {
  item: ResearchItem; projectId: number; onEdit: (item: ResearchItem) => void;
}) {
  const [full, setFull] = useState(false);
  const deleteItem = useDeleteResearch(projectId);
  const long = (item.text_content ?? "").split("\n").length > 8;

  return (
    <div className="group bg-card border border-border rounded-lg p-4 flex flex-col gap-3 hover:shadow-sm transition-all" data-kind="workflow">
      {item.d2 && <D2Diagram code={item.d2} />}
      <div className="flex items-start gap-2">
        <button className="flex-1 min-w-0 flex items-start gap-1.5 font-medium text-sm leading-snug text-left hover:text-primary transition-colors"
          onClick={() => onEdit(item)}>
          <WorkflowIcon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary/70" />
          <span className="line-clamp-2">{item.title || WORKFLOW_LABEL}</span>
        </button>
        <button className="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive text-muted-foreground rounded transition-opacity"
          title="Delete" onClick={() => { if (confirm(`Delete this ${WORKFLOW_LABEL.toLowerCase()}?`)) deleteItem.mutate(item.id); }}>
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {item.text_content && (
        <div className="text-xs">
          <div className={full || !long ? "" : "max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]"}>
            <Markdown text={item.text_content} />
          </div>
          {long && <button className="text-[10px] text-muted-foreground hover:text-foreground mt-1" onClick={() => setFull(v => !v)}>{full ? "▴ less" : "▾ show all"}</button>}
        </div>
      )}
    </div>
  );
}
