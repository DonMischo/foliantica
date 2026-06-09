"""
Tests for api/routers/images.py.

  - TestProjectCover   — POST / DELETE /api/projects/{id}/cover
  - TestCodexImage     — POST / DELETE /api/codex/{id}/image
  - TestSceneImage     — POST /api/scenes/{id}/images
  - TestResearchMedia  — POST /api/research/{id}/media + DELETE /api/research/media/{id}

All tests monkeypatch UPLOAD_DIR to pytest's tmp_path so no real files
are written to the repository.
"""
import io
import pytest

import routers.images as _img_module
from models import ResearchItem


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _use_tmp_upload_dir(tmp_path, monkeypatch):
    """Redirect all file uploads to a temp directory."""
    monkeypatch.setattr(_img_module, "UPLOAD_DIR", str(tmp_path))


@pytest.fixture
def codex_entry(client, project):
    r = client.post("/api/codex", json={
        "name": "TestChar", "project_id": project["id"], "entry_type": "character",
    })
    assert r.status_code == 201
    return r.json()


@pytest.fixture
def research_item(db, project):
    item = ResearchItem(project_id=project["id"], title="My Clipping")
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def _png_file(name="test.png"):
    """Minimal 1×1 transparent PNG bytes."""
    png = bytes([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,  # PNG signature
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,  # IHDR chunk
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
        0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,  # IDAT chunk
        0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
        0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
        0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,  # IEND chunk
        0x44, 0xae, 0x42, 0x60, 0x82,
    ])
    return (name, io.BytesIO(png), "image/png")


# ── Project cover ─────────────────────────────────────────────────────────────

class TestProjectCover:
    def test_upload_cover_returns_path(self, client, project):
        r = client.post(
            f"/api/projects/{project['id']}/cover",
            files={"file": _png_file()},
        )
        assert r.status_code == 200
        body = r.json()
        assert "cover_image" in body
        assert body["cover_image"].endswith(".png")

    def test_upload_unsupported_type_returns_400(self, client, project):
        r = client.post(
            f"/api/projects/{project['id']}/cover",
            files={"file": ("doc.svg", io.BytesIO(b"<svg/>"), "image/svg+xml")},
        )
        assert r.status_code == 400

    def test_upload_unknown_project_returns_404(self, client):
        r = client.post(
            "/api/projects/99999/cover",
            files={"file": _png_file()},
        )
        assert r.status_code == 404

    def test_delete_cover_returns_204(self, client, project):
        # Upload first
        client.post(
            f"/api/projects/{project['id']}/cover",
            files={"file": _png_file()},
        )
        r = client.delete(f"/api/projects/{project['id']}/cover")
        assert r.status_code == 204

    def test_delete_cover_unknown_project_returns_404(self, client):
        assert client.delete("/api/projects/99999/cover").status_code == 404

    def test_upload_replaces_existing(self, client, project):
        client.post(
            f"/api/projects/{project['id']}/cover",
            files={"file": _png_file("first.png")},
        )
        r = client.post(
            f"/api/projects/{project['id']}/cover",
            files={"file": _png_file("second.png")},
        )
        assert r.status_code == 200
        assert "cover_image" in r.json()


# ── Codex entry image ─────────────────────────────────────────────────────────

class TestCodexImage:
    def test_upload_image_returns_path(self, client, codex_entry):
        r = client.post(
            f"/api/codex/{codex_entry['id']}/image",
            files={"file": _png_file()},
        )
        assert r.status_code == 200
        assert "image_path" in r.json()
        assert r.json()["image_path"].endswith(".png")

    def test_upload_svg_returns_400(self, client, codex_entry):
        r = client.post(
            f"/api/codex/{codex_entry['id']}/image",
            files={"file": ("icon.svg", io.BytesIO(b"<svg/>"), "image/svg+xml")},
        )
        assert r.status_code == 400

    def test_upload_unknown_entry_returns_404(self, client):
        r = client.post(
            "/api/codex/99999/image",
            files={"file": _png_file()},
        )
        assert r.status_code == 404

    def test_delete_image_returns_204(self, client, codex_entry):
        client.post(
            f"/api/codex/{codex_entry['id']}/image",
            files={"file": _png_file()},
        )
        r = client.delete(f"/api/codex/{codex_entry['id']}/image")
        assert r.status_code == 204

    def test_delete_image_unknown_entry_returns_404(self, client):
        assert client.delete("/api/codex/99999/image").status_code == 404


# ── Scene inline image ────────────────────────────────────────────────────────

class TestSceneImage:
    def test_upload_scene_image_returns_src(self, client, scene):
        r = client.post(
            f"/api/scenes/{scene['id']}/images",
            files={"file": _png_file()},
        )
        assert r.status_code == 200
        assert "src" in r.json()
        assert r.json()["src"].endswith(".png")

    def test_upload_svg_returns_400(self, client, scene):
        r = client.post(
            f"/api/scenes/{scene['id']}/images",
            files={"file": ("icon.svg", io.BytesIO(b"<svg/>"), "image/svg+xml")},
        )
        assert r.status_code == 400

    def test_upload_unknown_scene_returns_404(self, client):
        r = client.post(
            "/api/scenes/99999/images",
            files={"file": _png_file()},
        )
        assert r.status_code == 404


# ── Research media ────────────────────────────────────────────────────────────

class TestResearchMedia:
    def test_upload_media_returns_metadata(self, client, research_item):
        r = client.post(
            f"/api/research/{research_item.id}/media",
            files={"file": _png_file()},
        )
        assert r.status_code == 200
        body = r.json()
        assert "id" in body
        assert body["kind"] == "image"
        assert body["path"].endswith(".png")
        assert body["order_index"] == 0

    def test_upload_pdf_accepted(self, client, research_item):
        r = client.post(
            f"/api/research/{research_item.id}/media",
            files={"file": ("doc.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
        )
        assert r.status_code == 200
        assert r.json()["kind"] == "pdf"

    def test_upload_svg_rejected(self, client, research_item):
        r = client.post(
            f"/api/research/{research_item.id}/media",
            files={"file": ("icon.svg", io.BytesIO(b"<svg/>"), "image/svg+xml")},
        )
        assert r.status_code == 400

    def test_upload_unknown_item_returns_404(self, client):
        r = client.post(
            "/api/research/99999/media",
            files={"file": _png_file()},
        )
        assert r.status_code == 404

    def test_upload_increments_order(self, client, research_item):
        first = client.post(
            f"/api/research/{research_item.id}/media",
            files={"file": _png_file()},
        ).json()
        second = client.post(
            f"/api/research/{research_item.id}/media",
            files={"file": _png_file()},
        ).json()
        assert second["order_index"] == first["order_index"] + 1

    def test_delete_media_returns_204(self, client, research_item):
        media = client.post(
            f"/api/research/{research_item.id}/media",
            files={"file": _png_file()},
        ).json()
        r = client.delete(f"/api/research/media/{media['id']}")
        assert r.status_code == 204

    def test_delete_unknown_media_returns_404(self, client):
        assert client.delete("/api/research/media/99999").status_code == 404
