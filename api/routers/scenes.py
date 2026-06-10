import re
import json
import hashlib
from datetime import datetime, UTC
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from models import Chapter, Scene, SceneVersion, MentionStat, CodexEntry, WritingLog
from schemas import SceneCreate, SceneOut, SceneUpdate, ReorderRequest, SceneVersionOut, SceneVersionDetail, CreateVersionRequest, MentionStatOut


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


# ── Mention scanning ──────────────────────────────────────────────────────────

def _scan_mentions(content: str, entries: list[CodexEntry]) -> dict[int, int]:
    """Return {codex_id: count} for every entry that appears in content."""
    plain = re.sub(r"<[^>]+>", "", content or "")
    counts: dict[int, int] = {}
    for entry in entries:
        names = [entry.name] + (json.loads(entry.aliases or "[]") if entry.aliases else [])
        names = [n for n in names if n]
        if not names:
            continue
        pattern = r"\b(?:" + "|".join(re.escape(n) for n in names) + r")\b"
        c = len(re.findall(pattern, plain, re.IGNORECASE))
        if c:
            counts[entry.id] = c
    return counts


def _get_project_id(scene_id: int, db: Session) -> int | None:
    """Resolve scene → project_id via the chapter/act chain."""
    row = db.execute(
        text("""
            SELECT a.project_id FROM scenes s
            JOIN chapters c ON c.id = s.chapter_id
            JOIN acts a     ON a.id = c.act_id
            WHERE s.id = :sid
        """),
        {"sid": scene_id},
    ).first()
    return row[0] if row else None


def _log_writing(project_id: int, delta: int, db: Session) -> None:
    """Add word delta to today's writing_log entry (insert-or-update)."""
    if delta <= 0:
        return
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    row = db.query(WritingLog).filter_by(project_id=project_id, date=today).first()
    if row:
        row.words_added += delta
    else:
        db.add(WritingLog(project_id=project_id, date=today, words_added=delta))
    db.flush()


def _update_mention_stats(
    scene_id: int,
    content: str,
    db: Session,
    project_id: int | None = None,
    entries: list[CodexEntry] | None = None,
) -> None:
    """Rescan a scene and upsert mention_stats rows. Called after every content save.

    Pass ``project_id`` and/or ``entries`` when already known to avoid redundant queries.
    """
    if project_id is None:
        project_id = _get_project_id(scene_id, db)
    if project_id is None:
        return

    if entries is None:
        entries = db.query(CodexEntry).filter(CodexEntry.project_id == project_id).all()

    counts = _scan_mentions(content, entries)

    # Replace all existing stats for this scene
    db.query(MentionStat).filter(MentionStat.scene_id == scene_id).delete()
    for codex_id, count in counts.items():
        db.add(MentionStat(scene_id=scene_id, codex_id=codex_id, count=count))
    db.flush()

router = APIRouter(tags=["scenes"])


def _auto_title(content: str) -> str:
    text = re.sub(r"<[^>]+>", "", content or "").strip()
    return text[:50] if text else "Untitled Scene"


def _count_words(content: str) -> int:
    text = re.sub(r"<[^>]+>", "", content or "")
    return len(text.split())


@router.get("/api/chapters/{chapter_id}/scenes", response_model=list[SceneOut])
def list_scenes(chapter_id: int, db: Session = Depends(get_db)):
    if not db.get(Chapter, chapter_id):
        raise HTTPException(404, "Chapter not found")
    return db.query(Scene).filter(Scene.chapter_id == chapter_id).order_by(Scene.order_index).all()


@router.post("/api/scenes", response_model=SceneOut, status_code=201)
def create_scene(body: SceneCreate, db: Session = Depends(get_db)):
    if not db.get(Chapter, body.chapter_id):
        raise HTTPException(404, "Chapter not found")
    data = body.model_dump()
    if not data.get("title") and data.get("content"):
        data["title"] = _auto_title(data["content"])
    data["word_count"] = _count_words(data.get("content", ""))
    scene = Scene(**data)
    db.add(scene)
    db.flush()  # gives scene.id before commit so mention scan can reference it
    _update_mention_stats(scene.id, data.get("content") or "", db)
    db.commit()
    db.refresh(scene)
    return scene


@router.get("/api/scenes/{scene_id}", response_model=SceneOut)
def get_scene(scene_id: int, db: Session = Depends(get_db)):
    scene = db.get(Scene, scene_id)
    if not scene:
        raise HTTPException(404, "Scene not found")
    return scene


