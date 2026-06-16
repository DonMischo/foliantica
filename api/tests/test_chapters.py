"""Tests for api/routers/chapters.py — list, create, update, delete, reorder, read."""


# ── Helper ────────────────────────────────────────────────────────────────────

def _make_chapter(client, act_id, title="Chapter", order_index=0):
    r = client.post("/api/chapters", json={
        "title": title, "act_id": act_id, "order_index": order_index,
    })
    assert r.status_code == 201
    return r.json()


# ── List ──────────────────────────────────────────────────────────────────────

class TestChapterList:
    def test_empty_for_new_act(self, client, act):
        r = client.get(f"/api/acts/{act['id']}/chapters")
        assert r.status_code == 200
        assert r.json() == []

    def test_returns_created_chapters(self, client, act):
        _make_chapter(client, act["id"], "Ch One", 0)
        _make_chapter(client, act["id"], "Ch Two", 1)
        titles = [c["title"] for c in client.get(f"/api/acts/{act['id']}/chapters").json()]
        assert "Ch One" in titles
        assert "Ch Two" in titles

    def test_ordered_by_order_index(self, client, act):
        _make_chapter(client, act["id"], "Second", 1)
        _make_chapter(client, act["id"], "First", 0)
        chapters = client.get(f"/api/acts/{act['id']}/chapters").json()
        assert chapters[0]["title"] == "First"
        assert chapters[1]["title"] == "Second"

    def test_unknown_act_returns_404(self, client):
        assert client.get("/api/acts/99999/chapters").status_code == 404


# ── Create ────────────────────────────────────────────────────────────────────

class TestChapterCreate:
    def test_returns_201_with_id(self, client, act):
        r = client.post("/api/chapters", json={
            "title": "New Chapter", "act_id": act["id"], "order_index": 0,
        })
        assert r.status_code == 201
        assert r.json()["id"] > 0
        assert r.json()["title"] == "New Chapter"

    def test_unknown_act_returns_404(self, client):
        r = client.post("/api/chapters", json={"title": "X", "act_id": 99999, "order_index": 0})
        assert r.status_code == 404


# ── Update ────────────────────────────────────────────────────────────────────

class TestChapterUpdate:
    def test_update_title(self, client, chapter):
        r = client.patch(f"/api/chapters/{chapter['id']}", json={"title": "Renamed"})
        assert r.status_code == 200
        assert r.json()["title"] == "Renamed"

    def test_unknown_chapter_returns_404(self, client):
        assert client.patch("/api/chapters/99999", json={"title": "x"}).status_code == 404


# ── Delete ────────────────────────────────────────────────────────────────────

class TestChapterDelete:
    def test_delete_returns_204(self, client, chapter):
        assert client.delete(f"/api/chapters/{chapter['id']}").status_code == 204

    def test_deleted_chapter_is_gone(self, client, chapter):
        client.delete(f"/api/chapters/{chapter['id']}")
        assert client.patch(f"/api/chapters/{chapter['id']}", json={"title": "gone"}).status_code == 404

    def test_unknown_chapter_returns_404(self, client):
        assert client.delete("/api/chapters/99999").status_code == 404


# ── Reorder ───────────────────────────────────────────────────────────────────

class TestChapterReorder:
    def test_swaps_order_indices(self, client, act):
        c1 = _make_chapter(client, act["id"], "Alpha", 0)
        c2 = _make_chapter(client, act["id"], "Beta", 1)
        r = client.post("/api/chapters/reorder", json={
            "items": [
                {"id": c1["id"], "order_index": 1},
                {"id": c2["id"], "order_index": 0},
            ],
        })
        assert r.status_code == 204
        chapters = client.get(f"/api/acts/{act['id']}/chapters").json()
        assert chapters[0]["title"] == "Beta"
        assert chapters[1]["title"] == "Alpha"

    def test_unknown_ids_silently_ignored(self, client):
        r = client.post("/api/chapters/reorder", json={"items": [{"id": 99999, "order_index": 0}]})
        assert r.status_code == 204


# ── Read view ─────────────────────────────────────────────────────────────────

class TestChapterReadView:
    def test_returns_nested_structure(self, client, act, chapter, scene):
        r = client.get(f"/api/chapters/{chapter['id']}/read")
        assert r.status_code == 200
        data = r.json()
        assert data["id"] == chapter["id"]
        assert data["act_id"] == act["id"]
        assert data["act_title"] == act["title"]
        assert len(data["scenes"]) == 1
        assert data["scenes"][0]["id"] == scene["id"]

    def test_unknown_chapter_returns_404(self, client):
        assert client.get("/api/chapters/99999/read").status_code == 404

    def test_scenes_ordered_by_order_index(self, client, chapter):
        client.post("/api/scenes", json={
            "title": "Later", "content": "", "chapter_id": chapter["id"], "order_index": 1,
        })
        client.post("/api/scenes", json={
            "title": "Earlier", "content": "", "chapter_id": chapter["id"], "order_index": 0,
        })
        scenes = client.get(f"/api/chapters/{chapter['id']}/read").json()["scenes"]
        titles = [s["title"] for s in scenes]
        assert titles.index("Earlier") < titles.index("Later")
