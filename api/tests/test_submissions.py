"""Tests for api/routers/submissions.py — query/submission tracker CRUD."""


# ── Helper ────────────────────────────────────────────────────────────────────

def _make_submission(client, project_id, **kwargs):
    defaults = {"agent_name": "Jane Agent", "status": "queried"}
    defaults.update(kwargs)
    r = client.post(f"/api/projects/{project_id}/submissions", json=defaults)
    assert r.status_code == 201
    return r.json()


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestSubmissions:
    def test_list_empty_for_new_project(self, client, project):
        r = client.get(f"/api/projects/{project['id']}/submissions")
        assert r.status_code == 200
        assert r.json() == []

    def test_create_returns_201_with_id(self, client, project):
        r = client.post(f"/api/projects/{project['id']}/submissions", json={
            "agent_name": "Alice Agent",
            "agency": "Big Agency",
            "status": "queried",
        })
        assert r.status_code == 201
        body = r.json()
        assert body["id"] > 0
        assert body["agent_name"] == "Alice Agent"
        assert body["agency"] == "Big Agency"
        assert body["status"] == "queried"

    def test_create_minimal_fields(self, client, project):
        r = client.post(f"/api/projects/{project['id']}/submissions", json={})
        assert r.status_code == 201
        assert r.json()["id"] > 0

    def test_list_returns_created_submissions(self, client, project):
        _make_submission(client, project["id"], agent_name="Agent A")
        _make_submission(client, project["id"], agent_name="Agent B")
        items = client.get(f"/api/projects/{project['id']}/submissions").json()
        names = [i["agent_name"] for i in items]
        assert "Agent A" in names
        assert "Agent B" in names

    def test_update_status(self, client, project):
        sub = _make_submission(client, project["id"])
        r = client.patch(f"/api/submissions/{sub['id']}", json={"status": "full_requested"})
        assert r.status_code == 200
        assert r.json()["status"] == "full_requested"

    def test_update_notes(self, client, project):
        sub = _make_submission(client, project["id"])
        r = client.patch(f"/api/submissions/{sub['id']}", json={"notes": "Liked the premise"})
        assert r.status_code == 200
        assert r.json()["notes"] == "Liked the premise"

    def test_delete_returns_204(self, client, project):
        sub = _make_submission(client, project["id"])
        assert client.delete(f"/api/submissions/{sub['id']}").status_code == 204

    def test_deleted_submission_not_in_list(self, client, project):
        sub = _make_submission(client, project["id"])
        client.delete(f"/api/submissions/{sub['id']}")
        items = client.get(f"/api/projects/{project['id']}/submissions").json()
        assert not any(i["id"] == sub["id"] for i in items)

    def test_update_unknown_returns_404(self, client):
        assert client.patch("/api/submissions/99999", json={"notes": "x"}).status_code == 404

    def test_delete_unknown_returns_404(self, client):
        assert client.delete("/api/submissions/99999").status_code == 404
