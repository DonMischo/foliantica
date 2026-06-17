import { describe, it, expect, vi, beforeEach } from "vitest";
import { useCollabStore, getLockHolder } from "../collabStore";

const DEFAULTS = {
  connected: false,
  locks: {},
  presence: [],
  mySessionId: null,
  _ws: null,
};

beforeEach(() => useCollabStore.setState(DEFAULTS));

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
  const ws = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;
  useCollabStore.setState({ _ws: ws });
  return ws as { send: ReturnType<typeof vi.fn> };
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
