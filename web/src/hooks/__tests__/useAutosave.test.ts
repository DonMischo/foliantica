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
  // Pin the autosave interval to 20s so the timer-based assertions below are
  // deterministic regardless of the store's default.
  useUIStore.setState({ saveStatus: "idle", autosaveInterval: 20 });
  vi.mocked(scenesApi.update).mockResolvedValue({} as any);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAutosave", () => {
  it("sets saveStatus to 'unsaved' when markDirty is called", () => {
    const { result } = renderHook(
      () => useAutosave({ sceneId: 1, enabled: true }),
      { wrapper: makeWrapper() }
    );
    act(() => { result.current.markDirty("<p>changed</p>"); });
    expect(useUIStore.getState().saveStatus).toBe("unsaved");
  });

  it("does NOT call scenesApi.update before the 20s interval fires", () => {
    const { result } = renderHook(
      () => useAutosave({ sceneId: 1, enabled: true }),
      { wrapper: makeWrapper() }
    );
    act(() => { result.current.markDirty("<p>hello</p>"); });
    vi.advanceTimersByTime(5_000);
    expect(scenesApi.update).not.toHaveBeenCalled();
  });

  it("saves the pending content after the 20s interval", async () => {
    const { result } = renderHook(
      () => useAutosave({ sceneId: 1, enabled: true }),
      { wrapper: makeWrapper() }
    );
    act(() => { result.current.markDirty("<p>edited</p>"); });

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    expect(scenesApi.update).toHaveBeenCalledWith(1, { content: "<p>edited</p>" });
  });

  it("does nothing when enabled is false", async () => {
    const { result } = renderHook(
      () => useAutosave({ sceneId: 1, enabled: false }),
      { wrapper: makeWrapper() }
    );
    act(() => { result.current.markDirty("<p>hello</p>"); });

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    expect(scenesApi.update).not.toHaveBeenCalled();
    // markDirty is a no-op while disabled — status stays at the mount-time
    // "saved" baseline instead of flipping to "unsaved".
    expect(useUIStore.getState().saveStatus).toBe("saved");
  });

  it("sets saveStatus to 'saved' after a successful save", async () => {
    const { result } = renderHook(
      () => useAutosave({ sceneId: 1, enabled: true }),
      { wrapper: makeWrapper() }
    );
    act(() => { result.current.markDirty("<p>edited</p>"); });

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    expect(useUIStore.getState().saveStatus).toBe("saved");
  });

  it("sets saveStatus to 'error' and persists to localStorage on API failure", async () => {
    vi.mocked(scenesApi.update).mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(
      () => useAutosave({ sceneId: 7, enabled: true }),
      { wrapper: makeWrapper() }
    );
    act(() => { result.current.markDirty("draft content"); });

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    expect(useUIStore.getState().saveStatus).toBe("error");
    expect(localStorage.getItem("lw_pending_7")).toBe("draft content");
  });

  it("removes the localStorage entry after a successful save", async () => {
    localStorage.setItem("lw_pending_5", "old draft");

    const { result } = renderHook(
      () => useAutosave({ sceneId: 5, enabled: true }),
      { wrapper: makeWrapper() }
    );
    act(() => { result.current.markDirty("<p>edited</p>"); });

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    expect(localStorage.getItem("lw_pending_5")).toBeNull();
  });

  it("recovers and saves content from localStorage on mount", async () => {
    localStorage.setItem("lw_pending_3", "stored content");

    renderHook(
      () => useAutosave({ sceneId: 3, enabled: true }),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(scenesApi.update).toHaveBeenCalledWith(3, { content: "stored content" });
  });

  it("flushes a pending edit on unmount instead of dropping it", async () => {
    const { result, unmount } = renderHook(
      () => useAutosave({ sceneId: 9, enabled: true }),
      { wrapper: makeWrapper() }
    );

    act(() => { result.current.markDirty("edited before nav"); });
    await act(async () => {
      unmount();
    });

    expect(scenesApi.update).toHaveBeenCalledWith(9, { content: "edited before nav" });
  });

  it("flushes the previous scene's pending edit to the correct scene on navigation", async () => {
    const { result, rerender } = renderHook(
      ({ sceneId }) => useAutosave({ sceneId, enabled: true }),
      { wrapper: makeWrapper(), initialProps: { sceneId: 1 } }
    );

    act(() => { result.current.markDirty("scene one edit"); });

    // Navigate to scene 2 before the 20s interval fires — scene 1 flush must run
    await act(async () => {
      rerender({ sceneId: 2 });
    });

    expect(scenesApi.update).toHaveBeenCalledWith(1, { content: "scene one edit" });
    expect(scenesApi.update).not.toHaveBeenCalledWith(2, { content: "scene one edit" });
  });

  it("does NOT save anything on scene switch when nothing was marked dirty", async () => {
    const { rerender } = renderHook(
      ({ sceneId }) => useAutosave({ sceneId, enabled: true }),
      { wrapper: makeWrapper(), initialProps: { sceneId: 1 } }
    );

    await act(async () => {
      rerender({ sceneId: 2 });
    });
    await act(async () => {
      rerender({ sceneId: 1 });
    });

    expect(scenesApi.update).not.toHaveBeenCalled();
  });

  it("does not save again if nothing changed since the last save", async () => {
    const { result } = renderHook(
      () => useAutosave({ sceneId: 1, enabled: true }),
      { wrapper: makeWrapper() }
    );
    act(() => { result.current.markDirty("<p>edited</p>"); });

    // First interval — saves
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(scenesApi.update).toHaveBeenCalledTimes(1);

    // Second interval — nothing pending, should NOT save again
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(scenesApi.update).toHaveBeenCalledTimes(1);
  });

  it("honours the configured autosave interval from the UI store", async () => {
    useUIStore.setState({ autosaveInterval: 60 });
    const { result } = renderHook(
      () => useAutosave({ sceneId: 1, enabled: true }),
      { wrapper: makeWrapper() }
    );
    act(() => { result.current.markDirty("<p>edited</p>"); });

    // 20s is no longer enough — the interval is now 60s.
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(scenesApi.update).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(40_000); });
    expect(scenesApi.update).toHaveBeenCalledWith(1, { content: "<p>edited</p>" });
  });

  it("saveNow triggers an immediate save with the given content", async () => {
    const { result } = renderHook(
      () => useAutosave({ sceneId: 1, enabled: true }),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      result.current.saveNow("<p>changed</p>");
    });

    expect(scenesApi.update).toHaveBeenCalledWith(1, { content: "<p>changed</p>" });
  });
});
