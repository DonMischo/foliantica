import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session, selectinload

from database import get_db
from models import Project, CodexEntry, CodexEntryAccess, CodexRelation, Act, Chapter, Scene, SceneConnection
from schemas import (
    ProjectCreate, ProjectOut, ProjectUpdate,
    SceneConnectionCreate, SceneConnectionOut, GlobalOrderRequest,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _project_to_out(p: Project, parent_title: Optional[str] = None) -> dict:
    """Serialize a Project ORM object to a dict suitable for ProjectOut.
    Handles book_meta JSON parsing and injects the parent codex project title."""
    book_meta = None
    if p.book_meta:
        try:
            book_meta = json.loads(p.book_meta)
        except Exception:
            pass
    return {
        "id": p.id,
        "title": p.title,
        "description": p.description,
        "book_meta": book_meta,
        "shared_codex_project_id": p.shared_codex_project_id,
        "shared_codex_project_title": parent_title,
        "cover_image": p.cover_image,
        "main_plot_color": p.main_plot_color,
        "plot_template": p.plot_template,
        "created_at": p.created_at,
        "updated_at": p.updated_at,
    }


@router.get("", response_model=list[ProjectOut])
def list_projects(request: Request, db: Session = Depends(get_db)):
    projects = db.query(Project).order_by(Project.updated_at.desc()).all()

    if getattr(request.state, "collab_hide_unassigned", False):
        allowed = set(getattr(request.state, "collab_assigned_scene_ids", []))
        if allowed:
            visible_project_ids = {
                row[0] for row in (
                    db.query(Project.id)
                    .join(Act, Act.project_id == Project.id)
                    .join(Chapter, Chapter.act_id == Act.id)
                    .join(Scene, Scene.chapter_id == Chapter.id)
                    .filter(Scene.id.in_(allowed))
                    .all()
                )
            }
            projects = [p for p in projects if p.id in visible_project_ids]
        else:
            projects = []

    parent_ids = {p.shared_codex_project_id for p in projects if p.shared_codex_project_id}
    parent_map: dict[int, str] = {}
    if parent_ids:
        for parent in db.query(Project).filter(Project.id.in_(parent_ids)).all():
            parent_map[parent.id] = parent.title
    return [_project_to_out(p, parent_map.get(p.shared_codex_project_id)) for p in projects]


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectCreate, db: Session = Depends(get_db)):
    data = body.model_dump(exclude={"copy_codex_from", "share_codex_from"})
    project = Project(**data)

    copy_id  = body.copy_codex_from
    share_id = body.share_codex_from

    if share_id:
        # Live-share: point to the canonical codex owner
        source = db.get(Project, share_id)
        if not source:
            raise HTTPException(404, f"Source project {share_id} not found")
        # Follow chain: if source is itself sharing, point to its owner
        owner_id = source.shared_codex_project_id or source.id
        project.shared_codex_project_id = owner_id
        # Inherit time config from codex owner
        owner = db.get(Project, owner_id)
        if owner and owner.time_config:
            project.time_config = owner.time_config
        db.add(project)
        db.flush()  # gives project.id

        # Auto-add this new project to entries that have share_future=1 and share_mode='specific'
        future_entries = (
            db.query(CodexEntry)
            .filter(
                CodexEntry.project_id == owner_id,
                CodexEntry.share_mode == "specific",
                CodexEntry.share_future == 1,
            )
            .all()
        )
        for entry in future_entries:
            existing = db.query(CodexEntryAccess).filter_by(
                entry_id=entry.id, project_id=project.id
            ).first()
            if not existing:
                db.add(CodexEntryAccess(entry_id=entry.id, project_id=project.id))

        db.commit()
        db.refresh(project)
        parent_title = None
        if project.shared_codex_project_id:
            parent = db.get(Project, project.shared_codex_project_id)
            parent_title = parent.title if parent else None
        return _project_to_out(project, parent_title)

    if copy_id:
        source = db.get(Project, copy_id)
        if not source:
            raise HTTPException(404, f"Source project {copy_id} not found")
        if source.time_config:
            project.time_config = source.time_config

    db.add(project)
    db.flush()  # assign project.id without committing — keep the copy atomic

    # Deep-copy codex entries + relations from source project. Done in the SAME
    # transaction as the project insert so a failure mid-copy rolls back the
    # whole thing instead of leaving an orphaned empty project behind.
    if copy_id:
        # Resolve to actual codex owner in case source is sharing
        actual_copy_id = source.shared_codex_project_id or copy_id  # type: ignore[possibly-undefined]
        source_entries = (
            db.query(CodexEntry)
            .filter(CodexEntry.project_id == actual_copy_id)
            .all()
        )
        old_to_new: dict[int, int] = {}
        for src in source_entries:
            new_entry = CodexEntry(
                project_id=project.id,
                name=src.name,
                aliases=src.aliases,
                entry_type=src.entry_type,
                description=src.description,
                notes=src.notes,
                color=src.color,
                species=src.species,
                subtype=src.subtype,
                tags=src.tags,
                is_main_char=src.is_main_char,
                inventory=src.inventory,
            )
            new_entry.set_groups(src.get_groups())
            db.add(new_entry)
            db.flush()
            old_to_new[src.id] = new_entry.id

        source_relations = (
            db.query(CodexRelation)
            .filter(
                CodexRelation.source_id.in_(old_to_new.keys()),
                CodexRelation.target_id.in_(old_to_new.keys()),
            )
            .all()
        )
        for rel in source_relations:
            new_rel = CodexRelation(
                source_id=old_to_new[rel.source_id],
                target_id=old_to_new[rel.target_id],
                relation_type=rel.relation_type,
            )
            db.add(new_rel)

    db.commit()
    db.refresh(project)
    return _project_to_out(project, None)


