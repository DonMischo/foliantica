"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shuffle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { dmApi } from "@/lib/api";
import { useDmPrefs, useUpdateDmPrefs } from "@/store/queries";
import { useLanguage } from "@/contexts/LanguageContext";

export function WildcardPicker({
  projectId, open, onClose,
}: { projectId: number; open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const { data: prefs } = useDmPrefs(projectId);
  const updatePrefs = useUpdateDmPrefs(projectId);

  const { data: tree } = useQuery({
    queryKey: ["dm-wildcards-tree"],
    queryFn: dmApi.wildcardsTree,
    enabled: open,
    staleTime: 60_000,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (open) setSelected(new Set(prefs?.wildcards ?? []));
  }, [open, prefs?.wildcards]);

  const categories = tree?.categories ?? [];
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.path.toLowerCase().includes(q));
  }, [categories, filter]);

  const toggle = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        // Selecting a parent covers its whole subtree — drop redundant children
        for (const p of [...next]) {
          if (p.startsWith(path + "/")) next.delete(p);
        }
        next.add(path);
      }
      return next;
    });

  const covered = (path: string) =>
    [...selected].some((p) => p !== path && path.startsWith(p + "/"));

  const save = () => {
    updatePrefs.mutate({ wildcards: [...selected].sort() }, { onSuccess: onClose });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shuffle className="h-4 w-4" />
            {t("dm_wildcards")}
            {selected.size > 0 && (
              <span className="text-xs font-normal text-muted-foreground">({selected.size})</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {!tree || !tree.available ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {tree?.error ? `${t("dm_wildcards_none")} (${tree.error})` : t("dm_wildcards_none")}
          </p>
        ) : (
          <>
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("dm_wildcards_filter")}
              className="h-8 text-sm"
            />
            <div className="flex-1 min-h-0 overflow-y-auto rounded-md border border-border p-1.5 space-y-0.5">
              {visible.map((c) => {
                const isCovered = covered(c.path);
                return (
                  <button
                    key={c.path}
                    onClick={() => toggle(c.path)}
                    disabled={isCovered}
                    className={cn(
                      "w-full flex items-center gap-2 rounded px-2 py-1 text-left text-xs",
                      selected.has(c.path)
                        ? "bg-primary/10 text-foreground"
                        : isCovered
                          ? "text-muted-foreground/50"
                          : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                    )}
                    style={{ paddingLeft: `${8 + c.depth * 16}px` }}
                  >
                    <span
                      className={cn(
                        "h-3 w-3 shrink-0 rounded-sm border",
                        selected.has(c.path) || isCovered
                          ? "bg-primary border-primary"
                          : "border-muted-foreground/50"
                      )}
                    />
                    <span className="flex-1 truncate">{c.path.split("/").pop()}</span>
                    <span className="text-[10px] text-muted-foreground/70 tabular-nums">{c.count}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>{t("common_cancel")}</Button>
          <Button onClick={save} disabled={updatePrefs.isPending || !tree?.available}>
            {t("common_save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
