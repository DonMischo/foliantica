"""
Tests for the research/clipping system and the scene-link feature.

Covers:
  - CRUD: create, list, update, delete
  - model_fields_set fix: PATCH with linked_scene_id=null actually unlinks
  - Omitting linked_scene_id from a PATCH body leaves the existing value unchanged
  - Linking and unlinking to a codex entry (same model_fields_set path)
  - Tag persistence
  - 404 on unknown item
"""
import pytest


# ── Helpers ───────────────────────────────────────────────────────────────────

def _create_item(client, project_id: int, **kwargs) -> dict:
    defaults = {"title": "Test clipping", "text_content": "Some research text."}
    defaults.update(kwargs)
    r = client.post(f"/api/projects/{project_id}/research", json=defaults)
    assert r.status_code == 201, r.text
    return r.json()


def _create_codex(client, project_id: int) -> dict:
    r = client.post("/api/codex", json={"name": "Aragorn", "project_id": project_id})
    assert r.status_code == 201, r.text
    return r.json()


# ── CRUD ──────────────────────────────────────────────────────────────────────

class TestResearchCRUD:
    def test_create_text_clipping(self, client, project):
        item = _create_item(client, project["id"], title="My Note",
                            text_content="Some idea here.")
        assert item["title"] == "My Note"
        assert item["text_content"] == "Some idea here."
        assert item["linked_scene_id"] is None
        assert item["linked_codex_id"] is None
        assert item["tags"] == []

    def test_create_url_clipping(self, client, project):
        # URL metadata fetch will fail silently in tests — that's fine.
        item = _create_item(client, project["id"], title="Article",
                            url="https://example.com")
        assert item["url"] == "https://example.com"

    def test_create_with_tags(self, client, project):
        item = _create_item(client, project["id"], tags=["history", "magic"])
        assert set(item["tags"]) == {"history", "magic"}

    def test_list_returns_created_items(self, client, project):
        _create_item(client, project["id"], title="Alpha")
        _create_item(client, project["id"], title="Beta")
        items = client.get(f"/api/projects/{project['id']}/research").json()
        titles = [i["title"] for i in items]
        assert "Alpha" in titles
        assert "Beta" in titles

    def test_list_empty_for_new_project(self, client, project):
        items = client.get(f"/api/projects/{project['id']}/research").json()
        assert items == []

    def test_update_title(self, client, project):
        item = _create_item(client, project["id"])
        r = client.patch(f"/api/research/{item['id']}", json={"title": "Updated"})
        assert r.status_code == 200
        assert r.json()["title"] == "Updated"

    def test_update_text_content(self, client, project):
        item = _create_item(client, project["id"])
        r = client.patch(f"/api/research/{item['id']}",
                         json={"text_content": "Revised text."})
        assert r.status_code == 200
        assert r.json()["text_content"] == "Revised text."

    def test_update_tags(self, client, project):
        item = _create_item(client, project["id"], tags=["old"])
        r = client.patch(f"/api/research/{item['id']}",
                         json={"tags": ["new", "updated"]})
        assert r.status_code == 200
        assert set(r.json()["tags"]) == {"new", "updated"}

    def test_delete_removes_item(self, client, project):
        item = _create_item(client, project["id"])
        r = client.delete(f"/api/research/{item['id']}")
        assert r.status_code == 204

        remaining = client.get(f"/api/projects/{project['id']}/research").json()
        assert all(i["id"] != item["id"] for i in remaining)

    def test_update_unknown_returns_404(self, client):
        r = client.patch("/api/research/99999", json={"title": "x"})
        assert r.status_code == 404

    def test_delete_unknown_returns_404(self, client):
        r = client.delete("/api/research/99999")
        assert r.status_code == 404


# ── Scene linking (core feature) ──────────────────────────────────────────────

