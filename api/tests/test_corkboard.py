"""Tests for corkboard persistence: prefs, card colors, scene connections, global order."""


def _make_scene(client, chapter_id: int, title: str, order_index: int) -> dict:
    r = client.post("/api/scenes", json={
        "title": title, "content": f"<p>{title}</p>",
        "chapter_id": chapter_id, "order_index": order_index,
    })
    assert r.status_code == 201
    return r.json()


class TestCorkboardPrefs:
    def test_prefs_default_empty(self, client, project):
        r = client.get(f"/api/projects/{project['id']}/corkboard")
        assert r.status_code == 200
        assert r.json()["prefs"] == {}

    def test_prefs_roundtrip(self, client, project):
        prefs = {"layout": "circle", "compact": True, "col_colors": {"__main__": "#ff0000"}}
        r = client.patch(f"/api/projects/{project['id']}/corkboard-prefs", json=prefs)
        assert r.status_code == 200
        r = client.get(f"/api/projects/{project['id']}/corkboard")
        assert r.json()["prefs"] == prefs

    def test_prefs_project_not_found(self, client):
        r = client.patch("/api/projects/9999/corkboard-prefs", json={})
        assert r.status_code == 404


class TestCardColor:
    def test_card_color_persists_and_clears(self, client, project, scene):
        client.patch(f"/api/scenes/{scene['id']}", json={"card_color": "#aabbcc"})
        board = client.get(f"/api/projects/{project['id']}/corkboard").json()
        assert board["scenes"][0]["card_color"] == "#aabbcc"

        # explicit null clears
        client.patch(f"/api/scenes/{scene['id']}", json={"card_color": None})
        board = client.get(f"/api/projects/{project['id']}/corkboard").json()
        assert board["scenes"][0]["card_color"] is None


class TestSceneConnections:
    def test_create_and_list_connection(self, client, project, chapter):
        s1 = _make_scene(client, chapter["id"], "S1", 0)
        s2 = _make_scene(client, chapter["id"], "S2", 1)
        r = client.post(f"/api/projects/{project['id']}/connections", json={
            "source_scene_id": s1["id"], "target_scene_id": s2["id"],
            "connection_type": "foreshadowing",
        })
        assert r.status_code == 201
        conn = r.json()
        assert conn["connection_type"] == "foreshadowing"

        board = client.get(f"/api/projects/{project['id']}/corkboard").json()
        assert len(board["connections"]) == 1
        assert board["connections"][0]["source_scene_id"] == s1["id"]

    def test_duplicate_connection_returns_existing(self, client, project, chapter):
        s1 = _make_scene(client, chapter["id"], "S1", 0)
        s2 = _make_scene(client, chapter["id"], "S2", 1)
        payload = {"source_scene_id": s1["id"], "target_scene_id": s2["id"],
                   "connection_type": "flashback"}
        first = client.post(f"/api/projects/{project['id']}/connections", json=payload).json()
        second = client.post(f"/api/projects/{project['id']}/connections", json=payload).json()
        assert first["id"] == second["id"]

    def test_self_connection_rejected(self, client, project, scene):
        r = client.post(f"/api/projects/{project['id']}/connections", json={
            "source_scene_id": scene["id"], "target_scene_id": scene["id"],
        })
        assert r.status_code == 400

    def test_cross_project_scene_rejected(self, client, project, chapter):
        s1 = _make_scene(client, chapter["id"], "S1", 0)
        # scene in a different project
        other = client.post("/api/projects", json={"title": "Other"}).json()
        act2 = client.post("/api/acts", json={"title": "A", "project_id": other["id"], "order_index": 0}).json()
        ch2 = client.post("/api/chapters", json={"title": "C", "act_id": act2["id"], "order_index": 0}).json()
        s_other = _make_scene(client, ch2["id"], "Foreign", 0)

        r = client.post(f"/api/projects/{project['id']}/connections", json={
            "source_scene_id": s1["id"], "target_scene_id": s_other["id"],
        })
        assert r.status_code == 404

    def test_delete_connection(self, client, project, chapter):
        s1 = _make_scene(client, chapter["id"], "S1", 0)
        s2 = _make_scene(client, chapter["id"], "S2", 1)
        conn = client.post(f"/api/projects/{project['id']}/connections", json={
            "source_scene_id": s1["id"], "target_scene_id": s2["id"],
        }).json()
        r = client.delete(f"/api/projects/{project['id']}/connections/{conn['id']}")
        assert r.status_code == 204
        board = client.get(f"/api/projects/{project['id']}/corkboard").json()
        assert board["connections"] == []

    def test_delete_wrong_project_404(self, client, project, chapter):
        s1 = _make_scene(client, chapter["id"], "S1", 0)
        s2 = _make_scene(client, chapter["id"], "S2", 1)
        conn = client.post(f"/api/projects/{project['id']}/connections", json={
            "source_scene_id": s1["id"], "target_scene_id": s2["id"],
        }).json()
        other = client.post("/api/projects", json={"title": "Other"}).json()
        r = client.delete(f"/api/projects/{other['id']}/connections/{conn['id']}")
        assert r.status_code == 404


class TestGlobalOrderBulk:
    def test_bulk_set_global_order(self, client, project, chapter):
        s1 = _make_scene(client, chapter["id"], "S1", 0)
        s2 = _make_scene(client, chapter["id"], "S2", 1)
        s3 = _make_scene(client, chapter["id"], "S3", 2)
        r = client.post(f"/api/projects/{project['id']}/corkboard/global-order", json={
            "items": [
                {"id": s1["id"], "global_order": 200},
                {"id": s2["id"], "global_order": 0},
                {"id": s3["id"], "global_order": 100},
            ]
        })
        assert r.status_code == 204
        board = client.get(f"/api/projects/{project['id']}/corkboard").json()
        ordered = [s["title"] for s in board["scenes"]]
        assert ordered == ["S2", "S3", "S1"]

    def test_bulk_order_ignores_foreign_scenes(self, client, project, chapter):
        s1 = _make_scene(client, chapter["id"], "S1", 0)
        other = client.post("/api/projects", json={"title": "Other"}).json()
        act2 = client.post("/api/acts", json={"title": "A", "project_id": other["id"], "order_index": 0}).json()
        ch2 = client.post("/api/chapters", json={"title": "C", "act_id": act2["id"], "order_index": 0}).json()
        s_other = _make_scene(client, ch2["id"], "Foreign", 0)
        # set initial global_order on the foreign scene
        client.get(f"/api/projects/{other['id']}/corkboard")
        before = client.get(f"/api/projects/{other['id']}/corkboard").json()["scenes"][0]["global_order"]

        r = client.post(f"/api/projects/{project['id']}/corkboard/global-order", json={
            "items": [{"id": s1["id"], "global_order": 500},
                      {"id": s_other["id"], "global_order": 999999}]
        })
        assert r.status_code == 204
        after = client.get(f"/api/projects/{other['id']}/corkboard").json()["scenes"][0]["global_order"]
        assert after == before  # foreign scene untouched
