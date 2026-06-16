"""
Phase 1 — Named invitations, guest auth, rate limiter.

Tests cover:
  * Invitation CRUD (create, list, update, delete, get-token)
  * JOIN: valid token, wrong token, PIN check, max-sessions cap
  * Rate limiter: 1 failure → 300 s ban; ban expires; ban is per-IP
  * JWT payload integrity
  * Toggle on/off
  * Info endpoint
"""

import time
from datetime import datetime, UTC, timedelta
from unittest.mock import patch

import pytest

import routers.collab as collab_mod
from tests.conftest import make_invitation, do_join, join_ok


# ── Invitation CRUD ───────────────────────────────────────────────────────────

class TestInvitationCRUD:

    def test_list_empty(self, client):
        r = client.get("/api/collab/invitations")
        assert r.status_code == 200
        assert r.json() == []

    def test_create_coauthor(self, client):
        inv = make_invitation(client, name="Bob", role="coauthor")
        assert inv["name"] == "Bob"
        assert inv["role"] == "coauthor"
        assert "id" in inv
        assert "token" in inv        # token is returned so host can build join URL
        assert "pin_hash" not in inv  # raw hash is never exposed

    def test_create_student(self, client):
        inv = make_invitation(client, name="Carol", role="student")
        assert inv["role"] == "student"
        assert inv["assigned_items"] == []

    def test_create_invalid_role(self, client):
        r = client.post("/api/collab/invitations", json={"name": "X", "role": "admin"})
        assert r.status_code == 400

    def test_create_with_pin(self, client):
        inv = make_invitation(client, pin="1234")
        assert inv["has_pin"] is True
        assert "pin_hash" not in inv

    def test_create_without_pin(self, client):
        inv = make_invitation(client)
        assert inv["has_pin"] is False

    def test_list_returns_all(self, client):
        make_invitation(client, name="A")
        make_invitation(client, name="B")
        r = client.get("/api/collab/invitations")
        assert r.status_code == 200
        names = {i["name"] for i in r.json()}
        assert names == {"A", "B"}

    def test_delete(self, client):
        inv = make_invitation(client)
        r = client.delete(f"/api/collab/invitations/{inv['id']}")
        assert r.status_code == 204
        assert client.get("/api/collab/invitations").json() == []

    def test_delete_nonexistent(self, client):
        r = client.delete("/api/collab/invitations/does-not-exist")
        assert r.status_code == 404

    def test_update_name(self, client):
        inv = make_invitation(client, name="Old")
        r = client.patch(f"/api/collab/invitations/{inv['id']}",
                         json={"name": "New"})
        assert r.status_code == 200
        assert r.json()["name"] == "New"

    def test_update_pin(self, client):
        inv = make_invitation(client)
        assert inv["has_pin"] is False
        r = client.patch(f"/api/collab/invitations/{inv['id']}",
                         json={"pin": "secret"})
        assert r.status_code == 200
        assert r.json()["has_pin"] is True

    def test_clear_pin(self, client):
        inv = make_invitation(client, pin="old")
        r = client.patch(f"/api/collab/invitations/{inv['id']}",
                         json={"pin": ""})
        assert r.status_code == 200
        assert r.json()["has_pin"] is False

    def test_get_token_endpoint(self, client):
        inv = make_invitation(client, name="Dave")
        r = client.get(f"/api/collab/invitations/{inv['id']}/token")
        assert r.status_code == 200
        data = r.json()
        assert "token" in data
        assert "join_url" in data
        assert inv["token"] == data["token"]

    def test_assigned_items_persisted(self, client):
        items = [{"type": "scene", "id": 7}]
        inv = make_invitation(client, role="student", assigned_items=items)
        listed = client.get("/api/collab/invitations").json()
        assert listed[0]["assigned_items"] == items

    def test_listing_does_not_expose_token(self, client):
        make_invitation(client, name="Eve")
        listed = client.get("/api/collab/invitations").json()
        assert "token" not in listed[0]

    def test_token_encrypted_on_disk(self, client):
        import json
        from crypto import decrypt

        inv = make_invitation(client, name="Frank")
        raw_token = inv["token"]

        cfg = json.loads(collab_mod._CONFIG_PATH.read_text("utf-8"))
        stored = cfg["cowork"]["invitations"][0]["token"]

        assert stored != raw_token              # not plaintext on disk
        assert decrypt(stored) == raw_token      # but recoverable with the machine key

    def test_legacy_plaintext_token_still_joinable(self, client):
        """Invitations written before tokens were encrypted (plain hex on
        disk) must keep working — _inv_token() falls back to the raw value
        when decrypt() fails."""
        invs = [{
            "id": "legacy-1", "name": "Legacy", "token": "a" * 64,
            "role": "coauthor", "pin_hash": None, "max_sessions": 1,
            "assigned_items": [],
        }]
        collab_mod._save_invitations(invs)

        r = client.get(f"/api/collab/invitations/legacy-1/token")
        assert r.status_code == 200
        assert r.json()["token"] == "a" * 64

        data = join_ok(client, token="a" * 64, display_name="Guest")
        assert data["display_name"] == "Guest"


