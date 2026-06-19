import { describe, it, expect, vi, beforeEach } from "vitest";
import { useCollabStore, getLockHolder } from "../collabStore";

const DEFAULTS = {
  connected: false,
  locks: {},
  presence: [],
  mySessionId: null,
  _ws: null,
  sessionExpired: false,
};

beforeEach(() => useCollabStore.setState(DEFAULTS));

// ── Simple setters ────────────────────────────────────────────────────────────

describe("CollabStore — simple setters", () => {
  it("setConnected updates the connected flag", () => {
    useCollabStore.getState().setConnected(true);
    expect(useCollabStore.getState().connected).toBe(true);
    useCollabStore.getState().setConnected(false);
    expect(useCollabStore.getState().connected).toBe(false);
  });

  it("setSessionExpired updates the sessionExpired flag", () => {
    useCollabStore.getState().setSessionExpired(true);
    expect(useCollabStore.getState().sessionExpired).toBe(true);
  });

  it("setPresence replaces the presence array", () => {
    const records = [
      { session_id: "s1", display_name: "Alice", color: "#f00", item_type: "scene", item_id: 1 },
    ];
    useCollabStore.getState().setPresence(records);
    expect(useCollabStore.getState().presence).toEqual(records);
  });

  it("setPresence with empty array clears presence", () => {
    useCollabStore.getState().setPresence([]);
    expect(useCollabStore.getState().presence).toEqual([]);
  });

  it("setMySessionId stores the session id", () => {
    useCollabStore.getState().setMySessionId("abc-123");
    expect(useCollabStore.getState().mySessionId).toBe("abc-123");
  });

  it("setMySessionId with null clears the id", () => {
    useCollabStore.getState().setMySessionId("abc-123");
    useCollabStore.getState().setMySessionId(null);
    expect(useCollabStore.getState().mySessionId).toBeNull();
  });

  it("setWs stores the WebSocket reference", () => {
    const ws = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;
    useCollabStore.getState().setWs(ws);
    expect(useCollabStore.getState()._ws).toBe(ws);
  });

  it("setWs with null clears the WebSocket", () => {
    const ws = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;
    useCollabStore.getState().setWs(ws);
    useCollabStore.getState().setWs(null);
    expect(useCollabStore.getState()._ws).toBeNull();
  });
});

// ── setLocks ──────────────────────────────────────────────────────────────────

describe("CollabStore — setLocks", () => {
  it("indexes each lock by 'item_type:item_id'", () => {
    useCollabStore.getState().setLocks([
      { session_id: "s1", display_name: "Alice", item_type: "scene", item_id: 42 },
    ]);
    expect(useCollabStore.getState().locks["scene:42"]).toMatchObject({
      session_id: "s1",
      display_name: "Alice",
    });
  });

  it("stores multiple locks under independent keys", () => {
    useCollabStore.getState().setLocks([
      { session_id: "s1", display_name: "Alice", item_type: "scene",   item_id: 1 },
      { session_id: "s2", display_name: "Bob",   item_type: "chapter", item_id: 7 },
    ]);
    const { locks } = useCollabStore.getState();
    expect(Object.keys(locks)).toHaveLength(2);
    expect(locks["chapter:7"].display_name).toBe("Bob");
  });

  it("replaces the entire lock map on each call — stale locks do not linger", () => {
    useCollabStore.getState().setLocks([
      { session_id: "s1", display_name: "Alice", item_type: "scene", item_id: 1 },
    ]);
    useCollabStore.getState().setLocks([]);
    expect(useCollabStore.getState().locks).toEqual({});
  });
});

// ── getLockHolder selector ────────────────────────────────────────────────────

describe("getLockHolder selector", () => {
  const locks = {
    "scene:42": {
      session_id: "other",
      display_name: "Bob",
      item_type: "scene",
      item_id: 42,
    },
  };

  it("returns null when the item is not in the lock map", () => {
    expect(getLockHolder(locks, "scene", 99, "me")).toBeNull();
  });

  it("returns null when I am the lock holder — own locks are invisible to the UI", () => {
    expect(getLockHolder(locks, "scene", 42, "other")).toBeNull();
  });

  it("returns the holder record when someone else holds the lock", () => {
    const holder = getLockHolder(locks, "scene", 42, "me");
    expect(holder).not.toBeNull();
    expect(holder!.display_name).toBe("Bob");
    expect(holder!.session_id).toBe("other");
  });

  it("returns null for an empty lock map", () => {
    expect(getLockHolder({}, "scene", 42, "me")).toBeNull();
  });
});

// ── WebSocket message sending ─────────────────────────────────────────────────

function mockOpenWs() {
  const ws = { readyState: WebSocket.OPEN, send: vi.fn() };
  useCollabStore.setState({ _ws: ws as unknown as WebSocket });
  return ws;
}

describe("CollabStore — WebSocket messages", () => {
  it("requestLock sends {type:'lock'} with the item coordinates", () => {
    const ws = mockOpenWs();
    useCollabStore.getState().requestLock("scene", 42);
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "lock", item_type: "scene", item_id: 42 })
    );
  });

  it("releaseLock sends {type:'unlock'}", () => {
    const ws = mockOpenWs();
    useCollabStore.getState().releaseLock("chapter", 7);
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "unlock", item_type: "chapter", item_id: 7 })
    );
  });

  it("sendHeartbeat sends {type:'heartbeat'}", () => {
    const ws = mockOpenWs();
    useCollabStore.getState().sendHeartbeat("scene", 5);
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "heartbeat", item_type: "scene", item_id: 5 })
    );
  });

  it("sendPresence with null location broadcasts an idle presence", () => {
    const ws = mockOpenWs();
    useCollabStore.getState().sendPresence(null, null);
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "presence", item_type: null, item_id: null })
    );
  });

  it("does not throw when there is no WebSocket", () => {
    // _ws is null from beforeEach
    expect(() => useCollabStore.getState().requestLock("scene", 1)).not.toThrow();
    expect(() => useCollabStore.getState().releaseLock("scene", 1)).not.toThrow();
    expect(() => useCollabStore.getState().sendPresence("scene", 1)).not.toThrow();
  });

  it("does not send when the WebSocket is still connecting", () => {
    const ws = { readyState: WebSocket.CONNECTING, send: vi.fn() } as unknown as WebSocket;
    useCollabStore.setState({ _ws: ws });
    useCollabStore.getState().requestLock("scene", 1);
    expect((ws as any).send).not.toHaveBeenCalled();
  });
});
