import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { createRef } from "react";
import { SlashCommandMenu, COMMANDS, type SlashMenuHandle } from "../SlashCommandMenu";

// A fixed rect simulating a cursor position mid-viewport.
const MOCK_RECT: DOMRect = {
  left: 100, right: 200, top: 300, bottom: 320,
  width: 100, height: 20, x: 100, y: 300,
  toJSON: () => ({}),
};

// Use the first two commands (Note, Currency) as a minimal stable fixture.
const TWO_ITEMS = COMMANDS.slice(0, 2);

function setup(
  overrides: Partial<React.ComponentProps<typeof SlashCommandMenu>> = {}
) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const ref = createRef<SlashMenuHandle>();
  render(
    <SlashCommandMenu
      ref={ref}
      items={TWO_ITEMS}
      rect={MOCK_RECT}
      onSelect={onSelect}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onSelect, onClose, ref };
}

function pressKey(ref: React.RefObject<SlashMenuHandle | null>, key: string) {
  act(() => {
    ref.current!.handleKey(new KeyboardEvent("keydown", { key }));
  });
}

// ── Visibility ────────────────────────────────────────────────────────────────

describe("SlashCommandMenu — visibility", () => {
  it("renders nothing when the items list is empty", () => {
    const { container } = render(
      <SlashCommandMenu items={[]} rect={MOCK_RECT} onSelect={vi.fn()} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when rect is null (cursor position unknown)", () => {
    const { container } = render(
      <SlashCommandMenu items={TWO_ITEMS} rect={null} onSelect={vi.fn()} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a button for every item in the list", () => {
    setup();
    expect(screen.getByText("Note")).toBeInTheDocument();
    expect(screen.getByText("Currency")).toBeInTheDocument();
  });

  it("shows each item's description alongside the label", () => {
    setup();
    expect(screen.getByText(/Annotation visible only while writing/)).toBeInTheDocument();
  });
});

// ── Keyboard navigation ───────────────────────────────────────────────────────

describe("SlashCommandMenu — keyboard navigation", () => {
  it("Enter selects the first item by default", () => {
    const { ref, onSelect } = setup();
    pressKey(ref, "Enter");
    expect(onSelect).toHaveBeenCalledWith(TWO_ITEMS[0]);
  });

  it("Tab also selects the active item", () => {
    const { ref, onSelect } = setup();
    pressKey(ref, "Tab");
    expect(onSelect).toHaveBeenCalledWith(TWO_ITEMS[0]);
  });

  it("ArrowDown moves selection to the next item", () => {
    const { ref, onSelect } = setup();
    pressKey(ref, "ArrowDown");
    pressKey(ref, "Enter");
    expect(onSelect).toHaveBeenCalledWith(TWO_ITEMS[1]);
  });

  it("ArrowDown wraps from last item back to first", () => {
    const { ref, onSelect } = setup();
    pressKey(ref, "ArrowDown"); // → index 1
    pressKey(ref, "ArrowDown"); // → index 0 (wrap)
    pressKey(ref, "Enter");
    expect(onSelect).toHaveBeenCalledWith(TWO_ITEMS[0]);
  });

  it("ArrowUp wraps from first item to last", () => {
    const { ref, onSelect } = setup();
    pressKey(ref, "ArrowUp"); // → index 1 (wrap from 0)
    pressKey(ref, "Enter");
    expect(onSelect).toHaveBeenCalledWith(TWO_ITEMS[1]);
  });

  it("returns true for handled navigation keys", () => {
    const { ref } = setup();
    let handled: boolean;
    act(() => {
      handled = ref.current!.handleKey(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    });
    expect(handled!).toBe(true);
  });

  it("returns false for unrecognised keys so the editor can process them", () => {
    const { ref } = setup();
    let handled: boolean;
    act(() => {
      handled = ref.current!.handleKey(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(handled!).toBe(false);
  });

  it("returns false (no-op) when the items list is empty", () => {
    const ref = createRef<SlashMenuHandle>();
    render(
      <SlashCommandMenu ref={ref} items={[]} rect={MOCK_RECT} onSelect={vi.fn()} onClose={vi.fn()} />
    );
    // Menu renders null but ref is still attached via forwardRef
    let handled: boolean;
    act(() => {
      handled = ref.current!.handleKey(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    });
    expect(handled!).toBe(false);
  });
});

// ── Mouse interaction ─────────────────────────────────────────────────────────

describe("SlashCommandMenu — mouse interaction", () => {
  it("mouseDown on a command button calls onSelect with that command", () => {
    const { onSelect } = setup();
    const currencyBtn = screen.getByText("Currency").closest("button")!;
    fireEvent.mouseDown(currencyBtn);
    expect(onSelect).toHaveBeenCalledWith(TWO_ITEMS[1]);
  });

  it("calls onClose when the user clicks outside the menu", () => {
    const { onClose } = setup();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("does NOT call onClose when clicking inside the menu", () => {
    const { onClose } = setup();
    const noteBtn = screen.getByText("Note").closest("button")!;
    fireEvent.mouseDown(noteBtn);
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ── COMMANDS registry ─────────────────────────────────────────────────────────

describe("COMMANDS — registry integrity", () => {
  it("every command has a non-empty id, label, and keywords array", () => {
    for (const cmd of COMMANDS) {
      expect(cmd.id).toBeTruthy();
      expect(cmd.label).toBeTruthy();
      expect(Array.isArray(cmd.keywords)).toBe(true);
      expect(cmd.keywords.length).toBeGreaterThan(0);
    }
  });

  it("all command ids are unique", () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── Content factories ─────────────────────────────────────────────────────────

describe("COMMANDS — content factories", () => {
  const withContent = COMMANDS.filter((c) => c.content !== null);

  it.each(withContent)(
    "$id content() returns a TipTap-compatible node object with a type string",
    ({ content }) => {
      const node = content!() as Record<string, unknown>;
      expect(typeof node.type).toBe("string");
      expect(node.type).toBeTruthy();
    }
  );

  it("note content nests a paragraph so the user can type immediately", () => {
    const node = COMMANDS.find((c) => c.id === "note")!.content!() as any;
    expect(node.type).toBe("note");
    expect(node.content[0].type).toBe("paragraph");
  });

  it("currency content starts with zero delta and empty currency name", () => {
    const node = COMMANDS.find((c) => c.id === "currency")!.content!() as any;
    expect(node.attrs.delta).toBe(0);
    expect(node.attrs.currencyName).toBe("");
  });

  it("item content defaults qty to 1", () => {
    const node = COMMANDS.find((c) => c.id === "item")!.content!() as any;
    expect(node.attrs.qty).toBe(1);
  });

  it("tasklist content starts with one unchecked task item", () => {
    const node = COMMANDS.find((c) => c.id === "tasklist")!.content!() as any;
    expect(node.type).toBe("taskList");
    expect(node.content[0].type).toBe("taskItem");
    expect(node.content[0].attrs.checked).toBe(false);
  });

  it("image content starts with empty src and caption", () => {
    const node = COMMANDS.find((c) => c.id === "image")!.content!() as any;
    expect(node.attrs.src).toBe("");
    expect(node.attrs.caption).toBe("");
  });
});
