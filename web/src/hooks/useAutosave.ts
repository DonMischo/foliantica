import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUIStore } from "@/store/ui";
import { scenesApi } from "@/lib/api";

const STORAGE_PREFIX = "lw_pending_";

interface Options {
  sceneId: number;
  enabled: boolean;
}

export function useAutosave({ sceneId, enabled }: Options) {
  const setSaveStatus = useUIStore((s) => s.setSaveStatus);
  const autosaveInterval = useUIStore((s) => s.autosaveInterval);
  const qc = useQueryClient();
  const pendingSaveRef = useRef<{ value: string; sceneId: number } | null>(null);

  const save = useCallback(async (value: string, forSceneId: number) => {
    if (!enabled) return;
    setSaveStatus("saving");
    try {
      await scenesApi.update(forSceneId, { content: value });
      qc.setQueryData(["scene", forSceneId], (old: any) =>
        old ? { ...old, content: value } : old
      );
      localStorage.removeItem(`${STORAGE_PREFIX}${forSceneId}`);
      setSaveStatus("saved");
    } catch {
      localStorage.setItem(`${STORAGE_PREFIX}${forSceneId}`, value);
      setSaveStatus("error");
    }
  }, [enabled, setSaveStatus, qc]);

  // Keep a stable ref so the flush closure always calls the latest save
  // without `save` being a dep of the flush effect (which would cause
  // spurious flushes whenever `enabled` toggles during scene loading).
  const saveRef = useRef(save);
  saveRef.current = save;

  // Clear any pending save when sceneId changes so a stale value from the
  // previous scene can never be flushed onto the new one.
  useEffect(() => {
    pendingSaveRef.current = null;
    setSaveStatus("saved");
  }, [sceneId, setSaveStatus]);

  // Flush on navigation — only fires when sceneId changes, not on every
  // enabled/save recreation.
  useEffect(() => {
    return () => {
      const pending = pendingSaveRef.current;
      if (pending) {
        pendingSaveRef.current = null;
        void saveRef.current(pending.value, pending.sceneId);
      }
    };
  }, [sceneId]);

  // Periodic interval save — period is the user-configured autosave interval.
  useEffect(() => {
    if (!enabled) return;
    const intervalMs = Math.max(5, autosaveInterval) * 1000;
    const interval = setInterval(() => {
      const pending = pendingSaveRef.current;
      if (pending) {
        pendingSaveRef.current = null;
        void save(pending.value, pending.sceneId);
      }
    }, intervalMs);
    return () => clearInterval(interval);
  }, [save, enabled, autosaveInterval]);

  // Warn on unload if there are unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pendingSaveRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Called directly by the scene page whenever TipTap fires onChange —
  // which only happens on real user edits (preventUpdate blocks it for
  // programmatic content loads). This is the single source of truth for
  // "the user changed something".
  const markDirty = useCallback((html: string) => {
    if (!enabled) return;
    pendingSaveRef.current = { value: html, sceneId };
    setSaveStatus("unsaved");
  }, [enabled, sceneId, setSaveStatus]);

  // Recover any locally stored unsaved changes once content is ready
  useEffect(() => {
    if (!enabled) return;
    const key = `${STORAGE_PREFIX}${sceneId}`;
    const stored = localStorage.getItem(key);
    if (!stored) return;
    save(stored, sceneId);
    localStorage.removeItem(key);
  }, [sceneId, enabled, save]);

  const saveNow = useCallback((currentContent: string) => {
    save(currentContent, sceneId);
  }, [save, sceneId]);

  return { saveNow, markDirty };
}
