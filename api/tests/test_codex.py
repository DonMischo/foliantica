"""
Tests for api/routers/codex.py — full coverage of all 9 endpoints.

  - TestCodexCRUD        — list, create (aliases/tags/groups), get, update, delete, 404 guards
  - TestCodexAutoCreate  — species and group stubs auto-created on update
  - TestCodexSharing     — shared_codex_project_id + share_mode filtering
  - TestCodexRelations   — create, list, delete, duplicate upsert, 404 guards
  - TestCodexAccess      — GET / PUT /api/codex/{id}/access
  - TestCodexMentions    — scene-mentions endpoint with seeded MentionStat rows
"""
import pytest

from models import MentionStat


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def entry(client, project):
    """One codex entry for the test project."""
    r = client.post("/api/codex", json={"name": "Aragorn", "project_id": project["id"],
                                        "entry_type": "character"})
    assert r.status_code == 201
    return r.json()


@pytest.fixture
def entry2(client, project):
    """A second codex entry."""
    r = client.post("/api/codex", json={"name": "Legolas", "project_id": project["id"],
                                        "entry_type": "character"})
    assert r.status_code == 201
    return r.json()


# ── CRUD ──────────────────────────────────────────────────────────────────────

class TestCodexCRUD:
    def test_list_empty_for_new_project(self, client, project):
        r = client.get(f"/api/projects/{project['id']}/codex")
        assert r.status_code == 200
        assert r.json() == []

    def test_create_minimal(self, client, project):
        r = client.post("/api/codex", json={"name": "Frodo", "project_id": project["id"]})
        assert r.status_code == 201
        body = r.json()
        assert body["id"] > 0
        assert body["name"] == "Frodo"
        assert body["entry_type"] == "custom"

    def test_create_with_aliases(self, client, project):
        r = client.post("/api/codex", json={
            "name": "Strider",
            "project_id": project["id"],
            "aliases": ["Aragorn", "Elessar"],
        })
        assert r.status_code == 201
        assert set(r.json()["aliases"]) == {"Aragorn", "Elessar"}

    def test_create_with_tags(self, client, project):
        r = client.post("/api/codex", json={
            "name": "Gandalf",
            "project_id": project["id"],
            "tags": ["wizard", "maia"],
        })
        assert r.status_code == 201
        assert set(r.json()["tags"]) == {"wizard", "maia"}

    def test_create_with_groups(self, client, project):
        r = client.post("/api/codex", json={
            "name": "Gimli",
            "project_id": project["id"],
            "groups": ["Fellowship"],
        })
        assert r.status_code == 201
        assert "Fellowship" in r.json()["groups"]

    def test_create_unknown_project_returns_404(self, client):
        r = client.post("/api/codex", json={"name": "X", "project_id": 99999})
        assert r.status_code == 404

    def test_list_returns_created_entries(self, client, project):
        client.post("/api/codex", json={"name": "Sam", "project_id": project["id"]})
        client.post("/api/codex", json={"name": "Merry", "project_id": project["id"]})
        names = [e["name"] for e in client.get(f"/api/projects/{project['id']}/codex").json()]
        assert "Sam" in names
        assert "Merry" in names

    def test_get_single_entry(self, client, entry):
        r = client.get(f"/api/codex/{entry['id']}")
        assert r.status_code == 200
        assert r.json()["name"] == entry["name"]

    def test_get_unknown_returns_404(self, client):
        assert client.get("/api/codex/99999").status_code == 404

    def test_update_name_and_description(self, client, entry):
        r = client.patch(f"/api/codex/{entry['id']}", json={
            "name": "Elessar", "description": "King of Gondor",
        })
        assert r.status_code == 200
        body = r.json()
        assert body["name"] == "Elessar"
        assert body["description"] == "King of Gondor"

    def test_update_aliases(self, client, entry):
        r = client.patch(f"/api/codex/{entry['id']}", json={"aliases": ["Strider", "Longshanks"]})
        assert r.status_code == 200
        assert set(r.json()["aliases"]) == {"Strider", "Longshanks"}

    def test_update_tags(self, client, entry):
        r = client.patch(f"/api/codex/{entry['id']}", json={"tags": ["ranger", "king"]})
        assert r.status_code == 200
        assert set(r.json()["tags"]) == {"ranger", "king"}

    def test_update_entry_type(self, client, entry):
        r = client.patch(f"/api/codex/{entry['id']}", json={"entry_type": "location"})
        assert r.status_code == 200
        assert r.json()["entry_type"] == "location"

    def test_update_unknown_returns_404(self, client):
        assert client.patch("/api/codex/99999", json={"name": "x"}).status_code == 404

    def test_delete_returns_204(self, client, entry):
        assert client.delete(f"/api/codex/{entry['id']}").status_code == 204

    def test_deleted_entry_is_gone(self, client, entry):
        client.delete(f"/api/codex/{entry['id']}")
        assert client.get(f"/api/codex/{entry['id']}").status_code == 404

    def test_delete_unknown_returns_404(self, client):
        assert client.delete("/api/codex/99999").status_code == 404


