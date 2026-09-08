"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Share2, ArrowRight, AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { codexApi } from "@/lib/api";
import { useSuggestDmRelations } from "@/store/queries";
import { useLanguage } from "@/contexts/LanguageContext";
import type { DmRelationSuggestion } from "@/types";

/**
 * Reads the campaign's play memory and proposes codex relations. The pass
 * itself writes nothing — only the rows the player ticks here are created.
 */
export function RelationSuggestDialog({
  projectId, open, onClose,
}: { projectId: number; open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const suggest = useSuggestDmRelations(projectId);

  const [suggestions, setSuggestions] = useState<DmRelationSuggestion[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSuggestions(null);
    setSelected(new Set());
    setError(null);
    suggest.mutate(undefined, {
      onSuccess: (rows) => {
        setSuggestions(rows);
        // Pre-tick everything that only adds; replacements are opt-in.
        setSelected(new Set(rows.map((r, i) => (r.existing_type ? -1 : i)).filter((i) => i >= 0)));
      },
      onError: (e) => setError(e instanceof Error ? e.message.replace(/^\d+: /, "") : String(e)),
    });
    // The pass is fired once per opening; suggest is a fresh mutation each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  const toggle = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const apply = async () => {
    if (!suggestions) return;
    setApplying(true);
    setError(null);
    try {
      for (const i of [...selected].sort((a, b) => a - b)) {
        const s = suggestions[i];
        await codexApi.createRelation({
          source_id: s.source_id,
          target_id: s.target_id,
          relation_type: s.relation_type,
        });
      }
      qc.invalidateQueries({ queryKey: ["codex"] });
      qc.invalidateQueries({ queryKey: ["codex-relations"] });
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
            <Share2 className="h-4 w-4" />
            {t("dm_relations_title")}
            {selected.size > 0 && (
              <span className="text-xs font-normal text-muted-foreground">({selected.size})</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {suggest.isPending && (
          <p className="py-8 text-center text-sm text-muted-foreground animate-pulse">
            {t("dm_relations_scanning")}
          </p>
        )}

        {suggestions?.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("dm_relations_none")}</p>
        )}

        {!!suggestions?.length && (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-1 rounded-md border border-border p-1.5">
            {suggestions.map((s, i) => (
              <button
                key={`${s.source_id}-${s.target_id}`}
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
                    <span className="font-medium">{s.source_name}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="rounded-full bg-secondary/70 px-2 py-0.5 text-[11px]">{s.relation_type}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">{s.target_name}</span>
                  </span>
                  {s.existing_type && (
                    <span className="flex items-center gap-1 text-[11px] text-amber-500">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {t("dm_relations_replaces", { type: s.existing_type })}
                    </span>
                  )}
                  {s.evidence && (
                    <span className="block text-[11px] leading-snug text-muted-foreground">{s.evidence}</span>
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
            {t("dm_relations_apply")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
