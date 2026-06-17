"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { valeApi, type ValeDisabledEntries, type ValeRuleEntry, type ValeRuleMeta } from "@/lib/api";

const LANGUAGES: { code: string; label: string }[] = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "it", label: "Italiano" },
  { code: "nl", label: "Nederlands" },
  { code: "no", label: "Norsk" },
  { code: "pt", label: "Português" },
  { code: "sv", label: "Svenska" },
  { code: "da", label: "Dansk" },
];

const RULE_LABELS: Record<string, string> = {
  Anglizismen: "Anglicisms",
  Buzzwords: "Buzzwords",
  FalscheFreunde: "False Friends",
  Klischees: "Clichés",
  NominalStyle: "Nominal Style",
  Passive: "Passive Voice",
  Redundancy: "Redundancy",
  ReflexiveVerbs: "Reflexive Verbs",
  WeaselWords: "Weasel Words",
  WordyPhrases: "Wordy Phrases",
  FalsosAmigos: "False Friends",
  FauxAmis: "False Friends",
  FalsiAmici: "False Friends",
  SprakFel: "Language Errors",
  SprogFejl: "Language Errors",
  SprakFeil: "Language Errors",
  ErroresComunes: "Common Errors",
  Anglicismes: "Anglicisms",
  Anglicismi: "Anglicisms",
  Estrangeirismos: "Foreign Words",
};

