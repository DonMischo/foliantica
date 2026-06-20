import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/api", () => ({
  valeApi: {
    getSyncStatus:    vi.fn(),
    syncRules:        vi.fn(),
    getRuleMeta:      vi.fn(),
    getRuleEntries:   vi.fn(),
    toggleEntry:      vi.fn(),
    toggleAllEntries: vi.fn(),
    getCustomRules:   vi.fn(),
    updateCustomRules: vi.fn(),
  },
}));

import { ValeRulesModal } from "../ValeRulesModal";
import { valeApi } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

const synced = {
  last_synced: "2024-06-01T10:00:00",
  total_entries: 2,
  errors: {} as Record<string, string>,
};

const deRules = { rules: [{ name: "WeaselWords", type: "existence" as const }] };

const deEntries = {
  type: "existence" as const,
  entries: [
    { key: "\\bgewissermaßen\\b", enabled: true },
    { key: "\\birgendwie\\b",     enabled: true },
  ],
};

function setupDefaults() {
  vi.mocked(valeApi.getSyncStatus).mockResolvedValue(synced);
  vi.mocked(valeApi.syncRules).mockResolvedValue({ synced: 0, errors: {}, last_synced: "" });
  vi.mocked(valeApi.getRuleMeta).mockResolvedValue(deRules);
  vi.mocked(valeApi.getRuleEntries).mockResolvedValue(deEntries);
  vi.mocked(valeApi.getCustomRules).mockResolvedValue({ rules: {} });
  vi.mocked(valeApi.toggleEntry).mockResolvedValue({ ok: true });
}

/** Render the modal and wait until entries have loaded. */
async function renderOpen() {
  render(<ValeRulesModal open={true} onClose={vi.fn()} />);
  await waitFor(() =>
    expect(screen.getByText("gewissermaßen")).toBeInTheDocument()
  );
}

// ── Basic render ──────────────────────────────────────────────────────────────

describe("ValeRulesModal — render", () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaults(); });

  it("shows language sidebar when open", async () => {
    render(<ValeRulesModal open={true} onClose={vi.fn()} />);
    expect(screen.getByText("Deutsch")).toBeInTheDocument();
    expect(screen.getByText("English")).toBeInTheDocument();
  });

  it("renders entries as <button> elements (not label+input)", async () => {
    await renderOpen();
    const btn = screen.getByText("gewissermaßen").closest("button");
    expect(btn).not.toBeNull();
    // no hidden checkbox input should exist inside the list
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

// ── displayKey integration ────────────────────────────────────────────────────

describe("ValeRulesModal — \\b stripping", () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaults(); });

  it("displays entries without \\b word-boundary markers", async () => {
    await renderOpen();
    expect(screen.getByText("gewissermaßen")).toBeInTheDocument();
    expect(screen.queryByText("\\bgewissermaßen\\b")).not.toBeInTheDocument();
  });

  it("displays all entries stripped", async () => {
    await renderOpen();
    expect(screen.getByText("irgendwie")).toBeInTheDocument();
  });
});

// ── Deferred save ─────────────────────────────────────────────────────────────

describe("ValeRulesModal — deferred save", () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaults(); });

  it("does NOT show Save button when entries are freshly loaded", async () => {
    await renderOpen();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("shows Save button after toggling an entry", async () => {
    const user = userEvent.setup();
    await renderOpen();
    await user.click(screen.getByText("gewissermaßen").closest("button")!);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("does NOT call valeApi.toggleEntry immediately on toggle", async () => {
    const user = userEvent.setup();
    await renderOpen();
    await user.click(screen.getByText("gewissermaßen").closest("button")!);
    expect(vi.mocked(valeApi.toggleEntry)).not.toHaveBeenCalled();
  });

  it("calls valeApi.toggleEntry only for the changed entry when Save is clicked", async () => {
    const user = userEvent.setup();
    await renderOpen();
    // Toggle only the first entry
    await user.click(screen.getByText("gewissermaßen").closest("button")!);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(vi.mocked(valeApi.toggleEntry)).toHaveBeenCalledTimes(1)
    );
    expect(vi.mocked(valeApi.toggleEntry)).toHaveBeenCalledWith(
      "de", "WeaselWords", "\\bgewissermaßen\\b", false
    );
  });

  it("hides Save button after a successful save", async () => {
    const user = userEvent.setup();
    await renderOpen();
    await user.click(screen.getByText("gewissermaßen").closest("button")!);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument()
    );
  });

  it("reverts entries on save error", async () => {
    vi.mocked(valeApi.toggleEntry).mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    await renderOpen();
    // Disable first entry
    await user.click(screen.getByText("gewissermaßen").closest("button")!);
    await user.click(screen.getByRole("button", { name: "Save" }));
    // After error, Save button should disappear (reverted to server state = not dirty)
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument()
    );
  });
});

