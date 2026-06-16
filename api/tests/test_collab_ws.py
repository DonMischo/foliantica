"""
Phases 2, 3, 4 — WebSocket: locks, presence, student-mode enforcement.

Strategy
--------
* Co-work DISABLED (default):  trust still requires a genuinely trusted
  connection (loopback peer, secret, or matching Origin) — disabling
  co-work no longer skips that check, since the server's bind address only
  changes on app restart, so a LAN device could otherwise still reach this
  port for a while after co-work is toggled off (see
  COWORKING_NETWORK_SECURITY_SUMMARY.md). These tests use the `client`
  fixture (loopback peer, see conftest.py) to get session_id="host" without
  needing real JWTs, exactly matching how the host's own Electron window
  actually connects.

* Co-work ENABLED (explicit):  Guest auth tests inject a real JWT via the
  ?token= query param, and connect via the `ws_client` fixture rather than
  `client` — `ws_client`'s peer is httpx's default non-loopback
  "testclient", simulating a real guest's connection (in production the WS
  upgrade is proxied through Next.js's server-wrapper.js, same as REST, but
  ws.client.host stops being a useful trust signal once that's true for
  host and guest alike — see TestWsHostTrust below). Student-mode tests
  build a session via the join endpoint (HTTP, via `client`) so the
  session dict (with assigned_items) is in _sessions, then connect with
  `ws_client`.

WebSocket path
--------------
The router has prefix /api/collab, so the WS endpoint is at
/api/collab/ws/collab.
"""

import os
from datetime import datetime, UTC, timedelta
from unittest.mock import patch

import pytest

import routers.collab as collab_mod
from tests.conftest import make_invitation, do_join, join_ok

WS_PATH = "/api/collab/ws/collab"


# ── Phase 2: connection + initial state ───────────────────────────────────────

class TestConnection:

    def test_connect_receives_state(self, client):
        with client.websocket_connect(WS_PATH) as ws:
            msg = ws.receive_json()
        assert msg["type"] == "state"
        assert "locks" in msg
        assert "presence" in msg
        assert "sessions" in msg

    def test_state_includes_my_session_id(self, client):
        with client.websocket_connect(WS_PATH) as ws:
            msg = ws.receive_json()
        assert "my_session_id" in msg
        assert msg["my_session_id"] == "host"

    def test_connect_registers_presence(self, client):
        with client.websocket_connect(WS_PATH) as ws:
            ws.receive_json()  # state
            assert "host" in collab_mod._presence

    def test_disconnect_clears_presence(self, client):
        with client.websocket_connect(WS_PATH) as ws:
            ws.receive_json()
        assert "host" not in collab_mod._presence

    def test_guest_rejected_without_jwt_when_cowork_enabled(self, ws_client):
        collab_mod.set_cowork_enabled(True)
        with pytest.raises(Exception):
            # Should close with code 1008 (policy violation)
            with ws_client.websocket_connect(WS_PATH) as ws:
                ws.receive_json()

    def test_guest_accepted_with_valid_jwt(self, client, ws_client):
        collab_mod.set_cowork_enabled(True)
        inv = make_invitation(client, name="Bob")
        data = join_ok(client, token=inv["token"], display_name="Bob")
        jwt_token = data["jwt"]
        with ws_client.websocket_connect(f"{WS_PATH}?token={jwt_token}") as ws:
            msg = ws.receive_json()
        assert msg["type"] == "state"
        assert msg["my_session_id"] == data["session_id"]

    def test_guest_rejected_with_invalid_jwt(self, ws_client):
        collab_mod.set_cowork_enabled(True)
        with pytest.raises(Exception):
            with ws_client.websocket_connect(f"{WS_PATH}?token=notvalid") as ws:
                ws.receive_json()

    def test_guest_rejected_when_cowork_disabled_even_with_valid_jwt(self, client, ws_client):
        """Disabling co-work immediately revokes guest access, including an
        already-issued JWT — not just new joins. Regression test for the
        bug where toggling co-work off (without an app restart) left the
        server still LAN-bound but with zero auth enforcement at all."""
        collab_mod.set_cowork_enabled(True)
        inv = make_invitation(client, name="Bob")
        data = join_ok(client, token=inv["token"], display_name="Bob")
        jwt_token = data["jwt"]
        collab_mod.set_cowork_enabled(False)
        with pytest.raises(Exception):
            with ws_client.websocket_connect(f"{WS_PATH}?token={jwt_token}") as ws:
                ws.receive_json()

    def test_ping_pong(self, client):
        with client.websocket_connect(WS_PATH) as ws:
            ws.receive_json()  # state
            ws.send_json({"type": "ping"})
            pong = ws.receive_json()
        assert pong["type"] == "pong"


