/**
 * Tests for SearchExtension — plugin state machine.
 *
 * Uses a plain @tiptap/core Editor (no React) so the tests are fast and
 * don't require a full render cycle.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SearchExtension, SEARCH_KEY } from "../SearchExtension";

function makeEditor(content = "<p>Hello world. Hello again.</p>") {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [StarterKit, SearchExtension],
    content,
  });
}

// ── setSearchTerm ────────────────────────────────────────────────────────────

describe("SearchExtension — setSearchTerm", () => {
  let editor: Editor;
  beforeEach(() => { editor = makeEditor(); });
  afterEach(() => { editor.destroy(); });

  it("starts with empty state", () => {
    const s = SEARCH_KEY.getState(editor.state)!;
    expect(s.term).toBe("");
    expect(s.results).toHaveLength(0);
    expect(s.current).toBe(0);
  });

  it("returns empty results for an empty search term", () => {
    editor.commands.setSearchTerm("");
    const s = SEARCH_KEY.getState(editor.state)!;
    expect(s.results).toHaveLength(0);
  });

  it("finds a single occurrence", () => {
    editor.commands.setSearchTerm("world");
    expect(SEARCH_KEY.getState(editor.state)!.results).toHaveLength(1);
  });

  it("finds multiple occurrences of the same term", () => {
    editor.commands.setSearchTerm("hello");
    expect(SEARCH_KEY.getState(editor.state)!.results).toHaveLength(2);
  });

  it("is case-insensitive", () => {
    editor.commands.setSearchTerm("HELLO");
    expect(SEARCH_KEY.getState(editor.state)!.results).toHaveLength(2);
  });

  it("returns zero results when term is not present", () => {
    editor.commands.setSearchTerm("xyzzy");
    expect(SEARCH_KEY.getState(editor.state)!.results).toHaveLength(0);
  });

  it("resets current to 0 on each new search", () => {
    editor.commands.setSearchTerm("hello");
    editor.commands.nextSearchResult(); // current → 1
    editor.commands.setSearchTerm("world");
    expect(SEARCH_KEY.getState(editor.state)!.current).toBe(0);
  });

  it("each result has from < to", () => {
    editor.commands.setSearchTerm("hello");
    for (const r of SEARCH_KEY.getState(editor.state)!.results) {
      expect(r.from).toBeLessThan(r.to);
    }
  });

  it("result length matches search term length", () => {
    editor.commands.setSearchTerm("world");
    const r = SEARCH_KEY.getState(editor.state)!.results[0];
    expect(r.to - r.from).toBe("world".length);
  });
});

// ── Navigation ───────────────────────────────────────────────────────────────

describe("SearchExtension — nextSearchResult / prevSearchResult", () => {
  let editor: Editor;
  beforeEach(() => {
    editor = makeEditor("<p>A B A B A</p>");
    editor.commands.setSearchTerm("a"); // 3 matches
  });
  afterEach(() => { editor.destroy(); });

  it("nextSearchResult advances current by 1", () => {
    editor.commands.nextSearchResult();
    expect(SEARCH_KEY.getState(editor.state)!.current).toBe(1);
  });

  it("nextSearchResult wraps from last back to 0", () => {
    editor.commands.nextSearchResult(); // 1
    editor.commands.nextSearchResult(); // 2
    editor.commands.nextSearchResult(); // wraps → 0
    expect(SEARCH_KEY.getState(editor.state)!.current).toBe(0);
  });

  it("prevSearchResult wraps from 0 to last", () => {
    editor.commands.prevSearchResult();
    const s = SEARCH_KEY.getState(editor.state)!;
    expect(s.current).toBe(s.results.length - 1);
  });

  it("prevSearchResult steps backward", () => {
    editor.commands.nextSearchResult(); // current = 1
    editor.commands.prevSearchResult(); // current = 0
    expect(SEARCH_KEY.getState(editor.state)!.current).toBe(0);
  });

  it("nextSearchResult returns false when there are no results", () => {
    editor.commands.setSearchTerm("xyzzy");
    const moved = editor.commands.nextSearchResult();
    expect(moved).toBe(false);
  });
});

// ── clearSearch ──────────────────────────────────────────────────────────────

describe("SearchExtension — clearSearch", () => {
  let editor: Editor;
  beforeEach(() => { editor = makeEditor(); });
  afterEach(() => { editor.destroy(); });

  it("resets term to empty string", () => {
    editor.commands.setSearchTerm("hello");
    editor.commands.clearSearch();
    expect(SEARCH_KEY.getState(editor.state)!.term).toBe("");
  });

  it("clears all results", () => {
    editor.commands.setSearchTerm("hello");
    editor.commands.clearSearch();
    expect(SEARCH_KEY.getState(editor.state)!.results).toHaveLength(0);
  });

  it("resets current to 0", () => {
    editor.commands.setSearchTerm("hello");
    editor.commands.nextSearchResult();
    editor.commands.clearSearch();
    expect(SEARCH_KEY.getState(editor.state)!.current).toBe(0);
  });
});

// ── replaceCurrent / replaceAll ──────────────────────────────────────────────

describe("SearchExtension — replace", () => {
  let editor: Editor;
  afterEach(() => { editor.destroy(); });

  it("replaceCurrent replaces only the current match and moves to the next", () => {
    editor = makeEditor("<p>cat dog cat</p>");
    editor.commands.setSearchTerm("cat");
    editor.commands.replaceCurrent("bird");
    expect(editor.getText()).toBe("bird dog cat");
    const s = SEARCH_KEY.getState(editor.state)!;
    expect(s.results).toHaveLength(1);
    expect(s.current).toBe(0);
  });

  it("replaceCurrent skips past a replacement that contains the term", () => {
    editor = makeEditor("<p>cat dog cat</p>");
    editor.commands.setSearchTerm("cat");
    editor.commands.replaceCurrent("cats");
    expect(editor.getText()).toBe("cats dog cat");
    const s = SEARCH_KEY.getState(editor.state)!;
    // current now points at the second, untouched "cat", not the new "cats"
    expect(s.results[s.current].from).toBeGreaterThan(5);
  });

  it("replaceCurrent with an empty string deletes the match", () => {
    editor = makeEditor("<p>a cat b</p>");
    editor.commands.setSearchTerm("cat ");
    editor.commands.replaceCurrent("");
    expect(editor.getText()).toBe("a b");
  });

  it("replaceAll replaces every match, case-insensitively", () => {
    editor = makeEditor("<p>Cat dog cat.</p><p>cat!</p>");
    editor.commands.setSearchTerm("cat");
    editor.commands.replaceAll("bird");
    expect(editor.getText()).toBe("bird dog bird.\n\nbird!");
    expect(SEARCH_KEY.getState(editor.state)!.results).toHaveLength(0);
  });

  it("replace commands return false when there are no results", () => {
    editor = makeEditor("<p>dog</p>");
    editor.commands.setSearchTerm("cat");
    expect(editor.commands.replaceCurrent("x")).toBe(false);
    expect(editor.commands.replaceAll("x")).toBe(false);
    expect(editor.getText()).toBe("dog");
  });

  it("replaceAll is a single undo step", () => {
    editor = makeEditor("<p>cat cat</p>");
    editor.commands.setSearchTerm("cat");
    editor.commands.replaceAll("dog");
    editor.commands.undo();
    expect(editor.getText()).toBe("cat cat");
  });
});

// ── Regex & match case ───────────────────────────────────────────────────────

describe("SearchExtension — regex and match case", () => {
  let editor: Editor;
  afterEach(() => { editor.destroy(); });

  const texts = (e: Editor) =>
    SEARCH_KEY.getState(e.state)!.results.map((r) => e.state.doc.textBetween(r.from, r.to));

  it("plain mode treats regex characters literally", () => {
    editor = makeEditor("<p>a.c abc a.c</p>");
    editor.commands.setSearchTerm("a.c");
    expect(texts(editor)).toEqual(["a.c", "a.c"]);
  });

  it("regex mode matches a pattern", () => {
    editor = makeEditor("<p>a.c abc a1c</p>");
    editor.commands.setSearchTerm("a.c", { regex: true });
    expect(texts(editor)).toEqual(["a.c", "abc", "a1c"]);
  });

  it("match case is off by default and can be turned on", () => {
    editor = makeEditor("<p>Cat cat</p>");
    editor.commands.setSearchTerm("cat");
    expect(texts(editor)).toEqual(["Cat", "cat"]);
    editor.commands.setSearchTerm("cat", { caseSensitive: true });
    expect(texts(editor)).toEqual(["cat"]);
  });

  it("^ and $ anchor to each paragraph", () => {
    editor = makeEditor("<p>one two</p><p>three four</p>");
    editor.commands.setSearchTerm("^\\w+", { regex: true });
    expect(texts(editor)).toEqual(["one", "three"]);
    editor.commands.setSearchTerm("\\w+$", { regex: true });
    expect(texts(editor)).toEqual(["two", "four"]);
  });

  it("finds a match spanning differently formatted text", () => {
    editor = makeEditor("<p>a <strong>bo</strong>ld word</p>");
    editor.commands.setSearchTerm("bold");
    expect(texts(editor)).toEqual(["bold"]);
  });

  it("an invalid regex yields no results and does not throw", () => {
    editor = makeEditor("<p>abc</p>");
    expect(() => editor.commands.setSearchTerm("a(", { regex: true })).not.toThrow();
    expect(SEARCH_KEY.getState(editor.state)!.results).toHaveLength(0);
  });

  it("keeps the options when the document changes", () => {
    editor = makeEditor("<p>a1</p>");
    editor.commands.setSearchTerm("a\\d", { regex: true });
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, " a2");
    expect(texts(editor)).toEqual(["a1", "a2"]);
  });

  it("replaceAll expands $1 and \\1 capture groups", () => {
    editor = makeEditor("<p>Smith, John</p><p>Doe, Jane</p>");
    editor.commands.setSearchTerm("(\\w+), (\\w+)", { regex: true });
    editor.commands.replaceAll("$2 \\1");
    expect(editor.getText()).toBe("John Smith\n\nJane Doe");
  });

  it("replaceCurrent expands $0 / $& / \\0 to the whole match", () => {
    editor = makeEditor("<p>cat dog bird</p>");
    editor.commands.setSearchTerm("\\w+", { regex: true });
    editor.commands.replaceCurrent("[$0]");
    editor.commands.replaceCurrent("<$&>");
    editor.commands.replaceCurrent("(\\0)");
    expect(editor.getText()).toBe("[cat] <dog> (bird)");
  });

  it("replacement understands \\t and \\\\ escapes", () => {
    editor = makeEditor("<p>a-b</p>");
    editor.commands.setSearchTerm("-", { regex: true });
    editor.commands.replaceAll("\\t\\\\");
    expect(editor.getText()).toBe("a\t\\b");
  });

  it("plain mode inserts the replacement literally", () => {
    editor = makeEditor("<p>cat</p>");
    editor.commands.setSearchTerm("cat");
    editor.commands.replaceAll("$1 \\t");
    expect(editor.getText()).toBe("$1 \\t");
  });

  it("an empty-width regex (^) can prefix every paragraph", () => {
    editor = makeEditor("<p>one</p><p>two</p>");
    editor.commands.setSearchTerm("^", { regex: true });
    editor.commands.replaceAll("> ");
    expect(editor.getText()).toBe("> one\n\n> two");
  });
});