# ── Auto-create stubs ─────────────────────────────────────────────────────────

class TestCodexAutoCreate:
    def test_species_creates_lore_stub(self, client, entry, project):
        client.patch(f"/api/codex/{entry['id']}", json={"species": "Dúnedain"})
        names = [e["name"] for e in client.get(f"/api/projects/{project['id']}/codex").json()]
        assert "Dúnedain" in names

    def test_species_stub_not_duplicated(self, client, entry, project):
        # Create the lore entry first
        client.post("/api/codex", json={"name": "Dúnedain", "project_id": project["id"],
                                        "entry_type": "lore"})
        client.patch(f"/api/codex/{entry['id']}", json={"species": "Dúnedain"})
        entries = client.get(f"/api/projects/{project['id']}/codex").json()
        assert [e["name"] for e in entries].count("Dúnedain") == 1

    def test_group_creates_custom_stub(self, client, entry, project):
        client.patch(f"/api/codex/{entry['id']}", json={"groups": ["Rangers of the North"]})
        names = [e["name"] for e in client.get(f"/api/projects/{project['id']}/codex").json()]
        assert "Rangers of the North" in names


# ── Sharing ───────────────────────────────────────────────────────────────────

class TestCodexSharing:
    def _make_consumer(self, client, owner_id):
        consumer = client.post("/api/projects", json={"title": "Consumer"}).json()
        client.patch(f"/api/projects/{consumer['id']}",
                     json={"shared_codex_project_id": owner_id})
        return consumer

    def test_consumer_sees_all_mode_entries(self, client, project, entry):
        # default share_mode is "all"
        consumer = self._make_consumer(client, project["id"])
        entries = client.get(f"/api/projects/{consumer['id']}/codex").json()
        assert any(e["id"] == entry["id"] for e in entries)

    def test_consumer_does_not_see_none_mode_entries(self, client, project, entry):
        client.patch(f"/api/codex/{entry['id']}", json={"share_mode": "none"})
        consumer = self._make_consumer(client, project["id"])
        entries = client.get(f"/api/projects/{consumer['id']}/codex").json()
        assert not any(e["id"] == entry["id"] for e in entries)

    def test_consumer_sees_specific_mode_with_access(self, client, project, entry):
        consumer = self._make_consumer(client, project["id"])
        client.patch(f"/api/codex/{entry['id']}", json={"share_mode": "specific"})
        # Grant access
        client.put(f"/api/codex/{entry['id']}/access",
                   json={"project_ids": [consumer["id"]]})
        entries = client.get(f"/api/projects/{consumer['id']}/codex").json()
        assert any(e["id"] == entry["id"] for e in entries)

    def test_consumer_does_not_see_specific_mode_without_access(self, client, project, entry):
        consumer = self._make_consumer(client, project["id"])
        client.patch(f"/api/codex/{entry['id']}", json={"share_mode": "specific"})
        # No access granted
        entries = client.get(f"/api/projects/{consumer['id']}/codex").json()
        assert not any(e["id"] == entry["id"] for e in entries)

    def test_owner_always_sees_own_entries(self, client, project, entry):
        client.patch(f"/api/codex/{entry['id']}", json={"share_mode": "none"})
        entries = client.get(f"/api/projects/{project['id']}/codex").json()
        assert any(e["id"] == entry["id"] for e in entries)


# ── Relations ─────────────────────────────────────────────────────────────────

