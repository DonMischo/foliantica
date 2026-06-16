"use client";

import { useState } from "react";
import { AlertCircle, AlertTriangle, Info, Loader2, Copy, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ValeAlert } from "@/lib/api";
import { useValeCheck } from "@/store/queries";

function langName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

// German articles / relative pronouns that legitimately double up after a comma
// in relative clauses ("die Frauen, die die Bücher lesen").
const DE_RELATIVE = new Set([
  "die", "der", "das", "dem", "den", "des",
  "welche", "welcher", "welches", "welchem", "welchen",
  "was", "wer", "wen", "wem",
]);

// Downgrade Vale.Repetition hits that are almost certainly valid relative-clause
// constructions rather than true typos.
function postProcessAlerts(alerts: ValeAlert[], text: string, language: string | undefined): ValeAlert[] {
  const lang = (language ?? "").toLowerCase().slice(0, 2);
  if (lang !== "de") return alerts;

  return alerts.map(alert => {
    if (alert.Check !== "Vale.Repetition") return alert;
    const word = alert.Match.toLowerCase().split(/\s+/)[0];
    if (!DE_RELATIVE.has(word)) return alert;
    // Span is 1-based column into `text`; look for a comma with only whitespace
    // between it and the start of the repeated word.
    const offset = alert.Span[0] - 1;
    const before = text.slice(Math.max(0, offset - 12), offset);
    const commaIdx = before.lastIndexOf(",");
    if (commaIdx !== -1 && before.slice(commaIdx + 1).trim() === "") {
      return { ...alert, Severity: "warning" as const };
    }
    return alert;
  });
}

// ── Friendly display names for Vale built-in rules ────────────────────────────
const RULE_LABELS: Record<string, string> = {
  "Vale.Repetition": "Double Words",
  "Vale.Spelling":   "Spelling",
};

// ── Severity config ───────────────────────────────────────────────────────────

const SEV = {
  error:      { icon: AlertCircle,   color: "text-red-500",    bg: "bg-red-500/10",    border: "border-red-500/20",    label: "Errors" },
  warning:    { icon: AlertTriangle, color: "text-amber-500",  bg: "bg-amber-500/10",  border: "border-amber-500/20",  label: "Warnings" },
  suggestion: { icon: Info,          color: "text-blue-500",   bg: "bg-blue-500/10",   border: "border-blue-500/20",   label: "Suggestions" },
} as const;

// ── Alert card ────────────────────────────────────────────────────────────────

