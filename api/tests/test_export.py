"""
Tests for api/routers/export.py.

  - TestExportMarkdown  — POST /api/projects/{id}/export format=md
  - TestExportLatex     — POST /api/projects/{id}/export format=tex
  - TestExportEpubStyle — POST /api/projects/{id}/export format=epub-style
  - TestExportPdf       — POST /api/projects/{id}/export format=pdf (respx-mocked pandoc)
  - TestExportFonts     — GET /api/projects/export/fonts
  - TestExportProfiles  — GET/POST/PATCH/DELETE export-profiles
  - TestExportStructure — GET /api/projects/{id}/export/structure
  - TestPublishers      — GET /api/export/publishers
  - TestBatchExport     — POST /api/projects/{id}/export/batch
  - TestExportPdfLive   — @pytest.mark.live: real Pandoc container at localhost:8082
"""
import respx
import httpx
import pytest

from models import ExportProfile


PANDOC_URL = "http://pandoc-test:8082"


def _enable_pandoc(client, url=PANDOC_URL):
    r = client.post("/api/settings", json={
        "pandoc_enabled": True,
        "pandoc_url": url,
    })
    assert r.status_code == 200


# ── Local format exports (no network) ─────────────────────────────────────────

class TestExportMarkdown:
    def test_returns_200_and_markdown_content_type(self, client, project, scene):
        r = client.post(f"/api/projects/{project['id']}/export", json={"format": "md"})
        assert r.status_code == 200
        assert "text/markdown" in r.headers["content-type"]

    def test_content_disposition_includes_filename(self, client, project, scene):
        r = client.post(f"/api/projects/{project['id']}/export", json={"format": "md"})
        assert "attachment" in r.headers["content-disposition"]
        assert ".md" in r.headers["content-disposition"]

    def test_scene_content_appears_in_output(self, client, project, scene):
        # Scene content is <p>Hello world</p> — stripped to "Hello world"
        r = client.post(f"/api/projects/{project['id']}/export", json={"format": "md"})
        assert "Hello world" in r.text

    def test_unknown_project_returns_404(self, client):
        r = client.post("/api/projects/99999/export", json={"format": "md"})
        assert r.status_code == 404


class TestExportLatex:
    def test_returns_200_and_tex_content_type(self, client, project, scene):
        r = client.post(f"/api/projects/{project['id']}/export", json={"format": "tex"})
        assert r.status_code == 200
        assert "tex" in r.headers["content-type"]

    def test_response_contains_latex_markup(self, client, project, scene):
        r = client.post(f"/api/projects/{project['id']}/export", json={"format": "tex"})
        # LaTeX output always contains backslash commands
        assert "\\" in r.text


class TestExportEpubStyle:
    def test_returns_200_and_css_content_type(self, client, project, scene):
        r = client.post(f"/api/projects/{project['id']}/export", json={"format": "epub-style"})
        assert r.status_code == 200
        assert "css" in r.headers["content-type"]


# ── Pandoc-backed exports ──────────────────────────────────────────────────────

class TestExportPdf:
    def test_pandoc_disabled_returns_503(self, client, project, scene):
        # No pandoc settings → disabled by default
        r = client.post(f"/api/projects/{project['id']}/export", json={"format": "pdf"})
        assert r.status_code == 503

    def test_pandoc_enabled_proxies_binary_response(self, client, project, scene):
        _enable_pandoc(client)
        fake_pdf = b"%PDF-1.4 fake"
        with respx.mock:
            respx.post(f"{PANDOC_URL}/convert").mock(
                return_value=httpx.Response(200, content=fake_pdf)
            )
            r = client.post(f"/api/projects/{project['id']}/export", json={"format": "pdf"})
        assert r.status_code == 200
        assert r.content == fake_pdf
        assert "application/pdf" in r.headers["content-type"]

    def test_pandoc_connect_error_returns_503(self, client, project, scene):
        _enable_pandoc(client)
        with respx.mock:
            respx.post(f"{PANDOC_URL}/convert").mock(side_effect=httpx.ConnectError("refused"))
            r = client.post(f"/api/projects/{project['id']}/export", json={"format": "pdf"})
        assert r.status_code == 503

    def test_pandoc_5xx_returns_502(self, client, project, scene):
        _enable_pandoc(client)
        with respx.mock:
            respx.post(f"{PANDOC_URL}/convert").mock(
                return_value=httpx.Response(500, text="Pandoc crashed")
            )
            r = client.post(f"/api/projects/{project['id']}/export", json={"format": "pdf"})
        assert r.status_code == 502


# ── GET /api/projects/export/fonts ────────────────────────────────────────────

