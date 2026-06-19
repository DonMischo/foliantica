"""
Tests for api/routers/projects.py — CRUD, shared codex, corkboard, connections.
"""
import json
import pytest


# ── CRUD ──────────────────────────────────────────────────────────────────────

class TestListProjects:
    def test_empty_list_on_fresh_db(self, client):
        r = client.get("/api/projects")
        assert r.status_code == 200
        assert r.json() == []

    def test_created_project_appears(self, client, project):
        r = client.get("/api/projects")
        assert any(p["id"] == project["id"] for p in r.json())

    def test_most_recently_updated_first(self, client):
        a = client.post("/api/projects", json={"title": "A"}).json()
        b = client.post("/api/projects", json={"title": "B"}).json()
        # Touch A so it has the newest updated_at
        client.patch(f"/api/projects/{a['id']}", json={"title": "A updated"})
        ids = [p["id"] for p in client.get("/api/projects").json()]
        assert ids.index(a["id"]) < ids.index(b["id"])


class TestCreateProject:
    def test_basic_create_returns_201(self, client):
        r = client.post("/api/projects", json={"title": "My Novel"})
        assert r.status_code == 201

    def test_title_and_description_persisted(self, client):
        r = client.post("/api/projects", json={"title": "Epic", "description": "A tale"})
        d = r.json()
        assert d["title"] == "Epic"
        assert d["description"] == "A tale"

    def test_response_has_expected_fields(self, client):
        d = client.post("/api/projects", json={"title": "T"}).json()
        for field in ("id", "title", "description", "book_meta",
                      "shared_codex_project_id", "created_at", "updated_at"):
            assert field in d, f"Missing field: {field}"

    def test_book_meta_null_by_default(self, client):
        d = client.post("/api/projects", json={"title": "T"}).json()
        assert d["book_meta"] is None


class TestGetProject:
    def test_get_existing_project(self, client, project):
        r = client.get(f"/api/projects/{project['id']}")
        assert r.status_code == 200
        assert r.json()["id"] == project["id"]

    def test_get_missing_project_returns_404(self, client):
        r = client.get("/api/projects/99999")
        assert r.status_code == 404


class TestUpdateProject:
    def test_patch_title(self, client, project):
        r = client.patch(f"/api/projects/{project['id']}", json={"title": "New Title"})
        assert r.status_code == 200
        assert r.json()["title"] == "New Title"

    def test_patch_book_meta(self, client, project):
        meta = {"series": "Wheel of Time", "series_index": "1"}
        r = client.patch(f"/api/projects/{project['id']}", json={"book_meta": meta})
        assert r.status_code == 200
        assert r.json()["book_meta"]["series"] == "Wheel of Time"

    def test_patch_missing_project_returns_404(self, client):
        r = client.patch("/api/projects/99999", json={"title": "x"})
        assert r.status_code == 404

    def test_patch_none_fields_ignored(self, client, project):
        # Only provided fields are updated; description stays None
        r = client.patch(f"/api/projects/{project['id']}", json={"title": "T2"})
        assert r.json()["description"] is None


class TestDeleteProject:
    def test_delete_returns_204(self, client, project):
        r = client.delete(f"/api/projects/{project['id']}")
        assert r.status_code == 204

    def test_deleted_project_gone(self, client, project):
        client.delete(f"/api/projects/{project['id']}")
        r = client.get(f"/api/projects/{project['id']}")
        assert r.status_code == 404

    def test_delete_missing_project_returns_404(self, client):
        r = client.delete("/api/projects/99999")
        assert r.status_code == 404

    def test_delete_blocked_when_sharers_exist(self, client, project):
        # Create a second project that shares the first project's codex
        client.post("/api/projects", json={"title": "Sharer", "share_codex_from": project["id"]})
        r = client.delete(f"/api/projects/{project['id']}")
        assert r.status_code == 409
        assert "share" in r.json()["detail"].lower()


# ── Shared codex ──────────────────────────────────────────────────────────────

class TestCreateProjectWithCopy:
    def _seed_codex_entry(self, client, project_id: int) -> dict:
        r = client.post(
            "/api/codex",
            json={"project_id": project_id, "name": "Gandalf", "entry_type": "character"},
        )
        assert r.status_code == 201
        return r.json()

    def test_copy_codex_from_creates_independent_entries(self, client, project):
        self._seed_codex_entry(client, project["id"])
        r = client.post(
            "/api/projects",
            json={"title": "Copy", "copy_codex_from": project["id"]},
        )
        assert r.status_code == 201
        copy_id = r.json()["id"]
        # Copied project must not share FK — it's independent
        assert r.json()["shared_codex_project_id"] is None
        # Entry must exist in the new project's codex
        entries = client.get(f"/api/projects/{copy_id}/codex").json()
        assert any(e["name"] == "Gandalf" for e in entries)

    def test_copy_codex_from_missing_source_returns_404(self, client):
        r = client.post("/api/projects", json={"title": "T", "copy_codex_from": 99999})
        assert r.status_code == 404


