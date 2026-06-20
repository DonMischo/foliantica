import { countOccurrencesBefore } from "./vale-utils";

/**
 * Convert editor HTML to the same space-collapsed plain text that the scene
 * page sends to LanguageTool — all tags removed, whitespace collapsed, trimmed.
 */
export function htmlToGrammarPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Given the space-collapsed plain text and a LanguageTool match offset,
 * return how many prior occurrences of `matched` exist before `plainOffset`.
 * This is the skip count passed to walkDocForNthOccurrence.
 */
export function computeGrammarSkipCount(
  plainText: string,
  matched: string,
  plainOffset: number,
): number {
  return countOccurrencesBefore(plainText, matched, plainOffset);
}