// ── \b legend ────────────────────────────────────────────────────────────────

describe("ValeRulesModal — \\b legend", () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaults(); });

  it("shows the word-boundary legend when a rule is selected", async () => {
    await renderOpen();
    expect(screen.getByText(/word boundary/)).toBeInTheDocument();
  });
});

// ── toggleAll ─────────────────────────────────────────────────────────────────

describe("ValeRulesModal — toggleAll", () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaults(); });

  it("shows Disable all button when entries are loaded", async () => {
    await renderOpen();
    expect(screen.getByRole("button", { name: "Disable all" })).toBeInTheDocument();
  });

  it("disables all entries and shows Save button", async () => {
    const user = userEvent.setup();
    await renderOpen();
    await user.click(screen.getByRole("button", { name: "Disable all" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("changes label to Enable all after all are disabled", async () => {
    const user = userEvent.setup();
    await renderOpen();
    await user.click(screen.getByRole("button", { name: "Disable all" }));
    expect(screen.getByRole("button", { name: "Enable all" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable all" })).not.toBeInTheDocument();
  });

  it("does NOT call valeApi.toggleAllEntries immediately", async () => {
    const user = userEvent.setup();
    await renderOpen();
    await user.click(screen.getByRole("button", { name: "Disable all" }));
    expect(vi.mocked(valeApi.toggleAllEntries)).not.toHaveBeenCalled();
  });
});

// ── Substitution entry display ────────────────────────────────────────────────

const subRules = { rules: [{ name: "Redundancy", type: "substitution" as const }] };
const subEntries = {
  type: "substitution" as const,
  entries: [{ key: "\\bweißer Schimmel\\b", value: "Schimmel", enabled: true }],
};

describe("ValeRulesModal — substitution entries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
    vi.mocked(valeApi.getRuleMeta).mockResolvedValue(subRules);
    vi.mocked(valeApi.getRuleEntries).mockResolvedValue(subEntries);
  });

  async function renderSubstitution() {
    render(<ValeRulesModal open={true} onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText("weißer Schimmel")).toBeInTheDocument()
    );
  }

  it("renders key and value with an arrow separator", async () => {
    await renderSubstitution();
    expect(screen.getByText("weißer Schimmel")).toBeInTheDocument();
    expect(screen.getByText("Schimmel")).toBeInTheDocument();
    // The → separator should appear at least once in the entry row
    expect(screen.getAllByText("→").length).toBeGreaterThan(0);
  });

  it("strips \\b from substitution entry keys", async () => {
    await renderSubstitution();
    // Entry button text should not contain \b (legend code elements may, that's fine)
    const entryBtn = screen.getByText("weißer Schimmel").closest("button");
    expect(entryBtn?.textContent).not.toMatch(/\\b/);
  });
});

// ── Rule switching ────────────────────────────────────────────────────────────

describe("ValeRulesModal — rule switching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
    vi.mocked(valeApi.getRuleMeta).mockResolvedValue({
      rules: [
        { name: "WeaselWords", type: "existence" as const },
        { name: "Redundancy",  type: "substitution" as const },
      ],
    });
    vi.mocked(valeApi.getRuleEntries).mockImplementation((_, rule) =>
      Promise.resolve(rule === "Redundancy" ? subEntries : deEntries)
    );
  });

  it("loads new entries when the rule dropdown changes", async () => {
    const user = userEvent.setup();
    await renderOpen();
    await user.selectOptions(screen.getByRole("combobox"), "Redundancy");
    await waitFor(() =>
      expect(screen.getByText("weißer Schimmel")).toBeInTheDocument()
    );
  });

  it("clears the dirty state when switching rules", async () => {
    const user = userEvent.setup();
    await renderOpen();
    // Dirty the first rule
    await user.click(screen.getByText("gewissermaßen").closest("button")!);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    // Switch to Redundancy — different cache key, not dirty
    await user.selectOptions(screen.getByRole("combobox"), "Redundancy");
    await waitFor(() =>
      expect(screen.getByText("weißer Schimmel")).toBeInTheDocument()
    );
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });
});

