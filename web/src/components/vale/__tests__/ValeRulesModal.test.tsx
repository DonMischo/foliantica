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
