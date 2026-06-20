/**
 * Split text into ~targetSize-char chunks, snapping to the last sentence boundary
 * in the second half of each chunk so we never cut mid-sentence.
 * Returns [{text, offset}] where offset is the chunk's start position in the full text.
 */
export function splitIntoChunks(text: string, targetSize = 3000): { text: string; offset: number }[] {
  if (!text.trim()) return [];
  if (text.length <= targetSize) return [{ text, offset: 0 }];

  const chunks: { text: string; offset: number }[] = [];
  let start = 0;

  while (start < text.length) {
    if (text.length - start <= targetSize) {
      chunks.push({ text: text.slice(start), offset: start });
      break;
    }

    const slice = text.slice(start, start + targetSize);
    // Search for the last sentence-ending punctuation followed by a space,
    // starting from the halfway point so chunks don't get too short.
    const halfIdx = Math.floor(targetSize / 2);
    const sub = slice.slice(halfIdx);
    const m = sub.match(/(.*[.!?]) /); // greedy → last boundary

    let end: number;
    if (m) {
      end = start + halfIdx + m[1].length;
    } else {
      // No sentence boundary — fall back to last space
      const lastSpace = slice.lastIndexOf(" ");
      end = lastSpace > halfIdx ? start + lastSpace : start + targetSize;
    }

    chunks.push({ text: text.slice(start, end), offset: start });
    // Advance past the split point, skipping any leading space on the next chunk
    start = end;
    while (start < text.length && text[start] === " ") start++;
  }

  return chunks;
}