class TestExportFonts:
    def test_pandoc_disabled_returns_empty_list(self, client):
        r = client.get("/api/projects/export/fonts")
        assert r.status_code == 200
        assert r.json() == {"fonts": []}

    def test_pandoc_enabled_proxies_font_list(self, client):
        _enable_pandoc(client)
        font_list = {"fonts": ["EB Garamond", "Source Serif 4"]}
        with respx.mock:
            respx.get(f"{PANDOC_URL}/fonts").mock(
                return_value=httpx.Response(200, json=font_list)
            )
            r = client.get("/api/projects/export/fonts")
        assert r.status_code == 200
        assert "EB Garamond" in r.json()["fonts"]

    def test_connect_error_returns_empty_list_not_503(self, client):
        # The fonts endpoint degrades gracefully — never raises 503
        _enable_pandoc(client)
        with respx.mock:
            respx.get(f"{PANDOC_URL}/fonts").mock(side_effect=httpx.ConnectError("refused"))
            r = client.get("/api/projects/export/fonts")
        assert r.status_code == 200
        assert r.json() == {"fonts": []}


# ── Export profiles CRUD ──────────────────────────────────────────────────────

class TestExportProfiles:
    def test_list_empty_initially(self, client, project):
        r = client.get(f"/api/projects/{project['id']}/export-profiles")
        assert r.status_code == 200
        assert r.json() == []

    def test_create_profile(self, client, project):
        r = client.post(f"/api/projects/{project['id']}/export-profiles", json={
            "name": "My Style",
            "description": "Manuscript format",
            "options_json": '{"format": "docx"}',
        })
        assert r.status_code == 201
        body = r.json()
        assert body["name"] == "My Style"
        assert body["project_id"] == project["id"]
        assert body["is_builtin"] == 0

    def test_created_profile_appears_in_list(self, client, project):
        client.post(f"/api/projects/{project['id']}/export-profiles", json={"name": "Draft"})
        profiles = client.get(f"/api/projects/{project['id']}/export-profiles").json()
        assert any(p["name"] == "Draft" for p in profiles)

    def test_update_profile_name(self, client, project):
        pid = client.post(
            f"/api/projects/{project['id']}/export-profiles", json={"name": "Old Name"}
        ).json()["id"]
        r = client.patch(f"/api/projects/export-profiles/{pid}", json={"name": "New Name"})
        assert r.status_code == 200
        assert r.json()["name"] == "New Name"

    def test_update_builtin_profile_returns_404(self, client, db, project):
        # Built-in profiles are read-only
        p = ExportProfile(name="Built-in", is_builtin=1, project_id=None)
        db.add(p)
        db.commit()
        db.refresh(p)
        r = client.patch(f"/api/projects/export-profiles/{p.id}", json={"name": "Hacked"})
        assert r.status_code == 404

    def test_delete_profile(self, client, project):
        pid = client.post(
            f"/api/projects/{project['id']}/export-profiles", json={"name": "Temp"}
        ).json()["id"]
        r = client.delete(f"/api/projects/export-profiles/{pid}")
        assert r.status_code == 204
        profiles = client.get(f"/api/projects/{project['id']}/export-profiles").json()
        assert not any(p["id"] == pid for p in profiles)

    def test_delete_builtin_profile_returns_404(self, client, db):
        p = ExportProfile(name="Read-only", is_builtin=1, project_id=None)
        db.add(p)
        db.commit()
        db.refresh(p)
        r = client.delete(f"/api/projects/export-profiles/{p.id}")
        assert r.status_code == 404


# ── GET /api/projects/{id}/export/structure ───────────────────────────────────

class TestExportStructure:
    def test_unknown_project_returns_404(self, client):
        r = client.get("/api/projects/99999/export/structure")
        assert r.status_code == 404

    def test_structure_matches_seeded_hierarchy(self, client, scene, chapter, act, project):
        r = client.get(f"/api/projects/{project['id']}/export/structure")
        assert r.status_code == 200
        body = r.json()
        assert body["title"] == project["title"]
        assert len(body["acts"]) == 1
        assert len(body["acts"][0]["chapters"]) == 1
        scenes = body["acts"][0]["chapters"][0]["scenes"]
        assert len(scenes) == 1
        assert scenes[0]["title"] == scene["title"]


# ── GET /api/export/publishers ────────────────────────────────────────────────

class TestPublishers:
    def test_returns_list(self, client):
        # Test DB has no seeded publisher profiles → empty list is valid
        r = client.get("/api/export/publishers")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ── POST /api/projects/{id}/export/batch ─────────────────────────────────────

