"use client";

import { useState, useCallback } from "react";
import { X, SpellCheck, ChevronDown, ChevronRight, Loader2, AlertCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GrammarMatch } from "@/lib/api";
import { grammarApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { splitIntoChunks } from "@/lib/grammarChunks";
import { shouldSkipGrammarMatch } from "@/lib/grammarUtils";

interface Props {
  /** Plain text of the scene (HTML tags stripped) */
  text: string;
  language?: string;
  onClose: () => void;
  /** Called when user clicks a suggestion chip — replaces matched text in editor */
  onApplySuggestion?: (matched: string, replacement: string, offset: number) => void;
  /** Called when match card is opened — scrolls to and selects the text in editor */
  onJumpTo?: (matched: string, offset: number) => void;
}

const ISSUE_COLOR: Record<string, string> = {
  misspelling:   "text-red-500",
  grammar:       "text-amber-500",
  style:         "text-blue-500",
  typographical: "text-purple-500",
  punctuation:   "text-orange-500",
};

function issueColor(type: string) {
  return ISSUE_COLOR[type] ?? "text-muted-foreground";
}


// ── Match card ────────────────────────────────────────────────────────────────

interface MatchCardProps {
  match: GrammarMatch;
  onApplySuggestion?: (matched: string, replacement: string, offset: number) => void;
  onJumpTo?: (matched: string, offset: number) => void;
}

function MatchCard({ match, onApplySuggestion, onJumpTo }: MatchCardProps) {
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);

  const ctx = match.context;
  const matched = ctx.text.slice(ctx.offset, ctx.offset + ctx.length);
  const before  = ctx.text.slice(0, ctx.offset);
  const after   = ctx.text.slice(ctx.offset + ctx.length);

  const handleHeaderClick = () => {
    const next = !open;
    setOpen(next);
    if (next) onJumpTo?.(matched, match.offset);
  };

  const handleApply = (value: string) => {
    if (onApplySuggestion) {
      onApplySuggestion(matched, value, match.offset);
      setApplied(value);
    } else {
      navigator.clipboard.writeText(value);
    }
  };

  return (
    <div className={cn("border border-border rounded-md overflow-hidden", applied && "opacity-50")}>
      <button
        type="button"
        onClick={handleHeaderClick}
        className="w-full text-left flex items-start gap-2 px-3 py-2 hover:bg-secondary/40 transition-colors"
      >
        <AlertCircle className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", issueColor(match.rule.issueType))} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium leading-snug">{match.shortMessage || match.message}</p>
          <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">
            …{before}
            <span className={cn("underline decoration-dotted", issueColor(match.rule.issueType))}>
              {applied ?? matched}
            </span>
            {after}…
          </p>
        </div>
        {open
          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
        }
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-border bg-secondary/20">
          <p className="text-[11px] text-muted-foreground pt-2">{match.message}</p>

          {match.replacements.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[11px] text-muted-foreground self-center">Fix:</span>
              {match.replacements.slice(0, 5).map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleApply(r.value)}
                  title={onApplySuggestion ? "Click to apply in editor" : "Click to copy"}
                  className={cn(
                    "text-[11px] px-2 py-0.5 rounded border transition-colors font-mono flex items-center gap-1",
                    applied === r.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background hover:bg-primary/10 hover:border-primary/40 hover:text-primary"
                  )}
                >
                  {applied === r.value && <Check className="h-2.5 w-2.5" />}
                  {r.value}
                </button>
              ))}
            </div>
          )}

          <p className="text-[10px] text-muted-foreground/60">
            {match.rule.description} ({match.rule.id})
          </p>
        </div>
      )}
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function GrammarPanel({ text, language = "auto", onClose, onApplySuggestion, onJumpTo }: Props) {
  const [matches, setMatches]     = useState<GrammarMatch[]>([]);
  const [isChecking, setChecking] = useState(false);
  const [progress, setProgress]   = useState<{ done: number; total: number } | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [hasRun, setHasRun]       = useState(false);

  const handleCheck = useCallback(async () => {
    const chunks = splitIntoChunks(text);
    if (!chunks.length) return;

    setChecking(true);
    setError(null);
    setMatches([]);
    setHasRun(false);
    setProgress(chunks.length > 1 ? { done: 0, total: chunks.length } : null);

    try {
      for (let i = 0; i < chunks.length; i++) {
        const { text: chunkText, offset: chunkOffset } = chunks[i];
        const result = await grammarApi.check(chunkText, language);

        // Shift match offsets so they point into the full text
        const adjusted = result.matches
          .map(m => ({ ...m, offset: m.offset + chunkOffset }))
          .filter(m => !shouldSkipGrammarMatch(m, text));
        setMatches(prev => [...prev, ...adjusted]);

        if (chunks.length > 1) setProgress({ done: i + 1, total: chunks.length });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Grammar check failed. Is LanguageTool running?");
    } finally {
      setChecking(false);
      setHasRun(true);
      setProgress(null);
    }
  }, [text, language]);

  return (
    <div className="w-72 flex flex-col border-l border-border bg-card overflow-hidden shrink-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <SpellCheck className="h-3.5 w-3.5 text-primary" />
        <span className="text-sm font-medium flex-1">Grammar Check</span>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <Button
          size="sm"
          onClick={handleCheck}
          disabled={isChecking || !text.trim()}
          className="w-full gap-2"
        >
          {isChecking
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking…</>
            : <><SpellCheck className="h-3.5 w-3.5" />{hasRun ? "Re-check" : "Check grammar"}</>
          }
        </Button>

        {/* Progress for multi-chunk scenes */}
        {progress && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin shrink-0" />
            <span>
              {progress.done === 0
                ? "Starting…"
                : `Still checking — ${progress.done} of ${progress.total} batches done`
              }
            </span>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        {matches.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              {matches.length} issue{matches.length !== 1 ? "s" : ""} found
              {isChecking && " so far"}
            </p>
            {matches.map((m, i) => (
              <MatchCard
                key={i}
                match={m}
                onApplySuggestion={onApplySuggestion}
                onJumpTo={onJumpTo}
              />
            ))}
          </div>
        )}

        {hasRun && !isChecking && matches.length === 0 && !error && (
          <p className="text-xs text-muted-foreground text-center py-4">No issues found.</p>
        )}
      </div>
    </div>
  );
}
