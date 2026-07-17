/**
 * Convert editor HTML to the space-collapsed plain text sent to LanguageTool.
 * Block-level tags become a space; inline marks (<em>, <strong>, spans, …)
 * are stripped without inserting one — otherwise "<em>Wort</em>," would reach
 * LanguageTool as "Wort ," and trigger false whitespace warnings.
 */
export function htmlToGrammarPlainText(html: string): string {
  return html
    .replace(/<\/?(p|div|br|li|ul|ol|h[1-6]|blockquote|hr|img|table|thead|tbody|tr|td|th)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Plain text rebuilt from the editor doc plus, per character, its doc position. */
export interface GrammarDocText {
  text: string;
  map: number[];
}

interface DocNodeLike {
  isText: boolean;
  text?: string | null;
}

/**
 * Build the same space-collapsed plain text directly from the ProseMirror doc,
 * recording the doc position of every character. Unlike a per-text-node search,
 * this lets a LanguageTool offset be translated into an editor range even when
 * the matched text spans marks (italic ↔ plain) or paragraph boundaries.
 */
export function buildGrammarDocText(doc: {
  descendants: (cb: (node: DocNodeLike, pos: number) => void) => void;
}): GrammarDocText {
  let text = "";
  const map: number[] = [];
  let pendingSpace = false;
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        const ch = node.text[i];
        if (/\s/.test(ch)) {
          if (text.length > 0) pendingSpace = true;
        } else {
          if (pendingSpace) {
            text += " ";
            map.push(pos + i);
            pendingSpace = false;
          }
          text += ch;
          map.push(pos + i);
        }
      }
    } else if (text.length > 0) {
      // Block or leaf node boundary (paragraph, hard break, …) → one space
      pendingSpace = true;
    }
  });
  return { text, map };
}

/**
 * Translate a LanguageTool match (matched string + offset in the plain text)
 * into a doc range. Uses the exact offset when the doc text still agrees;
 * otherwise falls back to the occurrence closest to the reported offset, which
 * tolerates small drift from edits made after the check ran.
 */
export function findGrammarRange(
  docText: GrammarDocText,
  matched: string,
  plainOffset: number,
): { from: number; to: number } | null {
  if (!matched) return null;
  const { text, map } = docText;
  let idx = text.startsWith(matched, plainOffset) ? plainOffset : -1;
  if (idx === -1) {
    let best = -1;
    for (let i = text.indexOf(matched); i !== -1; i = text.indexOf(matched, i + 1)) {
      if (best === -1 || Math.abs(i - plainOffset) < Math.abs(best - plainOffset)) best = i;
      if (i >= plainOffset) break; // later occurrences can only be farther away
    }
    idx = best;
  }
  if (idx === -1 || idx + matched.length > map.length) return null;
  return { from: map[idx], to: map[idx + matched.length - 1] + 1 };
}

/**
 * LanguageTool's AUSLASSUNGSPUNKTE_LEERZEICHEN wants a geschütztes Leerzeichen
 * before "…", which TipTap cannot produce. Skip the warning whenever any
 * whitespace already precedes the ellipsis.
 */
export function shouldSkipGrammarMatch(
  match: { rule: { id: string }; offset: number },
  checkedText: string,
): boolean {
  if (match.rule.id !== "AUSLASSUNGSPUNKTE_LEERZEICHEN") return false;
  const prev = checkedText[match.offset - 1];
  return prev !== undefined && /\s/.test(prev);
}