function AlertCard({ alert, onJumpTo }: { alert: ValeAlert; onJumpTo?: (matched: string, offset: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const cfg = SEV[alert.Severity] ?? SEV.suggestion;
  const Icon = cfg.icon;

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(text);
    setTimeout(() => setCopied(null), 1500);
  };

  const hasDetails =
    !!alert.Description ||
    (alert.Action.Name === "replace" && alert.Action.Params.length > 0) ||
    !!alert.Link;

  const handleClick = () => {
    if (hasDetails) setExpanded(e => !e);
    onJumpTo?.(alert.Match, alert.Span[0] - 1);
  };

  // Rule name: e.g. "write-good.Weasel" → show short name "Weasel" + package "write-good"
  const [pkg, ruleName] = alert.Check.includes(".")
    ? alert.Check.split(".", 2)
    : ["Vale", alert.Check];

  return (
    <div
      className={cn("rounded-md border text-xs", cfg.border, cfg.bg)}
      onClick={handleClick}
    >
      {/* Header */}
      <div className="flex items-start gap-2 px-2.5 py-2 cursor-pointer select-none">
        <Icon className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", cfg.color)} />
        <div className="flex-1 min-w-0">
          <p className="leading-snug text-foreground">{alert.Message}</p>
          <p className="text-muted-foreground mt-0.5 truncate">
            <span className="font-mono">{alert.Match}</span>
            <span className="ml-1.5 opacity-50">· {pkg}<span className="text-foreground/40">.</span>{ruleName}</span>
          </p>
        </div>
      </div>

      {/* Expanded: description + replacements */}
      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-1.5 border-t border-inherit pt-2">
          {alert.Description && (
            <p className="text-muted-foreground leading-snug">{alert.Description}</p>
          )}
          {alert.Action.Name === "replace" && alert.Action.Params.length > 0 && (
            <div>
              <p className="text-muted-foreground mb-1">Suggestions:</p>
              <div className="flex flex-wrap gap-1">
                {alert.Action.Params.slice(0, 5).map(p => (
                  <button
                    key={p}
                    onClick={e => { e.stopPropagation(); copy(p); }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-border bg-background hover:bg-secondary/50 transition-colors font-mono"
                  >
                    {copied === p ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
          {alert.Link && (
            <a
              href={alert.Link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-primary hover:underline text-[10px]"
            >
              Rule details ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  text: string;
  language?: string;
  onClose: () => void;
  onJumpTo?: (matched: string, offset: number) => void;
}

const SEVERITIES: ValeAlert["Severity"][] = ["error", "warning", "suggestion"];

export function ValePanel({ text, language, onClose, onJumpTo }: Props) {
  const check = useValeCheck();

  const byGroup = postProcessAlerts(check.data?.alerts ?? [], text, language).reduce<Record<string, ValeAlert[]>>(
    (acc, a) => { (acc[a.Severity] ??= []).push(a); return acc; },
    {},
  );
  const total = check.data?.alerts.length ?? 0;

  return (
    <div className="w-72 shrink-0 border-l border-border flex flex-col h-full bg-card text-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <span className="font-semibold text-sm">Style Checker</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-base leading-none px-1">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {!check.data && !check.isPending && !check.isError && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            Vale checks your prose for style issues using configured rule packages. Click <strong className="text-foreground">Run Vale</strong> to analyse this scene.
          </p>
        )}

        {check.isPending && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
              Analysing…
            </div>
          </div>
        )}

        {check.isError && (
          <p className="text-xs text-destructive leading-snug">
            {check.error?.message ?? "Vale check failed"}
          </p>
        )}

        {check.data && total === 0 && (
          <div className="flex items-center gap-2 text-xs text-green-500">
            <Check className="h-3.5 w-3.5 shrink-0" />
            No issues found
          </div>
        )}

        {check.data && total > 0 && (
          <>
            <p className="text-xs text-muted-foreground">{total} issue{total !== 1 ? "s" : ""} found</p>
            {SEVERITIES.map(sev => {
              const alerts = byGroup[sev];
              if (!alerts?.length) return null;
              const cfg = SEV[sev];

              // Group by Check rule so the same rule firing N times collapses into one block
              const byRule = alerts.reduce<Record<string, ValeAlert[]>>((acc, a) => {
                (acc[a.Check] ??= []).push(a);
                return acc;
              }, {});

              return (
                <div key={sev}>
                  <p className={cn("text-[10px] font-semibold uppercase tracking-wider mb-1.5", cfg.color)}>
                    {cfg.label} ({alerts.length})
                  </p>
                  <div className="space-y-3">
                    {Object.entries(byRule).map(([rule, ruleAlerts]) => {
                      const [pkg, ruleName] = rule.includes(".")
                        ? rule.split(".", 2)
                        : ["Vale", rule];
                      const friendlyName = RULE_LABELS[rule];
                      return (
                        <div key={rule}>
                          <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                            {friendlyName
                              ? <span>{friendlyName}</span>
                              : <><span className="opacity-50 font-mono">{pkg}.</span><span>{ruleName}</span></>
                            }
                            {ruleAlerts.length > 1 && (
                              <span className="ml-auto text-[10px] tabular-nums opacity-60">×{ruleAlerts.length}</span>
                            )}
                          </p>
                          <div className="space-y-1.5">
                            {ruleAlerts.map((a, i) => <AlertCard key={i} alert={a} onJumpTo={onJumpTo} />)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2.5 border-t border-border shrink-0 space-y-2">
        <Button
          size="sm"
          className="w-full"
          onClick={() => check.mutate({ text, language })}
          disabled={check.isPending}
        >
          {check.isPending
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Analysing…</>
            : "Run Vale"}
        </Button>
        <p className="text-[10px] text-muted-foreground leading-snug">
          {language
            ? <>Language: <span className="text-foreground/70">{langName(language)}</span> <span className="opacity-50">(from Project Info)</span></>
            : <>Using default English — set language in <span className="opacity-70">Project Info</span></>
          }
        </p>
      </div>
    </div>
  );
}
