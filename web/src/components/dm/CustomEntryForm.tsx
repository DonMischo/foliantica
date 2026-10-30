"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dmApi } from "@/lib/api";
import { useLanguage } from "@/contexts/LanguageContext";
import type { DmRuleset } from "@/types";

/**
 * Define a species or class of your own: a name over an existing entry's rules,
 * plus an optional line that replaces the species trait (or is added to the
 * class's abilities). Saved per install, so every campaign sees it.
 */
export function CustomEntryForm({
  kind, ruleset, onSaved,
}: {
  kind: "species" | "classes";
  ruleset: DmRuleset;
  onSaved: (key: string) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [base, setBase] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only built-ins can be a base, so custom entries never chain off each other.
  const bases = Object.entries(kind === "species" ? ruleset.species : ruleset.classes)
    .filter(([, entry]) => !entry.custom_base)
    .sort((a, b) => a[1].label.localeCompare(b[1].label));

  const reset = () => {
    setOpen(false);
    setLabel("");
    setBase("");
    setNote("");
    setError(null);
  };

  const save = async () => {
    if (!label.trim() || !base) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await dmApi.addCustomEntry({ kind, label: label.trim(), base, note: note.trim() || undefined });
      onSaved(saved.key);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\d+: /, "") : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-2.5 py-1 rounded-md border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 inline-flex items-center gap-1"
      >
        <Plus className="h-3 w-3" />
        {t("dm_custom_add")}
      </button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-md border border-primary/40 bg-primary/5 p-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium">
          {kind === "species" ? t("dm_custom_new_species") : t("dm_custom_new_class")}
        </p>
        <button onClick={reset} className="text-muted-foreground hover:text-foreground" title={t("common_cancel")}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-0.5">
          <label className="text-[10px] text-muted-foreground">{t("dm_custom_name")}</label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="h-7 text-xs"
            autoFocus
          />
        </div>
        <div className="space-y-0.5">
          <label className="text-[10px] text-muted-foreground">{t("dm_custom_base")}</label>
          <select
            value={base}
            onChange={(e) => setBase(e.target.value)}
            className={cn(
              "w-full h-7 rounded-md border border-input bg-background px-2 text-xs",
              !base && "text-muted-foreground"
            )}
          >
            <option value="">{t("dm_custom_base_pick")}</option>
            {bases.map(([key, entry]) => (
              <option key={key} value={key}>{entry.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-0.5">
        <label className="text-[10px] text-muted-foreground">
          {kind === "species" ? t("dm_custom_note_species") : t("dm_custom_note_class")}
        </label>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="h-7 text-xs"
        />
      </div>

      <p className="text-[10px] text-muted-foreground">{t("dm_custom_inherits")}</p>
      {error && <p className="text-[11px] text-destructive">{error}</p>}

      <Button size="sm" className="h-7 w-full text-xs" onClick={save} disabled={busy || !label.trim() || !base}>
        {t("dm_custom_save")}
      </Button>
    </div>
  );
}