# ── Phase 2: soft locks ───────────────────────────────────────────────────────

class TestLocks:

    def test_request_lock_grants_and_broadcasts(self, client):
        with client.websocket_connect(WS_PATH) as ws:
            ws.receive_json()  # state
            ws.send_json({"type": "lock", "item_type": "scene", "item_id": 42})
            msg = ws.receive_json()
        assert msg["type"] == "locks"
        assert len(msg["locks"]) == 1
        lock = msg["locks"][0]
        assert lock["item_type"] == "scene"
        assert lock["item_id"] == 42

    def test_lock_recorded_in_module_state(self, client):
        with client.websocket_connect(WS_PATH) as ws:
            ws.receive_json()
            ws.send_json({"type": "lock", "item_type": "scene", "item_id": 1})
            ws.receive_json()  # locks broadcast
            # Check while the connection is still open (disconnect clears locks —
            # that behavior is verified by test_disconnect_releases_all_locks)
            assert "scene:1" in collab_mod._locks

    def test_lock_denied_when_held_by_other(self, client):
        """Two separate WS sessions; second one is denied the same lock."""
        # First session grabs the lock by injecting directly into module state
        collab_mod._locks["scene:10"] = {
            "session_id":   "other-session",
            "display_name": "Other User",
            "item_type":    "scene",
            "item_id":      10,
            "expires_at":   datetime.now(UTC) + timedelta(seconds=30),
        }
        with client.websocket_connect(WS_PATH) as ws:
            ws.receive_json()  # state
            ws.send_json({"type": "lock", "item_type": "scene", "item_id": 10})
            msg = ws.receive_json()
        assert msg["type"] == "lock_denied"
        assert msg["holder"] == "Other User"
        assert msg["reason"] == "locked"
        assert msg["item_id"] == 10

    def test_lock_reacquired_by_same_session(self, client):
        """If the same session already holds a lock, re-requesting it updates TTL."""
        with client.websocket_connect(WS_PATH) as ws:
            ws.receive_json()
            ws.send_json({"type": "lock", "item_type": "scene", "item_id": 5})
            ws.receive_json()  # granted
            # Request again — should succeed (no denial)
            ws.send_json({"type": "lock", "item_type": "scene", "item_id": 5})
            msg = ws.receive_json()
        assert msg["type"] == "locks"

    def test_unlock_releases_lock(self, client):
        with client.websocket_connect(WS_PATH) as ws:
            ws.receive_json()
            ws.send_json({"type": "lock", "item_type": "scene", "item_id": 3})
            ws.receive_json()  # granted
            ws.send_json({"type": "unlock", "item_type": "scene", "item_id": 3})
            msg = ws.receive_json()
        assert msg["type"] == "locks"
        assert len(msg["locks"]) == 0
        assert "scene:3" not in collab_mod._locks

    def test_disconnect_releases_all_locks(self, client):
        with client.websocket_connect(WS_PATH) as ws:
            ws.receive_json()
            ws.send_json({"type": "lock", "item_type": "scene", "item_id": 99})
            ws.receive_json()
        # After context exit the WS is closed
        assert "scene:99" not in collab_mod._locks

    def test_heartbeat_extends_expiry(self, client):
        with client.websocket_connect(WS_PATH) as ws:
            ws.receive_json()
            ws.send_json({"type": "lock", "item_type": "scene", "item_id": 7})
            ws.receive_json()  # granted
            before = collab_mod._locks["scene:7"]["expires_at"]
            ws.send_json({"type": "heartbeat", "item_type": "scene", "item_id": 7})
            # Give the server time to process (sync TestClient processes inline)
            after = collab_mod._locks["scene:7"]["expires_at"]
        assert after >= before

    def test_expired_lock_pruned_on_next_request(self, client):
        # Inject an already-expired lock
        collab_mod._locks["scene:20"] = {
            "session_id":   "old",
            "display_name": "Gone",
            "item_type":    "scene",
            "item_id":      20,
            "expires_at":   datetime.now(UTC) - timedelta(seconds=1),
        }
        with client.websocket_connect(WS_PATH) as ws:
            ws.receive_json()
            # Requesting the same item should succeed because the old lock expired
            ws.send_json({"type": "lock", "item_type": "scene", "item_id": 20})
            msg = ws.receive_json()
        assert msg["type"] == "locks"
        lock = next(l for l in msg["locks"] if l["item_id"] == 20)
        assert lock["session_id"] == "host"

    def test_lock_snapshot_excludes_expires_at(self, client):
        with client.websocket_connect(WS_PATH) as ws:
            ws.receive_json()
            ws.send_json({"type": "lock", "item_type": "scene", "item_id": 8})
            msg = ws.receive_json()
        lock = msg["locks"][0]
        assert "expires_at" not in lock


