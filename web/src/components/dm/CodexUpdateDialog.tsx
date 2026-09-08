"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookMarked, Plus, Pencil } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dmApi } from "@/lib/api";
import { useSuggestCodexUpdates } from "@/store/queries";
import { useLanguage } from "@/contexts/LanguageContext";
import type { DmCodexUpdate } from "@/types";

/**
 * The /codex command. Reads play memory and proposes concrete codex changes —
 * knowledge to append to existing entries, and entries play established that
 * the codex is missing. The pass writes nothing; only ticked rows are applied.
 */
export function CodexUpdateDialog({
  projectId, instruction, open, onClose,
}: { projectId: number; instruction: string; open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const suggest = useSuggestCodexUpdates(projectId);

  const [updates, setUpdates] = useState<DmCodexUpdate[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUpdates(null);
    setSelected(new Set());
    setError(null);
    suggest.mutate(instruction, {
      onSuccess: (rows) => {
        setUpdates(rows);
        setSelected(new Set(rows.map((_, i) => i)));
      },
      onError: (e) => setError(e instanceof Error ? e.message.replace(/^\d+: /, "") : String(e)),
    });
    // Fired once per opening; suggest is a fresh mutation object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, instruction]);

  const toggle = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const apply = async () => {
    if (!updates) return;
    setApplying(true);
    setError(null);
    try {
      await dmApi.applyCodexUpdates(projectId, [...selected].sort((a, b) => a - b).map((i) => updates[i]));
      qc.invalidateQueries({ queryKey: ["codex"] });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\d+: /, "") : String(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookMarked className="h-4 w-4" />
            {t("dm_codex_title")}
            {selected.size > 0 && (
              <span className="text-xs font-normal text-muted-foreground">({selected.size})</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {instruction && (
          <p className="rounded-md border border-border bg-secondary/30 px-3 py-1.5 text-[11px] text-muted-foreground">
            {instruction}
          </p>
        )}

        {suggest.isPending && (
          <p className="py-8 text-center text-sm text-muted-foreground animate-pulse">
            {t("dm_codex_scanning")}
          </p>
        )}

        {updates?.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("dm_codex_none")}</p>
        )}

        {!!updates?.length && (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-1 rounded-md border border-border p-1.5">
            {updates.map((u, i) => (
              <button
                key={`${u.entry_id ?? "new"}-${i}`}
                onClick={() => toggle(i)}
                className={cn(
                  "w-full flex items-start gap-2 rounded px-2 py-1.5 text-left",
                  selected.has(i) ? "bg-primary/10" : "hover:bg-secondary/50"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm border",
                    selected.has(i) ? "bg-primary border-primary" : "border-muted-foreground/50"
                  )}
                />
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="flex flex-wrap items-center gap-1.5 text-xs">
                    {u.entry_id === null ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-500">
                        <Plus className="h-2.5 w-2.5" />
                        {t("dm_codex_new")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary/70 px-2 py-0.5 text-[10px] text-muted-foreground">
                        <Pencil className="h-2.5 w-2.5" />
                        {t("dm_codex_extends")}
                      </span>
                    )}
                    <span className="font-medium">{u.name}</span>
                    <span className="text-[10px] text-muted-foreground">[{u.entry_type}]</span>
                  </span>
                  <span className="block text-[11px] leading-snug">{u.description_add}</span>
                  {u.evidence && (
                    <span className="block text-[11px] leading-snug text-muted-foreground">{u.evidence}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}

        {error && <p className="text-xs text-destructive whitespace-pre-wrap">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>{t("common_cancel")}</Button>
          <Button onClick={apply} disabled={applying || selected.size === 0}>
            {t("dm_codex_apply")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
