import os
import shutil
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from database import get_db
from models import Project, CodexEntry, Scene, ResearchItem, ResearchMedia

router = APIRouter(tags=["images"])

UPLOAD_DIR = "uploads"
# Any image/* is accepted except SVG (can embed scripts).
# Extension is derived from MIME type; unknown types fall back to .jpg.
_MIME_TO_EXT: dict[str, str] = {
    "image/jpeg":    ".jpg",
    "image/jpg":     ".jpg",
    "image/png":     ".png",
    "image/webp":    ".webp",
    "image/gif":     ".gif",
    "image/avif":    ".avif",
    "image/heic":    ".heic",
    "image/heif":    ".heif",
    "image/bmp":     ".bmp",
    "image/tiff":    ".tiff",
    "application/pdf": ".pdf",
}


def _is_allowed_image(content_type: str | None) -> bool:
    ct = (content_type or "").lower()
    return ct.startswith("image/") and ct != "image/svg+xml"


def _save_upload(file: UploadFile, subdir: str, stem: str) -> str:
    """Save uploaded file and return the relative path stored in DB."""
    ext = _MIME_TO_EXT.get(file.content_type or "", ".jpg")
    dest_dir = os.path.join(UPLOAD_DIR, subdir)
    os.makedirs(dest_dir, exist_ok=True)
    rel_path = f"{UPLOAD_DIR}/{subdir}/{stem}{ext}"
    with open(rel_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return rel_path


def _delete_file(path: str) -> None:
    if path and os.path.exists(path):
        os.remove(path)


# ── Project cover ─────────────────────────────────────────────────────────────

@router.post("/api/projects/{project_id}/cover")
def upload_project_cover(
    project_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    if not _is_allowed_image(file.content_type):
        raise HTTPException(400, "Unsupported file type. Please upload an image (JPG, PNG, WebP, GIF, AVIF, …).")
    _delete_file(project.cover_image or "")
    project.cover_image = _save_upload(file, f"projects/{project_id}", "cover")
    db.commit()
    return {"cover_image": project.cover_image}


@router.delete("/api/projects/{project_id}/cover", status_code=204)
def delete_project_cover(project_id: int, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    _delete_file(project.cover_image or "")
    project.cover_image = None
    db.commit()


# ── Codex entry image ─────────────────────────────────────────────────────────

@router.post("/api/codex/{entry_id}/image")
def upload_codex_image(
    entry_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    entry = db.get(CodexEntry, entry_id)
    if not entry:
        raise HTTPException(404, "Codex entry not found")
    if not _is_allowed_image(file.content_type):
        raise HTTPException(400, "Unsupported file type. Please upload an image (JPG, PNG, WebP, GIF, AVIF, …).")
    _delete_file(entry.image_path or "")
    entry.image_path = _save_upload(file, f"codex/{entry_id}", "image")
    db.commit()
    return {"image_path": entry.image_path}


@router.delete("/api/codex/{entry_id}/image", status_code=204)
def delete_codex_image(entry_id: int, db: Session = Depends(get_db)):
    entry = db.get(CodexEntry, entry_id)
    if not entry:
        raise HTTPException(404, "Codex entry not found")
    _delete_file(entry.image_path or "")
    entry.image_path = None
    db.commit()


# ── Research item media (gallery — multiple images and/or PDFs per item) ──────

@router.post("/api/research/{item_id}/media")
def upload_research_media(
    item_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Append one image or PDF to a research item's media gallery."""
    item = db.get(ResearchItem, item_id)
    if not item:
        raise HTTPException(404, "Research item not found")

    ct = (file.content_type or "").lower()
    if ct == "application/pdf":
        kind = "pdf"
    elif ct.startswith("image/") and ct != "image/svg+xml":
        kind = "image"
    else:
        raise HTTPException(400, "Only images (JPG, PNG, WebP, GIF, …) and PDFs are supported.")

    # Append order: place after the last existing media item
    max_order = db.query(ResearchMedia)\
        .filter_by(research_item_id=item_id)\
        .count()

    stem = uuid.uuid4().hex[:12]
    path = _save_upload(file, f"research/{item_id}", stem)

    media = ResearchMedia(
        research_item_id=item_id,
        kind=kind,
        path=path,
        order_index=max_order,
    )
    db.add(media)
    db.commit()
    db.refresh(media)
    return {"id": media.id, "kind": media.kind, "path": media.path, "order_index": media.order_index}


@router.delete("/api/research/media/{media_id}", status_code=204)
def delete_research_media(media_id: int, db: Session = Depends(get_db)):
    """Delete one specific media item from a research clipping."""
    media = db.get(ResearchMedia, media_id)
    if not media:
        raise HTTPException(404, "Media not found")
    _delete_file(media.path)
    db.delete(media)
    db.commit()


# ── Scene inline images (illustrated novel) ───────────────────────────────────

@router.post("/api/scenes/{scene_id}/images")
def upload_scene_image(
    scene_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Upload an inline illustration image for use inside scene text."""
    scene = db.get(Scene, scene_id)
    if not scene:
        raise HTTPException(404, "Scene not found")
    if not _is_allowed_image(file.content_type):
        raise HTTPException(400, "Unsupported file type. Please upload an image (JPG, PNG, WebP, GIF, AVIF, …).")
    stem = uuid.uuid4().hex[:12]
    rel_path = _save_upload(file, f"scenes/{scene_id}", stem)
    return {"src": rel_path}
