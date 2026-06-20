"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getCoworkJwt, getCoworkIdentity, clearCoworkSession } from "@/lib/api";
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
  scene_comments:  [["comments"]],
};

export function useCollabSocket() {
  const queryClient   = useQueryClient();
  const setConnected   = useCollabStore((s) => s.setConnected);
  const setLocks       = useCollabStore((s) => s.setLocks);
  const setPresence    = useCollabStore((s) => s.setPresence);
  const setMySessionId = useCollabStore((s) => s.setMySessionId);
  const setWs             = useCollabStore((s) => s.setWs);
  const setSessionExpired = useCollabStore((s) => s.setSessionExpired);

  const attempt  = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wsRef    = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      if (cancelled) return;

      // Discover whether co-work is enabled.
      // Include the guest JWT if present — the ws-url endpoint is behind the
      // auth middleware, so LAN guests (non-loopback) need the Bearer header
      // or they get 401 and the WS never connects.
      try {
        const wsJwt = getCoworkJwt();
        const res = await fetch("/api/collab/ws-url", wsJwt ? {
          headers: { Authorization: `Bearer ${wsJwt}` },
        } : undefined);
        if (!res.ok) {
          if (res.status === 401 && wsJwt) {
            window.dispatchEvent(new CustomEvent("cowork:session_expired"));
            return;
          }
          scheduleReconnect();
          return;
        }
        const data: { enabled: boolean } = await res.json();
        if (!data.enabled) return; // co-work off — don't connect
      } catch {
        scheduleReconnect();
        return;
      }

      // Same host:port as the page itself — the WS upgrade is proxied through
      // Next.js (server-wrapper.js) to FastAPI, just like every REST call.
      // This also means it works through the Cloudflare tunnel (which only
      // ever carried this one port) and respects wss:// on https:// pages
      // (a plain ws:// from an https: page is blocked as mixed content).
      const jwt    = getCoworkJwt();
      const scheme = location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl  = `${scheme}//${location.host}/api/collab/ws/collab${jwt ? `?token=${encodeURIComponent(jwt)}` : ""}`;
      const ws     = new WebSocket(wsUrl);
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
            // Dispatch a custom event so the scene page can show a banner.
            // reason: "locked" (held by another) | "not_assigned" (student restriction)
            window.dispatchEvent(new CustomEvent("cowork:lock_denied", {
              detail: {
                item_type: msg.item_type,
                item_id:   msg.item_id,
                holder:    msg.holder,
                reason:    msg.reason ?? "locked",
              },
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

    function handleSessionExpired() {
      cancelled = true;
      clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
      setWs(null);
      clearCoworkSession();
      setSessionExpired(true);
    }
    window.addEventListener("cowork:session_expired", handleSessionExpired, { once: true });

    connect();

    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
      setWs(null);
      window.removeEventListener("cowork:session_expired", handleSessionExpired);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Mounts the socket hook and renders a full-screen overlay if the guest
 *  JWT was rejected (session expired or revoked). */
export function CollabSocketProvider() {
  useCollabSocket();
  const sessionExpired = useCollabStore((s) => s.sessionExpired);
  if (!sessionExpired) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="rounded-lg border bg-card p-8 shadow-lg text-center space-y-2 max-w-sm">
        <p className="text-base font-semibold">Session expired</p>
        <p className="text-sm text-muted-foreground">
          Your co-work session has ended. Please rejoin using your original link.
        </p>
      </div>
    </div>
  );
}