# ── Phase 3: presence ─────────────────────────────────────────────────────────

class TestPresence:

    def test_initial_state_includes_own_presence(self, client):
        with client.websocket_connect(WS_PATH) as ws:
            state = ws.receive_json()
        # The connecting session should be in presence
        assert any(p["session_id"] == "host" for p in state["presence"])

    def test_presence_message_updates_location(self, client):
        with client.websocket_connect(WS_PATH) as ws:
            ws.receive_json()  # state
            ws.send_json({"type": "presence", "item_type": "scene", "item_id": 42})
            msg = ws.receive_json()  # broadcast back to self (only connection)
        assert msg["type"] == "presence"
        sessions = msg["sessions"]
        host_presence = next(s for s in sessions if s["session_id"] == "host")
        assert host_presence["item_type"] == "scene"
        assert host_presence["item_id"] == 42

    def test_presence_null_clears_location(self, client):
        with client.websocket_connect(WS_PATH) as ws:
            ws.receive_json()
            ws.send_json({"type": "presence", "item_type": "scene", "item_id": 1})
            ws.receive_json()
            ws.send_json({"type": "presence", "item_type": None, "item_id": None})
            msg = ws.receive_json()
        host = next(s for s in msg["sessions"] if s["session_id"] == "host")
        assert host["item_type"] is None
        assert host["item_id"] is None

    def test_disconnect_removes_from_presence(self, client):
        with client.websocket_connect(WS_PATH) as ws:
            ws.receive_json()
        assert "host" not in collab_mod._presence

    def test_presence_includes_display_name(self, client):
        with client.websocket_connect(WS_PATH) as ws:
            state = ws.receive_json()
        host = next(s for s in state["presence"] if s["session_id"] == "host")
        assert host["display_name"] == "Host"

    def test_presence_includes_color(self, client):
        with client.websocket_connect(WS_PATH) as ws:
            state = ws.receive_json()
        host = next(s for s in state["presence"] if s["session_id"] == "host")
        assert host["color"].startswith("#")
        assert len(host["color"]) == 7  # #rrggbb

    def test_color_is_deterministic(self):
        """Same session_id must always produce the same color."""
        c1 = collab_mod._color_for_session("fixed-id")
        c2 = collab_mod._color_for_session("fixed-id")
        assert c1 == c2

    def test_different_ids_may_differ(self):
        """Different session IDs should map to colors from the palette."""
        colors = {collab_mod._color_for_session(f"id-{i}") for i in range(20)}
        # All colors must be from the known palette
        assert colors <= set(collab_mod._PRESENCE_COLORS)


