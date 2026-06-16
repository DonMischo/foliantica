"""Tests for api/routers/fragments.py — tabs, CRUD, import, pure parser."""
import io

from routers.fragments import _parse_snippet_file
from schemas import BUILTIN_TABS


# ── Unit tests: _parse_snippet_file ──────────────────────────────────────────

class TestParseSnippetFile:
    def test_no_frontmatter_uses_whole_file_as_content(self):
        result = _parse_snippet_file("Just some text")
        assert result["content"] == "Just some text"
        assert result["tab"] == "snippets"
        assert result["title"] is None

    def test_frontmatter_extracts_title_and_tab(self):
        raw = "---\ntitle: My Note\ntab: ideas\n---\nBody text here."
        result = _parse_snippet_file(raw)
        assert result["title"] == "My Note"
        assert result["tab"] == "ideas"
        assert result["content"] == "Body text here."

    def test_frontmatter_missing_tab_defaults_to_snippets(self):
        raw = "---\ntitle: Something\n---\nContent."
        result = _parse_snippet_file(raw)
        assert result["tab"] == "snippets"

    def test_frontmatter_missing_title_returns_none(self):
        raw = "---\ntab: archive\n---\nContent."
        result = _parse_snippet_file(raw)
        assert result["title"] is None

    def test_empty_file(self):
        result = _parse_snippet_file("")
        assert result["content"] == ""


# ── Tab management ────────────────────────────────────────────────────────────

class TestFragmentTabs:
    def test_get_tabs_returns_builtins_and_empty_custom(self, client, project):
        r = client.get(f"/api/projects/{project['id']}/fragment-tabs")
        assert r.status_code == 200
        data = r.json()
        assert data["builtin"] == BUILTIN_TABS
        assert data["custom"] == []
        assert data["all"] == BUILTIN_TABS

    def test_update_tabs_adds_custom(self, client, project):
        r = client.patch(f"/api/projects/{project['id']}/fragment-tabs",
                         json={"custom_tabs": ["worldbuilding", "characters"]})
        assert r.status_code == 200
        data = r.json()
        assert "worldbuilding" in data["custom"]
        assert "characters" in data["custom"]
        assert "worldbuilding" in data["all"]

    def test_update_tabs_deduplicates(self, client, project):
        r = client.patch(f"/api/projects/{project['id']}/fragment-tabs",
                         json={"custom_tabs": ["notes", "notes", "notes"]})
        assert r.status_code == 200
        assert r.json()["custom"].count("notes") == 1

    def test_update_tabs_excludes_builtins(self, client, project):
        r = client.patch(f"/api/projects/{project['id']}/fragment-tabs",
                         json={"custom_tabs": ["snippets", "ideas", "myown"]})
        assert r.status_code == 200
        custom = r.json()["custom"]
        assert "snippets" not in custom
        assert "ideas" not in custom
        assert "myown" in custom

    def test_update_strips_blank_entries(self, client, project):
        r = client.patch(f"/api/projects/{project['id']}/fragment-tabs",
                         json={"custom_tabs": ["  ", "valid", ""]})
        assert r.status_code == 200
        assert r.json()["custom"] == ["valid"]

    def test_get_tabs_unknown_project_returns_404(self, client):
        assert client.get("/api/projects/99999/fragment-tabs").status_code == 404

    def test_update_tabs_unknown_project_returns_404(self, client):
        r = client.patch("/api/projects/99999/fragment-tabs", json={"custom_tabs": []})
        assert r.status_code == 404


# ── Fragment CRUD ─────────────────────────────────────────────────────────────

