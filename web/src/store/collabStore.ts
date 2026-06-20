import { create } from "zustand";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LockRecord {
  session_id:   string;
  display_name: string;
  item_type:    string;
  item_id:      number;
}

export interface PresenceRecord {
  session_id:   string;
  display_name: string;
  color:        string;
  item_type:    string | null;
  item_id:      number | null;
}

interface CollabState {
  /** Whether the WebSocket is currently connected */
  connected: boolean;
  /** Locks keyed by "item_type:item_id" e.g. "scene:42" */
  locks: Record<string, LockRecord>;
  /** Active presence — one record per connected session */
  presence: PresenceRecord[];
  /** My own session_id as assigned by the server */
  mySessionId: string | null;
  /** Internal: reference to the open WebSocket (not reactive) */
  _ws: WebSocket | null;
  /** Set to true when the guest JWT was rejected — shows the expired overlay */
  sessionExpired: boolean;

  // ── Actions ────────────────────────────────────────────────────────────────
  setConnected:      (v: boolean) => void;
  setSessionExpired: (v: boolean) => void;
  setLocks:       (locks: LockRecord[]) => void;
  setPresence:    (records: PresenceRecord[]) => void;
  setMySessionId: (id: string | null) => void;
  setWs:          (ws: WebSocket | null) => void;

  /** Request a lock for item_type:item_id.  Returns immediately; server
   *  replies with either a "locks" broadcast (granted) or "lock_denied". */
  requestLock:   (item_type: string, item_id: number) => void;
  releaseLock:   (item_type: string, item_id: number) => void;
  sendHeartbeat: (item_type: string, item_id: number) => void;
  /** Broadcast current location to all connected collaborators. */
  sendPresence:  (item_type: string | null, item_id: number | null) => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useCollabStore = create<CollabState>((set, get) => ({
  connected:      false,
  locks:          {},
  presence:       [],
  mySessionId:    null,
  _ws:            null,
  sessionExpired: false,

  setConnected:      (v) => set({ connected: v }),
  setSessionExpired: (v) => set({ sessionExpired: v }),
  setPresence:    (records) => set({ presence: records }),
  setMySessionId: (id) => set({ mySessionId: id }),
  setWs:          (ws) => set({ _ws: ws }),

  setLocks: (locks) => {
    const map: Record<string, LockRecord> = {};
    for (const rec of locks) {
      map[`${rec.item_type}:${rec.item_id}`] = rec;
    }
    set({ locks: map });
  },

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

  sendPresence: (item_type, item_id) => {
    const ws = get()._ws;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "presence", item_type, item_id }));
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
