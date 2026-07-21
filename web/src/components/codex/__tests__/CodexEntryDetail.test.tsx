import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/store/queries", () => ({
  useEntryRelations: () => ({ data: [] }),
  useInventorySummary: () => ({ data: undefined }),
}));

vi.mock("../EntryMentionsDialog", () => ({
  EntryMentionsDialog: () => null,
}));

import { CodexEntryDetail } from "../CodexEntryDetail";
import type { CodexEntry } from "@/types";

const base: CodexEntry = {
  id: 1,
  project_id: 1,
  name: "Gandalf",
  entry_type: "character",
  color: "#aabbcc",
  aliases: [],
  tags: [],
  groups: [],
  description: null,
  notes: null,
  species: null,
  subtype: null,
  gender: null,
  is_main_char: false,
  inventory: null,
  rpg_sheet: null,
  image_path: null,
  image_crop: null,
  name_type: null,
  share_mode: "none",
  share_future: false,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Header ────────────────────────────────────────────────────────────────────

describe("CodexEntryDetail — header", () => {
  it("renders the entry name", () => {
    render(<CodexEntryDetail entry={base} allEntries={[]} />);
    expect(screen.getByText("Gandalf")).toBeInTheDocument();
  });

  it("renders the type label for known types", () => {
    render(<CodexEntryDetail entry={base} allEntries={[]} />);
    expect(screen.getByText("Character")).toBeInTheDocument();
  });

  it("renders 'Custom' for custom entry_type", () => {
    render(<CodexEntryDetail entry={{ ...base, entry_type: "custom" }} allEntries={[]} />);
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });

  it("renders the mentions button", () => {
    render(<CodexEntryDetail entry={base} allEntries={[]} />);
    expect(screen.getByTitle("Mentions across scenes")).toBeInTheDocument();
  });
});

// ── Description ───────────────────────────────────────────────────────────────

describe("CodexEntryDetail — description", () => {
  it("shows placeholder when description is null", () => {
    render(<CodexEntryDetail entry={base} allEntries={[]} />);
    expect(screen.getByText("No description yet.")).toBeInTheDocument();
  });

  it("shows description text and hides placeholder", () => {
    render(
      <CodexEntryDetail entry={{ ...base, description: "A very old wizard." }} allEntries={[]} />
    );
    expect(screen.getByText("A very old wizard.")).toBeInTheDocument();
    expect(screen.queryByText("No description yet.")).not.toBeInTheDocument();
  });
});

// ── Aliases ───────────────────────────────────────────────────────────────────

describe("CodexEntryDetail — aliases", () => {
  it("renders no aliases section when empty", () => {
    render(<CodexEntryDetail entry={base} allEntries={[]} />);
    expect(screen.queryByText("Also known as")).not.toBeInTheDocument();
  });

  it("renders each alias when present", () => {
    render(
      <CodexEntryDetail
        entry={{ ...base, aliases: ["Mithrandir", "Grey Pilgrim"] }}
        allEntries={[]}
      />
    );
    expect(screen.getByText("Also known as")).toBeInTheDocument();
    expect(screen.getByText("Mithrandir")).toBeInTheDocument();
    expect(screen.getByText("Grey Pilgrim")).toBeInTheDocument();
  });
});

// ── Tags ──────────────────────────────────────────────────────────────────────

describe("CodexEntryDetail — tags", () => {
  it("renders no tags section when empty", () => {
    render(<CodexEntryDetail entry={base} allEntries={[]} />);
    expect(screen.queryByText("Tags")).not.toBeInTheDocument();
  });

  it("renders tags with # prefix", () => {
    render(<CodexEntryDetail entry={{ ...base, tags: ["wizard", "istari"] }} allEntries={[]} />);
    expect(screen.getByText("Tags")).toBeInTheDocument();
    expect(screen.getByText("#wizard")).toBeInTheDocument();
    expect(screen.getByText("#istari")).toBeInTheDocument();
  });
});

// ── Notes ─────────────────────────────────────────────────────────────────────

describe("CodexEntryDetail — notes", () => {
  it("renders no notes section when absent", () => {
    render(<CodexEntryDetail entry={base} allEntries={[]} />);
    expect(screen.queryByText("Notes")).not.toBeInTheDocument();
  });

  it("renders notes label and text when present", () => {
    render(
      <CodexEntryDetail
        entry={{ ...base, notes: "Appears in all three books." }}
        allEntries={[]}
      />
    );
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("Appears in all three books.")).toBeInTheDocument();
  });
});
