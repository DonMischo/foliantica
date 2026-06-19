"""
Tests for api/routers/comments.py — CRUD and role-based authorization.

Role model recap:
  - Host      : no Authorization header (collab_role=None, is_host=True)
  - Coauthor  : role="coauthor"  — can create/edit/delete OWN comments; cannot resolve
  - Editor    : role="editor"    — same as coauthor for comment edits; blocked from sync-positions
  - Student   : role="student"   — cannot create comments; cannot edit/delete others'; blocked from sync-positions
  - Guest     : role="guest"     — can edit/delete own comments; cannot resolve

The host gets is_host=True for all ownership checks regardless of
whether the comment was originally authored by a guest.
"""

from datetime import datetime, timezone, timedelta

import jwt
import pytest

import routers.collab as collab_mod


# ── JWT helpers ────────────────────────────────────────────────────────────────

def _make_jwt(role: str, display_name: str = "Alice") -> str:
    """Mint a signed session JWT with the given role, using the app's own secret."""
    payload = {
        "role":         role,
        "display_name": display_name,
        "access_mode":  "default",
        "assigned_scene_ids":         [],
        "assigned_scene_permissions": {},
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }
    return jwt.encode(payload, collab_mod._JWT_SECRET, algorithm=collab_mod._JWT_ALGORITHM)


def _auth(role: str, display_name: str = "Alice") -> dict:
    """Return Authorization header dict for a guest with the given role."""
    return {"Authorization": f"Bearer {_make_jwt(role, display_name)}"}


# ── Fixtures ──────────────────────────────────────────────────────────────────

COMMENT_BODY = {
    "from_pos": 0, "to_pos": 5,
    "anchor_text": "Hello",
    "body": "Great scene!",
    "color": "#6366f1",
    "category": "",
}


@pytest.fixture
def scene_id(scene):
    return scene["id"]


@pytest.fixture
def host_comment(client, scene_id):
    """A comment created by the host."""
    r = client.post(f"/api/scenes/{scene_id}/comments", json=COMMENT_BODY)
    assert r.status_code == 200
    return r.json()


@pytest.fixture
def alice_comment(client, scene_id):
    """A comment created by coauthor Alice."""
    r = client.post(
        f"/api/scenes/{scene_id}/comments",
        json={**COMMENT_BODY, "body": "Alice's comment"},
        headers=_auth("coauthor", "Alice"),
    )
    assert r.status_code == 200
    return r.json()


# ── List comments ─────────────────────────────────────────────────────────────

class TestListComments:
    def test_empty_list_for_new_scene(self, client, scene_id):
        r = client.get(f"/api/scenes/{scene_id}/comments")
        assert r.status_code == 200
        assert r.json() == []

    def test_created_comment_appears_in_list(self, client, scene_id, host_comment):
        r = client.get(f"/api/scenes/{scene_id}/comments")
        assert r.status_code == 200
        assert any(c["id"] == host_comment["id"] for c in r.json())

    def test_comment_has_all_expected_fields(self, client, scene_id, host_comment):
        r = client.get(f"/api/scenes/{scene_id}/comments")
        c = r.json()[0]
        for field in ("id", "scene_id", "from_pos", "to_pos", "anchor_text",
                      "body", "author_name", "author_role", "color", "category",
                      "resolved", "created_at"):
            assert field in c, f"Missing field: {field}"

    def test_comments_ordered_by_creation_time(self, client, scene_id):
        client.post(f"/api/scenes/{scene_id}/comments", json={**COMMENT_BODY, "body": "first"})
        client.post(f"/api/scenes/{scene_id}/comments", json={**COMMENT_BODY, "body": "second"})
        r = client.get(f"/api/scenes/{scene_id}/comments")
        bodies = [c["body"] for c in r.json()]
        assert bodies == ["first", "second"]


# ── Create comment ────────────────────────────────────────────────────────────