@router.patch("/api/scenes/{scene_id}", response_model=SceneOut)
def update_scene(scene_id: int, body: SceneUpdate, db: Session = Depends(get_db)):
    scene = db.get(Scene, scene_id)
    if not scene:
        raise HTTPException(404, "Scene not found")
    data = body.model_dump(exclude_none=True)
    if "content" in data:
        if not scene.title and not body.title:
            scene.title = _auto_title(data["content"])
        new_wc = _count_words(data["content"])
        wc_delta = new_wc - (scene.word_count or 0)
        data["word_count"] = new_wc
    else:
        wc_delta = 0
    # Handle scene_time separately — None means "clear it", so bypass exclude_none
    if "scene_time" in body.model_fields_set:
        st = body.scene_time
        data["scene_time"] = json.dumps(st) if st is not None else None
    # These fields are intentionally nullable: an explicit null means "clear the
    # value" — e.g. move a scene back to the main plot, or remove it from the
    # corkboard canvas (node_x/node_y) or a stack. exclude_none above drops them,
    # so restore any the client explicitly set (including to null).
    _NULLABLE_FIELDS = (
        "subplot", "pov_character_id", "beat", "scene_type",
        "synopsis", "global_order", "stack_group", "node_x", "node_y",
    )
    for field in _NULLABLE_FIELDS:
        if field in body.model_fields_set:
            data[field] = getattr(body, field)
    # Validate cross-chapter move
    if "chapter_id" in data and not db.get(Chapter, data["chapter_id"]):
        raise HTTPException(404, f"Chapter {data['chapter_id']} not found")
    for k, v in data.items():
        setattr(scene, k, v)
    if "content" in data:
        project_id = _get_project_id(scene_id, db)
        if project_id:
            _log_writing(project_id, wc_delta, db)
        # Pass project_id so _update_mention_stats skips the redundant lookup
        _update_mention_stats(scene_id, data["content"], db, project_id=project_id)
    db.commit()
    db.refresh(scene)
    return scene


@router.delete("/api/scenes/{scene_id}", status_code=204)
def delete_scene(scene_id: int, db: Session = Depends(get_db)):
    scene = db.get(Scene, scene_id)
    if not scene:
        raise HTTPException(404, "Scene not found")
    db.delete(scene)
    db.commit()


@router.post("/api/scenes/reorder", status_code=204)
def reorder_scenes(body: ReorderRequest, db: Session = Depends(get_db)):
    for item in body.items:
        scene = db.get(Scene, item.id)
        if scene:
            scene.order_index = item.order_index
    db.commit()


# ── Scene Versions ────────────────────────────────────────────────────────────

def _prune_versions(scene_id: int, db: Session) -> None:
    """Keep the 30 most recent versions; delete the rest.

    The previous implementation also purged anything older than 30 days *before*
    the hard-cap, which could delete a version that was among the 30 newest
    simply because it was old — violating the "keep the 30 most recent" contract
    and losing history for users who snapshot in bursts then pause. The hard-cap
    alone bounds storage while always retaining the newest 30.
    """
    versions = (
        db.query(SceneVersion)
        .filter(SceneVersion.scene_id == scene_id)
        .order_by(SceneVersion.created_at.desc())
        .all()
    )
    if len(versions) <= 30:
        return
    for v in versions[30:]:  # newest-first, so [30:] are the oldest beyond the cap
        db.delete(v)
    db.flush()


@router.post("/api/scenes/{scene_id}/versions", status_code=201)
def create_scene_version(scene_id: int, body: CreateVersionRequest, db: Session = Depends(get_db)):
    """Snapshot current scene content. Skips if content is identical to latest version."""
    scene = db.get(Scene, scene_id)
    if not scene:
        raise HTTPException(404, "Scene not found")

    content = body.content or ""
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

    # Dedup: skip if latest snapshot has same content
    latest = (
        db.query(SceneVersion)
        .filter(SceneVersion.scene_id == scene_id)
        .order_by(SceneVersion.created_at.desc())
        .first()
    )
    if latest and latest.content_hash == content_hash:
        return SceneVersionOut.model_validate(latest)

    version = SceneVersion(scene_id=scene_id, content=content, content_hash=content_hash)
    db.add(version)
    db.flush()
    _prune_versions(scene_id, db)
    db.commit()
    db.refresh(version)
    return SceneVersionOut.model_validate(version)


@router.get("/api/scenes/{scene_id}/versions", response_model=list[SceneVersionOut])
def list_scene_versions(scene_id: int, db: Session = Depends(get_db)):
    return (
        db.query(SceneVersion)
        .filter(SceneVersion.scene_id == scene_id)
        .order_by(SceneVersion.created_at.desc())
        .all()
    )


@router.get("/api/scenes/{scene_id}/versions/{version_id}", response_model=SceneVersionDetail)
def get_scene_version(scene_id: int, version_id: int, db: Session = Depends(get_db)):
    v = db.query(SceneVersion).filter(
        SceneVersion.id == version_id,
        SceneVersion.scene_id == scene_id,
    ).first()
    if not v:
        raise HTTPException(404, "Version not found")
    return v