@router.get("/series")
def get_series(db: Session = Depends(get_db)):
    """Return all projects grouped by series name, ordered by series_index.
    Projects without a series appear in a separate 'unserialized' list."""
    projects = db.query(Project).order_by(Project.title).all()

    series_map: dict[str, list[dict]] = {}
    unserialized: list[dict] = []

    for p in projects:
        meta: dict = {}
        if p.book_meta:
            try:
                meta = json.loads(p.book_meta)
            except Exception:
                pass
        series_name   = meta.get("series")
        series_index  = meta.get("series_index")
        series_role   = meta.get("series_role")

        book = {
            "id":                      p.id,
            "title":                   p.title,
            "description":             p.description,
            "series_index":            series_index,
            "series_role":             series_role,
            "cover_image":             p.cover_image,
            "shared_codex_project_id": p.shared_codex_project_id,
            "updated_at":              p.updated_at.isoformat() if p.updated_at else None,
        }

        if series_name:
            series_map.setdefault(series_name, []).append(book)
        else:
            unserialized.append(book)

    def _sort_key(b: dict):
        idx = b.get("series_index")
        if idx is None:
            return (1, float("inf"))
        try:
            return (0, float(idx))
        except (TypeError, ValueError):
            return (1, float("inf"))

    result = []
    for name, books in sorted(series_map.items()):
        books.sort(key=_sort_key)
        result.append({"name": name, "books": books})

    return {"series": result, "unserialized": unserialized}


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    parent_title = None
    if project.shared_codex_project_id:
        parent = db.get(Project, project.shared_codex_project_id)
        parent_title = parent.title if parent else None
    return _project_to_out(project, parent_title)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(project_id: int, body: ProjectUpdate, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    data = body.model_dump(exclude_none=True)
    # Serialize nested model to JSON string for TEXT column
    if "book_meta" in data:
        data["book_meta"] = json.dumps(data["book_meta"])
    for k, v in data.items():
        setattr(project, k, v)
    db.commit()
    db.refresh(project)
    parent_title = None
    if project.shared_codex_project_id:
        parent = db.get(Project, project.shared_codex_project_id)
        parent_title = parent.title if parent else None
    return _project_to_out(project, parent_title)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    # Block deletion if other projects live-share this project's codex
    sharers = db.query(Project).filter(Project.shared_codex_project_id == project_id).count()
    if sharers > 0:
        raise HTTPException(
            409,
            f"Cannot delete: {sharers} other project(s) share this project's codex. "
            "Remove the sharing link from those projects first."
        )
    db.delete(project)
    db.commit()


@router.get("/{project_id}/corkboard")
def get_corkboard(project_id: int, db: Session = Depends(get_db)):
    """
    Flat list of all project scenes with corkboard fields.
    Auto-assigns global_order to scenes that don't have one yet,
    using act/chapter/order_index to determine chronological sequence.
    """
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    acts = (
        db.query(Act)
        .filter(Act.project_id == project_id)
        .options(selectinload(Act.chapters).selectinload(Chapter.scenes))
        .order_by(Act.order_index)
        .all()
    )

    # Collect all scenes in chronological order
    all_scenes: list[Scene] = []
    for act in sorted(acts, key=lambda a: a.order_index):
        for ch in sorted(act.chapters, key=lambda c: c.order_index):
            for s in sorted(ch.scenes, key=lambda sc: sc.order_index):
                all_scenes.append(s)

    # Auto-assign global_order if not yet set (first load)
    needs_commit = False
    for i, s in enumerate(all_scenes):
        if s.global_order is None:
            s.global_order = i * 100
            needs_commit = True
    if needs_commit:
        db.commit()

    # Collect unique subplots: project-defined names first, then any scene-assigned ones
    seen: dict[str, None] = {}
    try:
        for name in json.loads(project.subplot_names or "[]"):
            if name:
                seen[name] = None
    except Exception:
        pass
    for s in sorted(all_scenes, key=lambda sc: sc.global_order or 0):
        if s.subplot:
            seen[s.subplot] = None
    subplots = list(seen.keys())

    connections = (
        db.query(SceneConnection)
        .filter(SceneConnection.project_id == project_id)
        .all()
    )

    try:
        prefs = json.loads(project.corkboard_prefs or "{}")
    except Exception:
        prefs = {}

    return {
        "scenes": [
            {
                "id": s.id,
                "title": s.title,
                "synopsis": s.synopsis,
                "word_count": s.word_count,
                "subplot": s.subplot,
                "global_order": s.global_order,
                "stack_group": s.stack_group,
                "chapter_id": s.chapter_id,
                "node_x": s.node_x,
                "node_y": s.node_y,
                "pov_character_id": getattr(s, "pov_character_id", None),
                "beat": getattr(s, "beat", None),
                "card_color": getattr(s, "card_color", None),
            }
            for s in sorted(all_scenes, key=lambda sc: sc.global_order or 0)
        ],
        "subplots": subplots,
        "connections": [
            {
                "id": c.id,
                "source_scene_id": c.source_scene_id,
                "target_scene_id": c.target_scene_id,
                "connection_type": c.connection_type,
                "label": c.label,
            }
            for c in connections
        ],
        "prefs": prefs,
    }


@router.patch("/{project_id}/corkboard-prefs")
def update_corkboard_prefs(project_id: int, body: dict, db: Session = Depends(get_db)):
    """Replace the per-project corkboard view preferences (layout, colors, …)."""
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    project.corkboard_prefs = json.dumps(body)
    db.commit()
    return body


@router.post("/{project_id}/connections", response_model=SceneConnectionOut, status_code=201)
def create_scene_connection(project_id: int, body: SceneConnectionCreate, db: Session = Depends(get_db)):
    """Create a typed cable between two scenes of this project."""
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    if body.source_scene_id == body.target_scene_id:
        raise HTTPException(400, "Cannot connect a scene to itself")

    # Both scenes must belong to this project (no cross-project cables)
    for sid in (body.source_scene_id, body.target_scene_id):
        scene = db.get(Scene, sid)
        if not scene or scene.chapter.act.project_id != project_id:
            raise HTTPException(404, f"Scene {sid} not found in project")

    existing = (
        db.query(SceneConnection)
        .filter(
            SceneConnection.source_scene_id == body.source_scene_id,
            SceneConnection.target_scene_id == body.target_scene_id,
            SceneConnection.connection_type == body.connection_type,
        )
        .first()
    )
    if existing:
        return existing

    conn = SceneConnection(
        project_id=project_id,
        source_scene_id=body.source_scene_id,
        target_scene_id=body.target_scene_id,
        connection_type=body.connection_type,
        label=body.label,
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)
    return conn


@router.delete("/{project_id}/connections/{connection_id}", status_code=204)
def delete_scene_connection(project_id: int, connection_id: int, db: Session = Depends(get_db)):
    conn = db.get(SceneConnection, connection_id)
    if not conn or conn.project_id != project_id:
        raise HTTPException(404, "Connection not found")
    db.delete(conn)
    db.commit()


@router.post("/{project_id}/corkboard/global-order", status_code=204)
def set_global_order(project_id: int, body: GlobalOrderRequest, db: Session = Depends(get_db)):
    """Bulk-set scenes.global_order — used by cable reordering and its undo."""
    if not db.get(Project, project_id):
        raise HTTPException(404, "Project not found")
    scene_ids = [item.id for item in body.items]
    scenes = (
        db.query(Scene)
        .join(Chapter, Scene.chapter_id == Chapter.id)
        .join(Act, Chapter.act_id == Act.id)
        .filter(Scene.id.in_(scene_ids), Act.project_id == project_id)
        .all()
    )
    by_id = {s.id: s for s in scenes}
    for item in body.items:
        scene = by_id.get(item.id)
        if scene:
            scene.global_order = item.global_order
    db.commit()


@router.patch("/{project_id}/subplot-names", response_model=list[str])
def set_subplot_names(project_id: int, body: dict, db: Session = Depends(get_db)):
    """Persist the ordered list of subplot column names for this project."""
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    names = [str(n) for n in body.get("names", []) if n]
    project.subplot_names = json.dumps(names)
    db.commit()
    return names


@router.get("/{project_id}/structure")
def get_project_structure(project_id: int, db: Session = Depends(get_db)):
    """Acts → chapters → scenes hierarchy with synopsis, for the corkboard."""
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    acts = (
        db.query(Act)
        .filter(Act.project_id == project_id)
        .options(selectinload(Act.chapters).selectinload(Chapter.scenes))
        .order_by(Act.order_index)
        .all()
    )
    result = []
    for act in acts:
        chapters = sorted(act.chapters, key=lambda c: c.order_index)
        act_data = {
            "id": act.id,
            "title": act.title,
            "order_index": act.order_index,
            "chapters": [],
        }
        for ch in chapters:
            scenes = sorted(ch.scenes, key=lambda s: s.order_index)
            act_data["chapters"].append({
                "id": ch.id,
                "title": ch.title,
                "order_index": ch.order_index,
                "scenes": [
                    {
                        "id": s.id,
                        "title": s.title,
                        "synopsis": s.synopsis,
                        "word_count": s.word_count,
                        "order_index": s.order_index,
                    }
                    for s in scenes
                ],
            })
        result.append(act_data)
    return result


@router.get("/{project_id}/scenes")
def list_project_scenes(project_id: int, db: Session = Depends(get_db)):
    """Flat list of all scenes in a project, ordered by act/chapter/scene position."""
    acts = (
        db.query(Act)
        .filter(Act.project_id == project_id)
        .options(selectinload(Act.chapters).selectinload(Chapter.scenes))
        .order_by(Act.order_index)
        .all()
    )
    result = []
    for act in acts:
        chapters = sorted(act.chapters, key=lambda c: c.order_index)
        for chapter in chapters:
            scenes = sorted(chapter.scenes, key=lambda s: s.order_index)
            for scene in scenes:
                result.append({
                    "id": scene.id,
                    "title": scene.title or "Untitled Scene",
                    "chapter_title": chapter.title,
                    "act_title": act.title,
                })
    return result


@router.post("/{project_id}/codex-sharing/detach", response_model=ProjectOut)
def detach_codex_sharing(project_id: int, db: Session = Depends(get_db)):
    """Break the live-share link: copy all parent codex entries to this project, then clear the FK."""
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    if not project.shared_codex_project_id:
        raise HTTPException(400, "This project does not share a codex")

    parent_id = project.shared_codex_project_id
    source_entries = db.query(CodexEntry).filter(CodexEntry.project_id == parent_id).all()

    old_to_new: dict[int, int] = {}
    for src in source_entries:
        new_entry = CodexEntry(
            project_id=project_id,
            name=src.name,
            aliases=src.aliases,
            entry_type=src.entry_type,
            description=src.description,
            notes=src.notes,
            color=src.color,
            species=src.species,
            subtype=src.subtype,
            tags=src.tags,
            is_main_char=src.is_main_char,
            inventory=src.inventory,
        )
        new_entry.set_groups(src.get_groups())
        db.add(new_entry)
        db.flush()
        old_to_new[src.id] = new_entry.id

    # Copy relations
    source_relations = db.query(CodexRelation).filter(
        CodexRelation.source_id.in_(old_to_new.keys()),
        CodexRelation.target_id.in_(old_to_new.keys()),
    ).all()
    for rel in source_relations:
        db.add(CodexRelation(
            source_id=old_to_new[rel.source_id],
            target_id=old_to_new[rel.target_id],
            relation_type=rel.relation_type,
        ))

    project.shared_codex_project_id = None
    db.commit()
    db.refresh(project)
    return _project_to_out(project, None)


@router.get("/{project_id}/pov-stats")
def get_pov_stats(project_id: int, db: Session = Depends(get_db)):
    """Return POV character distribution: scene counts per pov_character_id."""
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    acts = (
        db.query(Act)
        .filter(Act.project_id == project_id)
        .options(selectinload(Act.chapters).selectinload(Chapter.scenes))
        .order_by(Act.order_index)
        .all()
    )
    all_scenes: list[Scene] = []
    for act in sorted(acts, key=lambda a: a.order_index):
        for ch in sorted(act.chapters, key=lambda c: c.order_index):
            for s in sorted(ch.scenes, key=lambda sc: sc.order_index):
                all_scenes.append(s)

    total = len(all_scenes)
    counts: dict[Optional[int], int] = {}
    for s in all_scenes:
        key = getattr(s, "pov_character_id", None)
        counts[key] = counts.get(key, 0) + 1

    # Resolve character names/colors from the canonical codex owner
    char_ids = {k for k in counts if k is not None}
    chars: dict[int, CodexEntry] = {}
    if char_ids:
        owner_id = project.shared_codex_project_id or project.id
        for entry in db.query(CodexEntry).filter(
            CodexEntry.project_id == owner_id,
            CodexEntry.id.in_(char_ids),
        ).all():
            chars[entry.id] = entry

    stats = []
    for char_id, count in sorted(counts.items(), key=lambda x: -(x[1])):
        if char_id is None:
            stats.append({"pov_character_id": None, "name": "No POV", "color": "#6b7280", "count": count})
        else:
            entry = chars.get(char_id)
            stats.append({
                "pov_character_id": char_id,
                "name": entry.name if entry else f"Unknown #{char_id}",
                "color": entry.color if entry else "#6b7280",
                "count": count,
            })

    return {"stats": stats, "total_scenes": total}
