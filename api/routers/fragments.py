import json
import re
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from database import get_db
from models import Project, Fragment
from schemas import FragmentCreate, FragmentOut, FragmentUpdate, TabsUpdate, BUILTIN_TABS

router = APIRouter(tags=["fragments"])


def _get_custom_tabs(project: Project) -> list[str]:
    if project.fragment_tabs:
        try:
            return json.loads(project.fragment_tabs)
        except Exception:
            pass
    return []


RESEARCH_TAB = "research"


def _all_tabs(project: Project) -> list[str]:
    return BUILTIN_TABS + _get_custom_tabs(project)


def _valid_write_tabs(project: Project) -> list[str]:
    # "research" is the always-present clippings tab — not stored in fragment_tabs
    # (so it's excluded from _all_tabs, which backs the tab-listing endpoint),
    # but fragments can still be filed into it alongside clippings.
    return _all_tabs(project) + [RESEARCH_TAB]


# ── Tab management ────────────────────────────────────────────────────────────

@router.get("/api/projects/{project_id}/fragment-tabs")
def get_tabs(project_id: int, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return {
        "builtin": BUILTIN_TABS,
        "custom": _get_custom_tabs(project),
        "all": _all_tabs(project),
    }


@router.patch("/api/projects/{project_id}/fragment-tabs")
def update_tabs(project_id: int, body: TabsUpdate, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    # Normalise: strip blanks, deduplicate, exclude builtins
    custom = list(dict.fromkeys(
        t.strip() for t in body.custom_tabs
        if t.strip() and t.strip().lower() not in BUILTIN_TABS
    ))
    project.fragment_tabs = json.dumps(custom)
    db.commit()
    return {
        "builtin": BUILTIN_TABS,
        "custom": custom,
        "all": BUILTIN_TABS + custom,
    }


# ── Fragment CRUD ─────────────────────────────────────────────────────────────

@router.get("/api/projects/{project_id}/fragments", response_model=list[FragmentOut])
def list_fragments(project_id: int, tab: str | None = None, db: Session = Depends(get_db)):
    if not db.get(Project, project_id):
        raise HTTPException(404, "Project not found")
    q = db.query(Fragment).filter(Fragment.project_id == project_id)
    if tab:
        q = q.filter(Fragment.tab == tab)
    return q.order_by(Fragment.tab, Fragment.order_index, Fragment.created_at).all()


@router.post("/api/projects/{project_id}/fragments", response_model=FragmentOut, status_code=201)
def create_fragment(project_id: int, body: FragmentCreate, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    # Validate tab exists
    if body.tab not in _valid_write_tabs(project):
        raise HTTPException(400, f"Unknown tab '{body.tab}'")
    fragment = Fragment(project_id=project_id, **body.model_dump())
    db.add(fragment)
    db.commit()
    db.refresh(fragment)
    return fragment


@router.patch("/api/fragments/{fragment_id}", response_model=FragmentOut)
def update_fragment(fragment_id: int, body: FragmentUpdate, db: Session = Depends(get_db)):
    fragment = db.get(Fragment, fragment_id)
    if not fragment:
        raise HTTPException(404, "Fragment not found")
    if body.tab is not None:
        project = db.get(Project, fragment.project_id)
        if body.tab not in _valid_write_tabs(project):
            raise HTTPException(400, f"Unknown tab '{body.tab}'")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(fragment, k, v)
    db.commit()
    db.refresh(fragment)
    return fragment


@router.delete("/api/fragments/{fragment_id}", status_code=204)
def delete_fragment(fragment_id: int, db: Session = Depends(get_db)):
    fragment = db.get(Fragment, fragment_id)
    if not fragment:
        raise HTTPException(404, "Fragment not found")
    db.delete(fragment)
    db.commit()


# ── Import ─────────────────────────────────────────────────────────────────────

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)", re.DOTALL)
_KV_RE = re.compile(r"^(\w+)\s*:\s*(.*)$")


def _parse_snippet_file(raw: str) -> dict:
    """Parse a YAML-frontmatter snippet file.

    Returns a dict with keys: title (str|None), tab (str), content (str).
    Frontmatter keys recognised: title, tab, favourite (ignored but accepted).
    """
    m = _FRONTMATTER_RE.match(raw.strip())
    if not m:
        # No frontmatter — treat whole file as content, use filename as title later
        return {"title": None, "tab": "snippets", "content": raw.strip()}

    frontmatter_str, body = m.group(1), m.group(2).strip()

    meta: dict = {}
    for line in frontmatter_str.splitlines():
        kv = _KV_RE.match(line.strip())
        if kv:
            meta[kv.group(1).lower()] = kv.group(2).strip()

    return {
        "title": meta.get("title") or None,
        "tab":   meta.get("tab", "snippets").lower(),
        "content": body,
    }


@router.post("/api/projects/{project_id}/fragments/import")
async def import_fragments(
    project_id: int,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
):
    """Import one or more snippet files with YAML frontmatter.

    Accepts multiple files at once (single file or whole directory upload).
    """
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    valid_tabs = _all_tabs(project)
    created = skipped = 0

    for upload in files:
        if not upload.filename:
            skipped += 1
            continue

        raw = (await upload.read()).decode("utf-8", errors="replace")
        parsed = _parse_snippet_file(raw)

        # Fallback title: filename without extension
        if not parsed["title"]:
            stem = upload.filename.rsplit(".", 1)[0]
            parsed["title"] = stem if stem else None

        # Map unknown tabs to "snippets"
        tab = parsed["tab"] if parsed["tab"] in valid_tabs else "snippets"

        fragment = Fragment(
            project_id=project_id,
            tab=tab,
            title=parsed["title"],
            content=parsed["content"],
        )
        db.add(fragment)
        created += 1

    db.commit()
    return {
        "message": f"Imported {created} snippet{'' if created == 1 else 's'}.",
        "created": created,
        "skipped": skipped,
    }
