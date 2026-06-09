"""
Tests for the hierarchical content structure: projects → acts → chapters → scenes.
Covers CRUD, ordering, cascade-delete, and word-count tracking.
"""


# ── Projects ──────────────────────────────────────────────────────────────────

class TestProjects:
    def test_create_project(self, client):
        r = client.post("/api/projects", json={"title": "My Novel"})
        assert r.status_code == 201
        data = r.json()
        assert data["title"] == "My Novel"
        assert data["id"] > 0

    def test_list_projects_empty(self, client):
        r = client.get("/api/projects")
        assert r.status_code == 200
        assert r.json() == []

    def test_list_projects(self, client, project):
        r = client.get("/api/projects")
        assert r.status_code == 200
        ids = [p["id"] for p in r.json()]
        assert project["id"] in ids

    def test_list_projects_sorted_by_updated(self, client):
        r1 = client.post("/api/projects", json={"title": "First"})
        r2 = client.post("/api/projects", json={"title": "Second"})
        listing = client.get("/api/projects").json()
        # Most recently updated should come first (Second was created last)
        assert listing[0]["id"] == r2.json()["id"]
        assert listing[1]["id"] == r1.json()["id"]

    def test_get_project(self, client, project):
        r = client.get(f"/api/projects/{project['id']}")
        assert r.status_code == 200
        assert r.json()["title"] == project["title"]

    def test_get_project_not_found(self, client):
        r = client.get("/api/projects/99999")
        assert r.status_code == 404

    def test_update_project(self, client, project):
        r = client.patch(f"/api/projects/{project['id']}",
                         json={"title": "Renamed"})
        assert r.status_code == 200
        assert r.json()["title"] == "Renamed"

    def test_delete_project(self, client, project):
        r = client.delete(f"/api/projects/{project['id']}")
        assert r.status_code == 204
        assert client.get(f"/api/projects/{project['id']}").status_code == 404

    def test_delete_project_cascades_to_acts(self, client, project):
        # Create an act, delete the project, verify the act is gone via PATCH (no bare GET endpoint)
        act = client.post("/api/acts",
                          json={"title": "A", "project_id": project["id"],
                                "order_index": 0}).json()
        client.delete(f"/api/projects/{project['id']}")
        r = client.patch(f"/api/acts/{act['id']}", json={"title": "gone"})
        assert r.status_code == 404


# ── Acts ──────────────────────────────────────────────────────────────────────

class TestActs:
    def test_create_act(self, client, project):
        r = client.post("/api/acts",
                        json={"title": "Act I", "project_id": project["id"],
                              "order_index": 0})
        assert r.status_code == 201
        assert r.json()["title"] == "Act I"
        assert r.json()["project_id"] == project["id"]

    def test_list_acts(self, client, act, project):
        r = client.get(f"/api/projects/{project['id']}/acts")
        assert r.status_code == 200
        assert any(a["id"] == act["id"] for a in r.json())

    def test_update_act(self, client, act):
        r = client.patch(f"/api/acts/{act['id']}", json={"title": "Act II"})
        assert r.status_code == 200
        assert r.json()["title"] == "Act II"

    def test_delete_act_cascades_to_chapters(self, client, project):
        act = client.post("/api/acts",
                          json={"title": "A", "project_id": project["id"],
                                "order_index": 0}).json()
        chapter = client.post("/api/chapters",
                              json={"title": "C", "act_id": act["id"],
                                    "order_index": 0}).json()
        client.delete(f"/api/acts/{act['id']}")
        r = client.patch(f"/api/chapters/{chapter['id']}", json={"title": "gone"})
        assert r.status_code == 404


# ── Chapters ──────────────────────────────────────────────────────────────────

class TestChapters:
    def test_create_chapter(self, client, act):
        r = client.post("/api/chapters",
                        json={"title": "Ch 1", "act_id": act["id"],
                              "order_index": 0})
        assert r.status_code == 201
        assert r.json()["act_id"] == act["id"]

    def test_delete_chapter_cascades_to_scenes(self, client, project):
        act = client.post("/api/acts",
                          json={"title": "A", "project_id": project["id"],
                                "order_index": 0}).json()
        chapter = client.post("/api/chapters",
                              json={"title": "C", "act_id": act["id"],
                                    "order_index": 0}).json()
        scene = client.post("/api/scenes",
                            json={"title": "S", "chapter_id": chapter["id"],
                                  "order_index": 0}).json()
        client.delete(f"/api/chapters/{chapter['id']}")
        r = client.get(f"/api/scenes/{scene['id']}")
        assert r.status_code == 404


# ── Scenes ────────────────────────────────────────────────────────────────────

class TestScenes:
    def test_create_scene(self, client, chapter):
        r = client.post("/api/scenes",
                        json={"title": "Opening", "content": "<p>Once upon a time.</p>",
                              "chapter_id": chapter["id"], "order_index": 0})
        assert r.status_code == 201
        data = r.json()
        assert data["title"] == "Opening"
        assert data["chapter_id"] == chapter["id"]

    def test_get_scene(self, client, scene):
        r = client.get(f"/api/scenes/{scene['id']}")
        assert r.status_code == 200
        assert r.json()["id"] == scene["id"]

    def test_update_scene_content(self, client, scene):
        new_content = "<p>Edited content here.</p>"
        r = client.patch(f"/api/scenes/{scene['id']}",
                         json={"content": new_content})
        assert r.status_code == 200
        assert r.json()["content"] == new_content

    def test_update_scene_title(self, client, scene):
        r = client.patch(f"/api/scenes/{scene['id']}", json={"title": "New Title"})
        assert r.status_code == 200
        assert r.json()["title"] == "New Title"

    def test_delete_scene(self, client, scene):
        r = client.delete(f"/api/scenes/{scene['id']}")
        assert r.status_code == 204
        assert client.get(f"/api/scenes/{scene['id']}").status_code == 404

    def test_scene_order_index(self, client, chapter):
        s1 = client.post("/api/scenes",
                         json={"title": "A", "chapter_id": chapter["id"],
                               "order_index": 0}).json()
        s2 = client.post("/api/scenes",
                         json={"title": "B", "chapter_id": chapter["id"],
                               "order_index": 1}).json()
        assert s2["order_index"] > s1["order_index"]

    def test_word_count_stored(self, client, chapter):
        content = "<p>one two three four five</p>"
        r = client.post("/api/scenes",
                        json={"title": "WC Test", "content": content,
                              "chapter_id": chapter["id"], "order_index": 0})
        assert r.status_code == 201
        assert r.json().get("word_count", 0) == 5
