import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useAutosave } from "../useAutosave";
import { useUIStore } from "@/store/ui";

// Node 22 has a broken experimental localStorage — replace with a real in-memory store.
const _store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => _store[k] ?? null,
  setItem: (k: string, v: string) => { _store[k] = v; },
  removeItem: (k: string) => { delete _store[k]; },
  clear: () => { Object.keys(_store).forEach((k) => delete _store[k]); },
};
vi.stubGlobal("localStorage", mockLocalStorage);

vi.mock("@/lib/api", () => ({
  scenesApi: {
    update: vi.fn(),
  },
}));

import { scenesApi } from "@/lib/api";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  // Reset zustand store state between tests
  useUIStore.setState({ saveStatus: "idle" });
  vi.mocked(scenesApi.update).mockResolvedValue({} as any);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAutosave", () => {
  it("sets saveStatus to 'saving' immediately on content change", () => {
    renderHook(
      () => useAutosave({ sceneId: 1, content: "hello", enabled: true }),
      { wrapper: makeWrapper() }
    );
    expect(useUIStore.getState().saveStatus).toBe("saving");
  });

  it("calls scenesApi.update after the debounce delay", async () => {
    renderHook(
      () => useAutosave({ sceneId: 1, content: "hello", enabled: true }),
      { wrapper: makeWrapper() }
    );

    expect(scenesApi.update).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(scenesApi.update).toHaveBeenCalledWith(1, { content: "hello" });
  });

  it("does not call scenesApi.update when enabled is false", async () => {
    renderHook(
      () => useAutosave({ sceneId: 1, content: "hello", enabled: false }),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(scenesApi.update).not.toHaveBeenCalled();
  });

  it("sets saveStatus to 'saved' after successful save", async () => {
    renderHook(
      () => useAutosave({ sceneId: 1, content: "hello", enabled: true }),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(useUIStore.getState().saveStatus).toBe("saved");
  });

  it("sets saveStatus to 'error' and persists to localStorage on API failure", async () => {
    vi.mocked(scenesApi.update).mockRejectedValueOnce(new Error("Network error"));

    renderHook(
      () => useAutosave({ sceneId: 7, content: "draft content", enabled: true }),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(useUIStore.getState().saveStatus).toBe("error");
    expect(localStorage.getItem("lw_pending_7")).toBe("draft content");
  });

  it("removes localStorage entry after successful save", async () => {
    localStorage.setItem("lw_pending_5", "old draft");

    renderHook(
      () => useAutosave({ sceneId: 5, content: "hello", enabled: true }),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(localStorage.getItem("lw_pending_5")).toBeNull();
  });

  it("recovers and saves content from localStorage on mount", async () => {
    localStorage.setItem("lw_pending_3", "stored content");

    renderHook(
      () => useAutosave({ sceneId: 3, content: "current", enabled: true }),
      { wrapper: makeWrapper() }
    );

    // The recovery save fires immediately (not debounced)
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(scenesApi.update).toHaveBeenCalledWith(3, { content: "stored content" });
  });
});
