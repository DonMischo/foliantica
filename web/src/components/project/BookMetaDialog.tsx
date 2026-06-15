"use client";

import { useState, useEffect } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { BookMeta } from "@/types";

// ── Common language options ───────────────────────────────────────────────────

const COMMON_LANGUAGES = [
  { code: "en",    label: "English" },
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "de",    label: "German" },
  { code: "fr",    label: "French" },
  { code: "es",    label: "Spanish" },
  { code: "it",    label: "Italian" },
  { code: "pt",    label: "Portuguese" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "nl",    label: "Dutch" },
  { code: "pl",    label: "Polish" },
  { code: "ru",    label: "Russian" },
  { code: "ja",    label: "Japanese" },
  { code: "zh",    label: "Chinese" },
  { code: "ko",    label: "Korean" },
  { code: "ar",    label: "Arabic" },
];

// ── Field components ──────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-5 mb-2 first:mt-0 border-b border-border/40 pb-1">
      {children}
    </p>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-foreground/80">{label}</Label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function MetaInput({
  value, onChange, placeholder, list,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  list?: string;
}) {
  return (
    <Input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      list={list}
      className="h-8 text-sm"
    />
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

interface Props {
  projectId: number;
  projectTitle: string;
  initial: BookMeta | null;
  open: boolean;
  onClose: () => void;
  onSave: (meta: BookMeta) => void;
}

const EMPTY_META: BookMeta = {
  author: "",
  author_sort: "",
  subtitle: "",
  language: "en",
  publisher: "",
  published_date: "",
  isbn: "",
  rights: "",
  series: "",
  series_index: "",
  genre: "",
  subjects: [],
  synopsis: "",
  translator: "",
  editor: "",
};

export function BookMetaDialog({ projectTitle, initial, open, onClose, onSave }: Props) {
  const [meta, setMeta] = useState<BookMeta>({ ...EMPTY_META });
  const [subjectsRaw, setSubjectsRaw] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    if (!open) return;
    const m = { ...EMPTY_META, ...(initial ?? {}) };
    setMeta(m);
    setSubjectsRaw((m.subjects ?? []).join(", "));
    setStatus("idle");
  }, [open, initial]);

  if (!open) return null;

  const set = <K extends keyof BookMeta>(k: K, v: BookMeta[K]) =>
    setMeta(prev => ({ ...prev, [k]: v }));

  const handleSave = () => {
    setStatus("saving");
    const subjects = subjectsRaw
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    const payload: BookMeta = { ...meta, subjects };
    // Strip empty strings to undefined for clean JSON
    const cleaned = Object.fromEntries(
      Object.entries(payload).filter(([, v]) =>
        v !== "" && v !== null && !(Array.isArray(v) && v.length === 0)
      )
    ) as BookMeta;
    onSave(cleaned);
    setTimeout(() => setStatus("saved"), 300);
    setTimeout(() => { setStatus("idle"); onClose(); }, 1200);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-semibold">Project Info</h2>
            <p className="text-xs text-muted-foreground truncate">{projectTitle}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">

          {/* ── Basic ── */}
          <SectionHeading>Basic</SectionHeading>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Field label="Author" hint="dc:creator — appears on the title page">
                <Input
                  value={meta.author ?? ""}
                  onChange={e => set("author", e.target.value)}
                  onBlur={e => {
                    const v = e.target.value;
                    if (v && !meta.rights) {
                      set("rights", `© ${new Date().getFullYear()} ${v}. All rights reserved.`);
                    }
                  }}
                  placeholder="Jane Doe"
                  className="h-8 text-sm"
                />
              </Field>
            </div>
            <Field label="Author sort key" hint='For library indexing, e.g. "Doe, Jane"'>
              <MetaInput
                value={meta.author_sort ?? ""}
                onChange={v => set("author_sort", v)}
                placeholder="Doe, Jane"
              />
            </Field>
            <Field label="Language" hint="BCP 47 code">
              <MetaInput
                value={meta.language ?? "en"}
                onChange={v => set("language", v)}
                placeholder="en"
                list="lw-lang-list"
              />
              <datalist id="lw-lang-list">
                {COMMON_LANGUAGES.map(l => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </datalist>
              {(() => {
                const lc = (meta.language ?? "en").toLowerCase().split("-")[0];
                if (["zh", "ja", "ko", "ar"].includes(lc))
                  return <p className="text-[10px] text-amber-500 mt-0.5">Style checking is not available for this language.</p>;
                if (!["en", "de", "es", "fr", "pt", "sv", "da", "no"].includes(lc))
                  return <p className="text-[10px] text-muted-foreground mt-0.5">Style checking has limited support for this language — only basic rules apply.</p>;
                return null;
              })()}
            </Field>
          </div>

          <Field label="Subtitle">
            <MetaInput
              value={meta.subtitle ?? ""}
              onChange={v => set("subtitle", v)}
              placeholder="A Novel of..."
            />
          </Field>

          {/* ── Publication ── */}
          <SectionHeading>Publication</SectionHeading>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Publisher">
              <MetaInput
                value={meta.publisher ?? ""}
                onChange={v => set("publisher", v)}
                placeholder="Self-Published"
              />
            </Field>
            <Field label="Publication date" hint="YYYY or YYYY-MM-DD">
              <MetaInput
                value={meta.published_date ?? ""}
                onChange={v => set("published_date", v)}
                placeholder="2024"
              />
            </Field>
            <Field label="ISBN">
              <MetaInput
                value={meta.isbn ?? ""}
                onChange={v => set("isbn", v)}
                placeholder="978-0-000-00000-0"
              />
            </Field>
            <div className="col-span-2">
              <Field label="Rights / Copyright" hint="dc:rights">
                <MetaInput
                  value={meta.rights ?? ""}
                  onChange={v => set("rights", v)}
                  placeholder="© 2024 Jane Doe. All rights reserved."
                />
              </Field>
            </div>
          </div>

          {/* ── Series ── */}
          <SectionHeading>Series</SectionHeading>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Series name">
              <MetaInput
                value={meta.series ?? ""}
                onChange={v => set("series", v)}
                placeholder="The Great Trilogy"
              />
            </Field>
            <Field label="Position in series">
              <MetaInput
                value={meta.series_index ?? ""}
                onChange={v => set("series_index", v)}
                placeholder="1"
              />
            </Field>
          </div>

          {/* ── Genre & Tags ── */}
          <SectionHeading>Genre & Tags</SectionHeading>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Genre / Primary subject">
              <MetaInput
                value={meta.genre ?? ""}
                onChange={v => set("genre", v)}
                placeholder="Fantasy"
              />
            </Field>
            <Field label="Additional subjects" hint="Comma-separated">
              <MetaInput
                value={subjectsRaw}
                onChange={setSubjectsRaw}
                placeholder="epic, dragons, magic"
              />
            </Field>
          </div>

          {/* ── Contributors ── */}
          <SectionHeading>Contributors</SectionHeading>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Translator" hint="dc:contributor role=trl">
              <MetaInput
                value={meta.translator ?? ""}
                onChange={v => set("translator", v)}
                placeholder="Name"
              />
            </Field>
            <Field label="Editor" hint="dc:contributor role=edt">
              <MetaInput
                value={meta.editor ?? ""}
                onChange={v => set("editor", v)}
                placeholder="Name"
              />
            </Field>
          </div>

          {/* ── Synopsis ── */}
          <SectionHeading>Synopsis</SectionHeading>

          <Field label="Back-cover synopsis" hint="dc:description — used in EPUB metadata">
            <textarea
              value={meta.synopsis ?? ""}
              onChange={e => set("synopsis", e.target.value)}
              placeholder="A brief description of the book for catalogue listings..."
              rows={4}
              className={cn(
                "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
                "resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
                "placeholder:text-muted-foreground"
              )}
            />
          </Field>

        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border shrink-0 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={status === "saving"}
            className={cn("gap-1.5 min-w-[80px]", status === "saved" && "bg-green-600 hover:bg-green-600")}
          >
            {status === "saving" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : status === "saved" ? (
              <><Check className="h-3.5 w-3.5" /> Saved</>
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