# ── Join / authentication ─────────────────────────────────────────────────────

class TestJoin:

    def test_join_valid_token(self, client):
        inv = make_invitation(client, name="Alice")
        data = join_ok(client, token=inv["token"], display_name="Alice")
        assert "jwt" in data
        assert data["display_name"] == "Alice"
        assert data["role"] == "coauthor"
        assert "session_id" in data
        assert data["expires_in"] > 0

    def test_join_invalid_token(self, client):
        r = do_join(client, token="notavalidtoken")
        assert r.status_code == 401

    def test_join_wrong_token_bans_ip(self, client):
        do_join(client, token="bad", client_ip="5.5.5.5")
        # Second attempt with same IP is banned
        r = do_join(client, token="bad2", client_ip="5.5.5.5")
        assert r.status_code == 429

    def test_join_ban_is_per_ip(self, client):
        """A ban on one IP must not affect a different IP."""
        do_join(client, token="bad", client_ip="1.2.3.4")
        inv = make_invitation(client)
        r = do_join(client, token=inv["token"], client_ip="9.9.9.9")
        assert r.status_code == 200

    def test_join_correct_pin(self, client):
        inv = make_invitation(client, pin="s3cr3t")
        data = join_ok(client, token=inv["token"], pin="s3cr3t")
        assert data["role"] == "coauthor"

    def test_join_wrong_pin_returns_401(self, client):
        inv = make_invitation(client, pin="right")
        r = do_join(client, token=inv["token"], pin="wrong")
        assert r.status_code == 401

    def test_join_missing_pin_returns_401(self, client):
        inv = make_invitation(client, pin="required")
        r = do_join(client, token=inv["token"])  # no pin supplied
        assert r.status_code == 401

    def test_join_session_recorded(self, client):
        inv = make_invitation(client, name="Dave")
        data = join_ok(client, token=inv["token"], display_name="Dave")
        assert data["session_id"] in collab_mod._sessions
        sess = collab_mod._sessions[data["session_id"]]
        assert sess["display_name"] == "Dave"
        assert sess["invitation_id"] == inv["id"]

    def test_max_sessions_enforced(self, client):
        inv = make_invitation(client, max_sessions=1)
        join_ok(client, token=inv["token"], display_name="First")
        r = do_join(client, token=inv["token"], display_name="Second")
        assert r.status_code == 409

    def test_max_sessions_two(self, client):
        inv = make_invitation(client, max_sessions=2)
        join_ok(client, token=inv["token"], display_name="One")
        join_ok(client, token=inv["token"], display_name="Two")
        r = do_join(client, token=inv["token"], display_name="Three")
        assert r.status_code == 409

    def test_jwt_payload_contains_role(self, client):
        inv = make_invitation(client, role="student")
        data = join_ok(client, token=inv["token"])
        payload = collab_mod.verify_session_jwt(data["jwt"])
        assert payload["role"] == "student"
        assert payload["display_name"] == "Guest"
        assert payload["session_id"] == data["session_id"]

    def test_delete_invitation_evicts_sessions(self, client):
        inv = make_invitation(client)
        data = join_ok(client, token=inv["token"])
        sid = data["session_id"]
        assert sid in collab_mod._sessions
        client.delete(f"/api/collab/invitations/{inv['id']}")
        assert sid not in collab_mod._sessions

    def test_ban_expires(self, client):
        inv = make_invitation(client)
        # Manually inject a ban that has already expired
        collab_mod._bans["5.5.5.5"] = datetime.now(UTC) - timedelta(seconds=1)
        r = do_join(client, token=inv["token"], client_ip="5.5.5.5")
        assert r.status_code == 200

    def test_ban_seconds_remaining_decreases(self, client):
        collab_mod._bans["7.7.7.7"] = datetime.now(UTC) + timedelta(seconds=200)
        remaining = collab_mod.seconds_until_unban("7.7.7.7")
        assert 195 <= remaining <= 200

    def test_seconds_until_unban_zero_when_not_banned(self, client):
        assert collab_mod.seconds_until_unban("8.8.8.8") == 0


