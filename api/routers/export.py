import io
import json as _json
import os
import re
import zipfile
import httpx
from pathlib import Path
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.orm import Session, selectinload

from database import get_db
from models import Project, Act, Chapter, UserSettings, ExportProfile, PublisherProfile
from schemas import ExportOptions, ExportProfileCreate, ExportProfileUpdate, ExportProfileOut, PublisherProfileOut, BatchExportRequest
from services.export import export_markdown, export_latex, export_epub_style, export_html

router = APIRouter(prefix="/api/projects", tags=["export"])


def _safe_filename(title: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", title)


def _load_project(project_id: int, db: Session) -> Project:
    project = (
        db.query(Project)
        .options(
            selectinload(Project.acts)
            .selectinload(Act.chapters)
            .selectinload(Chapter.scenes)
        )
        .filter(Project.id == project_id)
        .first()
    )
    if not project:
        raise HTTPException(404, "Project not found")
    return project


@router.post("/{project_id}/export")
async def export_project(
    project_id: int,
    opts: ExportOptions,
    db: Session = Depends(get_db),
):
    project = _load_project(project_id, db)
    safe_name = _safe_filename(project.title)

    # ── 1. Generate content ───────────────────────────────────────────────────
    content: bytes | str
    filename: str
    media_type: str
    is_binary = False

    if opts.format == "md":
        content   = export_markdown(project, opts)
        filename  = f"{safe_name}.md"
        media_type = "text/markdown"

    elif opts.format == "tex":
        content   = export_latex(project, opts)
        filename  = f"{safe_name}.tex"
        media_type = "application/x-tex"

    elif opts.format == "epub-style":
        content   = export_epub_style(project, opts)
        filename  = f"{safe_name}-style.css"
        media_type = "text/css"

    elif opts.format in ("pdf", "epub", "docx"):
        s = db.query(UserSettings).first()
        if not s or not s.pandoc_enabled:
            raise HTTPException(503, "PDF/EPUB/DOCX export is not enabled in settings")
        pandoc_url = (s.pandoc_url or "http://localhost:8082").rstrip("/")

        import json as _json
        html = export_html(project, opts)
        meta = _json.loads(project.book_meta) if project.book_meta else {}
        payload = {
            "html":             html,
            "format":           opts.format,
            "title":            project.title or "",
            "author":           meta.get("author", ""),
            "language":         meta.get("language", "en"),
            "font":             opts.font or None,
            "heading_font":     opts.heading_font or None,
            "heading_align":    opts.heading_align,
            "h1_size":          opts.h1_size,
            "h2_size":          opts.h2_size,
            "h3_size":          opts.h3_size,
            "h3_style":         opts.h3_style,
            "paragraph_indent": opts.paragraph_indent,
            "text_align":       opts.text_align,
            "pdf_margin":       opts.pdf_margin,
            "page_numbers":     opts.page_numbers,
            "line_spacing":     opts.line_spacing,
            "font_size":        opts.font_size,
        }
        if project.cover_image:
            payload["cover"] = project.cover_image

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                r = await client.post(f"{pandoc_url}/convert", json=payload)
            r.raise_for_status()
        except httpx.ConnectError:
            raise HTTPException(503, "Pandoc service is not reachable. Is the container running?")
        except httpx.HTTPStatusError as exc:
            raise HTTPException(502, f"Pandoc error: {exc.response.text[:200]}")

        content    = r.content
        is_binary  = True
        ext_map    = {"pdf": "pdf", "epub": "epub", "docx": "docx"}
        mime_map   = {
            "pdf":  "application/pdf",
            "epub": "application/epub+zip",
            "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }
        filename   = f"{safe_name}.{ext_map.get(opts.format, opts.format)}"
        media_type = mime_map.get(opts.format, "application/octet-stream")

    elif opts.format in ("mobi", "azw3", "epub-calibre"):
        s = db.query(UserSettings).first()
        mode = getattr(s, "calibre_mode", None) or "off" if s else "off"
        if mode == "off":
            raise HTTPException(503, "Calibre export is not enabled in settings")

        import json as _json
        calibre_fmt = "epub" if opts.format == "epub-calibre" else opts.format
        html        = export_html(project, opts)
        meta        = _json.loads(project.book_meta) if project.book_meta else {}
        cover_b64   = project.cover_image
        _mime_map   = {
            "mobi":         "application/x-mobipocket-ebook",
            "azw3":         "application/vnd.amazon.ebook",
            "epub-calibre": "application/epub+zip",
        }
        out_ext    = "epub" if opts.format == "epub-calibre" else opts.format

        if mode == "system":
            import shutil as _shutil, subprocess as _sp, tempfile as _tf, base64 as _b64, os as _os, sys as _sys
            from pathlib import Path as _Path
            if not _shutil.which("ebook-convert"):
                raise HTTPException(503, "ebook-convert not found on PATH. Install Calibre or switch to Docker mode in settings.")
            with _tf.TemporaryDirectory() as tmp:
                src = _Path(tmp) / "input.html"
                dst = _Path(tmp) / f"output.{calibre_fmt}"
                src.write_text(html, encoding="utf-8")
                cmd = ["ebook-convert", str(src), str(dst)]
                if project.title:              cmd += ["--title", project.title]
                if meta.get("author"):         cmd += ["--authors", meta["author"]]
                if meta.get("language", "en"): cmd += ["--language", meta.get("language", "en")]
                if cover_b64:
                    cp = _Path(tmp) / "cover.jpg"
                    cp.write_bytes(_b64.b64decode(cover_b64))
                    cmd += ["--cover", str(cp)]
                env = {**_os.environ, "QT_QPA_PLATFORM": "offscreen"}
                # Isolate child from parent's process group so uvicorn's SIGINT
                # doesn't propagate into ebook-convert on Windows.
                flags = _sp.CREATE_NEW_PROCESS_GROUP if _sys.platform == "win32" else 0
                result = _sp.run(cmd, capture_output=True, text=True, timeout=120, env=env, creationflags=flags)
                if result.returncode != 0:
                    raise HTTPException(500, f"ebook-convert failed: {result.stderr[-2000:]}")
                content = dst.read_bytes()

        else:  # docker
            calibre_url = (s.calibre_url or "http://localhost:8084").rstrip("/")
            payload = {
                "html":     html,
                "format":   calibre_fmt,
                "title":    project.title or "",
                "author":   meta.get("author", ""),
                "language": meta.get("language", "en"),
            }
            if cover_b64:
                payload["cover"] = cover_b64
            try:
                async with httpx.AsyncClient(timeout=120.0) as client:
                    r = await client.post(f"{calibre_url}/convert", json=payload)
                r.raise_for_status()
            except httpx.ConnectError:
                raise HTTPException(503, "Calibre service is not reachable. Is the container running?")
            except httpx.HTTPStatusError as exc:
                raise HTTPException(502, f"Calibre error: {exc.response.text[:200]}")
            content = r.content

        is_binary  = True
        filename   = f"{safe_name}.{out_ext}"
        media_type = _mime_map[opts.format]

    else:
        raise HTTPException(400, "Unknown format")

    # ── Track export count ────────────────────────────────────────────────────
    try:
        db.execute(text("UPDATE user_settings SET export_count = COALESCE(export_count, 0) + 1"))
        db.commit()
    except Exception:
        pass

    # ── 2. Deliver ────────────────────────────────────────────────────────────
    if opts.save_to_disk:
        # Save to {dataDir}/exports/ — CWD is always the dataDir (set by run.py)
        exports_dir = Path(os.getcwd()) / "exports"
        exports_dir.mkdir(exist_ok=True)
        dest = exports_dir / filename
        if is_binary:
            dest.write_bytes(content)       # type: ignore[arg-type]
        else:
            dest.write_text(content, encoding="utf-8")  # type: ignore[arg-type]
        return {"saved_to": str(dest), "filename": filename}

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/fonts")
async def list_pandoc_fonts(db: Session = Depends(get_db)):
    """Proxy the Pandoc container's font list for use in the export dialog."""
    s = db.query(UserSettings).first()
    if not s or not s.pandoc_enabled:
        return {"fonts": []}
    pandoc_url = (s.pandoc_url or "http://localhost:8082").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{pandoc_url}/fonts")
        return r.json()
    except Exception:
        return {"fonts": []}


@router.get("/{project_id}/export-profiles", response_model=list[ExportProfileOut])
def list_export_profiles(project_id: int, db: Session = Depends(get_db)):
    """Return global (built-in) profiles plus any saved for this project."""
    from sqlalchemy import or_
    return (
        db.query(ExportProfile)
        .filter(or_(ExportProfile.project_id == project_id, ExportProfile.project_id.is_(None)))
        .order_by(ExportProfile.is_builtin.desc(), ExportProfile.name)
        .all()
    )


@router.post("/{project_id}/export-profiles", response_model=ExportProfileOut, status_code=201)
def create_export_profile(project_id: int, data: ExportProfileCreate, db: Session = Depends(get_db)):
    profile = ExportProfile(project_id=project_id, **data.model_dump())
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


@router.patch("/export-profiles/{profile_id}", response_model=ExportProfileOut)
def update_export_profile(profile_id: int, data: ExportProfileUpdate, db: Session = Depends(get_db)):
    profile = db.get(ExportProfile, profile_id)
    if not profile or profile.is_builtin:
        raise HTTPException(404, "Profile not found or is read-only")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(profile, k, v)
    db.commit()
    db.refresh(profile)
    return profile


@router.delete("/export-profiles/{profile_id}", status_code=204)
def delete_export_profile(profile_id: int, db: Session = Depends(get_db)):
    profile = db.get(ExportProfile, profile_id)
    if not profile or profile.is_builtin:
        raise HTTPException(404, "Profile not found or is read-only")
    db.delete(profile)
    db.commit()


@router.get("/{project_id}/export/structure")
def export_structure(project_id: int, db: Session = Depends(get_db)):
    """Return acts → chapters → scenes hierarchy for the export dialog."""
    project = (
        db.query(Project)
        .options(
            selectinload(Project.acts)
            .selectinload(Act.chapters)
            .selectinload(Chapter.scenes)
        )
        .filter(Project.id == project_id)
        .first()
    )
    if not project:
        raise HTTPException(404, "Project not found")

    return {
        "title": project.title,
        "acts": [
            {
                "id": act.id,
                "title": act.title,
                "order_index": act.order_index,
                "chapters": [
                    {
                        "id": ch.id,
                        "title": ch.title,
                        "order_index": ch.order_index,
                        "scenes": [
                            {"id": s.id, "title": s.title or "Untitled Scene", "order_index": s.order_index}
                            for s in sorted(ch.scenes, key=lambda s: s.order_index)
                        ],
                    }
                    for ch in sorted(act.chapters, key=lambda c: c.order_index)
                ],
            }
            for act in sorted(project.acts, key=lambda a: a.order_index)
        ],
    }


# ── Publisher profiles ────────────────────────────────────────────────────────

# Separate router with /api prefix so the route doesn't clash with /{project_id}
from fastapi import APIRouter as _AR
_pub_router = _AR(prefix="/api", tags=["export"])

@_pub_router.get("/export/publishers", response_model=list[PublisherProfileOut])
def list_publisher_profiles(db: Session = Depends(get_db)):
    """Return all seeded publisher/agent formatting profiles."""
    return (
        db.query(PublisherProfile)
        .filter(PublisherProfile.is_active == 1)
        .order_by(PublisherProfile.category, PublisherProfile.name)
        .all()
    )

# ── Batch export ──────────────────────────────────────────────────────────────

@router.post("/{project_id}/export/batch")
async def batch_export(
    project_id: int,
    req: BatchExportRequest,
    db: Session = Depends(get_db),
):
    """Generate one file per selected publisher and return them as a ZIP archive."""
    project = _load_project(project_id, db)
    safe_name = _safe_filename(project.title)

    s = db.query(UserSettings).first()
    if not s or not s.pandoc_enabled:
        raise HTTPException(503, "PDF/EPUB/DOCX export requires the Pandoc service — enable it in Settings.")
    pandoc_url = (s.pandoc_url or "http://localhost:8082").rstrip("/")

    publishers = (
        db.query(PublisherProfile)
        .filter(PublisherProfile.id.in_(req.publisher_ids), PublisherProfile.is_active == 1)
        .all()
    )
    if not publishers:
        raise HTTPException(400, "No valid publisher profiles found for the given IDs.")

    meta = _json.loads(project.book_meta) if project.book_meta else {}

    zip_buf = io.BytesIO()
    failed: list[dict] = []

    # Pre-flight: verify Pandoc is reachable before generating all documents
    try:
        async with httpx.AsyncClient(timeout=5.0) as probe:
            await probe.get(f"{pandoc_url}/fonts")
    except httpx.ConnectError:
        raise HTTPException(503, "Pandoc service is not reachable. Is the container running?")

    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        async with httpx.AsyncClient(timeout=120.0) as client:
            for pub in publishers:
                try:
                    opts_dict: dict = _json.loads(pub.options_json)
                    fmt = opts_dict.get("format", "docx")
                    if fmt not in ("pdf", "epub", "docx"):
                        continue

                    # Build ExportOptions for HTML generation
                    export_opts = ExportOptions(
                        format=fmt,
                        scene_ids=req.scene_ids,
                        include_act_headings=req.include_act_headings,
                        include_chapter_headings=req.include_chapter_headings,
                        include_scene_headings=req.include_scene_headings,
                        font=opts_dict.get("font"),
                        font_size=opts_dict.get("font_size", "12pt"),
                        line_spacing=opts_dict.get("line_spacing", "2"),
                        text_align=opts_dict.get("text_align", "left"),
                        heading_align=opts_dict.get("heading_align", "center"),
                        paragraph_indent=opts_dict.get("paragraph_indent", "1.5em"),
                        pdf_margin=opts_dict.get("pdf_margin", "1in"),
                        page_numbers=opts_dict.get("page_numbers", True),
                        h1_size=opts_dict.get("h1_size", "1.5em"),
                        h2_size=opts_dict.get("h2_size", "1.25em"),
                        h3_size=opts_dict.get("h3_size", "1em"),
                        h3_style=opts_dict.get("h3_style", "normal"),
                    )

                    html = export_html(project, export_opts)
                    payload = {
                        "html":             html,
                        "format":           fmt,
                        "title":            project.title or "",
                        "author":           meta.get("author", ""),
                        "language":         meta.get("language", "en"),
                        "font":             export_opts.font,
                        "heading_font":     None,
                        "heading_align":    export_opts.heading_align,
                        "h1_size":          export_opts.h1_size,
                        "h2_size":          export_opts.h2_size,
                        "h3_size":          export_opts.h3_size,
                        "h3_style":         export_opts.h3_style,
                        "paragraph_indent": export_opts.paragraph_indent,
                        "text_align":       export_opts.text_align,
                        "pdf_margin":       export_opts.pdf_margin,
                        "page_numbers":     export_opts.page_numbers,
                        "line_spacing":     export_opts.line_spacing,
                        "font_size":        export_opts.font_size,
                    }
                    if project.cover_image and fmt == "epub":
                        payload["cover"] = project.cover_image

                    r = await client.post(f"{pandoc_url}/convert", json=payload)
                    r.raise_for_status()

                    ext = {"pdf": "pdf", "epub": "epub", "docx": "docx"}[fmt]
                    filename = f"{pub.short_name}_{safe_name}.{ext}"
                    zf.writestr(filename, r.content)

                except Exception as exc:
                    failed.append({"publisher": pub.name, "error": str(exc)[:120]})

    # ── Track export count ────────────────────────────────────────────────────
    try:
        db.execute(text("UPDATE user_settings SET export_count = COALESCE(export_count, 0) + 1"))
        db.commit()
    except Exception:
        pass

    zip_buf.seek(0)
    headers = {"Content-Disposition": f'attachment; filename="{safe_name}_submissions.zip"'}
    if failed:
        headers["X-Failed-Publishers"] = _json.dumps(failed)
    return Response(content=zip_buf.read(), media_type="application/zip", headers=headers)