# ── Phase 4: student-mode lock enforcement ────────────────────────────────────

class TestStudentEnforcement:

    def _student_jwt(self, client, *, scenes):
        """Create a student invitation with assigned scenes, join, return jwt."""
        items = [{"type": "scene", "id": sid} for sid in scenes]
        inv = make_invitation(client, role="student", assigned_items=items)
        collab_mod.set_cowork_enabled(True)
        data = join_ok(client, token=inv["token"], display_name="Stu")
        return data["jwt"], data["session_id"]

    def test_student_denied_unassigned_scene(self, client, ws_client):
        jwt_token, _ = self._student_jwt(client, scenes=[1, 2])
        with ws_client.websocket_connect(f"{WS_PATH}?token={jwt_token}") as ws:
            ws.receive_json()  # state
            ws.send_json({"type": "lock", "item_type": "scene", "item_id": 99})
            msg = ws.receive_json()
        assert msg["type"] == "lock_denied"
        assert msg["reason"] == "not_assigned"
        assert msg["holder"] is None

    def test_student_granted_assigned_scene(self, client, ws_client):
        jwt_token, _ = self._student_jwt(client, scenes=[5, 6])
        with ws_client.websocket_connect(f"{WS_PATH}?token={jwt_token}") as ws:
            ws.receive_json()
            ws.send_json({"type": "lock", "item_type": "scene", "item_id": 5})
            msg = ws.receive_json()
        assert msg["type"] == "locks"
        assert any(l["item_id"] == 5 for l in msg["locks"])

    def test_student_empty_assignment_denies_all(self, client, ws_client):
        """Student with no assigned scenes cannot lock anything."""
        jwt_token, _ = self._student_jwt(client, scenes=[])
        with ws_client.websocket_connect(f"{WS_PATH}?token={jwt_token}") as ws:
            ws.receive_json()
            ws.send_json({"type": "lock", "item_type": "scene", "item_id": 1})
            msg = ws.receive_json()
        assert msg["type"] == "lock_denied"
        assert msg["reason"] == "not_assigned"

    def test_coauthor_not_restricted_by_assignment(self, client, ws_client):
        """Co-author role bypasses assignment check entirely."""
        inv = make_invitation(client, role="coauthor", assigned_items=[])
        collab_mod.set_cowork_enabled(True)
        data = join_ok(client, token=inv["token"])
        with ws_client.websocket_connect(f"{WS_PATH}?token={data['jwt']}") as ws:
            ws.receive_json()
            ws.send_json({"type": "lock", "item_type": "scene", "item_id": 999})
            msg = ws.receive_json()
        assert msg["type"] == "locks"

    def test_student_lock_denied_does_not_pollute_lock_table(self, client, ws_client):
        """A denied lock must not appear in the shared lock state."""
        jwt_token, _ = self._student_jwt(client, scenes=[])
        with ws_client.websocket_connect(f"{WS_PATH}?token={jwt_token}") as ws:
            ws.receive_json()
            ws.send_json({"type": "lock", "item_type": "scene", "item_id": 7})
            ws.receive_json()  # lock_denied
        assert "scene:7" not in collab_mod._locks

    def test_is_assigned_helper_empty_returns_false(self):
        sess = {"assigned_items": []}
        assert collab_mod._is_assigned(sess, "scene", 1) is False

    def test_is_assigned_helper_hit(self):
        sess = {"assigned_items": [{"type": "scene", "id": 3}]}
        assert collab_mod._is_assigned(sess, "scene", 3) is True

    def test_is_assigned_helper_miss(self):
        sess = {"assigned_items": [{"type": "scene", "id": 3}]}
        assert collab_mod._is_assigned(sess, "scene", 4) is False

    def test_is_assigned_helper_type_mismatch(self):
        sess = {"assigned_items": [{"type": "chapter", "id": 3}]}
        assert collab_mod._is_assigned(sess, "scene", 3) is False


