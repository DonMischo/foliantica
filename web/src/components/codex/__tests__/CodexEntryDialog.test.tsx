import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

// ── Query hooks mock ───────────────────────────────────────────────────────────
vi.mock("@/store/queries", () => ({
  useSettings: () => ({ data: null }),
  useEntryAccess: () => ({ data: undefined }),
  useSetEntryAccess: () => ({ mutate: vi.fn() }),
  useInventorySummary: () => ({ data: undefined }),
  useCharacterItemLog: () => ({ data: undefined }),
  useCharacterCurrencyLog: () => ({ data: undefined }),
  useEntryRelations: () => ({ data: [] }),
  useCreateRelation: () => ({ mutate: vi.fn() }),
  useDeleteRelation: () => ({ mutate: vi.fn() }),
  useUploadCodexImage: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useDeleteCodexImage: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useUpdateCodexEntry: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

// ── Language context mock ──────────────────────────────────────────────────────
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

// ── API mock ───────────────────────────────────────────────────────────────────
vi.mock("@/lib/api", () => ({
  imagesApi: { uploadCodexImage: vi.fn(), deleteCodexImage: vi.fn() },
  translateApi: { translateEntry: vi.fn() },
  structureApi: { structureEntry: vi.fn() },
}));

// ── NameGeneratorWidget mock ───────────────────────────────────────────────────
vi.mock("../NameGeneratorWidget", () => ({
  NameGeneratorWidget: () => null,
}));

import { CodexEntryDialog } from "../CodexEntryDialog";

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onSave: vi.fn(),
  title: "New Codex Entry",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CodexEntryDialog — form render", () => {
  it("renders without crashing when open", () => {
    expect(() => render(<CodexEntryDialog {...defaultProps} />)).not.toThrow();
  });

  it("renders the Name input field", () => {
    render(<CodexEntryDialog {...defaultProps} />);
    // The input has a hardcoded placeholder "Entry name…"
    expect(screen.getByPlaceholderText("Entry name…")).toBeInTheDocument();
  });

  it("renders the Save button", () => {
    render(<CodexEntryDialog {...defaultProps} />);
    expect(screen.getByRole("button", { name: "entry_save" })).toBeInTheDocument();
  });

  it("renders the Cancel button", () => {
    render(<CodexEntryDialog {...defaultProps} />);
    expect(screen.getByRole("button", { name: "common_cancel" })).toBeInTheDocument();
  });

  it("pre-fills the name field from initial prop", () => {
    render(
      <CodexEntryDialog {...defaultProps} initial={{ name: "Gandalf", aliases: [] }} />
    );
    expect(screen.getByPlaceholderText("Entry name…")).toHaveValue("Gandalf");
  });
});

describe("CodexEntryDialog — empty name validation", () => {
  it("Save button is disabled when name is empty", () => {
    render(<CodexEntryDialog {...defaultProps} />);
    const saveBtn = screen.getByRole("button", { name: "entry_save" });
    expect(saveBtn).toBeDisabled();
  });

  it("does not call onSave when name is empty even if the disabled attribute is removed", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<CodexEntryDialog {...defaultProps} onSave={onSave} />);

    const saveBtn = screen.getByRole("button", { name: "entry_save" });
    // Bypass the UI guard: remove the disabled attribute so the button is clickable
    saveBtn.removeAttribute("disabled");
    await user.click(saveBtn);

    // The code-level guard (if (!name.trim()) return) must still block the call
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("CodexEntryDialog — submit payload", () => {
  it("enables Save button once a name is typed", async () => {
    const user = userEvent.setup();
    render(<CodexEntryDialog {...defaultProps} />);
    const nameInput = screen.getByPlaceholderText("Entry name…");
    await user.type(nameInput, "Frodo");
    const saveBtn = screen.getByRole("button", { name: "entry_save" });
    expect(saveBtn).not.toBeDisabled();
  });

  it("calls onSave with the typed name when Save is clicked", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<CodexEntryDialog {...defaultProps} onSave={onSave} />);

    const nameInput = screen.getByPlaceholderText("Entry name…");
    await user.type(nameInput, "Frodo Baggins");

    const saveBtn = screen.getByRole("button", { name: "entry_save" });
    await user.click(saveBtn);

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0]).toMatchObject({ name: "Frodo Baggins" });
  });

  it("calls onSave with trimmed name", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<CodexEntryDialog {...defaultProps} onSave={onSave} />);

    const nameInput = screen.getByPlaceholderText("Entry name…");
    await user.type(nameInput, "  Samwise  ");

    const saveBtn = screen.getByRole("button", { name: "entry_save" });
    await user.click(saveBtn);

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0].name).toBe("Samwise");
  });
});