class TestFragmentCRUD:
    def test_list_empty_for_new_project(self, client, project):
        r = client.get(f"/api/projects/{project['id']}/fragments")
        assert r.status_code == 200
        assert r.json() == []

    def test_create_in_builtin_tab(self, client, project):
        r = client.post(f"/api/projects/{project['id']}/fragments", json={
            "tab": "snippets", "title": "My Snippet", "content": "Hello world",
        })
        assert r.status_code == 201
        body = r.json()
        assert body["title"] == "My Snippet"
        assert body["tab"] == "snippets"

    def test_create_in_unknown_tab_returns_400(self, client, project):
        r = client.post(f"/api/projects/{project['id']}/fragments", json={
            "tab": "nonexistent", "title": "X",
        })
        assert r.status_code == 400

    def test_list_filters_by_tab(self, client, project):
        client.post(f"/api/projects/{project['id']}/fragments",
                    json={"tab": "snippets", "title": "S"})
        client.post(f"/api/projects/{project['id']}/fragments",
                    json={"tab": "ideas", "title": "I"})
        snippets = client.get(f"/api/projects/{project['id']}/fragments",
                              params={"tab": "snippets"}).json()
        assert all(f["tab"] == "snippets" for f in snippets)
        assert len(snippets) == 1

    def test_update_title_and_content(self, client, project):
        r = client.post(f"/api/projects/{project['id']}/fragments",
                        json={"tab": "snippets", "title": "Old"})
        frag_id = r.json()["id"]
        r2 = client.patch(f"/api/fragments/{frag_id}",
                          json={"title": "New", "content": "Updated body"})
        assert r2.status_code == 200
        assert r2.json()["title"] == "New"
        assert r2.json()["content"] == "Updated body"

    def test_update_to_invalid_tab_returns_400(self, client, project):
        r = client.post(f"/api/projects/{project['id']}/fragments",
                        json={"tab": "snippets", "title": "X"})
        frag_id = r.json()["id"]
        r2 = client.patch(f"/api/fragments/{frag_id}", json={"tab": "bad_tab"})
        assert r2.status_code == 400

    def test_delete_returns_204(self, client, project):
        r = client.post(f"/api/projects/{project['id']}/fragments",
                        json={"tab": "snippets", "title": "Del me"})
        frag_id = r.json()["id"]
        assert client.delete(f"/api/fragments/{frag_id}").status_code == 204
        remaining = client.get(f"/api/projects/{project['id']}/fragments").json()
        assert not any(f["id"] == frag_id for f in remaining)

    def test_update_unknown_returns_404(self, client):
        assert client.patch("/api/fragments/99999", json={"title": "x"}).status_code == 404

    def test_delete_unknown_returns_404(self, client):
        assert client.delete("/api/fragments/99999").status_code == 404

    def test_create_unknown_project_returns_404(self, client):
        r = client.post("/api/projects/99999/fragments", json={"tab": "snippets"})
        assert r.status_code == 404


# ── Fragment import ───────────────────────────────────────────────────────────

class TestFragmentImport:
    def _upload(self, client, project_id, filename, content):
        return client.post(
            f"/api/projects/{project_id}/fragments/import",
            files={"files": (filename, content.encode(), "text/plain")},
        )

    def test_import_plain_file_uses_filename_as_title(self, client, project):
        r = self._upload(client, project["id"], "my_note.md", "Just text content.")
        assert r.status_code == 200
        assert r.json()["created"] == 1
        frags = client.get(f"/api/projects/{project['id']}/fragments").json()
        assert frags[0]["title"] == "my_note"
        assert frags[0]["content"] == "Just text content."

    def test_import_frontmatter_file(self, client, project):
        raw = "---\ntitle: Research Note\ntab: ideas\n---\nDetailed notes here."
        r = self._upload(client, project["id"], "note.md", raw)
        assert r.status_code == 200
        frags = client.get(f"/api/projects/{project['id']}/fragments",
                           params={"tab": "ideas"}).json()
        assert frags[0]["title"] == "Research Note"
        assert "Detailed notes" in frags[0]["content"]

    def test_import_unknown_tab_falls_back_to_snippets(self, client, project):
        raw = "---\ntab: nonexistent\n---\nContent."
        r = self._upload(client, project["id"], "f.md", raw)
        assert r.status_code == 200
        frags = client.get(f"/api/projects/{project['id']}/fragments").json()
        assert frags[0]["tab"] == "snippets"

    def test_import_multiple_files(self, client, project):
        r = client.post(
            f"/api/projects/{project['id']}/fragments/import",
            files=[
                ("files", ("a.md", b"First file", "text/plain")),
                ("files", ("b.md", b"Second file", "text/plain")),
            ],
        )
        assert r.status_code == 200
        assert r.json()["created"] == 2
        assert client.get(f"/api/projects/{project['id']}/fragments").json().__len__() == 2

    def test_import_unknown_project_returns_404(self, client):
        r = client.post(
            "/api/projects/99999/fragments/import",
            files={"files": ("x.md", b"content", "text/plain")},
        )
        assert r.status_code == 404