class TestCreateComment:
    def test_host_can_create(self, client, scene_id):
        r = client.post(f"/api/scenes/{scene_id}/comments", json=COMMENT_BODY)
        assert r.status_code == 200
        assert r.json()["body"] == "Great scene!"
        assert r.json()["author_role"] == "host"

    def test_coauthor_can_create(self, client, scene_id):
        r = client.post(
            f"/api/scenes/{scene_id}/comments",
            json=COMMENT_BODY,
            headers=_auth("coauthor", "Alice"),
        )
        assert r.status_code == 200
        assert r.json()["author_role"] == "coauthor"
        assert r.json()["author_name"] == "Alice"

    def test_guest_can_create(self, client, scene_id):
        r = client.post(
            f"/api/scenes/{scene_id}/comments",
            json=COMMENT_BODY,
            headers=_auth("guest", "Bob"),
        )
        assert r.status_code == 200

    def test_student_cannot_create(self, client, scene_id):
        r = client.post(
            f"/api/scenes/{scene_id}/comments",
            json=COMMENT_BODY,
            headers=_auth("student", "Eve"),
        )
        assert r.status_code == 403
        assert "student" in r.json()["detail"].lower()

    def test_create_on_missing_scene_returns_404(self, client):
        r = client.post("/api/scenes/99999/comments", json=COMMENT_BODY)
        assert r.status_code == 404

    def test_resolved_defaults_to_false(self, client, scene_id):
        r = client.post(f"/api/scenes/{scene_id}/comments", json=COMMENT_BODY)
        assert r.json()["resolved"] is False

    def test_color_and_category_persisted(self, client, scene_id):
        r = client.post(
            f"/api/scenes/{scene_id}/comments",
            json={**COMMENT_BODY, "color": "#ff0000", "category": "continuity"},
        )
        assert r.json()["color"] == "#ff0000"
        assert r.json()["category"] == "continuity"


# ── Update comment (PATCH) ────────────────────────────────────────────────────

class TestUpdateComment:
    def test_host_can_edit_own_comment(self, client, host_comment):
        r = client.patch(f"/api/comments/{host_comment['id']}", json={"body": "Updated"})
        assert r.status_code == 200
        assert r.json()["body"] == "Updated"

    def test_host_can_edit_guest_comment(self, client, alice_comment):
        r = client.patch(f"/api/comments/{alice_comment['id']}", json={"body": "Host override"})
        assert r.status_code == 200
        assert r.json()["body"] == "Host override"

    def test_coauthor_can_edit_own_comment(self, client, alice_comment):
        r = client.patch(
            f"/api/comments/{alice_comment['id']}",
            json={"body": "Alice's edit"},
            headers=_auth("coauthor", "Alice"),
        )
        assert r.status_code == 200
        assert r.json()["body"] == "Alice's edit"

    def test_coauthor_cannot_edit_other_comment(self, client, host_comment):
        # "Bob" tries to edit a comment authored by "Host"
        r = client.patch(
            f"/api/comments/{host_comment['id']}",
            json={"body": "Stolen edit"},
            headers=_auth("coauthor", "Bob"),
        )
        assert r.status_code == 403
        assert "not your comment" in r.json()["detail"].lower()

    def test_host_can_resolve_comment(self, client, host_comment):
        r = client.patch(f"/api/comments/{host_comment['id']}", json={"resolved": True})
        assert r.status_code == 200
        assert r.json()["resolved"] is True

    def test_coauthor_cannot_resolve_comment(self, client, alice_comment):
        r = client.patch(
            f"/api/comments/{alice_comment['id']}",
            json={"resolved": True},
            headers=_auth("coauthor", "Alice"),
        )
        assert r.status_code == 403
        assert "host" in r.json()["detail"].lower()

    def test_guest_cannot_resolve_own_comment(self, client, scene_id):
        # Guest creates a comment, then tries to resolve it — must be forbidden
        c = client.post(
            f"/api/scenes/{scene_id}/comments",
            json=COMMENT_BODY,
            headers=_auth("guest", "Bob"),
        ).json()
        r = client.patch(
            f"/api/comments/{c['id']}",
            json={"resolved": True},
            headers=_auth("guest", "Bob"),
        )
        assert r.status_code == 403

    def test_patch_missing_comment_returns_404(self, client):
        r = client.patch("/api/comments/99999", json={"body": "x"})
        assert r.status_code == 404

    def test_patch_position_fields(self, client, host_comment):
        r = client.patch(
            f"/api/comments/{host_comment['id']}",
            json={"from_pos": 10, "to_pos": 20},
        )
        assert r.status_code == 200
        assert r.json()["from_pos"] == 10
        assert r.json()["to_pos"] == 20

    def test_patch_category(self, client, host_comment):
        r = client.patch(f"/api/comments/{host_comment['id']}", json={"category": "plot"})
        assert r.status_code == 200
        assert r.json()["category"] == "plot"


