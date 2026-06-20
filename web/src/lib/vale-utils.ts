import type { ValeAlert } from "./api";

/** Strip Vale regex word-boundary markers from a token for display purposes. */
export function displayKey(raw: string): string {
  return raw.replace(/^\\b|\\b$/g, "");
}

// German articles / relative pronouns that legitimately double up after a comma.
const DE_RELATIVE = new Set([
  "die", "der", "das", "dem", "den", "des",
  "welche", "welcher", "welches", "welchem", "welchen",
  "was", "wer", "wen", "wem",
]);

/**
 * Downgrade Vale.Repetition alerts for German relative-clause constructions
 * (e.g. "die Frauen, die die Bücher lesen") from error to warning, since
 * these are grammatically correct and not true typos.
 */
export function postProcessAlerts(
  alerts: ValeAlert[],
  text: string,
  language: string | undefined,
): ValeAlert[] {
  const lang = (language ?? "").toLowerCase().slice(0, 2);
  if (lang !== "de") return alerts;

  return alerts.map(alert => {
    if (alert.Check !== "Vale.Repetition") return alert;
    const word = alert.Match.toLowerCase().split(/\s+/)[0];
    if (!DE_RELATIVE.has(word)) return alert;
    const offset = alert.Span[0] - 1;
    const before = text.slice(Math.max(0, offset - 12), offset);
    const commaIdx = before.lastIndexOf(",");
    if (commaIdx !== -1 && before.slice(commaIdx + 1).trim() === "") {
      return { ...alert, Severity: "warning" as const };
    }
    return alert;
  });
}

/**
 * Compute how many prior occurrences of `matched` exist before `beforeOffset`
 * in `text`. Used by both Vale jump (newline-stripped text) and grammar jump
 * (space-collapsed plain text).
 */
export function countOccurrencesBefore(text: string, matched: string, beforeOffset: number): number {
  if (!matched) return 0;
  let count = 0;
  let pos = 0;
  const step = Math.max(matched.length, 1);
  while (pos < beforeOffset) {
    const idx = text.indexOf(matched, pos);
    if (idx === -1 || idx >= beforeOffset) break;
    count++;
    pos = idx + step;
  }
  return count;
}

/**
 * Given the newline-stripped text sent to Vale and a ValeAlert, compute
 * the skip count (0-based occurrence index) to pass to walkDocForNthOccurrence.
 *
 * Vale Span[0] is a 1-based column within alert.Line — not a global offset.
 * We reconstruct the global char offset, then count prior occurrences.
 */
export function computeValeSkipCount(text: string, alert: ValeAlert): number {
  const lines = text.split("\n");
  const globalOffset =
    lines.slice(0, alert.Line - 1).reduce((s, l) => s + l.length + 1, 0) +
    alert.Span[0] - 1;
  return countOccurrencesBefore(text, alert.Match, globalOffset);
}
