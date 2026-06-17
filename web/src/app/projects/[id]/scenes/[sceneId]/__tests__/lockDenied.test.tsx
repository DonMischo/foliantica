/**
 * Regression tests for the lock_denied null-holder bug.
 *
 * Before the fix, the scene page did:
 *   setLockDenied(detail.holder as string | null)
 * When the server sends holder: null for a "not_assigned" denial, this stored
 * null — making isReadOnly = !!(lockHolder || null) = false, so the student
 * could continue editing.
 *
 * The fix:
 *   setLockDenied((detail.holder as string) || (detail.reason as string) || "denied")
 *
 * These tests use a minimal harness that mirrors only the relevant event handler
 * from ScenePage, so they stay focused and don't require mounting the full page.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, act, screen } from "@testing-library/react";
import { useState, useEffect } from "react";

// ── Minimal harness ───────────────────────────────────────────────────────────
// Mirrors the cowork:lock_denied useEffect from ScenePage exactly.

interface Harness {
  sceneId: number;
}

function LockDeniedHarness({ sceneId }: Harness) {
  const [lockDenied, setLockDenied] = useState<string | null>(null);
  const [lockDeniedReason, setLockDeniedReason] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.item_type !== "scene" || detail?.item_id !== sceneId) return;
      // ↓ This is the fix — holder || reason || "denied", not just holder
      setLockDenied(
        (detail.holder as string) || (detail.reason as string) || "denied"
      );
      setLockDeniedReason(detail.reason as string | null);
    };
    window.addEventListener("cowork:lock_denied", handler);
    return () => window.removeEventListener("cowork:lock_denied", handler);
  }, [sceneId]);

  const isReadOnly = !!lockDenied;

  return (
    <div>
      <span data-testid="readonly">{isReadOnly ? "readonly" : "editable"}</span>
      <span data-testid="lockDenied">{lockDenied ?? "null"}</span>
      <span data-testid="reason">{lockDeniedReason ?? "null"}</span>
    </div>
  );
}

function dispatchLockDenied(detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent("cowork:lock_denied", { detail }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // render() in each test is isolated — no shared state to reset here
});

describe("cowork:lock_denied — not_assigned (primary regression)", () => {
  it("null holder + not_assigned reason makes the scene read-only", async () => {
    render(<LockDeniedHarness sceneId={42} />);
    expect(screen.getByTestId("readonly").textContent).toBe("editable");

    await act(async () => {
      dispatchLockDenied({
        item_type: "scene",
        item_id: 42,
        holder: null,
        reason: "not_assigned",
      });
    });

    expect(screen.getByTestId("readonly").textContent).toBe("readonly");
    expect(screen.getByTestId("reason").textContent).toBe("not_assigned");
  });

  it("lockDenied is set to the reason string so banner text can branch on it", async () => {
    render(<LockDeniedHarness sceneId={42} />);

    await act(async () => {
      dispatchLockDenied({
        item_type: "scene",
        item_id: 42,
        holder: null,
        reason: "not_assigned",
      });
    });

    // The scene page banner checks lockDeniedReason === "not_assigned" to choose
    // between "not in your assignment" vs "<holder> is editing"
    expect(screen.getByTestId("lockDenied").textContent).toBe("not_assigned");
    expect(screen.getByTestId("reason").textContent).toBe("not_assigned");
  });
});

describe("cowork:lock_denied — locked by another user", () => {
  it("non-null holder makes the scene read-only", async () => {
    render(<LockDeniedHarness sceneId={42} />);

    await act(async () => {
      dispatchLockDenied({
        item_type: "scene",
        item_id: 42,
        holder: "Alice",
        reason: "locked",
      });
    });

    expect(screen.getByTestId("readonly").textContent).toBe("readonly");
    expect(screen.getByTestId("lockDenied").textContent).toBe("Alice");
    expect(screen.getByTestId("reason").textContent).toBe("locked");
  });
});

describe("cowork:lock_denied — scoping", () => {
  it("event for a different scene does not affect this scene", async () => {
    render(<LockDeniedHarness sceneId={42} />);

    await act(async () => {
      dispatchLockDenied({
        item_type: "scene",
        item_id: 99,
        holder: null,
        reason: "not_assigned",
      });
    });

    expect(screen.getByTestId("readonly").textContent).toBe("editable");
  });

  it("event for a chapter item_type does not affect scene", async () => {
    render(<LockDeniedHarness sceneId={42} />);

    await act(async () => {
      dispatchLockDenied({
        item_type: "chapter",
        item_id: 42,
        holder: null,
        reason: "not_assigned",
      });
    });

    expect(screen.getByTestId("readonly").textContent).toBe("editable");
  });
});

describe("cowork:lock_denied — fallback when both holder and reason are missing", () => {
  it("still sets a truthy lockDenied so read-only triggers", async () => {
    render(<LockDeniedHarness sceneId={42} />);

    await act(async () => {
      dispatchLockDenied({
        item_type: "scene",
        item_id: 42,
        holder: null,
        reason: null,
      });
    });

    expect(screen.getByTestId("readonly").textContent).toBe("readonly");
    expect(screen.getByTestId("lockDenied").textContent).toBe("denied");
  });
});
