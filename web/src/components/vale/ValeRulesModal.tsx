"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Plus, RefreshCw, AlertTriangle, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { valeApi, type ValeCustomRules, type ValeRuleEntry, type ValeRuleMeta } from "@/lib/api";

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
  const [savedEntriesByKey, setSavedEntriesByKey] = useState<Record<string, ValeRuleEntry[]>>({});
  const [entryTypes, setEntryTypes] = useState<Record<string, "existence" | "substitution">>({});
  const [loadingRules, setLoadingRules] = useState(false);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [savingEntries, setSavingEntries] = useState(false);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
  const syncChecked = useRef(false);

  // Custom rules state
  const [customRules, setCustomRules] = useState<ValeCustomRules>({});
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [customSaving, setCustomSaving] = useState(false);

  const runSync = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await valeApi.syncRules();
      setLastSynced(r.last_synced);
      setSyncErrors(r.errors ?? {});
      setRulesByLang({});
      setEntriesByKey({});
      setSavedEntriesByKey({});
      setEntryTypes({});
      setSelectedRule("");
    } catch {
      // keep going, will show stale data
    } finally {
      setSyncing(false);
    }
  }, []);

  // Load custom rules every time the modal opens
  useEffect(() => {
    if (!open) return;
    valeApi.getCustomRules().then(c => setCustomRules(c.rules ?? {})).catch(() => {});
  }, [open]);

  // On open: check sync status, auto-sync if never synced (once per open)
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
    if (!selectedRule || !selectedLang) {
      setLoadingEntries(false);
      return;
    }
    const cacheKey = `${selectedLang}/${selectedRule}`;
    if (entriesByKey[cacheKey]) {
      setLoadingEntries(false);
      return;
    }
    let active = true;
    setLoadingEntries(true);
    valeApi.getRuleEntries(selectedLang, selectedRule)
      .then(r => {
        if (!active) return;
        setEntriesByKey(prev => ({ ...prev, [cacheKey]: r.entries }));
        setSavedEntriesByKey(prev => ({ ...prev, [cacheKey]: r.entries }));
        setEntryTypes(prev => ({ ...prev, [cacheKey]: r.type }));
      })
      .catch(() => {})
      .finally(() => { if (active) setLoadingEntries(false); });
    return () => { active = false; };
  }, [selectedLang, selectedRule]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleEntry(key: string) {
    const cacheKey = `${selectedLang}/${selectedRule}`;
    setEntriesByKey(prev => {
      const current = prev[cacheKey] ?? [];
      const entry = current.find(e => e.key === key);
      if (!entry) return prev;
      return {
        ...prev,
        [cacheKey]: current.map(e => e.key === key ? { ...e, enabled: !e.enabled } : e),
      };
    });
  }

  function toggleAll(enable: boolean) {
    const cacheKey = `${selectedLang}/${selectedRule}`;
    setEntriesByKey(prev => ({
      ...prev,
      [cacheKey]: (prev[cacheKey] ?? []).map(e => ({ ...e, enabled: enable })),
    }));
  }

  async function saveEntries() {
    const ck = `${selectedLang}/${selectedRule}`;
    const current = entriesByKey[ck] ?? [];
    const saved = savedEntriesByKey[ck] ?? [];
    const changed = current.filter(e => {
      const orig = saved.find(s => s.key === e.key);
      return orig && orig.enabled !== e.enabled;
    });
    if (changed.length === 0) return;
    setSavingEntries(true);
    try {
      await Promise.all(changed.map(e => valeApi.toggleEntry(selectedLang, selectedRule, e.key, e.enabled)));
      setSavedEntriesByKey(prev => ({ ...prev, [ck]: current }));
    } catch {
      setEntriesByKey(prev => ({ ...prev, [ck]: saved }));
    } finally {
      setSavingEntries(false);
    }
  }

  // ── Custom rule helpers ───────────────────────────────────────────────────

  function buildCustomUpdate(entries: string[] | Record<string, string>): ValeCustomRules {
    return {
      ...customRules,
      [selectedLang]: { ...(customRules[selectedLang] ?? {}), [selectedRule]: entries },
    };
  }

  async function saveCustom(next: ValeCustomRules) {
    setCustomSaving(true);
    try { await valeApi.updateCustomRules(next); } catch {} finally { setCustomSaving(false); }
  }

  function addCustomEntry() {
    const ik = `${selectedLang}/${selectedRule}`;
    const ikB = `${ik}:b`;
    if (entryType === "existence") {
      const token = (customInputs[ik] ?? "").trim();
      if (!token) return;
      const prev = (customRules[selectedLang]?.[selectedRule] as string[] | undefined) ?? [];
      if (prev.includes(token)) return;
      const next = buildCustomUpdate([...prev, token]);
      setCustomRules(next);
      setCustomInputs(p => ({ ...p, [ik]: "" }));
      saveCustom(next);
    } else {
      const orig = (customInputs[ik] ?? "").trim();
      const repl = (customInputs[ikB] ?? "").trim();
      if (!orig || !repl) return;
      const prev = (customRules[selectedLang]?.[selectedRule] as Record<string, string> | undefined) ?? {};
      const next = buildCustomUpdate({ ...prev, [orig]: repl });
      setCustomRules(next);
      setCustomInputs(p => ({ ...p, [ik]: "", [ikB]: "" }));
      saveCustom(next);
    }
  }

  function removeCustomEntry(key: string) {
    if (entryType === "existence") {
      const prev = (customRules[selectedLang]?.[selectedRule] as string[] | undefined) ?? [];
      const next = buildCustomUpdate(prev.filter(t => t !== key));
      setCustomRules(next);
      saveCustom(next);
    } else {
      const prev = { ...((customRules[selectedLang]?.[selectedRule] as Record<string, string> | undefined) ?? {}) };
      delete prev[key];
      const next = buildCustomUpdate(prev);
      setCustomRules(next);
      saveCustom(next);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function displayKey(raw: string) {
    return raw.replace(/^\\b|\\b$/g, "");
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const cacheKey = `${selectedLang}/${selectedRule}`;
  const entries = entriesByKey[cacheKey] ?? [];
  const entryType = entryTypes[cacheKey] ?? "existence";
  const activeCount = entries.filter(e => e.enabled).length;
  const allDisabled = entries.length > 0 && activeCount === 0;
  const rules = rulesByLang[selectedLang] ?? [];
  const errorCount = Object.keys(syncErrors).length;
  const isDirty = (entriesByKey[cacheKey] ?? []).some(e => {
    const orig = (savedEntriesByKey[cacheKey] ?? []).find(s => s.key === e.key);
    return orig && orig.enabled !== e.enabled;
  });

  const customForRule = customRules[selectedLang]?.[selectedRule];
  const customTokens: string[] = entryType === "existence"
    ? ((customForRule as string[] | undefined) ?? [])
    : [];
  const customPairs: Record<string, string> = entryType === "substitution"
    ? ((customForRule as Record<string, string> | undefined) ?? {})
    : {};
  const customCount = entryType === "existence" ? customTokens.length : Object.keys(customPairs).length;

  const syncLabel = syncing
    ? null
    : lastSynced
      ? new Date(lastSynced).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "Not synced";

  const ik = `${selectedLang}/${selectedRule}`;
  const ikB = `${ik}:b`;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="max-w-2xl p-0 gap-0 overflow-hidden h-[580px] flex flex-col">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-base">Vale — Rule Configuration</DialogTitle>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground mr-7">
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
                <>
                  <button
                    type="button"
                    onClick={() => toggleAll(allDisabled)}
                    className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {allDisabled ? "Enable all" : "Disable all"}
                  </button>
                  {isDirty && (
                    <button
                      type="button"
                      onClick={saveEntries}
                      disabled={savingEntries}
                      className="shrink-0 text-xs font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
                    >
                      {savingEntries ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Entry list */}
            <div className="flex-1 overflow-y-auto">
              {loadingEntries || syncing ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : (
                <>
                  {entries.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center mt-8">
                      {lastSynced ? "No entries" : "Sync to load entries"}
                    </p>
                  )}
                  {entries.length > 0 && (
                    <ul>
                      {entries.map(entry => (
                        <li key={entry.key}>
                          <button
                            type="button"
                            onClick={() => toggleEntry(entry.key)}
                            className="w-full flex items-center gap-3 px-4 py-1.5 text-left hover:bg-muted/30 transition-colors"
                          >
                            <span className={cn(
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                              entry.enabled
                                ? "border-primary bg-primary"
                                : "border-border bg-background"
                            )}>
                              {entry.enabled && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                            </span>
                            {entryType === "substitution" ? (
                              <span className={cn("text-xs flex-1 min-w-0 font-mono", !entry.enabled && "line-through text-muted-foreground/50")}>
                                <span className="text-foreground/80">{displayKey(entry.key)}</span>
                                <span className="text-muted-foreground mx-1.5">→</span>
                                <span className="text-muted-foreground">{displayKey(entry.value)}</span>
                              </span>
                            ) : (
                              <span className={cn("text-xs font-mono", !entry.enabled && "line-through text-muted-foreground/50")}>
                                {displayKey(entry.key)}
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Custom entries section */}
                  {selectedRule && (
                    <div className="border-t border-border/50 mt-1">
                      <div className="flex items-center justify-between px-4 py-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">Custom</p>
                        {customSaving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/40" />}
                      </div>

                      {entryType === "existence" ? (
                        <div className="px-4 space-y-1 pb-3">
                          {customTokens.map(tok => (
                            <div key={tok} className="flex items-center gap-2">
                              <span className="text-xs font-mono flex-1 text-foreground/70">{tok}</span>
                              <button
                                type="button"
                                onClick={() => removeCustomEntry(tok)}
                                className="text-muted-foreground/50 hover:text-foreground transition-colors"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                          <div className="flex gap-1 pt-0.5">
                            <input
                              type="text"
                              value={customInputs[ik] ?? ""}
                              onChange={e => setCustomInputs(p => ({ ...p, [ik]: e.target.value }))}
                              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCustomEntry(); } }}
                              placeholder="Add word or phrase…"
                              className="flex-1 h-6 text-[11px] bg-background border border-border/60 rounded px-2 focus:outline-none focus:border-primary/50"
                            />
                            <button
                              type="button"
                              onClick={addCustomEntry}
                              disabled={!(customInputs[ik] ?? "").trim()}
                              className="h-6 px-2 rounded border border-border/60 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors disabled:opacity-30"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="px-4 space-y-1 pb-3">
                          {Object.entries(customPairs).map(([orig, repl]) => (
                            <div key={orig} className="flex items-center gap-1.5">
                              <span className="text-xs font-mono text-foreground/70 flex-1 min-w-0 truncate">
                                {orig}
                                <span className="text-muted-foreground mx-1">→</span>
                                {repl}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeCustomEntry(orig)}
                                className="text-muted-foreground/50 hover:text-foreground transition-colors shrink-0"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                          <div className="flex gap-1 pt-0.5 items-center">
                            <input
                              type="text"
                              value={customInputs[ik] ?? ""}
                              onChange={e => setCustomInputs(p => ({ ...p, [ik]: e.target.value }))}
                              placeholder="Original…"
                              className="flex-1 h-6 text-[11px] bg-background border border-border/60 rounded px-2 focus:outline-none focus:border-primary/50 font-mono"
                            />
                            <span className="text-muted-foreground text-[11px]">→</span>
                            <input
                              type="text"
                              value={customInputs[ikB] ?? ""}
                              onChange={e => setCustomInputs(p => ({ ...p, [ikB]: e.target.value }))}
                              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCustomEntry(); } }}
                              placeholder="Replacement…"
                              className="flex-1 h-6 text-[11px] bg-background border border-border/60 rounded px-2 focus:outline-none focus:border-primary/50 font-mono"
                            />
                            <button
                              type="button"
                              onClick={addCustomEntry}
                              disabled={!(customInputs[ik] ?? "").trim() || !(customInputs[ikB] ?? "").trim()}
                              className="h-6 px-2 rounded border border-border/60 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors disabled:opacity-30"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      )}
                      <p className="px-4 pt-0.5 pb-2 text-[10px] text-muted-foreground/40 leading-relaxed">
                        <code className="font-mono">\b</code> = word boundary — <code className="font-mono">\bword\b</code> matches <em>whole word</em>, bare <code className="font-mono">word</code> matches anywhere in text
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            {(entries.length > 0 || customCount > 0) && (
              <div className="px-4 py-2 border-t border-border shrink-0">
                <p className="text-[11px] text-muted-foreground">
                  {activeCount} / {entries.length} active
                  {activeCount < entries.length && (
                    <span className="ml-1.5 text-amber-500">· {entries.length - activeCount} disabled</span>
                  )}
                  {customCount > 0 && (
                    <span className="ml-1.5 text-violet-400">· {customCount} custom</span>
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
