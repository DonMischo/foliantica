import { describe, it, expect } from "vitest";
import { htmlToGrammarPlainText, computeGrammarSkipCount } from "../grammarUtils";

// ── htmlToGrammarPlainText ────────────────────────────────────────────────────

describe("htmlToGrammarPlainText", () => {
  it("removes all HTML tags", () => {
    expect(htmlToGrammarPlainText("<p>Hello world</p>")).toBe("Hello world");
  });

  it("collapses multiple spaces after tag removal", () => {
    // Tags become spaces → multiple spaces collapse to one
    expect(htmlToGrammarPlainText("<p>one</p><p>two</p>")).toBe("one two");
  });

  it("trims leading and trailing whitespace", () => {
    expect(htmlToGrammarPlainText("  <p>text</p>  ")).toBe("text");
  });

  it("handles nested tags", () => {
    expect(htmlToGrammarPlainText("<p><strong>bold</strong> text</p>")).toBe("bold text");
  });

  it("handles self-closing tags", () => {
    expect(htmlToGrammarPlainText("<p>line<br/>two</p>")).toBe("line two");
  });

  it("produces a single line (no newlines)", () => {
    const result = htmlToGrammarPlainText("<p>Para one.</p><p>Para two.</p>");
    expect(result).not.toContain("\n");
  });

  it("returns empty string for empty input", () => {
    expect(htmlToGrammarPlainText("")).toBe("");
  });

  it("returns empty string for tags-only input", () => {
    expect(htmlToGrammarPlainText("<p></p>")).toBe("");
  });

  it("preserves text with no tags", () => {
    expect(htmlToGrammarPlainText("plain text here")).toBe("plain text here");
  });
});

// ── computeGrammarSkipCount ───────────────────────────────────────────────────

describe("computeGrammarSkipCount", () => {
  it("returns 0 when matched is first occurrence", () => {
    const text = "very good very bad";
    expect(computeGrammarSkipCount(text, "very", 0)).toBe(0);
  });

  it("returns 1 for the second occurrence", () => {
    const text = "very good very bad";
    // Second "very" starts at offset 10
    expect(computeGrammarSkipCount(text, "very", 10)).toBe(1);
  });

  it("returns 2 for the third occurrence", () => {
    const text = "very very very bad";
    // Third "very" starts at offset 10
    expect(computeGrammarSkipCount(text, "very", 10)).toBe(2);
  });

  it("returns 0 when offset is before first occurrence", () => {
    const text = "good very bad";
    expect(computeGrammarSkipCount(text, "very", 0)).toBe(0);
  });

  it("handles offset exactly at match start (not counted)", () => {
    const text = "very good";
    // offset = 0 = start of "very" → no priors
    expect(computeGrammarSkipCount(text, "very", 0)).toBe(0);
  });

  it("handles single-character match", () => {
    const text = "a b a b a";
    // 'a' at offsets 0, 4, 8 — plainOffset=4 → 1 prior
    expect(computeGrammarSkipCount(text, "a", 4)).toBe(1);
  });

  it("returns 0 for empty matched string", () => {
    expect(computeGrammarSkipCount("some text", "", 5)).toBe(0);
  });

  it("returns 0 when matched does not appear in text", () => {
    expect(computeGrammarSkipCount("hello world", "xyz", 50)).toBe(0);
  });

  it("handles multi-word match", () => {
    // "he said he said he said" — second "he said" starts at offset 8
    // (h(0)e(1) (2)s(3)a(4)i(5)d(6) (7)h(8)...)
    const text = "he said he said he said";
    expect(computeGrammarSkipCount(text, "he said", 8)).toBe(1);
  });
});