class TestBatchExport:
    def test_pandoc_disabled_returns_503(self, client, project):
        r = client.post(
            f"/api/projects/{project['id']}/export/batch",
            json={"publisher_ids": [1]},
        )
        assert r.status_code == 503

    def test_no_valid_publishers_returns_400(self, client, project):
        # Pandoc enabled + pre-flight passes, but publisher IDs don't exist → 400
        _enable_pandoc(client)
        with respx.mock:
            respx.get(f"{PANDOC_URL}/fonts").mock(
                return_value=httpx.Response(200, json={"fonts": []})
            )
            r = client.post(
                f"/api/projects/{project['id']}/export/batch",
                json={"publisher_ids": [99999]},
            )
        assert r.status_code == 400


# ── Image path-traversal safety (security) ────────────────────────────────────
# Scene content is raw, attacker-influenceable HTML, so a scene-image data-src
# must never be able to read a file outside the uploads dir during export.

class TestImagePathSafety:
    def test_rejects_absolute_path(self, tmp_path):
        from services.export import _safe_image_path
        secret = tmp_path / "secret.txt"
        secret.write_text("TOP SECRET")
        assert _safe_image_path(str(secret)) is None

    def test_rejects_parent_traversal(self):
        from services.export import _safe_image_path
        assert _safe_image_path("uploads/../../etc/passwd") is None
        assert _safe_image_path("../../../etc/passwd") is None

    def test_rejects_empty(self):
        from services.export import _safe_image_path
        assert _safe_image_path("") is None
        assert _safe_image_path(None) is None  # type: ignore[arg-type]

    def test_accepts_file_inside_uploads(self, tmp_path, monkeypatch):
        from services.export import _safe_image_path
        monkeypatch.chdir(tmp_path)
        up = tmp_path / "uploads" / "scenes"
        up.mkdir(parents=True)
        img = up / "a.png"
        img.write_bytes(b"\x89PNG fake")
        assert _safe_image_path("uploads/scenes/a.png") == img.resolve()

    def test_img_html_does_not_embed_arbitrary_file(self, tmp_path, monkeypatch):
        import base64
        from services.export import _img_html
        monkeypatch.chdir(tmp_path)
        (tmp_path / "uploads").mkdir()
        secret = tmp_path / "secret.key"
        secret.write_bytes(b"FERNET-SECRET-VALUE")
        # data-src pointing outside uploads must yield NO output and leak nothing
        out = _img_html(str(secret), "caption")
        assert out == ""
        assert base64.b64encode(b"FERNET-SECRET-VALUE").decode() not in out


# ── Live tests: real Pandoc container ─────────────────────────────────────────

PANDOC_LIVE_URL = "http://localhost:8082"


@pytest.fixture
def pandoc_running():
    """Skip the test if the Pandoc container is not reachable."""
    try:
        with httpx.Client(timeout=2.0) as c:
            c.get(f"{PANDOC_LIVE_URL}/fonts")
    except (httpx.ConnectError, httpx.ConnectTimeout):
        pytest.skip("Pandoc container not reachable at localhost:8082 — start it first")


@pytest.mark.live
class TestExportPdfLive:
    def test_pdf_export_returns_valid_pdf(self, client, project, scene, pandoc_running):
        client.post("/api/settings", json={
            "pandoc_enabled": True,
            "pandoc_url": PANDOC_LIVE_URL,
        })
        r = client.post(f"/api/projects/{project['id']}/export", json={"format": "pdf"})
        assert r.status_code == 200
        assert "application/pdf" in r.headers["content-type"]
        assert r.content[:4] == b"%PDF"

    def test_docx_export_returns_docx(self, client, project, scene, pandoc_running):
        client.post("/api/settings", json={
            "pandoc_enabled": True,
            "pandoc_url": PANDOC_LIVE_URL,
        })
        r = client.post(f"/api/projects/{project['id']}/export", json={"format": "docx"})
        assert r.status_code == 200
        # DOCX is a ZIP; starts with PK magic bytes
        assert r.content[:2] == b"PK"

    def test_epub_export_returns_epub(self, client, project, scene, pandoc_running):
        client.post("/api/settings", json={
            "pandoc_enabled": True,
            "pandoc_url": PANDOC_LIVE_URL,
        })
        r = client.post(f"/api/projects/{project['id']}/export", json={"format": "epub"})
        assert r.status_code == 200
        assert "epub" in r.headers["content-type"]
        # EPUB is a ZIP too
        assert r.content[:2] == b"PK"

    def test_fonts_endpoint_returns_list(self, client, pandoc_running):
        client.post("/api/settings", json={
            "pandoc_enabled": True,
            "pandoc_url": PANDOC_LIVE_URL,
        })
        r = client.get("/api/projects/export/fonts")
        assert r.status_code == 200
        assert isinstance(r.json().get("fonts"), list)
