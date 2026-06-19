from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import Scene, SceneComment

router = APIRouter(prefix="/api", tags=["comments"])


class CommentIn(BaseModel):
    from_pos:    int
    to_pos:      int
    anchor_text: str
    ctx_before:  Optional[str] = None
    ctx_after:   Optional[str] = None
    body:        str
    color:       str = "#6366f1"


class CommentUpdate(BaseModel):
    body:     Optional[str]  = None
    resolved: Optional[bool] = None
    from_pos: Optional[int]  = None
    to_pos:   Optional[int]  = None


class PositionSync(BaseModel):
    id:       int
    from_pos: int
    to_pos:   int


class CommentOut(BaseModel):
    id:          int
    scene_id:    int
    from_pos:    int
    to_pos:      int
    anchor_text: str
    ctx_before:  Optional[str]
    ctx_after:   Optional[str]
    body:        str
    author_name: str
    author_role: str
    color:       str
    resolved:    bool
    created_at:  str

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm(cls, obj: SceneComment) -> "CommentOut":
        return cls(
            id=obj.id, scene_id=obj.scene_id,
            from_pos=obj.from_pos, to_pos=obj.to_pos,
            anchor_text=obj.anchor_text,
            ctx_before=obj.ctx_before, ctx_after=obj.ctx_after,
            body=obj.body, author_name=obj.author_name,
            author_role=obj.author_role, color=obj.color,
            resolved=bool(obj.resolved),
            created_at=obj.created_at.isoformat(),
        )


@router.get("/scenes/{scene_id}/comments", response_model=list[CommentOut])
def list_comments(scene_id: int, db: Session = Depends(get_db)):
    rows = db.query(SceneComment).filter(
        SceneComment.scene_id == scene_id
    ).order_by(SceneComment.created_at).all()
    return [CommentOut.from_orm(r) for r in rows]


@router.post("/scenes/{scene_id}/comments", response_model=CommentOut)
def create_comment(scene_id: int, body: CommentIn, request: Request, db: Session = Depends(get_db)):
    role = getattr(request.state, "collab_role", None)
    if role == "student":
        raise HTTPException(status_code=403, detail="Students cannot add comments.")
    if not db.get(Scene, scene_id):
        raise HTTPException(status_code=404, detail="Scene not found.")

    comment = SceneComment(
        scene_id=scene_id,
        from_pos=body.from_pos,
        to_pos=body.to_pos,
        anchor_text=body.anchor_text,
        ctx_before=body.ctx_before,
        ctx_after=body.ctx_after,
        body=body.body,
        author_name=getattr(request.state, "collab_display_name", "Host"),
        author_role=role or "host",
        color=body.color,
        resolved=0,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return CommentOut.from_orm(comment)


@router.patch("/comments/{comment_id}", response_model=CommentOut)
def update_comment(comment_id: int, body: CommentUpdate, request: Request, db: Session = Depends(get_db)):
    comment = db.get(SceneComment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found.")

    role        = getattr(request.state, "collab_role", None)
    author_name = getattr(request.state, "collab_display_name", "Host")
    is_host = role is None
    is_own  = comment.author_name == author_name

    if not (is_host or is_own):
        raise HTTPException(status_code=403, detail="Not your comment.")
    if body.resolved is not None and not is_host:
        raise HTTPException(status_code=403, detail="Only the host can resolve comments.")

    if body.body     is not None: comment.body     = body.body
    if body.resolved is not None: comment.resolved = 1 if body.resolved else 0
    if body.from_pos is not None: comment.from_pos = body.from_pos
    if body.to_pos   is not None: comment.to_pos   = body.to_pos

    db.commit()
    db.refresh(comment)
    return CommentOut.from_orm(comment)


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(comment_id: int, request: Request, db: Session = Depends(get_db)):
    comment = db.get(SceneComment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found.")

    role        = getattr(request.state, "collab_role", None)
    author_name = getattr(request.state, "collab_display_name", "Host")
    is_host = role is None
    is_own  = comment.author_name == author_name

    if not (is_host or is_own):
        raise HTTPException(status_code=403, detail="Not your comment.")

    db.delete(comment)
    db.commit()


@router.post("/scenes/{scene_id}/comments/sync-positions")
def sync_positions(scene_id: int, updates: list[PositionSync], request: Request, db: Session = Depends(get_db)):
    """Bulk-update from/to after host/coauthor edits (drift correction on save)."""
    role = getattr(request.state, "collab_role", None)
    if role in ("student", "editor"):
        raise HTTPException(status_code=403, detail="Not allowed.")

    for u in updates:
        c = db.get(SceneComment, u.id)
        if c and c.scene_id == scene_id:
            c.from_pos = u.from_pos
            c.to_pos   = u.to_pos
    db.commit()
    return {"ok": True}