class TestCodexRelations:
    def test_create_relation(self, client, entry, entry2):
        r = client.post("/api/codex/relations", json={
            "source_id": entry["id"],
            "target_id": entry2["id"],
            "relation_type": "allies",
        })
        assert r.status_code == 201
        body = r.json()
        assert body["source_id"] == entry["id"]
        assert body["target_id"] == entry2["id"]
        assert body["relation_type"] == "allies"

    def test_get_entry_relations_includes_from_and_to(self, client, entry, entry2):
        client.post("/api/codex/relations", json={
            "source_id": entry["id"], "target_id": entry2["id"], "relation_type": "friend",
        })
        r = client.get(f"/api/codex/{entry['id']}/relations")
        assert r.status_code == 200
        rels = r.json()
        assert len(rels) == 1
        assert rels[0]["other_name"] == entry2["name"]
        assert rels[0]["direction"] == "from"

    def test_relation_appears_on_both_sides(self, client, entry, entry2):
        client.post("/api/codex/relations", json={
            "source_id": entry["id"], "target_id": entry2["id"], "relation_type": "sibling",
        })
        rels2 = client.get(f"/api/codex/{entry2['id']}/relations").json()
        assert any(r["direction"] == "to" for r in rels2)

    def test_duplicate_relation_upserts_type(self, client, entry, entry2):
        client.post("/api/codex/relations", json={
            "source_id": entry["id"], "target_id": entry2["id"], "relation_type": "old",
        })
        r = client.post("/api/codex/relations", json={
            "source_id": entry["id"], "target_id": entry2["id"], "relation_type": "new",
        })
        assert r.status_code == 201
        assert r.json()["relation_type"] == "new"
        # Still only one relation
        assert len(client.get(f"/api/codex/{entry['id']}/relations").json()) == 1

    def test_delete_relation(self, client, entry, entry2):
        rel = client.post("/api/codex/relations", json={
            "source_id": entry["id"], "target_id": entry2["id"],
        }).json()
        assert client.delete(f"/api/codex/relations/{rel['id']}").status_code == 204
        assert client.get(f"/api/codex/{entry['id']}/relations").json() == []

    def test_create_relation_missing_source_returns_404(self, client, entry):
        r = client.post("/api/codex/relations", json={
            "source_id": 99999, "target_id": entry["id"],
        })
        assert r.status_code == 404

    def test_create_relation_missing_target_returns_404(self, client, entry):
        r = client.post("/api/codex/relations", json={
            "source_id": entry["id"], "target_id": 99999,
        })
        assert r.status_code == 404

    def test_delete_unknown_relation_returns_404(self, client):
        assert client.delete("/api/codex/relations/99999").status_code == 404

    def test_get_relations_unknown_entry_returns_404(self, client):
        assert client.get("/api/codex/99999/relations").status_code == 404


# ── Access control ────────────────────────────────────────────────────────────

class TestCodexAccess:
    def test_get_access_empty_initially(self, client, entry):
        r = client.get(f"/api/codex/{entry['id']}/access")
        assert r.status_code == 200
        assert r.json()["project_ids"] == []

    def test_set_access_grants_projects(self, client, entry):
        r = client.put(f"/api/codex/{entry['id']}/access",
                       json={"project_ids": [42, 43]})
        assert r.status_code == 200
        assert set(r.json()["project_ids"]) == {42, 43}

    def test_set_access_replaces_previous(self, client, entry):
        client.put(f"/api/codex/{entry['id']}/access", json={"project_ids": [10, 11]})
        client.put(f"/api/codex/{entry['id']}/access", json={"project_ids": [20]})
        r = client.get(f"/api/codex/{entry['id']}/access")
        assert r.json()["project_ids"] == [20]

    def test_get_access_unknown_entry_returns_404(self, client):
        assert client.get("/api/codex/99999/access").status_code == 404

    def test_set_access_unknown_entry_returns_404(self, client):
        r = client.put("/api/codex/99999/access", json={"project_ids": []})
        assert r.status_code == 404


# ── Scene mentions ────────────────────────────────────────────────────────────

class TestCodexMentions:
    def test_no_mentions_returns_empty_list(self, client, entry):
        r = client.get(f"/api/codex/{entry['id']}/scene-mentions")
        assert r.status_code == 200
        assert r.json() == []

    def test_seeded_mention_appears_in_result(self, client, db, entry, scene):
        db.add(MentionStat(scene_id=scene["id"], codex_id=entry["id"], count=3))
        db.commit()
        r = client.get(f"/api/codex/{entry['id']}/scene-mentions")
        assert r.status_code == 200
        mentions = r.json()
        assert len(mentions) == 1
        assert mentions[0]["scene_id"] == scene["id"]
        assert mentions[0]["count"] == 3

    def test_zero_count_mention_excluded(self, client, db, entry, scene):
        db.add(MentionStat(scene_id=scene["id"], codex_id=entry["id"], count=0))
        db.commit()
        r = client.get(f"/api/codex/{entry['id']}/scene-mentions")
        assert r.json() == []

    def test_mention_includes_scene_and_chapter_titles(self, client, db, entry, scene, chapter, act):
        db.add(MentionStat(scene_id=scene["id"], codex_id=entry["id"], count=1))
        db.commit()
        mention = client.get(f"/api/codex/{entry['id']}/scene-mentions").json()[0]
        assert "scene_title" in mention
        assert "chapter_title" in mention
        assert "act_title" in mention
