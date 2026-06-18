from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session, selectinload

from database import get_db
from models import Act, Project, Chapter, Scene
from schemas import ActCreate, ActOut, ActUpdate, ReorderRequest

router = APIRouter(tags=["acts"])


@router.get("/api/projects/{project_id}/acts", response_model=list[ActOut])
def list_acts(project_id: int, request: Request, db: Session = Depends(get_db)):
    if not db.get(Project, project_id):
        raise HTTPException(404, "Project not found")
    acts = db.query(Act).filter(Act.project_id == project_id).order_by(Act.order_index).all()

    if getattr(request.state, "collab_hide_unassigned", False):
        allowed = set(getattr(request.state, "collab_assigned_scene_ids", []))
        if allowed:
            visible_act_ids = {
                row[0] for row in (
                    db.query(Act.id)
                    .join(Chapter, Chapter.act_id == Act.id)
                    .join(Scene, Scene.chapter_id == Chapter.id)
                    .filter(Act.project_id == project_id, Scene.id.in_(allowed))
                    .all()
                )
            }
            acts = [a for a in acts if a.id in visible_act_ids]
        else:
            acts = []

    return acts


@router.post("/api/acts", response_model=ActOut, status_code=201)
def create_act(body: ActCreate, db: Session = Depends(get_db)):
    if not db.get(Project, body.project_id):
        raise HTTPException(404, "Project not found")
    act = Act(**body.model_dump())
    db.add(act)
    db.commit()
    db.refresh(act)
    return act


@router.patch("/api/acts/{act_id}", response_model=ActOut)
def update_act(act_id: int, body: ActUpdate, db: Session = Depends(get_db)):
    act = db.get(Act, act_id)
    if not act:
        raise HTTPException(404, "Act not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(act, k, v)
    db.commit()
    db.refresh(act)
    return act


@router.delete("/api/acts/{act_id}", status_code=204)
def delete_act(act_id: int, db: Session = Depends(get_db)):
    act = db.get(Act, act_id)
    if not act:
        raise HTTPException(404, "Act not found")
    db.delete(act)
    db.commit()


@router.post("/api/acts/reorder", status_code=204)
def reorder_acts(body: ReorderRequest, db: Session = Depends(get_db)):
    for item in body.items:
        act = db.get(Act, item.id)
        if act:
            act.order_index = item.order_index
    db.commit()


# ── Flowing read view ─────────────────────────────────────────────────────────

@router.get("/api/acts/{act_id}/read")
def read_act(act_id: int, db: Session = Depends(get_db)):
    """Return act with all chapters and their scenes for the flowing text view."""
    act = (
        db.query(Act)
        .options(selectinload(Act.chapters).selectinload(Chapter.scenes))
        .filter(Act.id == act_id)
        .first()
    )
    if not act:
        raise HTTPException(404, "Act not found")

    return {
        "id": act.id,
        "title": act.title,
        "chapters": [
            {
                "id": ch.id,
                "title": ch.title,
                "scenes": [
                    {"id": sc.id, "title": sc.title or "", "content": sc.content or ""}
                    for sc in sorted(ch.scenes, key=lambda s: s.order_index)
                ],
            }
            for ch in sorted(act.chapters, key=lambda c: c.order_index)
        ],
    }
