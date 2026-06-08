"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getCoworkJwt, getCoworkIdentity } from "@/lib/api";
import { useCollabStore, type PresenceRecord } from "@/store/collabStore";

// Exponential backoff delays (ms) for reconnection attempts
const BACKOFF = [1_000, 2_000, 5_000, 10_000, 30_000];

// Map API table names → React Query cache keys to invalidate
const TABLE_TO_QUERY_KEY: Record<string, string[][]> = {
  scenes:          [["scenes"]],
  chapters:        [["chapters"]],
  acts:            [["acts"]],
  projects:        [["projects"]],
  codex_entries:   [["codex"]],
  codex_relations: [["codex-relations"]],
  fragments:       [["fragments"]],
  timeline_events: [["timeline-events"]],
  timeline_tracks: [["timeline-tracks"]],
  research_items:  [["research"]],
  writing_log:     [["writing-log"]],
};

export function useCollabSocket() {
  const queryClient   = useQueryClient();
  const setConnected   = useCollabStore((s) => s.setConnected);
  const setLocks       = useCollabStore((s) => s.setLocks);
  const setPresence    = useCollabStore((s) => s.setPresence);
  const setMySessionId = useCollabStore((s) => s.setMySessionId);
  const setWs          = useCollabStore((s) => s.setWs);

  const attempt  = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wsRef    = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      if (cancelled) return;

      // Discover whether co-work is enabled and which port WS runs on
      let wsPort: number;
      try {
        const res = await fetch("/api/collab/ws-url");
        if (!res.ok) return; // API unavailable — stop silently
        const data: { enabled: boolean; ws_port: number | null } = await res.json();
        if (!data.enabled || !data.ws_port) return; // co-work off — don't connect
        wsPort = data.ws_port;
      } catch {
        scheduleReconnect();
        return;
      }

      const jwt     = getCoworkJwt();
      const wsUrl   = `ws://${location.hostname}:${wsPort}/ws/collab${jwt ? `?token=${encodeURIComponent(jwt)}` : ""}`;
      const ws      = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt.current = 0;
        setConnected(true);
        setWs(ws);
      };

      ws.onmessage = (evt) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(evt.data as string); } catch { return; }

        switch (msg.type) {

          case "state":
            // Initial snapshot: sync locks, presence, and learn our session id
            if (Array.isArray(msg.locks)) setLocks(msg.locks as never);
            if (typeof msg.my_session_id === "string") setMySessionId(msg.my_session_id as string);
            if (Array.isArray(msg.presence)) setPresence(msg.presence as PresenceRecord[]);
            break;

          case "change": {
            // Invalidate React Query caches for changed tables
            const tables = Array.isArray(msg.tables) ? (msg.tables as string[]) : [];
            for (const tbl of tables) {
              const keys = TABLE_TO_QUERY_KEY[tbl];
              if (keys) {
                for (const qk of keys) {
                  queryClient.invalidateQueries({ queryKey: qk });
                }
              }
            }
            break;
          }

          case "locks":
            if (Array.isArray(msg.locks)) setLocks(msg.locks as never);
            break;

          case "presence":
            if (Array.isArray(msg.sessions)) setPresence(msg.sessions as PresenceRecord[]);
            break;

          case "lock_denied":
            // The scene page listens to the store; denial is reflected there
            // by the absence of the lock for our session (store isn't updated).
            // Dispatch a custom event so the scene page can show a banner.
            window.dispatchEvent(new CustomEvent("cowork:lock_denied", {
              detail: { item_type: msg.item_type, item_id: msg.item_id, holder: msg.holder },
            }));
            break;
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        setConnected(false);
        setPresence([]);
        setMySessionId(null);
        setWs(null);
        if (!cancelled) scheduleReconnect();
      };

      ws.onerror = () => ws.close();
    }

    function scheduleReconnect() {
      const delay = BACKOFF[Math.min(attempt.current, BACKOFF.length - 1)];
      attempt.current++;
      timerRef.current = setTimeout(connect, delay);
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
      setWs(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Tiny component that mounts the hook — use inside Providers. */
export function CollabSocketProvider() {
  useCollabSocket();
  return null;
}
