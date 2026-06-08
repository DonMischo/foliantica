"""
Shared fixtures and helpers for the co-work test suite.

Isolation guarantees
--------------------
* Every test gets a fresh, empty in-memory state (sessions, bans, locks,
  presence, WebSocket connections, UPnP vars).
* _CONFIG_PATH is redirected to a per-test temp file so ~/.foliantica/config.json
  is NEVER read or written by any test.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.collab as collab_mod
from routers.collab import router as collab_router


# ── State isolation fixture ───────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def isolated_state(tmp_path, monkeypatch):
    """Reset all module-level state and redirect config before every test."""
    # Mutable containers — clear in-place so existing object references work
    collab_mod._sessions.clear()
    collab_mod._bans.clear()
    collab_mod._locks.clear()
    collab_mod._presence.clear()
    collab_mod.manager._connections.clear()
    collab_mod._upnp_mapped_ports.clear()

    # Scalar state — set directly (monkeypatch not needed; teardown resets them)
    collab_mod._upnp_active = False
    collab_mod._upnp_external_ip = None
    collab_mod._cf_active = False
    collab_mod._cf_url = None
    collab_mod._cf_process = None

    # Redirect config so production ~/.foliantica/config.json is never touched
    monkeypatch.setattr(collab_mod, "_CONFIG_PATH", tmp_path / "config.json")

    yield

    # Symmetric teardown — keeps state clean even if a test raises mid-way
    collab_mod._sessions.clear()
    collab_mod._bans.clear()
    collab_mod._locks.clear()
    collab_mod._presence.clear()
    collab_mod.manager._connections.clear()
    collab_mod._upnp_mapped_ports.clear()
    collab_mod._upnp_active = False
    collab_mod._upnp_external_ip = None
    collab_mod._cf_active = False
    collab_mod._cf_url = None
    collab_mod._cf_process = None


# ── App / client fixtures ─────────────────────────────────────────────────────

@pytest.fixture
def app() -> FastAPI:
    a = FastAPI()
    a.include_router(collab_router)
    return a


@pytest.fixture
def client(app) -> TestClient:
    return TestClient(app, raise_server_exceptions=True)


# ── Reusable API helpers (imported by test modules) ───────────────────────────

def make_invitation(client, *, name="Alice", role="coauthor", pin=None,
                    max_sessions=1, assigned_items=None):
    """POST /api/collab/invitations and assert 201."""
    body: dict = {"name": name, "role": role, "max_sessions": max_sessions}
    if pin is not None:
        body["pin"] = pin
    if assigned_items is not None:
        body["assigned_items"] = assigned_items
    r = client.post("/api/collab/invitations", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def do_join(client, *, token, display_name="Guest", pin=None, client_ip=None):
    """POST /api/collab/join, return the raw Response."""
    body = {"token": token, "display_name": display_name}
    if pin is not None:
        body["pin"] = pin
    headers = {}
    if client_ip:
        headers["X-Client-IP"] = client_ip
    return client.post("/api/collab/join", json=body, headers=headers)


def join_ok(client, *, token, display_name="Guest", pin=None):
    """POST /api/collab/join and assert 200, return JSON."""
    r = do_join(client, token=token, display_name=display_name, pin=pin)
    assert r.status_code == 200, r.text
    return r.json()
