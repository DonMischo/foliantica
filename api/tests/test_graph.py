"""Tests for api/routers/graph.py — codex relation graph endpoint."""


# ── Helper ────────────────────────────────────────────────────────────────────

def _make_entry(client, project_id, name, entry_type="character"):
    r = client.post("/api/codex", json={"name": name, "project_id": project_id,
                                        "entry_type": entry_type})
    assert r.status_code == 201
    return r.json()


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestRelationsGraph:
    def test_empty_project_returns_empty_graph(self, client, project):
        r = client.get(f"/api/projects/{project['id']}/graph")
        assert r.status_code == 200
        data = r.json()
        assert "nodes" in data
        assert "edges" in data
        assert data["nodes"] == []
        assert data["edges"] == []

    def test_codex_entries_appear_as_nodes(self, client, project):
        _make_entry(client, project["id"], "Elara")
        _make_entry(client, project["id"], "Dren")
        r = client.get(f"/api/projects/{project['id']}/graph")
        assert r.status_code == 200
        node_ids = [n["id"] for n in r.json()["nodes"]]
        assert "Elara" in node_ids
        assert "Dren" in node_ids

    def test_relation_appears_as_edge(self, client, project):
        a = _make_entry(client, project["id"], "Hero")
        b = _make_entry(client, project["id"], "Villain")
        client.post("/api/codex/relations", json={
            "source_id": a["id"], "target_id": b["id"], "relation_type": "rivals",
        })
        r = client.get(f"/api/projects/{project['id']}/graph")
        assert r.status_code == 200
        data = r.json()
        assert len(data["edges"]) == 1
        edge = data["edges"][0]
        assert edge["source"] == "Hero"
        assert edge["target"] == "Villain"
        assert edge["type"] == "rivals"

    def test_node_includes_entry_type(self, client, project):
        _make_entry(client, project["id"], "Midgard", entry_type="location")
        r = client.get(f"/api/projects/{project['id']}/graph")
        node = next(n for n in r.json()["nodes"] if n["id"] == "Midgard")
        assert node["entry_type"] == "location"

    def test_unknown_project_returns_404(self, client):
        assert client.get("/api/projects/99999/graph").status_code == 404

    def test_shared_codex_project_uses_owner_entries(self, client, project):
        """Consumer project with shared_codex_project_id shows the owner's entries."""
        # Create owner entries
        _make_entry(client, project["id"], "SharedChar")
        # Create consumer project pointing at owner
        consumer = client.post("/api/projects", json={"title": "Consumer"}).json()
        client.patch(f"/api/projects/{consumer['id']}",
                     json={"shared_codex_project_id": project["id"]})
        r = client.get(f"/api/projects/{consumer['id']}/graph")
        assert r.status_code == 200
        node_ids = [n["id"] for n in r.json()["nodes"]]
        assert "SharedChar" in node_ids
