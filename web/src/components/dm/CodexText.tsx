"use client";

import { useMemo } from "react";
import { patchEntryAliases } from "@/components/editor/CodexHighlightExtension";
import type { CodexEntry } from "@/types";

/**
 * Codex highlighting for plain-text DM narration. The editor does this with a
 * ProseMirror decoration plugin; the DM transcript is plain strings, so this
 * splits the text on one combined term regex and wraps the hits in spans that
 * carry the same `.codex-highlight` class and entry colour.
 */
export function CodexText({
  text, entries, lang,
}: { text: string; entries: CodexEntry[]; lang?: string | null }) {
  const { pattern, byTerm } = useMemo(() => {
    const map = new Map<string, CodexEntry>();
    for (const entry of patchEntryAliases(entries, lang)) {
      for (const term of entry._allTerms) {
        const key = term.toLowerCase();
        if (term && !map.has(key)) map.set(key, entry);
      }
    }
    // Longest first so "Lyra Nightsong" wins over "Lyra".
    const terms = [...map.keys()].sort((a, b) => b.length - a.length);
    if (terms.length === 0) return { pattern: null, byTerm: map };
    const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return { pattern: new RegExp(`\\b(${escaped.join("|")})\\b`, "gi"), byTerm: map };
  }, [entries, lang]);

  if (!pattern) return <>{text}</>;

  const out: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  pattern.lastIndex = 0;
  while ((match = pattern.exec(text)) !== null) {
    const entry = byTerm.get(match[0].toLowerCase());
    if (!entry) continue;
    if (match.index > last) out.push(text.slice(last, match.index));
    out.push(
      <span
        key={`${match.index}-${entry.id}`}
        className="codex-highlight"
        style={{ borderColor: entry.color, backgroundColor: `${entry.color}22`, color: entry.color, cursor: "help" }}
        title={`${entry.name} · ${entry.entry_type}${entry.description ? ` — ${entry.description.slice(0, 160)}` : ""}`}
      >
        {match[0]}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));

  return <>{out}</>;
}
