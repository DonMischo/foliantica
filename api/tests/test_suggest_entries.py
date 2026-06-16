"""
Tests for GET /api/scenes/{scene_id}/suggest-entries.

Covers:
  - TestSuggestEntriesGating   — 404 / 400 / 503 error cases
  - TestSuggestEntriesFiltering — exact match, alias, genitive-s, short names
"""
import respx
import httpx


SPACY_URL = "http://spacy-test:8000"


def _enable_spacy(client, url=SPACY_URL):
    r = client.post("/api/settings", json={"spacy_enabled": True, "spacy_url": url})
    assert r.status_code == 200


def _mock_suggest(suggestions: list[dict]):
    """Return a respx mock that returns suggestions from the spaCy /suggest endpoint."""
    return respx.mock(assert_all_called=False).__enter__(), \
           respx.post(f"{SPACY_URL}/suggest").mock(
               return_value=httpx.Response(200, json=suggestions)
           )


# ── Error gates ───────────────────────────────────────────────────────────────

class TestSuggestEntriesGating:
    def test_unknown_scene_returns_404(self, client):
        r = client.get("/api/scenes/99999/suggest-entries")
        assert r.status_code == 404

    def test_spacy_not_configured_returns_400(self, client, scene):
        # No settings row → spacy_enabled defaults to 0
        r = client.get(f"/api/scenes/{scene['id']}/suggest-entries")
        assert r.status_code == 400

    def test_spacy_disabled_returns_400(self, client, scene):
        client.post("/api/settings", json={"spacy_enabled": False, "spacy_url": SPACY_URL})
        r = client.get(f"/api/scenes/{scene['id']}/suggest-entries")
        assert r.status_code == 400

    def test_spacy_service_unreachable_returns_503(self, client, scene):
        _enable_spacy(client)
        with respx.mock:
            respx.post(f"{SPACY_URL}/suggest").mock(
                side_effect=httpx.ConnectError("refused")
            )
            r = client.get(f"/api/scenes/{scene['id']}/suggest-entries")
        assert r.status_code == 503

    def test_spacy_error_response_returns_503(self, client, scene):
        _enable_spacy(client)
        with respx.mock:
            respx.post(f"{SPACY_URL}/suggest").mock(
                return_value=httpx.Response(500)
            )
            r = client.get(f"/api/scenes/{scene['id']}/suggest-entries")
        assert r.status_code == 503


# ── Filtering ─────────────────────────────────────────────────────────────────

class TestSuggestEntriesFiltering:
    def test_returns_all_suggestions_when_no_codex(self, client, scene):
        _enable_spacy(client)
        with respx.mock:
            respx.post(f"{SPACY_URL}/suggest").mock(
                return_value=httpx.Response(200, json=[
                    {"text": "Miya",   "label": "PER"},
                    {"text": "Berlin", "label": "LOC"},
                ])
            )
            r = client.get(f"/api/scenes/{scene['id']}/suggest-entries")
        assert r.status_code == 200
        assert len(r.json()) == 2

    def test_filters_exact_name_match(self, client, project, scene):
        _enable_spacy(client)
        client.post("/api/codex", json={
            "name": "Miya", "project_id": project["id"], "entry_type": "character",
        })
        with respx.mock:
            respx.post(f"{SPACY_URL}/suggest").mock(return_value=httpx.Response(200, json=[
                {"text": "Miya",   "label": "PER"},
                {"text": "Berlin", "label": "LOC"},
            ]))
            r = client.get(f"/api/scenes/{scene['id']}/suggest-entries")
        body = r.json()
        assert not any(s["text"] == "Miya"   for s in body)
        assert     any(s["text"] == "Berlin" for s in body)

    def test_match_is_case_insensitive(self, client, project, scene):
        _enable_spacy(client)
        client.post("/api/codex", json={
            "name": "miya", "project_id": project["id"], "entry_type": "character",
        })
        with respx.mock:
            respx.post(f"{SPACY_URL}/suggest").mock(
                return_value=httpx.Response(200, json=[{"text": "Miya", "label": "PER"}])
            )
            r = client.get(f"/api/scenes/{scene['id']}/suggest-entries")
        assert r.json() == []

    def test_filters_alias_match(self, client, project, scene):
        _enable_spacy(client)
        client.post("/api/codex", json={
            "name": "Maria", "aliases": ["Miya"],
            "project_id": project["id"], "entry_type": "character",
        })
        with respx.mock:
            respx.post(f"{SPACY_URL}/suggest").mock(
                return_value=httpx.Response(200, json=[{"text": "Miya", "label": "PER"}])
            )
            r = client.get(f"/api/scenes/{scene['id']}/suggest-entries")
        assert r.json() == []

    def test_filters_genitive_s(self, client, project, scene):
        """'Claras' is filtered when 'Clara' is in the codex."""
        _enable_spacy(client)
        client.post("/api/codex", json={
            "name": "Clara", "project_id": project["id"], "entry_type": "character",
        })
        with respx.mock:
            respx.post(f"{SPACY_URL}/suggest").mock(
                return_value=httpx.Response(200, json=[{"text": "Claras", "label": "PER"}])
            )
            r = client.get(f"/api/scenes/{scene['id']}/suggest-entries")
        assert r.json() == []

    def test_genitive_s_via_alias(self, client, project, scene):
        """'Marias' is filtered when alias 'Maria' is in the codex."""
        _enable_spacy(client)
        client.post("/api/codex", json={
            "name": "Unknown", "aliases": ["Maria"],
            "project_id": project["id"], "entry_type": "character",
        })
        with respx.mock:
            respx.post(f"{SPACY_URL}/suggest").mock(
                return_value=httpx.Response(200, json=[{"text": "Marias", "label": "PER"}])
            )
            r = client.get(f"/api/scenes/{scene['id']}/suggest-entries")
        assert r.json() == []

    def test_name_ending_in_s_not_filtered_when_absent(self, client, scene):
        """'Thomas' is kept when neither 'Thomas' nor 'Thoma' is in the codex."""
        _enable_spacy(client)
        with respx.mock:
            respx.post(f"{SPACY_URL}/suggest").mock(
                return_value=httpx.Response(200, json=[{"text": "Thomas", "label": "PER"}])
            )
            r = client.get(f"/api/scenes/{scene['id']}/suggest-entries")
        assert any(s["text"] == "Thomas" for s in r.json())

    def test_two_char_name_ending_s_not_stripped(self, client, scene):
        """A two-letter name like 'As' must not be mangled to 'A' and falsely matched."""
        _enable_spacy(client)
        with respx.mock:
            respx.post(f"{SPACY_URL}/suggest").mock(
                return_value=httpx.Response(200, json=[{"text": "As", "label": "PER"}])
            )
            r = client.get(f"/api/scenes/{scene['id']}/suggest-entries")
        # "As" has no match in the codex, so it must be returned
        assert any(s["text"] == "As" for s in r.json())

    def test_suggestions_from_other_projects_not_filtered(self, client, scene):
        """Codex entries from a different project must not suppress suggestions."""
        _enable_spacy(client)
        # Create a second project with its own codex
        other = client.post("/api/projects", json={"title": "Other"}).json()
        client.post("/api/codex", json={
            "name": "Miya", "project_id": other["id"], "entry_type": "character",
        })
        with respx.mock:
            respx.post(f"{SPACY_URL}/suggest").mock(
                return_value=httpx.Response(200, json=[{"text": "Miya", "label": "PER"}])
            )
            r = client.get(f"/api/scenes/{scene['id']}/suggest-entries")
        # "Miya" belongs to a different project — should not be filtered
        assert any(s["text"] == "Miya" for s in r.json())
