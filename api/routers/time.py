import json as _json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Project, Scene, TimelineTrack, TimelineEvent
from schemas import (
    TimeConfig, TimeConfigOut, DEFAULT_TIME_UNITS, DEFAULT_DAY_NIGHT,
    TimelineTrackCreate, TimelineTrackUpdate, TimelineTrackOut,
    TimelineEventCreate, TimelineEventUpdate, TimelineEventOut,
)

router = APIRouter(tags=["time"])


def _get_or_default(project: Project) -> TimeConfig:
    if project.time_config:
        try:
            data = _json.loads(project.time_config)
            return TimeConfig(**data)
        except Exception:
            pass
    return TimeConfig()


@router.get("/api/projects/{project_id}/time-config", response_model=TimeConfigOut)
def get_time_config(project_id: int, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return _get_or_default(project)


@router.patch("/api/projects/{project_id}/time-config", response_model=TimeConfigOut)
def update_time_config(project_id: int, body: TimeConfig, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    project.time_config = body.model_dump_json()
    db.commit()
    return body


def _sibling_project_ids(project: Project, db: Session) -> list[int]:
    """Return all project IDs sharing the same codex (owner + all its sharers)."""
    owner_id = project.shared_codex_project_id or project.id
    sharers = db.query(Project.id).filter(Project.shared_codex_project_id == owner_id).all()
    return list({owner_id} | {row.id for row in sharers})


@router.get("/api/projects/{project_id}/timeline")
def get_timeline(project_id: int, db: Session = Depends(get_db)):
    project = (
        db.query(Project)
        .filter(Project.id == project_id)
        .first()
    )
    if not project:
        raise HTTPException(404, "Project not found")

    config = _get_or_default(project)
    enabled_units = [u for u in config.units if u.enabled]

    # Determine which projects to scan (self only, or full shared-codex family)
    sibling_ids = _sibling_project_ids(project, db)
    is_shared = len(sibling_ids) > 1
    projects_to_scan: list[Project] = []
    for pid in sibling_ids:
        p = db.get(Project, pid)
        if p:
            projects_to_scan.append(p)

    # Collect all scenes with scene_time set, in story order across all sibling projects
    entries = []
    for proj in projects_to_scan:
        for act in sorted(proj.acts, key=lambda a: a.order_index):
            for chapter in sorted(act.chapters, key=lambda c: c.order_index):
                for scene in sorted(chapter.scenes, key=lambda s: s.order_index):
                    if not scene.scene_time:
                        continue
                    try:
                        time_data = json.loads(scene.scene_time)
                    except Exception:
                        continue

                    sort_key = [time_data.get(u.id, 0) for u in enabled_units]

                    parts = []
                    for u in enabled_units:
                        val = time_data.get(u.id)
                        if val is None:
                            continue
                        if u.value_names and 1 <= val <= len(u.value_names):
                            parts.append(u.value_names[val - 1])
                        else:
                            parts.append(f"{u.singular} {val}")
                    time_display = ", ".join(parts) if parts else "—"

                    hour_unit = next((u for u in enabled_units if u.id == "hour"), None)
                    hour_val = time_data.get("hour")
                    day_night_label = None
                    if hour_unit and hour_val is not None:
                        dn = config.day_night
                        night_end = (dn.night_start_hour + dn.night_duration) % dn.hours_per_day
                        if dn.night_start_hour < night_end:
                            is_night = dn.night_start_hour <= hour_val < night_end
                        else:
                            is_night = hour_val >= dn.night_start_hour or hour_val < night_end
                        day_night_label = "Night" if is_night else "Day"

                    entry = {
                        "scene_id":      scene.id,
                        "scene_title":   scene.title or "Untitled Scene",
                        "act_title":     act.title,
                        "chapter_title": chapter.title,
                        "scene_time":    time_data,
                        "time_display":  time_display,
                        "day_night":     day_night_label,
                        "sort_key":      sort_key,
                    }
                    if is_shared:
                        entry["project_id"]    = proj.id
                        entry["project_title"] = proj.title
                    entries.append(entry)

    entries.sort(key=lambda e: e["sort_key"])

    return {
        "config":    config.model_dump(),
        "entries":   entries,
        "is_shared": is_shared,
    }


# ── Timeline Tracks ───────────────────────────────────────────────────────────

@router.get("/api/projects/{project_id}/timeline-tracks", response_model=list[TimelineTrackOut])
def list_tracks(project_id: int, db: Session = Depends(get_db)):
    return [_track_out(t) for t in db.query(TimelineTrack).filter_by(project_id=project_id).order_by(TimelineTrack.order_index).all()]

@router.post("/api/projects/{project_id}/timeline-tracks", response_model=TimelineTrackOut)
def create_track(project_id: int, body: TimelineTrackCreate, db: Session = Depends(get_db)):
    t = TimelineTrack(
        project_id=project_id,
        name=body.name, color=body.color, track_type=body.track_type,
        order_index=body.order_index,
        start_time=_json.dumps(body.start_time) if body.start_time else None,
        end_time=_json.dumps(body.end_time)   if body.end_time   else None,
    )
    db.add(t); db.commit(); db.refresh(t)
    return _track_out(t)

@router.patch("/api/projects/{project_id}/timeline-tracks/{track_id}", response_model=TimelineTrackOut)
def update_track(project_id: int, track_id: int, body: TimelineTrackUpdate, db: Session = Depends(get_db)):
    t = db.get(TimelineTrack, track_id)
    if not t or t.project_id != project_id:
        raise HTTPException(404)
    if body.name        is not None: t.name       = body.name
    if body.color       is not None: t.color      = body.color
    if body.track_type  is not None: t.track_type = body.track_type
    if body.order_index is not None: t.order_index= body.order_index
    if "start_time" in body.model_fields_set:
        t.start_time = _json.dumps(body.start_time) if body.start_time else None
    if "end_time"   in body.model_fields_set:
        t.end_time   = _json.dumps(body.end_time)   if body.end_time   else None
    db.commit(); db.refresh(t)
    return _track_out(t)

@router.delete("/api/projects/{project_id}/timeline-tracks/{track_id}", status_code=204)
def delete_track(project_id: int, track_id: int, db: Session = Depends(get_db)):
    t = db.get(TimelineTrack, track_id)
    if not t or t.project_id != project_id:
        raise HTTPException(404)
    db.delete(t); db.commit()

def _track_out(t: TimelineTrack) -> dict:
    return {
        "id": t.id, "project_id": t.project_id, "name": t.name, "color": t.color,
        "track_type": t.track_type, "order_index": t.order_index,
        "start_time": _json.loads(t.start_time) if t.start_time else None,
        "end_time":   _json.loads(t.end_time)   if t.end_time   else None,
    }

# ── Timeline Events ───────────────────────────────────────────────────────────

@router.get("/api/projects/{project_id}/timeline-events", response_model=list[TimelineEventOut])
def list_events(project_id: int, db: Session = Depends(get_db)):
    return [_event_out(e) for e in db.query(TimelineEvent).filter_by(project_id=project_id).all()]

@router.post("/api/projects/{project_id}/timeline-events", response_model=TimelineEventOut)
def create_event(project_id: int, body: TimelineEventCreate, db: Session = Depends(get_db)):
    e = TimelineEvent(
        project_id=project_id, track_id=body.track_id, title=body.title,
        description=body.description, color=body.color,
        scene_time=_json.dumps(body.scene_time) if body.scene_time else None,
    )
    db.add(e); db.commit(); db.refresh(e)
    return _event_out(e)

@router.patch("/api/projects/{project_id}/timeline-events/{event_id}", response_model=TimelineEventOut)
def update_event(project_id: int, event_id: int, body: TimelineEventUpdate, db: Session = Depends(get_db)):
    e = db.get(TimelineEvent, event_id)
    if not e or e.project_id != project_id:
        raise HTTPException(404)
    if body.track_id    is not None: e.track_id    = body.track_id
    if body.title       is not None: e.title       = body.title
    if body.description is not None: e.description = body.description
    if body.color       is not None: e.color       = body.color
    if "scene_time" in body.model_fields_set:
        e.scene_time = _json.dumps(body.scene_time) if body.scene_time else None
    db.commit(); db.refresh(e)
    return _event_out(e)

@router.delete("/api/projects/{project_id}/timeline-events/{event_id}", status_code=204)
def delete_event(project_id: int, event_id: int, db: Session = Depends(get_db)):
    e = db.get(TimelineEvent, event_id)
    if not e or e.project_id != project_id:
        raise HTTPException(404)
    db.delete(e); db.commit()

def _event_out(e: TimelineEvent) -> dict:
    return {
        "id": e.id, "project_id": e.project_id, "track_id": e.track_id,
        "title": e.title, "description": e.description, "color": e.color,
        "scene_time": _json.loads(e.scene_time) if e.scene_time else None,
    }

# ── Timeline V2 ───────────────────────────────────────────────────────────────

@router.get("/api/projects/{project_id}/timeline-v2")
def get_timeline_v2(project_id: int, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404)
    config = _get_or_default(project)
    enabled_units = [u for u in config.units if u.enabled]

    def make_sort_key(time_data: dict) -> list[int]:
        return [time_data.get(u.id, 0) for u in enabled_units]

    def make_display(time_data: dict) -> str:
        parts = []
        for u in enabled_units:
            val = time_data.get(u.id)
            if val is None: continue
            if u.value_names and 1 <= val <= len(u.value_names):
                parts.append(u.value_names[val - 1])
            else:
                parts.append(f"{u.singular} {val}")
        return ", ".join(parts) if parts else "—"

    def day_night_label(time_data: dict):
        hour_unit = next((u for u in enabled_units if u.id == "hour"), None)
        if not hour_unit: return None
        val = time_data.get("hour")
        if val is None: return None
        dn = config.day_night
        night_end = (dn.night_start_hour + dn.night_duration) % dn.hours_per_day
        if dn.night_start_hour < night_end:
            is_night = dn.night_start_hour <= val < night_end
        else:
            is_night = val >= dn.night_start_hour or val < night_end
        return "Night" if is_night else "Day"

    sibling_ids = _sibling_project_ids(project, db)
    story_nodes = []
    for pid in sibling_ids:
        p = db.get(Project, pid)
        if not p: continue
        for act in sorted(p.acts, key=lambda a: a.order_index):
            for chapter in sorted(act.chapters, key=lambda c: c.order_index):
                for scene in sorted(chapter.scenes, key=lambda s: s.order_index):
                    if not scene.scene_time: continue
                    try:
                        td = _json.loads(scene.scene_time)
                    except Exception:
                        continue
                    story_nodes.append({
                        "id": f"scene-{scene.id}",
                        "type": "scene",
                        "scene_id": scene.id,
                        "title": scene.title or "Untitled Scene",
                        "time_display": make_display(td),
                        "sort_key": make_sort_key(td),
                        "day_night": day_night_label(td),
                        "act_title": act.title,
                        "chapter_title": chapter.title,
                        "subplot": scene.subplot,
                    })

    story_nodes.sort(key=lambda n: n["sort_key"])

    tracks = db.query(TimelineTrack).filter_by(project_id=project_id).order_by(TimelineTrack.order_index).all()
    events = db.query(TimelineEvent).filter_by(project_id=project_id).all()

    event_nodes = []
    for e in events:
        td = _json.loads(e.scene_time) if e.scene_time else {}
        event_nodes.append({
            "id": f"event-{e.id}",
            "type": "event",
            "event_id": e.id,
            "track_id": e.track_id,
            "title": e.title,
            "description": e.description,
            "time_display": make_display(td) if td else "—",
            "sort_key": make_sort_key(td) if td else [],
            "day_night": day_night_label(td) if td else None,
            "color": e.color,
        })

    # Collect all subplot names: project-defined list + any scene-assigned values
    subplot_names: set[str] = set()
    try:
        subplot_names.update(_json.loads(project.subplot_names or "[]"))
    except Exception:
        pass
    for pid in sibling_ids:
        p = db.get(Project, pid)
        if not p: continue
        for act in p.acts:
            for chapter in act.chapters:
                for scene in chapter.scenes:
                    if scene.subplot:
                        subplot_names.add(scene.subplot)

    return {
        "config":             config.model_dump(),
        "tracks":             [_track_out(t) for t in tracks],
        "story_nodes":        story_nodes,
        "event_nodes":        event_nodes,
        "available_subplots": sorted(subplot_names),
    }
