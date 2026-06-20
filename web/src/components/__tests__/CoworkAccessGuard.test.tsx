import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

let mockPathname = "/";

import { CoworkAccessGuard } from "../CoworkAccessGuard";

describe("CoworkAccessGuard", () => {
  const _store: Record<string, string> = {};

  beforeEach(() => {
    mockPathname = "/";
    Object.keys(_store).forEach(k => delete _store[k]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => _store[k] ?? null,
      setItem: (k: string, v: string) => { _store[k] = v; },
      removeItem: (k: string) => { delete _store[k]; },
      clear: () => { Object.keys(_store).forEach(k => delete _store[k]); },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the stored cowork JWT as a Bearer token when probing /api/projects", async () => {
    _store["cowork_jwt"] = "test-jwt-123";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<CoworkAccessGuard><div>content</div></CoworkAccessGuard>);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({ Authorization: "Bearer test-jwt-123" });
  });

  it("renders children once the probe succeeds with a valid JWT", async () => {
    _store["cowork_jwt"] = "test-jwt-123";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    render(<CoworkAccessGuard><div>secret content</div></CoworkAccessGuard>);

    await waitFor(() => expect(screen.getByText("secret content")).toBeInTheDocument());
  });

  it("shows the invitation-required screen when the probe returns 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    render(<CoworkAccessGuard><div>secret content</div></CoworkAccessGuard>);

    await waitFor(() => expect(screen.getByText("Invitation required")).toBeInTheDocument());
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
  });

  it("shows the invitation-required screen when the probe returns 403", async () => {
    // 403 means co-work is disabled and the caller still isn't trusted —
    // e.g. a LAN device reaching the page after the host toggled co-work
    // off (the server's bind address only changes on app restart, so the
    // LAN port can still be reachable for a while). Without this, the
    // guard would render the app shell while every real data fetch
    // underneath fails with 403, producing a blank screen instead of this
    // message.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));

    render(<CoworkAccessGuard><div>secret content</div></CoworkAccessGuard>);

    await waitFor(() => expect(screen.getByText("Invitation required")).toBeInTheDocument());
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
  });

  it("skips the probe entirely on /join", async () => {
    mockPathname = "/join";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<CoworkAccessGuard><div>join form</div></CoworkAccessGuard>);

    expect(screen.getByText("join form")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
