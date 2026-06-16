import { describe, it, expect } from "vitest";
import { patchEntryAliases } from "../CodexHighlightExtension";
import type { CodexEntry } from "@/types";

function makeEntry(overrides: Partial<CodexEntry> = {}): CodexEntry {
  return {
    id: 1,
    name: "Aragorn",
    aliases: [],
    entry_type: "character",
    description: null,
    notes: null,
    color: "#eab308",
    groups: [],
    species: null,
    subtype: null,
    tags: [],
    is_main_char: false,
    name_type: null,
    project_id: 1,
    image_path: null,
    inventory: null,
    share_mode: "all",
    share_future: true,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("patchEntryAliases", () => {
  it("returns an empty array for empty input", () => {
    expect(patchEntryAliases([])).toEqual([]);
  });

  it("adds _allTerms containing at least the entry name", () => {
    const [patched] = patchEntryAliases([makeEntry({ name: "Aragorn", aliases: [] })]);
    expect(patched._allTerms).toContain("Aragorn");
  });

  it("includes all aliases in _allTerms", () => {
    const [patched] = patchEntryAliases([
      makeEntry({ name: "Aragorn", aliases: ["Strider", "Elessar"] }),
    ]);
    expect(patched._allTerms).toContain("Aragorn");
    expect(patched._allTerms).toContain("Strider");
    expect(patched._allTerms).toContain("Elessar");
    expect(patched._allTerms.length).toBe(3);
  });

  it("sorts _allTerms by descending length", () => {
    const [patched] = patchEntryAliases([
      makeEntry({ name: "Al", aliases: ["Albus Dumbledore", "Albus"] }),
    ]);
    // "Albus Dumbledore" (16) > "Albus" (5) > "Al" (2)
    expect(patched._allTerms[0]).toBe("Albus Dumbledore");
    expect(patched._allTerms[1]).toBe("Albus");
    expect(patched._allTerms[2]).toBe("Al");
  });

  it("preserves all other entry properties unchanged", () => {
    const entry = makeEntry({ id: 42, color: "#ff0000", description: "A ranger" });
    const [patched] = patchEntryAliases([entry]);
    expect(patched.id).toBe(42);
    expect(patched.color).toBe("#ff0000");
    expect(patched.description).toBe("A ranger");
  });

  it("handles null aliases gracefully (falls back to empty)", () => {
    const entry = makeEntry({ aliases: null as unknown as string[] });
    expect(() => patchEntryAliases([entry])).not.toThrow();
    const [patched] = patchEntryAliases([entry]);
    expect(patched._allTerms).toEqual(["Aragorn"]);
  });

  it("processes multiple entries independently", () => {
    const entries = [
      makeEntry({ id: 1, name: "Frodo", aliases: ["Mr. Baggins"] }),
      makeEntry({ id: 2, name: "Sam", aliases: [] }),
    ];
    const patched = patchEntryAliases(entries);
    expect(patched[0]._allTerms).toEqual(["Mr. Baggins", "Frodo"]);
    expect(patched[1]._allTerms).toEqual(["Sam"]);
  });
});
