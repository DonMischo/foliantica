/**
 * Tests for SearchBar — scroll-to-match behavior after navigation.
 *
 * We mock the editor and SEARCH_KEY.getState so we can verify that
 * scrollIntoView is called on the .search-result-current element after
 * each navigation action.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SEARCH_KEY } from "../SearchExtension";
import { SearchBar } from "../SearchBar";
import type { Editor } from "@tiptap/react";

// ── Shared mock setup ─────────────────────────────────────────────────────────

function makeScrollEl() {
  return { scrollIntoView: vi.fn() };
}

function makeEditor(scrollEl: ReturnType<typeof makeScrollEl>) {
  return {
    commands: {
      prevSearchResult: vi.fn(),
      nextSearchResult: vi.fn(),
      clearSearch: vi.fn(),
      setSearchTerm: vi.fn(),
      replaceCurrent: vi.fn(),
      replaceAll: vi.fn(),
    },
    isEditable: true,
    view: {
      dom: {
        querySelector: vi.fn().mockReturnValue(scrollEl),
      },
    },
    state: {},
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Editor;
}

function setup() {
  const scrollEl = makeScrollEl();
  const editor = makeEditor(scrollEl);
  const onClose = vi.fn();
  return { editor, scrollEl, onClose };
}

// Spy: return 2 results so navigation buttons are not disabled
beforeEach(() => {
  vi.spyOn(SEARCH_KEY, "getState").mockReturnValue({
    term: "test",
    results: [{ from: 0, to: 4 }, { from: 10, to: 14 }],
    current: 0,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

// ── Navigation buttons ────────────────────────────────────────────────────────

describe("SearchBar — next button (ChevronDown)", () => {
  it("calls nextSearchResult on mousedown", () => {
    const { editor, onClose } = setup();
    render(<SearchBar editor={editor} onClose={onClose} showReplace={false} onToggleReplace={vi.fn()} />);
    fireEvent.mouseDown(screen.getByTitle("Next (Enter)"));
    expect(editor.commands.nextSearchResult).toHaveBeenCalledOnce();
  });

  it("calls scrollIntoView on the current result element", () => {
    const { editor, scrollEl, onClose } = setup();
    render(<SearchBar editor={editor} onClose={onClose} showReplace={false} onToggleReplace={vi.fn()} />);
    fireEvent.mouseDown(screen.getByTitle("Next (Enter)"));
    expect(
      (editor.view.dom as any).querySelector
    ).toHaveBeenCalledWith(".search-result-current");
    expect(scrollEl.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      behavior: "smooth",
    });
  });
});

describe("SearchBar — prev button (ChevronUp)", () => {
  it("calls prevSearchResult on mousedown", () => {
    const { editor, onClose } = setup();
    render(<SearchBar editor={editor} onClose={onClose} showReplace={false} onToggleReplace={vi.fn()} />);
    fireEvent.mouseDown(screen.getByTitle("Previous (Shift+Enter)"));
    expect(editor.commands.prevSearchResult).toHaveBeenCalledOnce();
  });

  it("calls scrollIntoView on the current result element", () => {
    const { editor, scrollEl, onClose } = setup();
    render(<SearchBar editor={editor} onClose={onClose} showReplace={false} onToggleReplace={vi.fn()} />);
    fireEvent.mouseDown(screen.getByTitle("Previous (Shift+Enter)"));
    expect(scrollEl.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      behavior: "smooth",
    });
  });
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

describe("SearchBar — keyboard navigation", () => {
  it("Enter calls nextSearchResult and scrolls", () => {
    const { editor, scrollEl, onClose } = setup();
    render(<SearchBar editor={editor} onClose={onClose} showReplace={false} onToggleReplace={vi.fn()} />);
    const input = screen.getByPlaceholderText("Find in scene…");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(editor.commands.nextSearchResult).toHaveBeenCalledOnce();
    expect(scrollEl.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      behavior: "smooth",
    });
  });

  it("Shift+Enter calls prevSearchResult and scrolls", () => {
    const { editor, scrollEl, onClose } = setup();
    render(<SearchBar editor={editor} onClose={onClose} showReplace={false} onToggleReplace={vi.fn()} />);
    const input = screen.getByPlaceholderText("Find in scene…");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(editor.commands.prevSearchResult).toHaveBeenCalledOnce();
    expect(scrollEl.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      behavior: "smooth",
    });
  });

  it("Escape calls clearSearch and onClose", () => {
    const { editor, onClose } = setup();
    render(<SearchBar editor={editor} onClose={onClose} showReplace={false} onToggleReplace={vi.fn()} />);
    const input = screen.getByPlaceholderText("Find in scene…");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(editor.commands.clearSearch).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not scroll when scrollIntoView element is absent", () => {
    const { editor, onClose } = setup();
    // querySelector returns null — should not throw
    (editor.view.dom as any).querySelector.mockReturnValue(null);
    render(<SearchBar editor={editor} onClose={onClose} showReplace={false} onToggleReplace={vi.fn()} />);
    expect(() =>
      fireEvent.mouseDown(screen.getByTitle("Next (Enter)"))
    ).not.toThrow();
  });
});

// ── Result counter display ────────────────────────────────────────────────────

describe("SearchBar — result counter", () => {
  it("shows no counter when input is empty", () => {
    const { editor, onClose } = setup();
    render(<SearchBar editor={editor} onClose={onClose} showReplace={false} onToggleReplace={vi.fn()} />);
    expect(screen.queryByText(/\//)).not.toBeInTheDocument();
  });

  it("shows 'no results' when results array is empty", () => {
    vi.spyOn(SEARCH_KEY, "getState").mockReturnValue({
      term: "xyz",
      results: [],
      current: 0,
    });
    const { editor, onClose } = setup();
    render(<SearchBar editor={editor} onClose={onClose} showReplace={false} onToggleReplace={vi.fn()} />);
    const input = screen.getByPlaceholderText("Find in scene…");
    fireEvent.change(input, { target: { value: "xyz" } });
    expect(screen.getByText("no results")).toBeInTheDocument();
  });
});

// ── Replace row ───────────────────────────────────────────────────────────────

describe("SearchBar — replace", () => {
  function renderReplace(editable = true) {
    const { editor, onClose } = setup();
    (editor as unknown as { isEditable: boolean }).isEditable = editable;
    render(<SearchBar editor={editor} onClose={onClose} showReplace onToggleReplace={vi.fn()} />);
    return editor;
  }

  it("is hidden when showReplace is false", () => {
    const { editor, onClose } = setup();
    render(<SearchBar editor={editor} onClose={onClose} showReplace={false} onToggleReplace={vi.fn()} />);
    expect(screen.queryByPlaceholderText("Replace with…")).toBeNull();
  });

  it("is hidden for a read-only editor", () => {
    renderReplace(false);
    expect(screen.queryByPlaceholderText("Replace with…")).toBeNull();
  });

  it("Replace button replaces the current match with the typed text", () => {
    const editor = renderReplace();
    fireEvent.change(screen.getByPlaceholderText("Replace with…"), { target: { value: "dog" } });
    fireEvent.mouseDown(screen.getByTitle("Replace (Enter)"));
    expect(editor.commands.replaceCurrent).toHaveBeenCalledWith("dog");
  });

  it("All button replaces every match", () => {
    const editor = renderReplace();
    fireEvent.change(screen.getByPlaceholderText("Replace with…"), { target: { value: "dog" } });
    fireEvent.mouseDown(screen.getByTitle("Replace all (Ctrl+Enter)"));
    expect(editor.commands.replaceAll).toHaveBeenCalledWith("dog");
  });

  it("Enter replaces one, Ctrl+Enter replaces all", () => {
    const editor = renderReplace();
    const input = screen.getByPlaceholderText("Replace with…");
    fireEvent.change(input, { target: { value: "dog" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(editor.commands.replaceCurrent).toHaveBeenCalledWith("dog");
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(editor.commands.replaceAll).toHaveBeenCalledWith("dog");
  });
});