# ── Delete comment ────────────────────────────────────────────────────────────

class TestDeleteComment:
    def test_host_can_delete_own_comment(self, client, host_comment):
        r = client.delete(f"/api/comments/{host_comment['id']}")
        assert r.status_code == 204

    def test_host_can_delete_guest_comment(self, client, alice_comment):
        r = client.delete(f"/api/comments/{alice_comment['id']}")
        assert r.status_code == 204

    def test_coauthor_can_delete_own_comment(self, client, alice_comment):
        r = client.delete(
            f"/api/comments/{alice_comment['id']}",
            headers=_auth("coauthor", "Alice"),
        )
        assert r.status_code == 204

    def test_coauthor_cannot_delete_others_comment(self, client, host_comment):
        r = client.delete(
            f"/api/comments/{host_comment['id']}",
            headers=_auth("coauthor", "Bob"),
        )
        assert r.status_code == 403

    def test_delete_missing_comment_returns_404(self, client):
        r = client.delete("/api/comments/99999")
        assert r.status_code == 404

    def test_comment_gone_after_delete(self, client, scene_id, host_comment):
        client.delete(f"/api/comments/{host_comment['id']}")
        r = client.get(f"/api/scenes/{scene_id}/comments")
        assert not any(c["id"] == host_comment["id"] for c in r.json())


# ── sync-positions ────────────────────────────────────────────────────────────

class TestSyncPositions:
    def test_host_can_sync(self, client, scene_id, host_comment):
        r = client.post(
            f"/api/scenes/{scene_id}/comments/sync-positions",
            json=[{"id": host_comment["id"], "from_pos": 5, "to_pos": 15}],
        )
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_coauthor_can_sync(self, client, scene_id, alice_comment):
        r = client.post(
            f"/api/scenes/{scene_id}/comments/sync-positions",
            json=[{"id": alice_comment["id"], "from_pos": 5, "to_pos": 15}],
            headers=_auth("coauthor", "Alice"),
        )
        assert r.status_code == 200

    def test_student_cannot_sync(self, client, scene_id):
        r = client.post(
            f"/api/scenes/{scene_id}/comments/sync-positions",
            json=[],
            headers=_auth("student", "Eve"),
        )
        assert r.status_code == 403

    def test_editor_cannot_sync(self, client, scene_id):
        r = client.post(
            f"/api/scenes/{scene_id}/comments/sync-positions",
            json=[],
            headers=_auth("editor", "Ed"),
        )
        assert r.status_code == 403

    def test_sync_updates_positions_in_db(self, client, scene_id, host_comment):
        client.post(
            f"/api/scenes/{scene_id}/comments/sync-positions",
            json=[{"id": host_comment["id"], "from_pos": 42, "to_pos": 99}],
        )
        updated = next(
            c for c in client.get(f"/api/scenes/{scene_id}/comments").json()
            if c["id"] == host_comment["id"]
        )
        assert updated["from_pos"] == 42
        assert updated["to_pos"] == 99

    def test_sync_ignores_unknown_comment_ids(self, client, scene_id):
        r = client.post(
            f"/api/scenes/{scene_id}/comments/sync-positions",
            json=[{"id": 99999, "from_pos": 0, "to_pos": 1}],
        )
        assert r.status_code == 200  # silently ignored, not an error

    def test_sync_does_not_update_comment_from_other_scene(self, client, scene_id, host_comment, chapter):
        # Create a second scene and verify cross-scene update is silently skipped
        scene2 = client.post(
            "/api/scenes",
            json={"title": "S2", "content": "<p>x</p>", "chapter_id": chapter["id"], "order_index": 1},
        ).json()
        r = client.post(
            f"/api/scenes/{scene2['id']}/comments/sync-positions",
            json=[{"id": host_comment["id"], "from_pos": 999, "to_pos": 999}],
        )
        assert r.status_code == 200
        # Original comment positions should be unchanged
        original = next(
            c for c in client.get(f"/api/scenes/{scene_id}/comments").json()
            if c["id"] == host_comment["id"]
        )
        assert original["from_pos"] == COMMENT_BODY["from_pos"]