class TestSceneLink:
    def test_link_to_scene(self, client, project, scene):
        item = _create_item(client, project["id"])
        assert item["linked_scene_id"] is None

        r = client.patch(f"/api/research/{item['id']}",
                         json={"linked_scene_id": scene["id"]})
        assert r.status_code == 200
        assert r.json()["linked_scene_id"] == scene["id"]

    def test_unlink_from_scene_with_null(self, client, project, scene):
        """
        Sending linked_scene_id=null must clear the link.
        This is the model_fields_set fix — the old code would ignore null.
        """
        item = _create_item(client, project["id"],
                            linked_scene_id=scene["id"])
        assert item["linked_scene_id"] == scene["id"]

        r = client.patch(f"/api/research/{item['id']}",
                         json={"linked_scene_id": None})
        assert r.status_code == 200
        assert r.json()["linked_scene_id"] is None

    def test_omitting_linked_scene_id_preserves_value(self, client, project, scene):
        """
        A PATCH that does NOT include linked_scene_id at all must leave
        the existing value untouched. Only model_fields_set can do this.
        """
        item = _create_item(client, project["id"],
                            linked_scene_id=scene["id"])
        assert item["linked_scene_id"] == scene["id"]

        # PATCH only the title — no linked_scene_id key in body
        r = client.patch(f"/api/research/{item['id']}",
                         json={"title": "Still linked"})
        assert r.status_code == 200
        assert r.json()["linked_scene_id"] == scene["id"], (
            "linked_scene_id must not be cleared when omitted from the PATCH body"
        )

    def test_link_persists_across_list(self, client, project, scene):
        """Linked item appears with the correct scene id when listed."""
        item = _create_item(client, project["id"])
        client.patch(f"/api/research/{item['id']}",
                     json={"linked_scene_id": scene["id"]})

        items = client.get(f"/api/projects/{project['id']}/research").json()
        match = next(i for i in items if i["id"] == item["id"])
        assert match["linked_scene_id"] == scene["id"]

    def test_link_to_scene_does_not_affect_other_items(self, client, project, scene):
        """Linking one item must not change other items' linked_scene_id."""
        item_a = _create_item(client, project["id"], title="A")
        item_b = _create_item(client, project["id"], title="B")

        client.patch(f"/api/research/{item_a['id']}",
                     json={"linked_scene_id": scene["id"]})

        items = client.get(f"/api/projects/{project['id']}/research").json()
        b = next(i for i in items if i["id"] == item_b["id"])
        assert b["linked_scene_id"] is None


# ── Codex linking (same model_fields_set path) ────────────────────────────────

class TestCodexLink:
    def test_link_to_codex(self, client, project):
        entry = _create_codex(client, project["id"])
        item = _create_item(client, project["id"])

        r = client.patch(f"/api/research/{item['id']}",
                         json={"linked_codex_id": entry["id"]})
        assert r.status_code == 200
        assert r.json()["linked_codex_id"] == entry["id"]

    def test_unlink_from_codex_with_null(self, client, project):
        entry = _create_codex(client, project["id"])
        item = _create_item(client, project["id"],
                            linked_codex_id=entry["id"])
        assert item["linked_codex_id"] == entry["id"]

        r = client.patch(f"/api/research/{item['id']}",
                         json={"linked_codex_id": None})
        assert r.status_code == 200
        assert r.json()["linked_codex_id"] is None

    def test_omitting_linked_codex_id_preserves_value(self, client, project):
        entry = _create_codex(client, project["id"])
        item = _create_item(client, project["id"],
                            linked_codex_id=entry["id"])

        r = client.patch(f"/api/research/{item['id']}",
                         json={"title": "Still codex-linked"})
        assert r.status_code == 200
        assert r.json()["linked_codex_id"] == entry["id"]


# ── Combined scene + codex link ───────────────────────────────────────────────

class TestCombinedLink:
    def test_scene_and_codex_independent(self, client, project, scene):
        """Setting linked_scene_id must not disturb linked_codex_id and vice versa."""
        entry = _create_codex(client, project["id"])
        item = _create_item(client, project["id"])

        # Link to codex first
        client.patch(f"/api/research/{item['id']}",
                     json={"linked_codex_id": entry["id"]})

        # Now link to scene — codex link must remain
        r = client.patch(f"/api/research/{item['id']}",
                         json={"linked_scene_id": scene["id"]})
        body = r.json()
        assert body["linked_scene_id"] == scene["id"]
        assert body["linked_codex_id"] == entry["id"]
