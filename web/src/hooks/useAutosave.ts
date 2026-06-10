import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUIStore } from "@/store/ui";
import { scenesApi } from "@/lib/api";

const DEBOUNCE_MS = 1000;
const INTERVAL_MS = 60_000;
const STORAGE_PREFIX = "lw_pending_";

interface Options {
  sceneId: number;
  content: string;
  enabled: boolean;
}

export function useAutosave({ sceneId, content, enabled }: Options) {
  const setSaveStatus = useUIStore((s) => s.setSaveStatus);
  const qc = useQueryClient();
  const pendingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;
  // The scheduled-but-not-yet-fired save, tagged with the scene it belongs to.
  const pendingSaveRef = useRef<{ value: string; sceneId: number } | null>(null);

  // save() takes the target sceneId explicitly so a late-firing save can never
  // write content to a scene the user has since navigated away from.
  const save = useCallback(async (value: string, forSceneId: number) => {
    if (!enabled) return;
    setSaveStatus("saving");
    pendingRef.current = true;
    try {
      await scenesApi.update(forSceneId, { content: value });
      // Keep React Query cache in sync so remounts read fresh content
      qc.setQueryData(["scene", forSceneId], (old: any) =>
        old ? { ...old, content: value } : old
      );
      localStorage.removeItem(`${STORAGE_PREFIX}${forSceneId}`);
      setSaveStatus("saved");
    } catch {
      localStorage.setItem(`${STORAGE_PREFIX}${forSceneId}`, value);
      setSaveStatus("error");
    } finally {
      pendingRef.current = false;
    }
  }, [enabled, setSaveStatus, qc]);

  // Debounced save on content change
  useEffect(() => {
    if (!enabled) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveStatus("saving");
    const payload = { value: contentRef.current, sceneId };
    pendingSaveRef.current = payload;
    debounceRef.current = setTimeout(() => {
      pendingSaveRef.current = null;
      save(payload.value, payload.sceneId);
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [content, save, enabled, setSaveStatus, sceneId]);

  // Flush a pending edit when leaving the scene (navigation) or unmounting, so
  // the last keystrokes before the debounce fires are never silently dropped.
  // Keyed on sceneId: the cleanup runs with the *leaving* scene's pending save.
  useEffect(() => {
    return () => {
      const pending = pendingSaveRef.current;
      if (pending) {
        pendingSaveRef.current = null;
        void save(pending.value, pending.sceneId);
      }
    };
  }, [sceneId, save]);

  // Interval save
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => save(contentRef.current, sceneId), INTERVAL_MS);
    return () => clearInterval(interval);
  }, [save, enabled, sceneId]);

  // Warn on unload
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pendingRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Recover any locally stored unsaved changes on mount. Only replay if the
  // stored copy actually differs from the loaded scene content — if they match,
  // there is nothing to recover, so just clear the stale pending key instead of
  // issuing a redundant (and potentially clobbering) write.
  useEffect(() => {
    const key = `${STORAGE_PREFIX}${sceneId}`;
    const stored = localStorage.getItem(key);
    if (!stored) return;
    if (stored === contentRef.current) {
      localStorage.removeItem(key);
    } else {
      save(stored, sceneId);
    }
  }, [sceneId, save]);
}
