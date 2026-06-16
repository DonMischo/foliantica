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
