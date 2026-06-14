"use client";

import { useEffect, useRef, useState } from "react";
import { X, ChevronUp, ChevronDown } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { SEARCH_KEY } from "./SearchExtension";

interface Props {
  editor: Editor;
  onClose: () => void;
}

export function SearchBar({ editor, onClose }: Props) {
  const [term, setTerm] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus & select-all when the bar opens
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Re-render whenever editor state changes so result count is live
  const [, tick] = useState(0);
  useEffect(() => {
    const update = () => tick((n) => n + 1);
    editor.on("transaction", update);
    return () => { editor.off("transaction", update); };
  }, [editor]);

  const s = SEARCH_KEY.getState(editor.state);
  const total = s?.results.length ?? 0;
  const current = total > 0 ? (s?.current ?? 0) + 1 : 0;

  const handleChange = (value: string) => {
    setTerm(value);
    editor.commands.setSearchTerm(value);
  };

  // PM updates the DOM synchronously on dispatch, so we can query the
  // decorated element immediately after the command returns.
  const scrollToMatch = () => {
    editor.view.dom
      .querySelector<HTMLElement>(".search-result-current")
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) { editor.commands.prevSearchResult(); }
      else { editor.commands.nextSearchResult(); }
      scrollToMatch();
    }
    if (e.key === "Escape") close();
  };

  const close = () => {
    editor.commands.clearSearch();
    onClose();
  };

  return (
    <div className="absolute top-2 right-3 z-30 flex items-center gap-1 bg-card border border-border rounded-lg shadow-xl px-2 py-1.5">
      <input
        ref={inputRef}
        value={term}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in scene…"
        className="bg-transparent text-sm outline-none w-44 text-foreground placeholder:text-muted-foreground"
        spellCheck={false}
      />

      {/* Result counter */}
      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 w-14 text-right">
        {!term ? "" : total === 0 ? "no results" : `${current} / ${total}`}
      </span>

      {/* Navigation */}
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); editor.commands.prevSearchResult(); scrollToMatch(); }}
        disabled={total < 2}
        title="Previous (Shift+Enter)"
        className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-30 transition-colors"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); editor.commands.nextSearchResult(); scrollToMatch(); }}
        disabled={total < 2}
        title="Next (Enter)"
        className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-30 transition-colors"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={close}
        title="Close (Esc)"
        className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
