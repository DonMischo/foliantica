import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import text, func

from database import get_db
from models import CodexEntry, CodexEntryAccess, CodexRelation, Project
from schemas import (
    CodexEntryCreate, CodexEntryOut, CodexEntryUpdate,
    CodexRelationCreate, CodexRelationOut,
)

router = APIRouter(tags=["codex"])


def _codex_owner_id(project: Project) -> int:
    """Return the project_id whose codex entries to use (follows sharing link)."""
    return project.shared_codex_project_id or project.id


@router.get("/api/projects/{project_id}/codex", response_model=list[CodexEntryOut])
def list_codex(project_id: int, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    owner_id = _codex_owner_id(project)
    entries = db.query(CodexEntry).filter(CodexEntry.project_id == owner_id).all()

    # If the requesting project IS the owner, no share filtering needed
    if project_id == owner_id:
        return [CodexEntryOut.from_orm_entry(e) for e in entries]

    # For a consumer project, filter by share_mode
    # Batch-load entry_ids that this project has specific access to
    access_rows = db.query(CodexEntryAccess).filter(
        CodexEntryAccess.project_id == project_id,
        CodexEntryAccess.entry_id.in_([e.id for e in entries]),
    ).all()
    accessible_ids = {r.entry_id for r in access_rows}

    result = []
    for e in entries:
        mode = getattr(e, "share_mode", "all") or "all"
        if mode == "all":
            result.append(e)
        elif mode == "specific" and e.id in accessible_ids:
            result.append(e)
        # mode == "none" → skip
    return [CodexEntryOut.from_orm_entry(e) for e in result]


@router.get("/api/codex")
def list_codex_collections(db: Session = Depends(get_db)):
    """Return every codex in the DB (one row per canonical owner project),
    with its entry count and the other projects currently linked to it."""
    projects = db.query(Project).all()

    # Group projects by canonical codex owner (self, unless live-sharing another project's codex)
    members_by_owner: dict[int, list[Project]] = {}
    for p in projects:
        owner_id = p.shared_codex_project_id or p.id
        members_by_owner.setdefault(owner_id, []).append(p)

    entry_counts: dict[int, int] = {}
    for owner_id, count in db.query(CodexEntry.project_id, func.count(CodexEntry.id)).group_by(CodexEntry.project_id).all():
        entry_counts[owner_id] = count

    by_id = {p.id: p for p in projects}
    result = []
    for owner_id, members in members_by_owner.items():
        owner = by_id.get(owner_id)
        if not owner:
            continue
        count = entry_counts.get(owner_id, 0)
        linked = [{"id": m.id, "title": m.title} for m in members if m.id != owner_id]
        if count == 0 and not linked:
            continue  # nothing to show: standalone project with an empty codex
        result.append({
            "owner": {"id": owner.id, "title": owner.title},
            "entry_count": count,
            "linked_projects": linked,
        })
    return result


@router.post("/api/projects/{project_id}/codex-sharing/attach")
def attach_codex_sharing(project_id: int, body: dict, db: Session = Depends(get_db)):
    """Link a project to another project's codex (live-share). Rejects if the
    project already owns codex entries of its own — detach/delete those first."""
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    owner_id = int(body.get("owner_id"))
    owner = db.get(Project, owner_id)
    if not owner:
        raise HTTPException(404, "Target codex owner not found")
    own_entries = db.query(CodexEntry).filter(CodexEntry.project_id == project_id).count()
    if own_entries > 0:
        raise HTTPException(409, "This project already has its own codex entries. Delete or move them first.")

    canonical_owner_id = owner.shared_codex_project_id or owner.id
    project.shared_codex_project_id = canonical_owner_id

    # Auto-add this project to entries that have share_future=1 and share_mode='specific'
    future_entries = (
        db.query(CodexEntry)
        .filter(
            CodexEntry.project_id == canonical_owner_id,
            CodexEntry.share_mode == "specific",
            CodexEntry.share_future == 1,
        )
        .all()
    )
    for entry in future_entries:
        existing = db.query(CodexEntryAccess).filter_by(entry_id=entry.id, project_id=project_id).first()
        if not existing:
            db.add(CodexEntryAccess(entry_id=entry.id, project_id=project_id))

    db.commit()
    return {"shared_codex_project_id": canonical_owner_id}


@router.delete("/api/projects/{project_id}/codex", status_code=204)
def delete_codex_collection(project_id: int, db: Session = Depends(get_db)):
    """Delete every codex entry owned by this project (the whole codex)."""
    db.query(CodexEntry).filter(CodexEntry.project_id == project_id).delete()
    db.commit()


@router.post("/api/codex", response_model=CodexEntryOut, status_code=201)
def create_codex_entry(body: CodexEntryCreate, db: Session = Depends(get_db)):
    project = db.get(Project, body.project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    data = body.model_dump()
    data["project_id"] = _codex_owner_id(project)  # redirect writes to owner
    aliases   = data.pop("aliases", [])
    tags      = data.pop("tags", [])
    groups    = data.pop("groups", [])
    inventory = data.pop("inventory", None)
    data.pop("is_main_char", None)  # handled via setattr below
    is_main_char = body.is_main_char
    data.pop("entry_group", None)  # not a schema field; set via set_groups
    entry = CodexEntry(**data)
    entry.set_aliases(aliases)
    entry.set_tags(tags)
    entry.set_groups(groups)
    entry.is_main_char = int(is_main_char)
    if inventory is not None:
        entry.inventory = json.dumps(inventory)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return CodexEntryOut.from_orm_entry(entry)


@router.get("/api/codex/{entry_id}", response_model=CodexEntryOut)
def get_codex_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.get(CodexEntry, entry_id)
    if not entry:
        raise HTTPException(404, "Codex entry not found")
    return CodexEntryOut.from_orm_entry(entry)


@router.patch("/api/codex/{entry_id}", response_model=CodexEntryOut)
def update_codex_entry(entry_id: int, body: CodexEntryUpdate, db: Session = Depends(get_db)):
    entry = db.get(CodexEntry, entry_id)
    if not entry:
        raise HTTPException(404, "Codex entry not found")
    data = body.model_dump(exclude_none=True)
    if "aliases" in data:
        entry.set_aliases(data.pop("aliases"))
    if "tags" in data:
        entry.set_tags(data.pop("tags"))
    new_groups = data.pop("groups", None)
    if new_groups is not None:
        entry.set_groups(new_groups)
    if "inventory" in data:
        inv = data.pop("inventory")
        entry.inventory = json.dumps(inv) if inv is not None else None
    if "is_main_char" in data:
        entry.is_main_char = int(data.pop("is_main_char"))
    if "share_mode" in data:
        entry.share_mode = data.pop("share_mode") or "all"
    if "share_future" in data:
        entry.share_future = int(bool(data.pop("share_future")))
    for k, v in data.items():
        setattr(entry, k, v)

    # Auto-create codex entries for new species / group names (empty stubs)
    project_id = entry.project_id
    auto_create: list[tuple[str, str]] = []
    if body.species and body.species.strip():
        auto_create.append((body.species.strip(), "lore"))
    if new_groups:
        for g in new_groups:
            if g.strip():
                auto_create.append((g.strip(), "custom"))
    for aname, atype in auto_create:
        exists = db.query(CodexEntry).filter(
            CodexEntry.project_id == project_id,
            CodexEntry.name == aname,
        ).first()
        if not exists:
            stub = CodexEntry(project_id=project_id, name=aname, entry_type=atype)
            stub.set_aliases([])
            stub.set_tags([])
            stub.set_groups([])
            db.add(stub)

    db.commit()
    db.refresh(entry)
    return CodexEntryOut.from_orm_entry(entry)


@router.delete("/api/codex/{entry_id}", status_code=204)
def delete_codex_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.get(CodexEntry, entry_id)
    if not entry:
        raise HTTPException(404, "Codex entry not found")
    db.delete(entry)
    db.commit()


# ── Entry access (per-project sharing) ────────────────────────────────────────

@router.get("/api/codex/{entry_id}/access")
def get_entry_access(entry_id: int, db: Session = Depends(get_db)):
    """Return the list of project IDs that have explicit access to this entry."""
    if not db.get(CodexEntry, entry_id):
        raise HTTPException(404, "Codex entry not found")
    rows = db.query(CodexEntryAccess).filter(CodexEntryAccess.entry_id == entry_id).all()
    return {"project_ids": [r.project_id for r in rows]}


@router.put("/api/codex/{entry_id}/access")
def set_entry_access(entry_id: int, body: dict, db: Session = Depends(get_db)):
    """Replace the explicit access list for an entry (used with share_mode='specific')."""
    if not db.get(CodexEntry, entry_id):
        raise HTTPException(404, "Codex entry not found")
    project_ids: list[int] = [int(pid) for pid in body.get("project_ids", [])]
    db.query(CodexEntryAccess).filter(CodexEntryAccess.entry_id == entry_id).delete()
    for pid in project_ids:
        db.add(CodexEntryAccess(entry_id=entry_id, project_id=pid))
    db.commit()
    return {"project_ids": project_ids}


# ── Relations ─────────────────────────────────────────────────────────────────

@router.get("/api/codex/{entry_id}/relations")
def get_entry_relations(entry_id: int, db: Session = Depends(get_db)):
    """Return all relations for an entry (as source or target), with resolved names."""
    entry = (
        db.query(CodexEntry)
        .options(
            selectinload(CodexEntry.relations_from).selectinload(CodexRelation.target),
            selectinload(CodexEntry.relations_to).selectinload(CodexRelation.source),
        )
        .filter(CodexEntry.id == entry_id)
        .first()
    )
    if not entry:
        raise HTTPException(404, "Codex entry not found")

    result = []
    for rel in entry.relations_from:
        result.append({
            "id": rel.id,
            "source_id": rel.source_id,
            "target_id": rel.target_id,
            "other_id": rel.target_id,
            "other_name": rel.target.name,
            "other_color": rel.target.color,
            "other_type": rel.target.entry_type,
            "relation_type": rel.relation_type or "",
            "direction": "from",
        })
    for rel in entry.relations_to:
        result.append({
            "id": rel.id,
            "source_id": rel.source_id,
            "target_id": rel.target_id,
            "other_id": rel.source_id,
            "other_name": rel.source.name,
            "other_color": rel.source.color,
            "other_type": rel.source.entry_type,
            "relation_type": rel.relation_type or "",
            "direction": "to",
        })
    return result


@router.post("/api/codex/relations", response_model=CodexRelationOut, status_code=201)
def create_relation(body: CodexRelationCreate, db: Session = Depends(get_db)):
    if not db.get(CodexEntry, body.source_id):
        raise HTTPException(404, "Source entry not found")
    if not db.get(CodexEntry, body.target_id):
        raise HTTPException(404, "Target entry not found")
    # Prevent duplicates
    existing = (
        db.query(CodexRelation)
        .filter(CodexRelation.source_id == body.source_id, CodexRelation.target_id == body.target_id)
        .first()
    )
    if existing:
        existing.relation_type = body.relation_type
        db.commit()
        db.refresh(existing)
        return existing
    rel = CodexRelation(**body.model_dump())
    db.add(rel)
    db.commit()
    db.refresh(rel)
    return rel


@router.delete("/api/codex/relations/{relation_id}", status_code=204)
def delete_relation(relation_id: int, db: Session = Depends(get_db)):
    rel = db.get(CodexRelation, relation_id)
    if not rel:
        raise HTTPException(404, "Relation not found")
    db.delete(rel)
    db.commit()


@router.get("/api/codex/{entry_id}/scene-mentions")
def get_entry_scene_mentions(entry_id: int, db: Session = Depends(get_db)):
    """Return all scenes that mention this codex entry, ordered by story position."""
    from sqlalchemy import text
    rows = db.execute(
        text("""
            SELECT ms.scene_id,
                   COALESCE(s.title, 'Untitled Scene') AS scene_title,
                   a.title  AS act_title,
                   c.title  AS chapter_title,
                   ms.count
            FROM mention_stats ms
            JOIN scenes   s ON s.id = ms.scene_id
            JOIN chapters c ON c.id = s.chapter_id
            JOIN acts     a ON a.id = c.act_id
            WHERE ms.codex_id = :eid AND ms.count > 0
            ORDER BY a.order_index, c.order_index, s.order_index
        """),
        {"eid": entry_id},
    ).fetchall()
    return [
        {
            "scene_id":     r[0],
            "scene_title":  r[1],
            "act_title":    r[2],
            "chapter_title": r[3],
            "count":        r[4],
        }
        for r in rows
    ]
