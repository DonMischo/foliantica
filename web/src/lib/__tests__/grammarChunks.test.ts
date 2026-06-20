import { describe, it, expect } from "vitest";
import { splitIntoChunks } from "../grammarChunks";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a string of `n` sentences each exactly `wordsPerSentence` words long. */
function makeSentences(count: number, wordsPerSentence = 5): string {
  return Array.from({ length: count }, (_, i) =>
    Array.from({ length: wordsPerSentence }, () => `word${i}`).join(" ") + "."
  ).join(" ");
}

/** Build a string that fills at least `minLen` chars with no sentence boundaries. */
function makeNoBoundary(minLen: number): string {
  const word = "abcde ";
  return word.repeat(Math.ceil(minLen / word.length)).slice(0, minLen + 10);
}

// ── Edge-case inputs ──────────────────────────────────────────────────────────

describe("splitIntoChunks — edge cases", () => {
  it("returns [] for empty string", () => {
    expect(splitIntoChunks("")).toEqual([]);
  });

  it("returns [] for whitespace-only string", () => {
    expect(splitIntoChunks("   \n\t  ")).toEqual([]);
  });

  it("returns single chunk when text fits within targetSize", () => {
    const text = "Short text.";
    const result = splitIntoChunks(text, 3000);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ text, offset: 0 });
  });

  it("single chunk offset is always 0", () => {
    const text = "Hello world.";
    expect(splitIntoChunks(text, 100)[0].offset).toBe(0);
  });
});

// ── Chunking correctness ───────────────────────────────────────────────────────

describe("splitIntoChunks — chunking", () => {
  it("produces multiple chunks when text exceeds targetSize", () => {
    const text = makeSentences(200, 6); // well over 3000 chars
    const result = splitIntoChunks(text, 3000);
    expect(result.length).toBeGreaterThan(1);
  });

  it("chunks cover the full text with no gaps", () => {
    const text = makeSentences(200, 6);
    const result = splitIntoChunks(text, 3000);

    // Reconstruct: each chunk starts right after the previous one ends
    // (leading spaces are consumed by the splitter)
    let reconstructed = result[0].text;
    for (let i = 1; i < result.length; i++) {
      const gap = text.slice(result[i - 1].offset + result[i - 1].text.length, result[i].offset);
      // Gap should be at most a single space (the consumed leading space)
      expect(gap.trim()).toBe("");
      reconstructed += gap + result[i].text;
    }
    // Full text covered
    expect(result[result.length - 1].offset + result[result.length - 1].text.length).toBeGreaterThanOrEqual(
      text.trim().length - 1
    );
  });

  it("offsets are strictly increasing", () => {
    const text = makeSentences(200, 6);
    const result = splitIntoChunks(text, 3000);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].offset).toBeGreaterThan(result[i - 1].offset);
    }
  });

  it("each chunk is no longer than targetSize", () => {
    const text = makeSentences(300, 6);
    const result = splitIntoChunks(text, 3000);
    for (const chunk of result) {
      expect(chunk.text.length).toBeLessThanOrEqual(3001); // allow ±1 for boundary char
    }
  });

  it("respects custom targetSize", () => {
    const text = "one two three. four five six. seven eight nine.";
    const result = splitIntoChunks(text, 20);
    expect(result.length).toBeGreaterThan(1);
  });
});

// ── Sentence-boundary snapping ────────────────────────────────────────────────

describe("splitIntoChunks — sentence boundary snapping", () => {
  it("snaps to sentence boundary (chunk does not end mid-word)", () => {
    // Build text where we know sentence boundaries exist
    const text = makeSentences(100, 8); // ~900 chars per 100 sentences
    const result = splitIntoChunks(text, 500);
    for (const chunk of result.slice(0, -1)) {
      // Each non-final chunk should end at a sentence boundary (. ! ?)
      const last = chunk.text.trimEnd();
      expect(last).toMatch(/[.!?]$/);
    }
  });

  it("falls back to last space when no sentence boundary in second half", () => {
    // Build a blob with no periods/!/? — fallback to space split
    const text = makeNoBoundary(4000);
    const result = splitIntoChunks(text, 3000);
    expect(result.length).toBeGreaterThan(1);
    // No chunk should be empty
    for (const chunk of result) {
      expect(chunk.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("offset + length of non-final chunk does not exceed next chunk offset (no overlap)", () => {
    const text = makeSentences(300, 6);
    const result = splitIntoChunks(text, 3000);
    for (let i = 0; i < result.length - 1; i++) {
      const endOfCurrent = result[i].offset + result[i].text.length;
      expect(endOfCurrent).toBeLessThanOrEqual(result[i + 1].offset + 1); // +1 for consumed space
    }
  });
});

// ── Offset accuracy ───────────────────────────────────────────────────────────

describe("splitIntoChunks — offset accuracy", () => {
  it("offset correctly points into the original text", () => {
    const text = makeSentences(200, 6);
    const result = splitIntoChunks(text, 3000);
    for (const chunk of result) {
      // The chunk text should match the original text at its offset
      expect(text.slice(chunk.offset, chunk.offset + chunk.text.length)).toBe(chunk.text);
    }
  });

  it("first chunk always has offset 0", () => {
    const text = makeSentences(200, 6);
    expect(splitIntoChunks(text, 3000)[0].offset).toBe(0);
  });
});
