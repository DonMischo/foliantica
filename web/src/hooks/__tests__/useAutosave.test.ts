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
  useUIStore.setState({ saveStatus: "idle" });
  vi.mocked(scenesApi.update).mockResolvedValue({} as any);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAutosave", () => {
  it("sets saveStatus to 'unsaved' immediately on content change", () => {
    const { rerender } = renderHook(
      ({ content }) => useAutosave({ sceneId: 1, content, enabled: true }),
      { wrapper: makeWrapper(), initialProps: { content: "first" } }
    );
    // After initial mount, lastSavedRef.current === content, so status stays idle.
    // Change content to trigger the unsaved effect.
    rerender({ content: "changed" });
    expect(useUIStore.getState().saveStatus).toBe("unsaved");
  });

  it("does NOT call scenesApi.update before the 20s interval fires", () => {
    renderHook(
      () => useAutosave({ sceneId: 1, content: "hello", enabled: true }),
      { wrapper: makeWrapper() }
    );
    vi.advanceTimersByTime(5_000);
    expect(scenesApi.update).not.toHaveBeenCalled();
  });

  it("calls scenesApi.update after the 20s interval", async () => {
    const { rerender } = renderHook(
      ({ content }) => useAutosave({ sceneId: 1, content, enabled: true }),
      { wrapper: makeWrapper(), initialProps: { content: "first" } }
    );
    rerender({ content: "edited" });

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    expect(scenesApi.update).toHaveBeenCalledWith(1, { content: "edited" });
  });

  it("does not call scenesApi.update when enabled is false", async () => {
    renderHook(
      () => useAutosave({ sceneId: 1, content: "hello", enabled: false }),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    expect(scenesApi.update).not.toHaveBeenCalled();
  });

  it("sets saveStatus to 'saved' after successful save", async () => {
    const { rerender } = renderHook(
      ({ content }) => useAutosave({ sceneId: 1, content, enabled: true }),
      { wrapper: makeWrapper(), initialProps: { content: "first" } }
    );
    rerender({ content: "edited" });

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    expect(useUIStore.getState().saveStatus).toBe("saved");
  });

  it("sets saveStatus to 'error' and persists to localStorage on API failure", async () => {
    vi.mocked(scenesApi.update).mockRejectedValueOnce(new Error("Network error"));

    const { rerender } = renderHook(
      ({ content }) => useAutosave({ sceneId: 7, content, enabled: true }),
      { wrapper: makeWrapper(), initialProps: { content: "first" } }
    );
    rerender({ content: "draft content" });

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    expect(useUIStore.getState().saveStatus).toBe("error");
    expect(localStorage.getItem("lw_pending_7")).toBe("draft content");
  });

  it("removes localStorage entry after successful save", async () => {
    localStorage.setItem("lw_pending_5", "old draft");

    const { rerender } = renderHook(
      ({ content }) => useAutosave({ sceneId: 5, content, enabled: true }),
      { wrapper: makeWrapper(), initialProps: { content: "first" } }
    );
    rerender({ content: "edited" });

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    expect(localStorage.getItem("lw_pending_5")).toBeNull();
  });

  it("recovers and saves content from localStorage on mount", async () => {
    localStorage.setItem("lw_pending_3", "stored content");

    renderHook(
      () => useAutosave({ sceneId: 3, content: "current", enabled: true }),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(scenesApi.update).toHaveBeenCalledWith(3, { content: "stored content" });
  });

  it("does NOT re-save when stored pending content equals the loaded content", async () => {
    localStorage.setItem("lw_pending_4", "same content");

    renderHook(
      () => useAutosave({ sceneId: 4, content: "same content", enabled: true }),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(scenesApi.update).not.toHaveBeenCalled();
    expect(localStorage.getItem("lw_pending_4")).toBeNull();
  });

  it("flushes a pending edit on unmount instead of dropping it", async () => {
    const { rerender, unmount } = renderHook(
      ({ content }) => useAutosave({ sceneId: 9, content, enabled: true }),
      { wrapper: makeWrapper(), initialProps: { content: "first" } }
    );

    rerender({ content: "edited before nav" });
    await act(async () => {
      unmount();
    });

    expect(scenesApi.update).toHaveBeenCalledWith(9, { content: "edited before nav" });
  });

  it("flushes the previous scene's pending edit to the correct scene on navigation", async () => {
    const { rerender } = renderHook(
      ({ sceneId, content }) => useAutosave({ sceneId, content, enabled: true }),
      {
        wrapper: makeWrapper(),
        initialProps: { sceneId: 1, content: "initial" },
      }
    );

    // Edit scene 1 — now there's a pending save
    rerender({ sceneId: 1, content: "scene one edit" });

    // Navigate to scene 2 before the 20s interval fires — scene 1 flush must run
    await act(async () => {
      rerender({ sceneId: 2, content: "scene two content" });
    });

    expect(scenesApi.update).toHaveBeenCalledWith(1, { content: "scene one edit" });
    expect(scenesApi.update).not.toHaveBeenCalledWith(2, { content: "scene one edit" });
  });

  it("does not save again if content has not changed since last save", async () => {
    const { rerender } = renderHook(
      ({ content }) => useAutosave({ sceneId: 1, content, enabled: true }),
      { wrapper: makeWrapper(), initialProps: { content: "first" } }
    );
    rerender({ content: "edited" });

    // First interval — saves
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(scenesApi.update).toHaveBeenCalledTimes(1);

    // Second interval — content unchanged, should NOT save again
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(scenesApi.update).toHaveBeenCalledTimes(1);
  });

  it("saveNow triggers an immediate save", async () => {
    const { rerender, result } = renderHook(
      ({ content }) => useAutosave({ sceneId: 1, content, enabled: true }),
      { wrapper: makeWrapper(), initialProps: { content: "first" } }
    );
    rerender({ content: "changed" });

    await act(async () => {
      result.current.saveNow();
    });

    expect(scenesApi.update).toHaveBeenCalledWith(1, { content: "changed" });
  });
});
