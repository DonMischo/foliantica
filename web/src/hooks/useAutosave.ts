import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUIStore } from "@/store/ui";
import { scenesApi } from "@/lib/api";

const INTERVAL_MS = 20_000;
const STORAGE_PREFIX = "lw_pending_";

interface Options {
  sceneId: number;
  content: string;
  enabled: boolean;
}

export function useAutosave({ sceneId, content, enabled }: Options) {
  const setSaveStatus = useUIStore((s) => s.setSaveStatus);
  const qc = useQueryClient();
  const contentRef = useRef(content);
  contentRef.current = content;
  const lastSavedRef = useRef(content);
  const pendingSaveRef = useRef<{ value: string; sceneId: number } | null>(null);

  // save() takes the target sceneId explicitly so a late-firing save can never
  // write content to a scene the user has since navigated away from.
  const save = useCallback(async (value: string, forSceneId: number) => {
    if (!enabled) return;
    setSaveStatus("saving");
    try {
      await scenesApi.update(forSceneId, { content: value });
      qc.setQueryData(["scene", forSceneId], (old: any) =>
        old ? { ...old, content: value } : old
      );
      localStorage.removeItem(`${STORAGE_PREFIX}${forSceneId}`);
      lastSavedRef.current = value;
      setSaveStatus("saved");
    } catch {
      localStorage.setItem(`${STORAGE_PREFIX}${forSceneId}`, value);
      setSaveStatus("error");
    }
  }, [enabled, setSaveStatus, qc]);

  // Mark unsaved when content diverges from what was last saved
  useEffect(() => {
    if (!enabled) return;
    if (content !== lastSavedRef.current) {
      pendingSaveRef.current = { value: content, sceneId };
      setSaveStatus("unsaved");
    }
  }, [content, enabled, sceneId, setSaveStatus]);

  // Flush pending edit on navigation away or unmount — never silently drop keystrokes
  useEffect(() => {
    return () => {
      const pending = pendingSaveRef.current;
      if (pending) {
        pendingSaveRef.current = null;
        void save(pending.value, pending.sceneId);
      }
    };
  }, [sceneId, save]);

  // 20-second interval save
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      const pending = pendingSaveRef.current;
      if (pending) {
        pendingSaveRef.current = null;
        void save(pending.value, pending.sceneId);
      }
    }, INTERVAL_MS);
    return () => clearInterval(interval);
  }, [save, enabled, sceneId]);

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

  // Recover any locally stored unsaved changes on mount
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

  const saveNow = useCallback(() => save(contentRef.current, sceneId), [save, sceneId]);
  return { saveNow };
}