class TestCreateProjectWithShare:
    def test_share_codex_from_sets_fk(self, client, project):
        r = client.post(
            "/api/projects",
            json={"title": "Shared", "share_codex_from": project["id"]},
        )
        assert r.status_code == 201
        assert r.json()["shared_codex_project_id"] == project["id"]

    def test_share_codex_from_missing_source_returns_404(self, client):
        r = client.post("/api/projects", json={"title": "T", "share_codex_from": 99999})
        assert r.status_code == 404

    def test_shared_codex_title_appears_in_get(self, client, project):
        shared = client.post(
            "/api/projects",
            json={"title": "Child", "share_codex_from": project["id"]},
        ).json()
        r = client.get(f"/api/projects/{shared['id']}")
        assert r.json()["shared_codex_project_title"] == project["title"]


class TestDetachCodexSharing:
    def test_detach_clears_fk(self, client, project):
        child = client.post(
            "/api/projects",
            json={"title": "Child", "share_codex_from": project["id"]},
        ).json()
        r = client.post(f"/api/projects/{child['id']}/codex-sharing/detach")
        assert r.status_code == 200
        assert r.json()["shared_codex_project_id"] is None

    def test_detach_on_non_sharing_project_returns_400(self, client, project):
        r = client.post(f"/api/projects/{project['id']}/codex-sharing/detach")
        assert r.status_code == 400

    def test_detach_missing_project_returns_404(self, client):
        r = client.post("/api/projects/99999/codex-sharing/detach")
        assert r.status_code == 404


# ── Series ────────────────────────────────────────────────────────────────────

class TestSeries:
    def test_project_without_series_appears_in_unserialized(self, client, project):
        r = client.get("/api/projects/series")
        assert r.status_code == 200
        d = r.json()
        assert any(b["id"] == project["id"] for b in d["unserialized"])

    def test_project_with_series_appears_in_series(self, client, project):
        client.patch(
            f"/api/projects/{project['id']}",
            json={"book_meta": {"series": "Foundation", "series_index": "1"}},
        )
        r = client.get("/api/projects/series")
        d = r.json()
        series_names = [s["name"] for s in d["series"]]
        assert "Foundation" in series_names

    def test_empty_db_returns_empty_lists(self, client):
        r = client.get("/api/projects/series")
        d = r.json()
        assert d["series"] == []
        assert d["unserialized"] == []


# ── Corkboard ─────────────────────────────────────────────────────────────────

class TestCorkboard:
    def test_corkboard_has_expected_keys(self, client, project):
        r = client.get(f"/api/projects/{project['id']}/corkboard")
        assert r.status_code == 200
        d = r.json()
        assert "scenes" in d and "subplots" in d and "connections" in d and "prefs" in d

    def test_corkboard_includes_scene(self, client, project, scene):
        r = client.get(f"/api/projects/{project['id']}/corkboard")
        ids = [s["id"] for s in r.json()["scenes"]]
        assert scene["id"] in ids

    def test_corkboard_auto_assigns_global_order(self, client, project, scene):
        r = client.get(f"/api/projects/{project['id']}/corkboard")
        s = next(s for s in r.json()["scenes"] if s["id"] == scene["id"])
        assert s["global_order"] is not None

    def test_corkboard_missing_project_returns_404(self, client):
        r = client.get("/api/projects/99999/corkboard")
        assert r.status_code == 404


class TestCorkboardPrefs:
    def test_store_and_retrieve_prefs(self, client, project):
        prefs = {"zoom": 1.5, "layout": "grid"}
        r = client.patch(f"/api/projects/{project['id']}/corkboard-prefs", json=prefs)
        assert r.status_code == 200
        assert r.json()["zoom"] == 1.5
        # Reload and confirm persisted
        r2 = client.get(f"/api/projects/{project['id']}/corkboard")
        assert r2.json()["prefs"]["layout"] == "grid"

    def test_prefs_missing_project_returns_404(self, client):
        r = client.patch("/api/projects/99999/corkboard-prefs", json={})
        assert r.status_code == 404


# ── Scene connections ─────────────────────────────────────────────────────────

class TestSceneConnections:
    def _two_scenes(self, client, project, chapter):
        """Return two scene ids in the same chapter."""
        s1 = client.post(
            "/api/scenes",
            json={"title": "S1", "content": "<p>a</p>", "chapter_id": chapter["id"], "order_index": 10},
        ).json()["id"]
        s2 = client.post(
            "/api/scenes",
            json={"title": "S2", "content": "<p>b</p>", "chapter_id": chapter["id"], "order_index": 11},
        ).json()["id"]
        return s1, s2

    def test_create_connection_returns_201(self, client, project, chapter):
        s1, s2 = self._two_scenes(client, project, chapter)
        r = client.post(
            f"/api/projects/{project['id']}/connections",
            json={"source_scene_id": s1, "target_scene_id": s2, "connection_type": "causal"},
        )
        assert r.status_code == 201
        assert r.json()["source_scene_id"] == s1

    def test_duplicate_connection_is_idempotent(self, client, project, chapter):
        s1, s2 = self._two_scenes(client, project, chapter)
        body = {"source_scene_id": s1, "target_scene_id": s2, "connection_type": "causal"}
        r1 = client.post(f"/api/projects/{project['id']}/connections", json=body)
        r2 = client.post(f"/api/projects/{project['id']}/connections", json=body)
        assert r1.status_code == 201
        assert r2.status_code == 201
        assert r1.json()["id"] == r2.json()["id"]

    def test_self_connection_returns_400(self, client, project, scene):
        r = client.post(
            f"/api/projects/{project['id']}/connections",
            json={"source_scene_id": scene["id"], "target_scene_id": scene["id"], "connection_type": "causal"},
        )
        assert r.status_code == 400

    def test_delete_connection_returns_204(self, client, project, chapter):
        s1, s2 = self._two_scenes(client, project, chapter)
        conn = client.post(
            f"/api/projects/{project['id']}/connections",
            json={"source_scene_id": s1, "target_scene_id": s2, "connection_type": "causal"},
        ).json()
        r = client.delete(f"/api/projects/{project['id']}/connections/{conn['id']}")
        assert r.status_code == 204

    def test_delete_missing_connection_returns_404(self, client, project):
        r = client.delete(f"/api/projects/{project['id']}/connections/99999")
        assert r.status_code == 404