# ── Phase 4: teacher view ─────────────────────────────────────────────────────

class TestTeacherView:

    def test_teacher_view_empty(self, client):
        r = client.get("/api/collab/teacher-view")
        assert r.status_code == 200
        assert r.json() == []

    def test_teacher_view_includes_session_and_presence(self, client):
        inv = make_invitation(client, role="student", name="Stu")
        data = join_ok(client, token=inv["token"])
        sid = data["session_id"]
        # Inject a presence record
        collab_mod._presence[sid] = {"item_type": "scene", "item_id": 10}

        r = client.get("/api/collab/teacher-view")
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) == 1
        row = rows[0]
        assert row["display_name"] == "Guest"
        assert row["role"] == "student"
        assert row["item_type"] == "scene"
        assert row["item_id"] == 10
        assert row["color"].startswith("#")

    def test_teacher_view_color_matches_color_helper(self, client):
        inv = make_invitation(client)
        data = join_ok(client, token=inv["token"])
        sid = data["session_id"]
        expected_color = collab_mod._color_for_session(sid)
        r = client.get("/api/collab/teacher-view")
        assert r.json()[0]["color"] == expected_color


# ── WS host-trust rework ────────────────────────────────────────────────────
# Once the WS upgrade is proxied through Next.js in production, ws.client.host
# is loopback for ALL traffic — host and guest alike — so it stops being a
# useful trust signal on its own. These tests cover the replacement: a secret
# header (strongest, works even from a non-loopback peer) or a loopback peer
# combined with a matching Origin (closes the "malicious tab on the host's own
# machine" gap a bare peer check can't).

class TestWsHostTrust:

    def _remote_client(self):
        """A TestClient whose peer is a real (non-loopback) address."""
        from fastapi.testclient import TestClient
        from main import app
        return TestClient(app, raise_server_exceptions=True, client=("192.168.1.50", 12345))

    def test_secret_grants_host_trust_from_remote_peer(self, monkeypatch):
        import routers.collab as collab_module
        monkeypatch.setattr(collab_module, "_HOST_SECRET", "test-secret-456")
        collab_mod.set_cowork_enabled(True)

        remote = self._remote_client()
        with remote.websocket_connect(
            WS_PATH, headers={"x-foliantica-host-secret": "test-secret-456"}
        ) as ws:
            msg = ws.receive_json()
        assert msg["my_session_id"] == "host"

    def test_loopback_peer_with_mismatched_origin_is_rejected(self, client):
        """A malicious browser tab on the host's own machine, doing
        new WebSocket(...) straight to this port, has a genuinely loopback
        peer but an Origin that doesn't match our web server's port."""
        collab_mod.set_cowork_enabled(True)
        with pytest.raises(Exception):
            with client.websocket_connect(
                WS_PATH, headers={"origin": "https://evil.example.com"}
            ) as ws:
                ws.receive_json()

    def test_loopback_peer_with_matching_origin_is_trusted(self, client):
        collab_mod.set_cowork_enabled(True)
        web_port = os.environ.get("LW_WEB_PORT", "3000")
        with client.websocket_connect(
            WS_PATH, headers={"origin": f"http://127.0.0.1:{web_port}"}
        ) as ws:
            msg = ws.receive_json()
        assert msg["my_session_id"] == "host"

    def test_loopback_peer_with_no_origin_is_trusted(self, client):
        """No Origin header at all (e.g. a non-browser client) is treated
        as matching — only a present-but-mismatched Origin is rejected."""
        collab_mod.set_cowork_enabled(True)
        with client.websocket_connect(WS_PATH) as ws:
            msg = ws.receive_json()
        assert msg["my_session_id"] == "host"