// ── Custom rules — existence ──────────────────────────────────────────────────

describe("ValeRulesModal — custom rules (existence)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
    vi.mocked(valeApi.updateCustomRules).mockResolvedValue({ ok: true });
  });

  it("add-button is disabled when the custom input is empty", async () => {
    await renderOpen();
    const addInput = screen.getByPlaceholderText("Add word or phrase…");
    const addBtn = addInput.closest("div")!.querySelector("button")!;
    expect(addBtn).toBeDisabled();
  });

  it("calls updateCustomRules when a token is submitted via Enter", async () => {
    const user = userEvent.setup();
    await renderOpen();
    await user.type(screen.getByPlaceholderText("Add word or phrase…"), "sozusagen");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(vi.mocked(valeApi.updateCustomRules)).toHaveBeenCalledWith(
        { de: { WeaselWords: ["sozusagen"] } }
      )
    );
  });

  it("calls updateCustomRules when the + button is clicked", async () => {
    const user = userEvent.setup();
    await renderOpen();
    const addInput = screen.getByPlaceholderText("Add word or phrase…");
    await user.type(addInput, "sozusagen");
    const addBtn = addInput.closest("div")!.querySelector("button")!;
    await user.click(addBtn);
    await waitFor(() =>
      expect(vi.mocked(valeApi.updateCustomRules)).toHaveBeenCalledWith(
        { de: { WeaselWords: ["sozusagen"] } }
      )
    );
  });

  it("removes a custom token when its X button is clicked", async () => {
    vi.mocked(valeApi.getCustomRules).mockResolvedValue({
      rules: { de: { WeaselWords: ["vorhandenes"] } },
    });
    const user = userEvent.setup();
    render(<ValeRulesModal open={true} onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText("vorhandenes")).toBeInTheDocument()
    );
    const row = screen.getByText("vorhandenes").closest("div")!;
    await user.click(row.querySelector("button")!);
    await waitFor(() =>
      expect(vi.mocked(valeApi.updateCustomRules)).toHaveBeenCalledWith(
        { de: { WeaselWords: [] } }
      )
    );
  });
});

// ── Custom rules — substitution ───────────────────────────────────────────────

describe("ValeRulesModal — custom rules (substitution)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
    vi.mocked(valeApi.getRuleMeta).mockResolvedValue(subRules);
    vi.mocked(valeApi.getRuleEntries).mockResolvedValue(subEntries);
    vi.mocked(valeApi.updateCustomRules).mockResolvedValue({ ok: true });
  });

  async function renderSub() {
    render(<ValeRulesModal open={true} onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText("weißer Schimmel")).toBeInTheDocument()
    );
  }

  it("calls updateCustomRules when a pair is submitted via Enter", async () => {
    const user = userEvent.setup();
    await renderSub();
    await user.type(screen.getByPlaceholderText("Original…"), "weißer Schimmel");
    await user.type(screen.getByPlaceholderText("Replacement…"), "Schimmel");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(vi.mocked(valeApi.updateCustomRules)).toHaveBeenCalledWith({
        de: { Redundancy: { "weißer Schimmel": "Schimmel" } },
      })
    );
  });

  it("removes a custom pair when its X button is clicked", async () => {
    vi.mocked(valeApi.getCustomRules).mockResolvedValue({
      rules: { de: { Redundancy: { "alter Hut": "Klischee" } } },
    });
    const user = userEvent.setup();
    render(<ValeRulesModal open={true} onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/alter Hut/)).toBeInTheDocument()
    );
    const row = screen.getByText(/alter Hut/).closest("div")!;
    await user.click(row.querySelector("button")!);
    await waitFor(() =>
      expect(vi.mocked(valeApi.updateCustomRules)).toHaveBeenCalledWith(
        { de: { Redundancy: {} } }
      )
    );
  });
});