# ── Subplot names ─────────────────────────────────────────────────────────────

class TestSubplotNames:
    def test_persist_and_return_names(self, client, project):
        r = client.patch(
            f"/api/projects/{project['id']}/subplot-names",
            json={"names": ["Romance", "Mystery"]},
        )
        assert r.status_code == 200
        assert r.json() == ["Romance", "Mystery"]

    def test_subplot_names_appear_in_corkboard(self, client, project):
        client.patch(
            f"/api/projects/{project['id']}/subplot-names",
            json={"names": ["Arc A"]},
        )
        r = client.get(f"/api/projects/{project['id']}/corkboard")
        assert "Arc A" in r.json()["subplots"]

    def test_subplot_names_missing_project_returns_404(self, client):
        r = client.patch("/api/projects/99999/subplot-names", json={"names": []})
        assert r.status_code == 404


# ── Structure & scenes ────────────────────────────────────────────────────────

class TestStructure:
    def test_structure_returns_acts(self, client, project, act):
        r = client.get(f"/api/projects/{project['id']}/structure")
        assert r.status_code == 200
        acts = r.json()
        assert any(a["id"] == act["id"] for a in acts)

    def test_structure_nested_chapters(self, client, project, chapter):
        r = client.get(f"/api/projects/{project['id']}/structure")
        all_chapters = [ch for act in r.json() for ch in act["chapters"]]
        assert any(ch["id"] == chapter["id"] for ch in all_chapters)

    def test_structure_missing_project_returns_404(self, client):
        r = client.get("/api/projects/99999/structure")
        assert r.status_code == 404


class TestProjectScenes:
    def test_flat_scenes_list(self, client, project, scene):
        r = client.get(f"/api/projects/{project['id']}/scenes")
        assert r.status_code == 200
        ids = [s["id"] for s in r.json()]
        assert scene["id"] in ids

    def test_scene_has_chapter_and_act_title(self, client, project, scene):
        r = client.get(f"/api/projects/{project['id']}/scenes")
        s = next(s for s in r.json() if s["id"] == scene["id"])
        assert "chapter_title" in s
        assert "act_title" in s


# ── POV stats ─────────────────────────────────────────────────────────────────

class TestPovStats:
    def test_returns_stats_and_total(self, client, project, scene):
        r = client.get(f"/api/projects/{project['id']}/pov-stats")
        assert r.status_code == 200
        d = r.json()
        assert "stats" in d and "total_scenes" in d

    def test_total_matches_scene_count(self, client, project, scene):
        r = client.get(f"/api/projects/{project['id']}/pov-stats")
        assert r.json()["total_scenes"] == 1

    def test_no_pov_bucket_when_pov_unset(self, client, project, scene):
        r = client.get(f"/api/projects/{project['id']}/pov-stats")
        stats = r.json()["stats"]
        no_pov = next((s for s in stats if s["pov_character_id"] is None), None)
        assert no_pov is not None
        assert no_pov["count"] == 1

    def test_missing_project_returns_404(self, client):
        r = client.get("/api/projects/99999/pov-stats")
        assert r.status_code == 404


# ── Global order ──────────────────────────────────────────────────────────────

class TestGlobalOrder:
    def test_set_global_order_returns_204(self, client, project, scene):
        r = client.post(
            f"/api/projects/{project['id']}/corkboard/global-order",
            json={"items": [{"id": scene["id"], "global_order": 500}]},
        )
        assert r.status_code == 204

    def test_global_order_persisted(self, client, project, scene):
        client.post(
            f"/api/projects/{project['id']}/corkboard/global-order",
            json={"items": [{"id": scene["id"], "global_order": 999}]},
        )
        corkboard = client.get(f"/api/projects/{project['id']}/corkboard").json()
        s = next(s for s in corkboard["scenes"] if s["id"] == scene["id"])
        assert s["global_order"] == 999

    def test_global_order_missing_project_returns_404(self, client):
        r = client.post(
            "/api/projects/99999/corkboard/global-order",
            json={"items": []},
        )
        assert r.status_code == 404