function ruleLabel(name: string) {
  return RULE_LABELS[name] ?? name.replace(/([A-Z])/g, " $1").trim();
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ValeRulesModal({ open, onClose }: Props) {
  const [selectedLang, setSelectedLang] = useState("de");
  const [selectedRule, setSelectedRule] = useState<string>("");
  const [rulesByLang, setRulesByLang] = useState<Record<string, ValeRuleMeta[]>>({});
  const [entriesByKey, setEntriesByKey] = useState<Record<string, ValeRuleEntry[]>>({});
  const [entryTypes, setEntryTypes] = useState<Record<string, "existence" | "substitution">>({});
  const [disabled, setDisabled] = useState<ValeDisabledEntries>({});
  const [loadingRules, setLoadingRules] = useState(false);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load disabled entries once on open
  useEffect(() => {
    if (!open) return;
    valeApi.getDisabledEntries().then(r => setDisabled(r.disabled ?? {})).catch(() => {});
  }, [open]);

  // Load rule list when language changes
  useEffect(() => {
    if (!open) return;
    if (rulesByLang[selectedLang]) {
      if (!selectedRule) setSelectedRule(rulesByLang[selectedLang][0]?.name ?? "");
      return;
    }
    setLoadingRules(true);
    valeApi.getRuleMeta(selectedLang)
      .then(r => {
        setRulesByLang(prev => ({ ...prev, [selectedLang]: r.rules ?? [] }));
        setSelectedRule(r.rules?.[0]?.name ?? "");
      })
      .catch(() => {})
      .finally(() => setLoadingRules(false));
  }, [open, selectedLang]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load entries when rule changes
  useEffect(() => {
    if (!selectedRule || !selectedLang) return;
    const cacheKey = `${selectedLang}/${selectedRule}`;
    if (entriesByKey[cacheKey]) return;
    setLoadingEntries(true);
    valeApi.getRuleEntries(selectedLang, selectedRule)
      .then(r => {
        setEntriesByKey(prev => ({ ...prev, [cacheKey]: r.entries }));
        setEntryTypes(prev => ({ ...prev, [cacheKey]: r.type }));
      })
      .catch(() => {})
      .finally(() => setLoadingEntries(false));
  }, [selectedLang, selectedRule]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveDisabled = useCallback((next: ValeDisabledEntries) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      valeApi.updateDisabledEntries(next).catch(() => {});
    }, 400);
  }, []);

  function toggleEntry(key: string) {
    const langMap = disabled[selectedLang] ?? {};
    const ruleDisabled = langMap[selectedRule] ?? [];
    const next = ruleDisabled.includes(key)
      ? ruleDisabled.filter(k => k !== key)
      : [...ruleDisabled, key];
    const nextDisabled: ValeDisabledEntries = {
      ...disabled,
      [selectedLang]: { ...langMap, [selectedRule]: next },
    };
    setDisabled(nextDisabled);
    saveDisabled(nextDisabled);
  }

  function toggleAll(allKeys: string[], enable: boolean) {
    const langMap = disabled[selectedLang] ?? {};
    const next: ValeDisabledEntries = {
      ...disabled,
      [selectedLang]: { ...langMap, [selectedRule]: enable ? [] : [...allKeys] },
    };
    setDisabled(next);
    saveDisabled(next);
  }

  const cacheKey = `${selectedLang}/${selectedRule}`;
  const entries = entriesByKey[cacheKey] ?? [];
  const entryType = entryTypes[cacheKey] ?? "existence";
  const disabledForRule = new Set(disabled[selectedLang]?.[selectedRule] ?? []);
  const allDisabled = entries.length > 0 && entries.every(e => disabledForRule.has(e.key));
  const rules = rulesByLang[selectedLang] ?? [];

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden h-[560px] flex flex-col">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-border shrink-0">
          <DialogTitle className="text-base">Vale — Rule Configuration</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 min-h-0">
          {/* Language sidebar */}
          <aside className="w-32 shrink-0 border-r border-border overflow-y-auto py-2">
            {LANGUAGES.map(({ code, label }) => (
              <button
                key={code}
                type="button"
                onClick={() => { setSelectedLang(code); setSelectedRule(""); }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-sm transition-colors",
                  selectedLang === code
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                )}
              >
                {label}
              </button>
            ))}
          </aside>

          {/* Main area */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {/* Rule dropdown */}
            <div className="px-4 py-3 border-b border-border shrink-0 flex items-center gap-3">
              {loadingRules ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <select
                  value={selectedRule}
                  onChange={e => setSelectedRule(e.target.value)}
                  className="flex-1 h-8 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {rules.map(r => (
                    <option key={r.name} value={r.name}>{ruleLabel(r.name)}</option>
                  ))}
                  {rules.length === 0 && <option value="">No rules available</option>}
                </select>
              )}
              {entries.length > 0 && (
                <button
                  type="button"
                  onClick={() => toggleAll(entries.map(e => e.key), allDisabled)}
                  className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {allDisabled ? "Enable all" : "Disable all"}
                </button>
              )}
            </div>

            {/* Entry list */}
            <div className="flex-1 overflow-y-auto">
              {loadingEntries ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : entries.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center mt-8">No entries</p>
              ) : (
                <ul>
                  {entries.map(entry => {
                    const isDisabled = disabledForRule.has(entry.key);
                    return (
                      <li key={entry.key}>
                        <label className="flex items-center gap-3 px-4 py-1.5 cursor-pointer hover:bg-muted/30 transition-colors group">
                          <span className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                            isDisabled
                              ? "border-border bg-background"
                              : "border-primary bg-primary"
                          )}>
                            {!isDisabled && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                          </span>
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={!isDisabled}
                            onChange={() => toggleEntry(entry.key)}
                          />
                          {entryType === "substitution" ? (
                            <span className={cn("text-xs flex-1 min-w-0 font-mono", isDisabled && "line-through text-muted-foreground/50")}>
                              <span className="text-foreground/80">{entry.key}</span>
                              <span className="text-muted-foreground mx-1.5">→</span>
                              <span className="text-muted-foreground">{entry.value}</span>
                            </span>
                          ) : (
                            <span className={cn("text-xs font-mono", isDisabled && "line-through text-muted-foreground/50")}>
                              {entry.key}
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Footer count */}
            {entries.length > 0 && (
              <div className="px-4 py-2 border-t border-border shrink-0">
                <p className="text-[11px] text-muted-foreground">
                  {entries.length - disabledForRule.size} / {entries.length} active
                  {disabledForRule.size > 0 && <span className="ml-1.5 text-amber-500">· {disabledForRule.size} disabled</span>}
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
