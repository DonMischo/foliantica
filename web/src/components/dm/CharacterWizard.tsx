"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dices, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { dmApi } from "@/lib/api";
import { useDmRuleset } from "@/store/queries";
import { useLanguage } from "@/contexts/LanguageContext";
import type { DmCharacterDraft, RpgAppearance } from "@/types";

type Method = "roll" | "array" | "manual";

function appearanceSentence(a: RpgAppearance): string {
  const bits = [
    `${a.size}, ${a.build}`,
    `${a.hair_color} hair ${a.hair_style}`,
    `${a.eye_color} eyes`,
    ...a.features,
    ...a.scars,
    ...a.tattoos,
  ].filter(Boolean);
  return bits.join("; ");
}

export function CharacterWizard({
  projectId, open, onClose,
}: { projectId: number; open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const { data: ruleset } = useDmRuleset();

  const [speciesSel, setSpeciesSel] = useState<string[]>(["human"]);
  const [charClass, setCharClass] = useState("fighter");
  const [gender, setGender] = useState<"male" | "female" | "div">("male");
  const [method, setMethod] = useState<Method>("roll");
  const [manualStats, setManualStats] = useState<string[]>(Array(6).fill(""));
  const [draft, setDraft] = useState<DmCharacterDraft | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleSpecies = (key: string) =>
    setSpeciesSel((sel) => {
      if (sel.includes(key)) return sel.filter((s) => s !== key);
      if (sel.length >= 2) return [sel[1], key]; // rotate: keep most recent + new
      return [...sel, key];
    });

  const genRequest = (overrides?: Partial<Parameters<typeof dmApi.generateCharacter>[1]>) => ({
    species: speciesSel[0],
    species2: speciesSel[1] || undefined,
    char_class: charClass,
    gender,
    method,
    manual_stats: method === "manual" ? manualStats.map(Number) : undefined,
    ...overrides,
  });

  const generate = async () => {
    if (speciesSel.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const data = await dmApi.generateCharacter(projectId, genRequest());
      setDraft(data);
      setName(data.name);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\d+: /, "") : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rerollName = async () => {
    if (busy || speciesSel.length === 0) return;
    const d = await dmApi.generateCharacter(projectId, genRequest({ method: "array" }));
    setName(d.name);
  };

  const setAppearance = (patch: Partial<RpgAppearance>) =>
    setDraft((d) => {
      if (!d) return d;
      const appearance = { ...d.appearance, ...patch };
      return { ...d, appearance, rpg_sheet: { ...d.rpg_sheet, appearance } };
    });

  const save = async () => {
    if (!draft || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const descParts = [
        description.trim() || `${draft.species} ${draft.class_label}`,
        appearanceSentence(draft.appearance),
      ];
      // Server-side save: kit becomes real codex inventory (item entries + currency)
      await dmApi.saveCharacter(projectId, {
        name: name.trim(),
        description: descParts.join("\n\n"),
        gender,
        rpg_sheet: draft.rpg_sheet,
      });
      qc.invalidateQueries({ queryKey: ["codex", projectId] });
      setDraft(null);
      setDescription("");
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
  const looks = draft?.appearance;

  const listField = (label: string, key: "features" | "scars" | "tattoos") => (
    <div className="space-y-0.5">
      <label className="text-[10px] text-muted-foreground">{label}</label>
      <Input
        value={looks?.[key].join(", ") ?? ""}
        onChange={(e) =>
          setAppearance({ [key]: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) } as Partial<RpgAppearance>)
        }
        className="h-7 text-xs"
      />
    </div>
  );

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
          {/* Species — pick one, or two for a halfblood */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              {t("dm_species")}
              {speciesSel.length === 2 && (
                <span className="ml-2 text-primary font-normal">{t("dm_halfblood")}</span>
              )}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(ruleset.species).map(([key, sp]) => (
                <button
                  key={key}
                  onClick={() => toggleSpecies(key)}
                  title={sp.trait}
                  className={cn(
                    "px-2.5 py-1 rounded-md border text-xs",
                    speciesSel.includes(key)
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {sp.label}
                </button>
              ))}
            </div>
            {speciesSel.length === 2 && (
              <p className="text-[10px] text-muted-foreground">{t("dm_halfblood_hint")}</p>
            )}
          </div>

          {/* Gender */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t("dm_gender")}</p>
            <div className="flex gap-1.5">
              {([
                ["male", t("dm_male")],
                ["female", t("dm_female")],
                ["div", t("dm_diverse")],
              ] as ["male" | "female" | "div", string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setGender(key)}
                  className={cn(
                    "px-2.5 py-1 rounded-md border text-xs",
                    gender === key
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
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
            disabled={busy || speciesSel.length === 0 || (method === "manual" && !manualValid)}
            onClick={generate}
          >
            <Dices className="h-3.5 w-3.5" />
            {draft ? t("dm_reroll") : t("dm_create_character")}
          </Button>

          {/* Draft review */}
          {draft && sheet && looks && (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm font-medium" />
                <Button
                  variant="outline" size="sm" className="h-8 shrink-0" title={t("dm_generate_name")}
                  disabled={busy}
                  onClick={rerollName}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">{draft.species} · {draft.class_label}</p>

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

              {/* Appearance — everything editable */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-muted-foreground">{t("dm_appearance")}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="space-y-0.5">
                    <label className="text-[10px] text-muted-foreground">{t("dm_size")}</label>
                    <Input value={looks.size} onChange={(e) => setAppearance({ size: e.target.value })} className="h-7 text-xs" />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-[10px] text-muted-foreground">{t("dm_build")}</label>
                    <Input value={looks.build} onChange={(e) => setAppearance({ build: e.target.value })} className="h-7 text-xs" />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-[10px] text-muted-foreground">{t("dm_hair")}</label>
                    <div className="flex gap-1">
                      <Input value={looks.hair_color} onChange={(e) => setAppearance({ hair_color: e.target.value })} className="h-7 text-xs" />
                      <Input value={looks.hair_style} onChange={(e) => setAppearance({ hair_style: e.target.value })} className="h-7 text-xs" />
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-[10px] text-muted-foreground">{t("dm_eyes")}</label>
                    <Input value={looks.eye_color} onChange={(e) => setAppearance({ eye_color: e.target.value })} className="h-7 text-xs" />
                  </div>
                </div>
                {listField(t("dm_features_label"), "features")}
                {listField(t("dm_scars"), "scars")}
                {listField(t("dm_tattoos"), "tattoos")}
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
                  {[
                    draft.starting_currency && `${draft.starting_currency.amount} ${draft.starting_currency.name}`,
                    ...sheet.gear.map((g) => (g.qty > 1 ? `${g.name} ×${g.qty}` : g.name)),
                  ].filter(Boolean).join(", ")}
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-[11px] font-medium text-muted-foreground">{t("dm_description")}</p>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="text-xs"
                />
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
