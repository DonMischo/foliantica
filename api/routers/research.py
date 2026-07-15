"""
Research panel — per-project clippings (URL, text, image) linkable to scenes or codex entries.
"""
import json
import re
from typing import Optional
from datetime import datetime, UTC

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from database import get_db
from models import Project, ResearchItem
from schemas import ResearchItemCreate, ResearchItemUpdate, ResearchItemOut

router = APIRouter(prefix="/api", tags=["research"])


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


# ── URL metadata scraping ─────────────────────────────────────────────────────

async def _fetch_url_meta(url: str) -> dict:
    """Attempt to scrape <title>, og:description, og:image from a URL.
    Returns a dict with keys: url_title, url_description, url_image.
    Falls back gracefully if httpx is not installed or the request fails."""
    try:
        import httpx  # optional dependency — graceful no-op if absent
        async with httpx.AsyncClient(timeout=5, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Foliantica/1.0 (research-clipping)"})
            html = resp.text
    except ImportError:
        return {}  # httpx not installed
    except Exception:
        return {}

    def _meta(name: str) -> Optional[str]:
        m = re.search(
            rf'<meta[^>]+(?:property|name)=["\']og:{name}["\'][^>]+content=["\']([^"\']+)["\']',
            html, re.IGNORECASE,
        ) or re.search(
            rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']og:{name}["\']',
            html, re.IGNORECASE,
        )
        return m.group(1).strip() if m else None

    title_match = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
    title = _meta("title") or (title_match.group(1).strip() if title_match else None)

    return {
        "url_title":       title,
        "url_description": _meta("description"),
        "url_image":       _meta("image"),
    }


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/research", response_model=list[ResearchItemOut])
def list_research(project_id: int, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return db.query(ResearchItem)\
             .options(selectinload(ResearchItem.media))\
             .filter_by(project_id=project_id)\
             .order_by(ResearchItem.created_at.desc()).all()


@router.post("/projects/{project_id}/research", response_model=ResearchItemOut, status_code=201)
async def create_research(project_id: int, data: ResearchItemCreate, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    url_meta: dict = {}
    if data.url:
        url_meta = await _fetch_url_meta(data.url)

    item = ResearchItem(
        project_id=project_id,
        tab=data.tab,
        title=data.title,
        url=data.url,
        url_title=url_meta.get("url_title"),
        url_description=url_meta.get("url_description"),
        url_image=url_meta.get("url_image"),
        text_content=data.text_content,
        linked_scene_id=data.linked_scene_id,
        linked_codex_id=data.linked_codex_id,
        tags=json.dumps(data.tags),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    # Eagerly load media so Pydantic can serialise it after the session flushes.
    db.query(ResearchItem).options(selectinload(ResearchItem.media)).filter_by(id=item.id).one()
    return item


@router.patch("/research/{item_id}", response_model=ResearchItemOut)
async def update_research(item_id: int, data: ResearchItemUpdate, db: Session = Depends(get_db)):
    item = db.get(ResearchItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Research item not found")

    fs = data.model_fields_set
    if "tab" in fs and data.tab is not None:
        item.tab = data.tab
    if "title" in fs:
        item.title = data.title
    if "url" in fs and data.url is not None:
        item.url = data.url
        # Re-fetch metadata when URL changes
        url_meta = await _fetch_url_meta(data.url)
        item.url_title       = url_meta.get("url_title")
        item.url_description = url_meta.get("url_description")
        item.url_image       = url_meta.get("url_image")
    if "text_content" in fs:
        item.text_content = data.text_content
    # linked_scene_id / linked_codex_id use model_fields_set so callers can
    # explicitly set null (unlink) — a plain None default would be ignored otherwise.
    if "linked_scene_id" in fs:
        item.linked_scene_id = data.linked_scene_id
    if "linked_codex_id" in fs:
        item.linked_codex_id = data.linked_codex_id
    if "tags" in fs and data.tags is not None:
        item.tags = json.dumps(data.tags)

    item.updated_at = _now()
    db.commit()
    db.refresh(item)
    return item


@router.delete("/research/{item_id}", status_code=204)
def delete_research(item_id: int, db: Session = Depends(get_db)):
    item = db.get(ResearchItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Research item not found")
    db.delete(item)
    db.commit()


@router.post("/research/{item_id}/fetch-url", response_model=ResearchItemOut)
async def refetch_url(item_id: int, db: Session = Depends(get_db)):
    """Re-fetch URL metadata for an existing clipping."""
    item = db.get(ResearchItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Research item not found")
    if not item.url:
        raise HTTPException(status_code=400, detail="Item has no URL")

    url_meta = await _fetch_url_meta(item.url)
    item.url_title       = url_meta.get("url_title")
    item.url_description = url_meta.get("url_description")
    item.url_image       = url_meta.get("url_image")
    item.updated_at = _now()
    db.commit()
    db.refresh(item)
    return item
