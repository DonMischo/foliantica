"use client";

import { useState } from "react";
import { AlertCircle, AlertTriangle, Info, Loader2, Copy, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ValeAlert } from "@/lib/api";
import { useValeCheck } from "@/store/queries";

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

  const handleClick = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) onJumpTo?.(alert.Match, alert.Span[0] - 1);
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
            <span className="ml-1.5 opacity-60">· line {alert.Line}</span>
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

  const byGroup = (check.data?.alerts ?? []).reduce<Record<string, ValeAlert[]>>(
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
                      return (
                        <div key={rule}>
                          <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                            <span className="opacity-50 font-mono">{pkg}.</span>
                            <span>{ruleName}</span>
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
      <div className="px-3 py-2.5 border-t border-border shrink-0">
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
      </div>
    </div>
  );
}