# ── Kick session ──────────────────────────────────────────────────────────────

class TestKick:

    def test_kick_removes_session(self, client):
        inv = make_invitation(client)
        data = join_ok(client, token=inv["token"])
        sid = data["session_id"]
        r = client.post(f"/api/collab/kick/{sid}")
        assert r.status_code == 204
        assert sid not in collab_mod._sessions

    def test_kick_nonexistent(self, client):
        r = client.post("/api/collab/kick/does-not-exist")
        assert r.status_code == 404


# ── List sessions ─────────────────────────────────────────────────────────────

class TestSessions:

    def test_list_sessions_empty(self, client):
        r = client.get("/api/collab/sessions")
        assert r.status_code == 200
        assert r.json() == []

    def test_list_sessions_after_join(self, client):
        inv = make_invitation(client, name="Eve")
        join_ok(client, token=inv["token"], display_name="Eve")
        r = client.get("/api/collab/sessions")
        assert len(r.json()) == 1
        assert r.json()[0]["display_name"] == "Eve"


# ── Toggle ────────────────────────────────────────────────────────────────────

class TestToggle:

    def test_toggle_on(self, client):
        r = client.post("/api/collab/toggle", json={"enabled": True})
        assert r.status_code == 200
        assert r.json()["enabled"] is True
        assert collab_mod.is_cowork_enabled() is True

    def test_toggle_off(self, client):
        collab_mod.set_cowork_enabled(True)
        r = client.post("/api/collab/toggle", json={"enabled": False})
        assert r.status_code == 200
        assert collab_mod.is_cowork_enabled() is False

    def test_toggle_persisted_to_config(self, client):
        client.post("/api/collab/toggle", json={"enabled": True})
        # Re-reading config from disk should reflect the change
        assert collab_mod.is_cowork_enabled() is True


# ── Info endpoint ─────────────────────────────────────────────────────────────

class TestInfo:

    def test_info_basic(self, client):
        r = client.get("/api/collab/info")
        assert r.status_code == 200
        data = r.json()
        assert "lan_ip" in data
        assert "enabled" in data

    def test_info_with_valid_token(self, client):
        inv = make_invitation(client, name="Alice")
        r = client.get(f"/api/collab/info?token={inv['token']}")
        assert r.status_code == 200
        data = r.json()
        assert data["invitation"]["name"] == "Alice"

    def test_info_with_invalid_token(self, client):
        r = client.get("/api/collab/info?token=invalid")
        assert r.status_code == 200
        assert r.json()["invitation"] is None


# ── WS URL endpoint ───────────────────────────────────────────────────────────

class TestWsUrl:

    def test_ws_url_disabled(self, client):
        r = client.get("/api/collab/ws-url")
        assert r.status_code == 200
        assert r.json()["enabled"] is False

    def test_ws_url_enabled(self, client):
        collab_mod.set_cowork_enabled(True)
        r = client.get("/api/collab/ws-url")
        assert r.status_code == 200
        assert r.json()["enabled"] is True


# ── Proxy trust boundary ───────────────────────────────────────────────────────
# CoworkAuthMiddleware (main.py) must only honor X-Client-IP when the request's
# actual TCP peer is loopback — i.e. it can only have been set by the local
# Next.js proxy (route.ts always targets http://127.0.0.1:<port>). Since
# co-work mode makes FastAPI bind 0.0.0.0, any device on the LAN can otherwise
# reach the API port directly; if the header were trusted unconditionally, such
# a device could spoof "X-Client-IP: 127.0.0.1" and gain full host-level access
# with no token at all.

