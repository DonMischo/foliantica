import { create } from "zustand";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LockRecord {
  session_id:   string;
  display_name: string;
  item_type:    string;
  item_id:      number;
}

interface CollabState {
  /** Whether the WebSocket is currently connected */
  connected: boolean;
  /** Locks keyed by "item_type:item_id" e.g. "scene:42" */
  locks: Record<string, LockRecord>;
  /** Internal: reference to the open WebSocket (not reactive) */
  _ws: WebSocket | null;

  // ── Actions ────────────────────────────────────────────────────────────────
  setConnected:  (v: boolean) => void;
  setLocks:      (locks: LockRecord[]) => void;
  setWs:         (ws: WebSocket | null) => void;

  /** Request a lock for item_type:item_id.  Returns immediately; server
   *  replies with either a "locks" broadcast (granted) or "lock_denied". */
  requestLock:   (item_type: string, item_id: number) => void;
  releaseLock:   (item_type: string, item_id: number) => void;
  sendHeartbeat: (item_type: string, item_id: number) => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useCollabStore = create<CollabState>((set, get) => ({
  connected: false,
  locks:     {},
  _ws:       null,

  setConnected: (v) => set({ connected: v }),

  setLocks: (locks) => {
    const map: Record<string, LockRecord> = {};
    for (const rec of locks) {
      map[`${rec.item_type}:${rec.item_id}`] = rec;
    }
    set({ locks: map });
  },

  setWs: (ws) => set({ _ws: ws }),

  requestLock: (item_type, item_id) => {
    const ws = get()._ws;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "lock", item_type, item_id }));
    }
  },

  releaseLock: (item_type, item_id) => {
    const ws = get()._ws;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "unlock", item_type, item_id }));
    }
  },

  sendHeartbeat: (item_type, item_id) => {
    const ws = get()._ws;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "heartbeat", item_type, item_id }));
    }
  },
}));

// ── Selector helpers ──────────────────────────────────────────────────────────

/** Returns the lock holder for a given item, or null if unlocked / held by self. */
export function getLockHolder(
  locks: Record<string, LockRecord>,
  item_type: string,
  item_id: number,
  mySessionId: string | null,
): LockRecord | null {
  const rec = locks[`${item_type}:${item_id}`];
  if (!rec) return null;
  if (rec.session_id === mySessionId) return null; // own lock
  return rec;
}
