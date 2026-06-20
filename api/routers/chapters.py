from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session, selectinload

from database import get_db
from models import Act, Chapter, Scene
from schemas import ChapterCreate, ChapterOut, ChapterUpdate, ReorderRequest

router = APIRouter(tags=["chapters"])


@router.get("/api/acts/{act_id}/chapters", response_model=list[ChapterOut])
def list_chapters(act_id: int, request: Request, db: Session = Depends(get_db)):
    if not db.get(Act, act_id):
        raise HTTPException(404, "Act not found")
    chapters = db.query(Chapter).filter(Chapter.act_id == act_id).order_by(Chapter.order_index).all()

    if getattr(request.state, "collab_hide_unassigned", False):
        allowed = set(getattr(request.state, "collab_assigned_scene_ids", []))
        if allowed:
            visible_chapter_ids = {
                row[0] for row in (
                    db.query(Chapter.id)
                    .join(Scene, Scene.chapter_id == Chapter.id)
                    .filter(Chapter.act_id == act_id, Scene.id.in_(allowed))
                    .all()
                )
            }
            chapters = [c for c in chapters if c.id in visible_chapter_ids]
        else:
            chapters = []

    return chapters


@router.post("/api/chapters", response_model=ChapterOut, status_code=201)
def create_chapter(body: ChapterCreate, db: Session = Depends(get_db)):
    if not db.get(Act, body.act_id):
        raise HTTPException(404, "Act not found")
    chapter = Chapter(**body.model_dump())
    db.add(chapter)
    db.commit()
    db.refresh(chapter)
    return chapter


@router.patch("/api/chapters/{chapter_id}", response_model=ChapterOut)
def update_chapter(chapter_id: int, body: ChapterUpdate, db: Session = Depends(get_db)):
    chapter = db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(404, "Chapter not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(chapter, k, v)
    db.commit()
    db.refresh(chapter)
    return chapter


@router.delete("/api/chapters/{chapter_id}", status_code=204)
def delete_chapter(chapter_id: int, db: Session = Depends(get_db)):
    chapter = db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(404, "Chapter not found")
    db.delete(chapter)
    db.commit()


@router.post("/api/chapters/reorder", status_code=204)
def reorder_chapters(body: ReorderRequest, db: Session = Depends(get_db)):
    for item in body.items:
        chapter = db.get(Chapter, item.id)
        if chapter:
            chapter.order_index = item.order_index
    db.commit()


# ── Flowing read view ─────────────────────────────────────────────────────────

@router.get("/api/chapters/{chapter_id}/read")
def read_chapter(chapter_id: int, db: Session = Depends(get_db)):
    """Return chapter with all its scenes for the flowing text view."""
    chapter = (
        db.query(Chapter)
        .options(selectinload(Chapter.scenes), selectinload(Chapter.act))
        .filter(Chapter.id == chapter_id)
        .first()
    )
    if not chapter:
        raise HTTPException(404, "Chapter not found")

    return {
        "id": chapter.id,
        "title": chapter.title,
        "act_id": chapter.act_id,
        "act_title": chapter.act.title,
        "scenes": [
            {"id": sc.id, "title": sc.title or "", "content": sc.content or ""}
            for sc in sorted(chapter.scenes, key=lambda s: s.order_index)
        ],
    }
