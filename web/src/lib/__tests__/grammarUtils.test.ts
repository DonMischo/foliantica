import { describe, it, expect } from "vitest";
import {
  htmlToGrammarPlainText,
  buildGrammarDocText,
  findGrammarRange,
  shouldSkipGrammarMatch,
} from "../grammarUtils";

// ── htmlToGrammarPlainText ────────────────────────────────────────────────────

describe("htmlToGrammarPlainText", () => {
  it("removes all HTML tags", () => {
    expect(htmlToGrammarPlainText("<p>Hello world</p>")).toBe("Hello world");
  });

  it("separates block elements with a space", () => {
    expect(htmlToGrammarPlainText("<p>one</p><p>two</p>")).toBe("one two");
  });

  it("strips inline marks without inserting a space", () => {
    // Regression: "<em>Wort</em>," must not become "Wort ," (false
    // COMMA_PARENTHESIS_WHITESPACE from LanguageTool)
    expect(
      htmlToGrammarPlainText("<p><em>Definitiv männlich</em>, stellte sie fest.</p>")
    ).toBe("Definitiv männlich, stellte sie fest.");
  });

  it("trims leading and trailing whitespace", () => {
    expect(htmlToGrammarPlainText("  <p>text</p>  ")).toBe("text");
  });

  it("handles nested tags", () => {
    expect(htmlToGrammarPlainText("<p><strong>bold</strong> text</p>")).toBe("bold text");
  });

  it("treats <br> as a space", () => {
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

// ── buildGrammarDocText / findGrammarRange ────────────────────────────────────

// Minimal ProseMirror-like doc: paragraphs of text segments (segments model
// mark boundaries — each is its own text node). Positions mimic PM: +1 to
// enter each paragraph, +1 to leave it.
function makeDoc(paragraphs: string[][]) {
  const visits: { node: { isText: boolean; text?: string }; pos: number }[] = [];
  let pos = 0;
  for (const para of paragraphs) {
    visits.push({ node: { isText: false }, pos });
    let inner = pos + 1;
    for (const seg of para) {
      visits.push({ node: { isText: true, text: seg }, pos: inner });
      inner += seg.length;
    }
    pos = inner + 1;
  }
  return {
    descendants(cb: (node: { isText: boolean; text?: string }, pos: number) => void) {
      for (const v of visits) cb(v.node, v.pos);
    },
  };
}

describe("buildGrammarDocText", () => {
  it("maps characters of a single paragraph to doc positions", () => {
    const { text, map } = buildGrammarDocText(makeDoc([["Hello world"]]));
    expect(text).toBe("Hello world");
    expect(map[0]).toBe(1);  // "H" sits at pos 1 (after paragraph open)
    expect(map[10]).toBe(11);
  });

  it("joins paragraphs with a single space", () => {
    const { text } = buildGrammarDocText(makeDoc([["One."], ["Two."]]));
    expect(text).toBe("One. Two.");
  });

  it("keeps text contiguous across mark boundaries (no phantom space)", () => {
    const { text } = buildGrammarDocText(
      makeDoc([["Definitiv männlich", ", stellte sie fest."]])
    );
    expect(text).toBe("Definitiv männlich, stellte sie fest.");
  });

  it("collapses whitespace runs to one space", () => {
    const { text } = buildGrammarDocText(makeDoc([["a    b"]]));
    expect(text).toBe("a b");
  });

  it("returns empty text for an empty doc", () => {
    const { text, map } = buildGrammarDocText(makeDoc([]));
    expect(text).toBe("");
    expect(map).toHaveLength(0);
  });
});

describe("findGrammarRange", () => {
  it("resolves an exact offset to a doc range", () => {
    const docText = buildGrammarDocText(makeDoc([["Hello world"]]));
    // "world" starts at plain offset 6 → doc pos 7
    expect(findGrammarRange(docText, "world", 6)).toEqual({ from: 7, to: 12 });
  });

  it("finds a match spanning mark boundaries", () => {
    const docText = buildGrammarDocText(
      makeDoc([["Definitiv männlich", ", stellte sie fest."]])
    );
    const idx = docText.text.indexOf("männlich, stellte");
    const range = findGrammarRange(docText, "männlich, stellte", idx);
    expect(range).not.toBeNull();
    expect(range!.to - range!.from).toBe("männlich, stellte".length);
  });

  it("finds a match spanning a paragraph boundary", () => {
    const docText = buildGrammarDocText(makeDoc([["One."], ["Two."]]));
    expect(findGrammarRange(docText, "One. Two.", 0)).not.toBeNull();
  });

  it("falls back to the occurrence closest to a drifted offset", () => {
    const docText = buildGrammarDocText(makeDoc([["aa bb aa"]]));
    // Second "aa" is at plain offset 6; a drifted offset 5 should still hit it
    const range = findGrammarRange(docText, "aa", 5);
    expect(range).toEqual({ from: 7, to: 9 });
  });

  it("returns null when the matched text is not in the doc", () => {
    const docText = buildGrammarDocText(makeDoc([["Hello world"]]));
    expect(findGrammarRange(docText, "xyz", 0)).toBeNull();
  });

  it("returns null for an empty matched string", () => {
    const docText = buildGrammarDocText(makeDoc([["Hello"]]));
    expect(findGrammarRange(docText, "", 0)).toBeNull();
  });
});

// ── shouldSkipGrammarMatch ────────────────────────────────────────────────────

describe("shouldSkipGrammarMatch", () => {
  const ellipsisMatch = (offset: number) => ({
    rule: { id: "AUSLASSUNGSPUNKTE_LEERZEICHEN" },
    offset,
  });

  it("skips the ellipsis-space warning when a space precedes the ellipsis", () => {
    const text = "Er drehte sich um … und ging.";
    expect(shouldSkipGrammarMatch(ellipsisMatch(18), text)).toBe(true);
  });

  it("keeps the warning when the ellipsis is attached to a word", () => {
    const text = "Ich wollte doch nur…";
    expect(shouldSkipGrammarMatch(ellipsisMatch(19), text)).toBe(false);
  });

  it("keeps the warning at text start (no preceding character)", () => {
    expect(shouldSkipGrammarMatch(ellipsisMatch(0), "… und dann.")).toBe(false);
  });

  it("never skips other rules", () => {
    const m = { rule: { id: "COMMA_PARENTHESIS_WHITESPACE" }, offset: 5 };
    expect(shouldSkipGrammarMatch(m, "abcd , efg")).toBe(false);
  });
});
