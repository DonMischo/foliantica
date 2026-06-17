"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { valeApi, type ValeRuleEntry, type ValeRuleMeta } from "@/lib/api";

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
  Anglicismen: "Anglicisms",
  Buzzwords: "Buzzwords",
  FalscheFreunde: "False Friends",
  Klischees: "Clichés",
  NominalStyle: "Nominal Style",
  Passive: "Passive Voice",
  Redundancy: "Redundancy",
  ReflexiveVerbs: "Reflexive Verbs",
  TaalFouten: "Language Errors",
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
  const [loadingRules, setLoadingRules] = useState(false);
  const [loadingEntries, setLoadingEntries] = useState(false);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
  const syncChecked = useRef(false);

  const runSync = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await valeApi.syncRules();
      setLastSynced(r.last_synced);
      setSyncErrors(r.errors ?? {});
      // Invalidate cached rules/entries so they reload from DB
      setRulesByLang({});
      setEntriesByKey({});
      setEntryTypes({});
      setSelectedRule("");
    } catch {
      // keep going, will show stale data
    } finally {
      setSyncing(false);
    }
  }, []);

  // On open: check sync status, auto-sync if never synced
  useEffect(() => {
    if (!open || syncChecked.current) return;
    syncChecked.current = true;
    valeApi.getSyncStatus().then(s => {
      setLastSynced(s.last_synced);
      setSyncErrors(s.errors ?? {});
      if (!s.last_synced) runSync();
    }).catch(() => {});
  }, [open, runSync]);

  // Reset sync check when modal closes
  useEffect(() => {
    if (!open) syncChecked.current = false;
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
  }, [open, selectedLang, rulesByLang]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function toggleEntry(key: string) {
    const cacheKey = `${selectedLang}/${selectedRule}`;
    const current = entriesByKey[cacheKey] ?? [];
    const entry = current.find(e => e.key === key);
    if (!entry) return;
    const newEnabled = !entry.enabled;
    // Optimistic update
    setEntriesByKey(prev => ({
      ...prev,
      [cacheKey]: current.map(e => e.key === key ? { ...e, enabled: newEnabled } : e),
    }));
    valeApi.toggleEntry(selectedLang, selectedRule, key, newEnabled).catch(() => {
      setEntriesByKey(prev => ({ ...prev, [cacheKey]: current }));
    });
  }

  function toggleAll(enable: boolean) {
    const cacheKey = `${selectedLang}/${selectedRule}`;
    const current = entriesByKey[cacheKey] ?? [];
    setEntriesByKey(prev => ({
      ...prev,
      [cacheKey]: current.map(e => ({ ...e, enabled: enable })),
    }));
    valeApi.toggleAllEntries(selectedLang, selectedRule, enable).catch(() => {
      setEntriesByKey(prev => ({ ...prev, [cacheKey]: current }));
    });
  }

  const cacheKey = `${selectedLang}/${selectedRule}`;
  const entries = entriesByKey[cacheKey] ?? [];
  const entryType = entryTypes[cacheKey] ?? "existence";
  const activeCount = entries.filter(e => e.enabled).length;
  const allDisabled = entries.length > 0 && activeCount === 0;
  const rules = rulesByLang[selectedLang] ?? [];
  const errorCount = Object.keys(syncErrors).length;

  const syncLabel = syncing
    ? null
    : lastSynced
      ? new Date(lastSynced).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "Not synced";

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden h-[560px] flex flex-col">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-base">Vale — Rule Configuration</DialogTitle>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {errorCount > 0 && (
                <span className="flex items-center gap-1 text-amber-500">
                  <AlertTriangle className="h-3 w-3" />
                  {errorCount} file {errorCount === 1 ? "error" : "errors"}
                </span>
              )}
              {syncing ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Syncing…
                </span>
              ) : (
                <span className="opacity-60">{syncLabel}</span>
              )}
              <button
                type="button"
                onClick={runSync}
                disabled={syncing}
                title="Re-sync rules from style files"
                className="p-0.5 rounded hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
            </div>
          </div>
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
              {loadingRules || syncing ? (
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
                  onClick={() => toggleAll(allDisabled)}
                  className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {allDisabled ? "Enable all" : "Disable all"}
                </button>
              )}
            </div>

            {/* Entry list */}
            <div className="flex-1 overflow-y-auto">
              {loadingEntries || syncing ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : entries.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center mt-8">
                  {lastSynced ? "No entries" : "Sync to load entries"}
                </p>
              ) : (
                <ul>
                  {entries.map(entry => (
                    <li key={entry.key}>
                      <label className="flex items-center gap-3 px-4 py-1.5 cursor-pointer hover:bg-muted/30 transition-colors">
                        <span className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                          entry.enabled
                            ? "border-primary bg-primary"
                            : "border-border bg-background"
                        )}>
                          {entry.enabled && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                        </span>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={entry.enabled}
                          onChange={() => toggleEntry(entry.key)}
                        />
                        {entryType === "substitution" ? (
                          <span className={cn("text-xs flex-1 min-w-0 font-mono", !entry.enabled && "line-through text-muted-foreground/50")}>
                            <span className="text-foreground/80">{entry.key}</span>
                            <span className="text-muted-foreground mx-1.5">→</span>
                            <span className="text-muted-foreground">{entry.value}</span>
                          </span>
                        ) : (
                          <span className={cn("text-xs font-mono", !entry.enabled && "line-through text-muted-foreground/50")}>
                            {entry.key}
                          </span>
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Footer */}
            {entries.length > 0 && (
              <div className="px-4 py-2 border-t border-border shrink-0">
                <p className="text-[11px] text-muted-foreground">
                  {activeCount} / {entries.length} active
                  {activeCount < entries.length && (
                    <span className="ml-1.5 text-amber-500">· {entries.length - activeCount} disabled</span>
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
