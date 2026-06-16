"""Tests for api/routers/acts.py — list, create, update, delete, reorder, read."""
import pytest


# ── Helper ────────────────────────────────────────────────────────────────────

def _make_act(client, project_id, title="Act", order_index=0):
    r = client.post("/api/acts", json={
        "title": title, "project_id": project_id, "order_index": order_index,
    })
    assert r.status_code == 201
    return r.json()


# ── List ──────────────────────────────────────────────────────────────────────

class TestActList:
    def test_empty_for_new_project(self, client, project):
        r = client.get(f"/api/projects/{project['id']}/acts")
        assert r.status_code == 200
        assert r.json() == []

    def test_returns_created_acts(self, client, project):
        _make_act(client, project["id"], "Act One", 0)
        _make_act(client, project["id"], "Act Two", 1)
        titles = [a["title"] for a in client.get(f"/api/projects/{project['id']}/acts").json()]
        assert "Act One" in titles
        assert "Act Two" in titles

    def test_ordered_by_order_index(self, client, project):
        _make_act(client, project["id"], "Second", 1)
        _make_act(client, project["id"], "First", 0)
        acts = client.get(f"/api/projects/{project['id']}/acts").json()
        assert acts[0]["title"] == "First"
        assert acts[1]["title"] == "Second"

    def test_unknown_project_returns_404(self, client):
        assert client.get("/api/projects/99999/acts").status_code == 404


# ── Create ────────────────────────────────────────────────────────────────────

class TestActCreate:
    def test_returns_201_with_id(self, client, project):
        r = client.post("/api/acts", json={
            "title": "New Act", "project_id": project["id"], "order_index": 0,
        })
        assert r.status_code == 201
        assert r.json()["id"] > 0
        assert r.json()["title"] == "New Act"

    def test_unknown_project_returns_404(self, client):
        r = client.post("/api/acts", json={"title": "X", "project_id": 99999, "order_index": 0})
        assert r.status_code == 404


# ── Update ────────────────────────────────────────────────────────────────────

class TestActUpdate:
    def test_update_title(self, client, act):
        r = client.patch(f"/api/acts/{act['id']}", json={"title": "Updated"})
        assert r.status_code == 200
        assert r.json()["title"] == "Updated"

    def test_unknown_act_returns_404(self, client):
        assert client.patch("/api/acts/99999", json={"title": "x"}).status_code == 404


# ── Delete ────────────────────────────────────────────────────────────────────

class TestActDelete:
    def test_delete_returns_204(self, client, act):
        assert client.delete(f"/api/acts/{act['id']}").status_code == 204

    def test_deleted_act_is_gone(self, client, act):
        client.delete(f"/api/acts/{act['id']}")
        assert client.patch(f"/api/acts/{act['id']}", json={"title": "gone"}).status_code == 404

    def test_unknown_act_returns_404(self, client):
        assert client.delete("/api/acts/99999").status_code == 404


# ── Reorder ───────────────────────────────────────────────────────────────────

class TestActReorder:
    def test_swaps_order_indices(self, client, project):
        a1 = _make_act(client, project["id"], "Alpha", 0)
        a2 = _make_act(client, project["id"], "Beta", 1)
        r = client.post("/api/acts/reorder", json={
            "items": [
                {"id": a1["id"], "order_index": 1},
                {"id": a2["id"], "order_index": 0},
            ],
        })
        assert r.status_code == 204
        acts = client.get(f"/api/projects/{project['id']}/acts").json()
        assert acts[0]["title"] == "Beta"
        assert acts[1]["title"] == "Alpha"

    def test_unknown_ids_silently_ignored(self, client):
        r = client.post("/api/acts/reorder", json={"items": [{"id": 99999, "order_index": 0}]})
        assert r.status_code == 204


# ── Read view ─────────────────────────────────────────────────────────────────

class TestActReadView:
    def test_returns_nested_structure(self, client, act, chapter, scene):
        r = client.get(f"/api/acts/{act['id']}/read")
        assert r.status_code == 200
        data = r.json()
        assert data["id"] == act["id"]
        assert len(data["chapters"]) == 1
        assert data["chapters"][0]["id"] == chapter["id"]
        assert len(data["chapters"][0]["scenes"]) == 1
        assert data["chapters"][0]["scenes"][0]["id"] == scene["id"]

    def test_unknown_act_returns_404(self, client):
        assert client.get("/api/acts/99999/read").status_code == 404

    def test_scenes_ordered_by_order_index(self, client, act, chapter):
        client.post("/api/scenes", json={
            "title": "Later", "content": "", "chapter_id": chapter["id"], "order_index": 1,
        })
        client.post("/api/scenes", json={
            "title": "Earlier", "content": "", "chapter_id": chapter["id"], "order_index": 0,
        })
        scenes = client.get(f"/api/acts/{act['id']}/read").json()["chapters"][0]["scenes"]
        titles = [s["title"] for s in scenes]
        assert titles.index("Earlier") < titles.index("Later")