class TestProxyTrustBoundary:

    def _remote_client(self):
        """A TestClient whose peer is a real (non-loopback) address —
        simulating a LAN device hitting FastAPI's exposed port directly,
        bypassing the Next.js proxy entirely."""
        from fastapi.testclient import TestClient
        from main import app
        return TestClient(app, raise_server_exceptions=True, client=("192.168.1.50", 12345))

    def test_spoofed_header_from_remote_peer_is_rejected(self, client):
        collab_mod.set_cowork_enabled(True)
        remote = self._remote_client()
        remote.headers["X-Client-IP"] = "127.0.0.1"  # spoofed — peer is NOT loopback
        r = remote.get("/api/collab/invitations")
        assert r.status_code == 401

    def test_remote_peer_without_header_is_also_rejected(self, client):
        collab_mod.set_cowork_enabled(True)
        remote = self._remote_client()
        r = remote.get("/api/collab/invitations")
        assert r.status_code == 401

    def test_remote_peer_with_valid_jwt_still_works(self, client):
        """The fix must not break legitimate non-proxied access — a real
        guest with a valid session JWT is unaffected by the trust check."""
        collab_mod.set_cowork_enabled(True)
        inv = make_invitation(client, name="Remote Guest")
        data = join_ok(client, token=inv["token"])

        remote = self._remote_client()
        remote.headers["Authorization"] = f"Bearer {data['jwt']}"
        r = remote.get("/api/collab/invitations")
        assert r.status_code == 200

    def test_remote_peer_rejected_when_cowork_disabled_even_with_valid_jwt(self, client):
        """Disabling co-work must immediately revoke ALL non-trusted access,
        including an already-issued JWT — not just block new joins. The
        server's bind address only changes on app restart, so a LAN device
        can still reach this port for a while after co-work is toggled off;
        this is what actually closes that window. Regression test for a
        bug where the middleware's old early bypass ("if not
        is_cowork_enabled(): allow everyone unconditionally") left the app
        fully open to the LAN, with zero auth, the moment co-work was
        switched off while still bound 0.0.0.0 from before."""
        collab_mod.set_cowork_enabled(True)
        inv = make_invitation(client, name="Remote Guest")
        data = join_ok(client, token=inv["token"])
        collab_mod.set_cowork_enabled(False)

        remote = self._remote_client()
        remote.headers["Authorization"] = f"Bearer {data['jwt']}"
        r = remote.get("/api/collab/invitations")
        assert r.status_code == 403

    def test_remote_peer_rejected_when_cowork_disabled_with_no_credentials(self, client):
        collab_mod.set_cowork_enabled(False)
        remote = self._remote_client()
        r = remote.get("/api/collab/invitations")
        assert r.status_code == 403


# ── Electron host-secret trust ─────────────────────────────────────────────────
# The secret is the strongest of the three trust signals — it's checked
# before the peer/X-Client-IP logic and grants trust outright, since only
# Electron's own window (via webRequest, invisible to page JS or any other
# local process) can ever attach it. It must work even from a non-loopback
# peer (the secret alone is sufficient) and a wrong/absent secret must never
# grant trust by itself.

class TestHostSecret:

    def _remote_client(self):
        from fastapi.testclient import TestClient
        from main import app
        return TestClient(app, raise_server_exceptions=True, client=("192.168.1.50", 12345))

    def test_correct_secret_trusted_even_from_remote_peer(self, client, monkeypatch):
        import main as main_mod
        monkeypatch.setattr(main_mod, "_HOST_SECRET", "test-secret-123")
        collab_mod.set_cowork_enabled(True)

        remote = self._remote_client()
        remote.headers["X-Foliantica-Host-Secret"] = "test-secret-123"
        r = remote.get("/api/collab/invitations")
        assert r.status_code == 200

    def test_wrong_secret_from_remote_peer_is_rejected(self, client, monkeypatch):
        import main as main_mod
        monkeypatch.setattr(main_mod, "_HOST_SECRET", "test-secret-123")
        collab_mod.set_cowork_enabled(True)

        remote = self._remote_client()
        remote.headers["X-Foliantica-Host-Secret"] = "wrong-guess"
        r = remote.get("/api/collab/invitations")
        assert r.status_code == 401

    def test_unset_secret_never_grants_trust(self, client, monkeypatch):
        """If FOLIANTICA_HOST_SECRET was never configured (e.g. the
        non-Electron launch path), an empty server-side secret must not
        match an empty/absent client-supplied header."""
        import main as main_mod
        monkeypatch.setattr(main_mod, "_HOST_SECRET", "")
        collab_mod.set_cowork_enabled(True)

        remote = self._remote_client()
        r = remote.get("/api/collab/invitations")
        assert r.status_code == 401