@router.post("/api/scenes/{scene_id}/versions/{version_id}/restore", response_model=SceneVersionDetail)
def restore_scene_version(scene_id: int, version_id: int, db: Session = Depends(get_db)):
    """Snapshot current content, then restore the given version."""
    scene = db.get(Scene, scene_id)
    if not scene:
        raise HTTPException(404, "Scene not found")
    target = db.query(SceneVersion).filter(
        SceneVersion.id == version_id,
        SceneVersion.scene_id == scene_id,
    ).first()
    if not target:
        raise HTTPException(404, "Version not found")

    # Snapshot current content before overwriting (with dedup)
    current_hash = hashlib.sha256((scene.content or "").encode("utf-8")).hexdigest()
    latest = (
        db.query(SceneVersion)
        .filter(SceneVersion.scene_id == scene_id)
        .order_by(SceneVersion.created_at.desc())
        .first()
    )
    if not latest or latest.content_hash != current_hash:
        snap = SceneVersion(scene_id=scene_id, content=scene.content or "", content_hash=current_hash)
        db.add(snap)
        db.flush()
        _prune_versions(scene_id, db)

    # Restore
    scene.content = target.content
    db.commit()
    db.refresh(target)
    return target


# ── Mention stats endpoints ───────────────────────────────────────────────────

@router.get("/api/scenes/{scene_id}/mention-stats", response_model=list[MentionStatOut])
def get_scene_mention_stats(scene_id: int, db: Session = Depends(get_db)):
    """Return mention counts for every codex entry in this scene."""
    rows = db.query(MentionStat).filter(MentionStat.scene_id == scene_id).all()
    return [MentionStatOut(codex_id=r.codex_id, scene_id=r.scene_id, count=r.count) for r in rows]


@router.get("/api/projects/{project_id}/mention-stats", response_model=list[MentionStatOut])
def get_project_mention_stats(project_id: int, db: Session = Depends(get_db)):
    """Return aggregated mention counts across all scenes for a project."""
    rows = db.execute(
        text("""
            SELECT ms.codex_id, SUM(ms.count) AS total
            FROM mention_stats ms
            JOIN scenes s   ON s.id  = ms.scene_id
            JOIN chapters c ON c.id  = s.chapter_id
            JOIN acts a     ON a.id  = c.act_id
            WHERE a.project_id = :pid
            GROUP BY ms.codex_id
            ORDER BY total DESC
        """),
        {"pid": project_id},
    ).fetchall()
    return [MentionStatOut(codex_id=r[0], scene_id=None, count=r[1]) for r in rows]


@router.post("/api/projects/{project_id}/mentions/rescan")
def rescan_project_mentions(project_id: int, db: Session = Depends(get_db)):
    """Rebuild mention_stats for every scene in the project.
    Safe to call at any time — replaces all existing stats for affected scenes."""
    # Load codex entries once for the whole project (not once per scene)
    entries = db.query(CodexEntry).filter(CodexEntry.project_id == project_id).all()
    rows = db.execute(
        text("""
            SELECT s.id, s.content
            FROM scenes s
            JOIN chapters c ON c.id = s.chapter_id
            JOIN acts     a ON a.id = c.act_id
            WHERE a.project_id = :pid
        """),
        {"pid": project_id},
    ).fetchall()
    for scene_id, content in rows:
        _update_mention_stats(
            scene_id, content or "", db,
            project_id=project_id, entries=entries,
        )
    db.commit()
    return {"scanned": len(rows)}


# ── Writing log endpoints ─────────────────────────────────────────────────────

@router.get("/api/projects/{project_id}/writing-log")
def get_project_writing_log(project_id: int, db: Session = Depends(get_db)):
    """Return all writing-log entries for a project (for per-project heatmap)."""
    rows = db.query(WritingLog).filter_by(project_id=project_id).order_by(WritingLog.date).all()
    return [{"date": r.date, "words": r.words_added} for r in rows]


@router.get("/api/writing-log")
def get_global_writing_log(db: Session = Depends(get_db)):
    """Return daily word totals aggregated across all projects."""
    rows = db.execute(
        text("SELECT date, SUM(words_added) FROM writing_log GROUP BY date ORDER BY date")
    ).fetchall()
    return [{"date": r[0], "words": r[1]} for r in rows]


# ── Ghost text scanner ────────────────────────────────────────────────────────

@router.get("/api/projects/{project_id}/ghost-texts")
def get_project_ghost_texts(project_id: int, db: Session = Depends(get_db)):
    """Return scenes that contain ghost-text placeholders (data-ghost spans)."""
    rows = db.execute(
        text("""
            SELECT s.id, COALESCE(s.title, 'Untitled Scene') AS scene_title,
                   s.content, a.title AS act_title, c.title AS chapter_title
            FROM scenes s
            JOIN chapters c ON c.id = s.chapter_id
            JOIN acts     a ON a.id = c.act_id
            WHERE a.project_id = :pid AND s.content LIKE '%data-ghost%'
        """),
        {"pid": project_id},
    ).fetchall()

    import re as _re
    ghost_pat = _re.compile(r'<span[^>]+data-ghost[^>]*>([^<]*)</span>')
    result = []
    for scene_id, scene_title, content, act_title, chapter_title in rows:
        texts = ghost_pat.findall(content or "")
        if texts:
            result.append({
                "scene_id": scene_id,
                "scene_title": scene_title,
                "act_title": act_title,
                "chapter_title": chapter_title,
                "ghost_texts": texts,
            })
    return result
