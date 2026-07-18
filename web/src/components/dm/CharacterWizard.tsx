"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dices, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { codexApi, dmApi } from "@/lib/api";
import { useDmRuleset } from "@/store/queries";
import { useLanguage } from "@/contexts/LanguageContext";
import type { DmCharacterDraft } from "@/types";

type Method = "roll" | "array" | "manual";

export function CharacterWizard({
  projectId, open, onClose,
}: { projectId: number; open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const { data: ruleset } = useDmRuleset();

  const [species, setSpecies] = useState("human");
  const [charClass, setCharClass] = useState("fighter");
  const [method, setMethod] = useState<Method>("roll");
  const [manualStats, setManualStats] = useState<string[]>(Array(6).fill(""));
  const [draft, setDraft] = useState<DmCharacterDraft | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async (keepName = false) => {
    setBusy(true);
    setError(null);
    try {
      const data = await dmApi.generateCharacter(projectId, {
        species,
        char_class: charClass,
        method,
        manual_stats: method === "manual" ? manualStats.map(Number) : undefined,
        name: keepName && name.trim() ? name.trim() : undefined,
      });
      setDraft(data);
      if (!keepName || !name.trim()) setName(data.name);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\d+: /, "") : String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await codexApi.create({
        project_id: projectId,
        name: name.trim(),
        aliases: [],
        entry_type: "character",
        description: `${draft.species} ${draft.class_label}`,
        notes: null,
        color: "#38bdf8",
        groups: [],
        species: draft.species,
        subtype: draft.class_label,
        tags: [],
        is_main_char: true,
        inventory: null,
        rpg_sheet: draft.rpg_sheet,
        image_path: null,
        image_crop: null,
        name_type: null,
        share_mode: "all",
        share_future: true,
      });
      qc.invalidateQueries({ queryKey: ["codex", projectId] });
      setDraft(null);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\d+: /, "") : String(e));
    } finally {
      setBusy(false);
    }
  };

  const manualValid = manualStats.every((v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 3 && n <= 18;
  });

  if (!ruleset) return null;
  const sheet = draft?.rpg_sheet;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Dices className="h-4 w-4" />
            {t("dm_create_character")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Species */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t("dm_species")}</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(ruleset.species).map(([key, sp]) => (
                <button
                  key={key}
                  onClick={() => setSpecies(key)}
                  title={sp.trait}
                  className={cn(
                    "px-2.5 py-1 rounded-md border text-xs",
                    species === key
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {sp.label}
                </button>
              ))}
            </div>
          </div>

          {/* Class */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t("dm_class")}</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(ruleset.classes).map(([key, cl]) => (
                <button
                  key={key}
                  onClick={() => setCharClass(key)}
                  title={cl.abilities.join("\n")}
                  className={cn(
                    "px-2.5 py-1 rounded-md border text-xs",
                    charClass === key
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {cl.label}
                </button>
              ))}
            </div>
          </div>

          {/* Stats method */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t("dm_stats")}</p>
            <div className="flex gap-1.5">
              {([
                ["roll", t("dm_method_roll")],
                ["array", t("dm_method_array")],
                ["manual", t("dm_method_manual")],
              ] as [Method, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setMethod(key)}
                  className={cn(
                    "px-2.5 py-1 rounded-md border text-xs",
                    method === key
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {method === "manual" && (
              <div className="grid grid-cols-6 gap-1.5 pt-1">
                {manualStats.map((v, i) => (
                  <Input
                    key={i}
                    type="number" min={3} max={18} value={v}
                    onChange={(e) => {
                      const next = [...manualStats];
                      next[i] = e.target.value;
                      setManualStats(next);
                    }}
                    className="h-7 text-xs text-center"
                  />
                ))}
              </div>
            )}
          </div>

          <Button
            variant="outline" size="sm" className="w-full"
            disabled={busy || (method === "manual" && !manualValid)}
            onClick={() => generate(false)}
          >
            <Dices className="h-3.5 w-3.5" />
            {draft ? t("dm_reroll") : t("dm_create_character")}
          </Button>

          {/* Draft review */}
          {draft && sheet && (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm font-medium" />
                <Button
                  variant="outline" size="sm" className="h-8 shrink-0" title={t("dm_generate_name")}
                  disabled={busy}
                  onClick={async () => {
                    const d = await dmApi.generateCharacter(projectId, {
                      species, char_class: charClass, method: "array",
                    });
                    setName(d.name);
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="grid grid-cols-6 gap-1 text-center">
                {Object.entries(sheet.stats).map(([stat, value]) => (
                  <div key={stat} className="rounded-md bg-secondary/50 py-1">
                    <p className="text-[9px] uppercase text-muted-foreground">{stat}</p>
                    <p className="text-sm font-semibold tabular-nums">{value}</p>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 text-xs">
                <span><span className="text-muted-foreground">{t("dm_hp")}</span> <b>{sheet.hp.max}</b></span>
                <span><span className="text-muted-foreground">{t("dm_ac")}</span> <b>{sheet.ac}</b></span>
              </div>

              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-1">{t("dm_abilities")}</p>
                <ul className="space-y-0.5 text-xs list-disc pl-4">
                  {sheet.abilities.map((a) => <li key={a}>{a}</li>)}
                </ul>
              </div>

              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-1">{t("dm_gear")}</p>
                <p className="text-xs text-muted-foreground">
                  {sheet.gear.map((g) => (g.qty > 1 ? `${g.name} ×${g.qty}` : g.name)).join(", ")}
                </p>
              </div>

              {draft.stat_rolls && (
                <p className="text-[10px] text-muted-foreground">
                  4d6: {draft.stat_rolls.map((r) => `[${r.dice.join(",")}]→${r.total}`).join("  ")}
                </p>
              )}
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>{t("common_cancel")}</Button>
            <Button onClick={save} disabled={!draft || !name.trim() || busy}>
              {t("dm_save_character")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
