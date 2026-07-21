"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { codexApi, projectsApi, dmApi } from "@/lib/api";
import { useDmPrefs } from "@/store/queries";
import { useLanguage } from "@/contexts/LanguageContext";
import type { SessionZeroAnswers } from "@/types";

const TONES = ["Grim & gritty", "Heroic", "Weird & wondrous", "Horror", "Intrigue", "Comedic"];

const LANGUAGES: [string, string][] = [
  ["en", "English"], ["de", "Deutsch"], ["es", "Español"], ["fr", "Français"],
  ["it", "Italiano"], ["pt", "Português"], ["nl", "Nederlands"], ["pl", "Polski"],
  ["sv", "Svenska"], ["da", "Dansk"], ["no", "Norsk"], ["cs", "Čeština"],
  ["ru", "Русский"], ["zh", "中文"], ["ja", "日本語"],
];

function composeBrief(a: SessionZeroAnswers): string {
  const tone = [...a.tone, a.tone_free.trim()].filter(Boolean).join(", ");
  const truths = a.truths.map((t, i) => `${i + 1}. ${t.trim()}`).filter((t) => t.length > 3);
  return [
    tone && `TONE: ${tone}`,
    a.genre.trim() && `GENRE TEXTURE: ${a.genre.trim()}`,
    truths.length && `WORLD TRUTHS:\n${truths.join("\n")}`,
    a.lines.trim() && `HARD LIMITS (never include): ${a.lines.trim()}`,
  ].filter(Boolean).join("\n\n");
}

export function SessionZeroWizard({
  projectId, open, onClose,
}: { projectId: number; open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const { data: prefs } = useDmPrefs(projectId);

  const [answers, setAnswers] = useState<SessionZeroAnswers>({
    tone: [], tone_free: "", genre: "", truths: ["", "", ""], lines: "",
  });
  const [language, setLanguage] = useState("en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill from a previous run
  useEffect(() => {
    if (open && prefs?.session_zero) setAnswers(prefs.session_zero);
    if (open && prefs?.language) setLanguage(prefs.language);
  }, [open, prefs?.session_zero, prefs?.language]);

  const toggleTone = (tone: string) =>
    setAnswers((a) => ({
      ...a,
      tone: a.tone.includes(tone) ? a.tone.filter((x) => x !== tone) : [...a.tone, tone],
    }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const previous = prefs?.session_zero;
      // Recompose the brief only when the setup answers actually changed —
      // a pure language switch must not overwrite an AI-refreshed brief.
      if (!previous || JSON.stringify(previous) !== JSON.stringify(answers)) {
        await projectsApi.update(projectId, { campaign_brief: composeBrief(answers) });
      }
      await dmApi.updatePrefs(projectId, { session_zero: answers, language });
      // World truths become lore codex entries — but only on first save, not on edits
      if (!previous) {
        for (const truth of answers.truths.map((x) => x.trim()).filter((x) => x.length > 3)) {
          await codexApi.create({
            project_id: projectId,
            name: truth.length > 60 ? `${truth.slice(0, 57)}…` : truth,
            aliases: [],
            entry_type: "lore",
            description: truth,
            notes: null,
            color: "#f59e0b",
            groups: [],
            species: null,
            subtype: null,
            gender: null,
            tags: [],
            is_main_char: false,
            inventory: null,
            rpg_sheet: null,
            image_path: null,
            image_crop: null,
            name_type: null,
            share_mode: "all",
            share_future: true,
          });
        }
      }
      qc.invalidateQueries({ queryKey: ["projects", projectId] });
      qc.invalidateQueries({ queryKey: ["dm-prefs", projectId] });
      qc.invalidateQueries({ queryKey: ["codex", projectId] });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\d+: /, "") : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            {t("dm_session_zero")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t("dm_language")}</p>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              {LANGUAGES.map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t("dm_tone")}</p>
            <div className="flex flex-wrap gap-1.5">
              {TONES.map((tone) => (
                <button
                  key={tone}
                  onClick={() => toggleTone(tone)}
                  className={cn(
                    "px-2.5 py-1 rounded-md border text-xs",
                    answers.tone.includes(tone)
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tone}
                </button>
              ))}
            </div>
            <Input
              value={answers.tone_free}
              onChange={(e) => setAnswers((a) => ({ ...a, tone_free: e.target.value }))}
              placeholder="…"
              className="h-7 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t("dm_genre")}</p>
            <Textarea
              value={answers.genre}
              onChange={(e) => setAnswers((a) => ({ ...a, genre: e.target.value }))}
              rows={2}
              className="text-xs"
              placeholder="Rust-age sword & sorcery; no elves, gods are bureaucrats, gunpowder is new and feared…"
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t("dm_truths")}</p>
            {answers.truths.map((truth, i) => (
              <Input
                key={i}
                value={truth}
                onChange={(e) => {
                  const truths = [...answers.truths];
                  truths[i] = e.target.value;
                  setAnswers((a) => ({ ...a, truths }));
                }}
                className="h-8 text-xs"
                placeholder={`${i + 1}.`}
              />
            ))}
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t("dm_lines")}</p>
            <Textarea
              value={answers.lines}
              onChange={(e) => setAnswers((a) => ({ ...a, lines: e.target.value }))}
              rows={2}
              className="text-xs"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>{t("common_cancel")}</Button>
            <Button onClick={save} disabled={busy}>
              {t("dm_save_setup")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
