import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from database import (
    engine,
    migrate_indexes, migrate_codex_entry_sharing,
    migrate_ai_disabled, migrate_research_pdf,
    migrate_ai_providers, migrate_corkboard,
    migrate_achievement_popup_shown, migrate_sync_mirror,
    migrate_spacy, migrate_calibre, migrate_project_language,
    migrate_ai_prompts_word_count, migrate_backfill_word_counts,
    seed_ai_prompts, seed_publisher_profiles, seed_export_profiles,
)
from models import Base
from routers import projects, acts, chapters, scenes, codex, settings, ai, export, imports, graph, time, fragments, images, scene_commands, grammar, analytics, research, submissions, achievements
from routers import sync as sync_router


def _init_sync() -> None:
    try:
        with engine.connect() as conn:
            row = conn.execute(text(
                "SELECT sync_mirror_enabled, sync_local_dir FROM user_settings LIMIT 1"
            )).fetchone()
        if row:
            sync_router.init(bool(row[0]), row[1])
        else:
            sync_router.init(False, None)
    except Exception:
        pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Schema: wait up to 60 s for PG (Docker may still be starting) ─────────
    _pg_ready = False
    for _attempt in range(60):
        try:
            Base.metadata.create_all(bind=engine)
            _pg_ready = True
            break
        except Exception as _e:
            if _attempt == 0:
                print(f"[startup] Waiting for PostgreSQL… ({_e.__class__.__name__})", flush=True)
            await asyncio.sleep(1)
    if not _pg_ready:
        raise RuntimeError(
            "PostgreSQL did not become available within 60 seconds. "
            "Check that the database is running and the connection settings are correct."
        )

    # Seed static reference data
    seed_ai_prompts()
    seed_publisher_profiles()
    seed_export_profiles()

    # Incremental ALTER TABLE migrations — idempotent, safe on every startup.
    migrate_indexes()
    migrate_codex_entry_sharing()
    migrate_ai_disabled()
    migrate_research_pdf()
    migrate_ai_providers()
    migrate_corkboard()
    migrate_achievement_popup_shown()
    migrate_sync_mirror()
    migrate_spacy()
    migrate_calibre()
    migrate_project_language()
    migrate_ai_prompts_word_count()
    migrate_backfill_word_counts()

    os.makedirs("uploads", exist_ok=True)
    _init_sync()

    yield
    sync_router.shutdown_backup()


app = FastAPI(title="Foliantica API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # Allow any localhost / 127.0.0.1 port — needed for the Electron build
    # where the Next.js server runs on a dynamic port.
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(acts.router)
app.include_router(chapters.router)
app.include_router(scenes.router)
app.include_router(codex.router)
app.include_router(settings.router)
app.include_router(ai.router)
app.include_router(export.router)
app.include_router(export._pub_router)
app.include_router(imports.router)
app.include_router(graph.router)
app.include_router(time.router)
app.include_router(fragments.router)
app.include_router(images.router)
app.include_router(scene_commands.router)
app.include_router(grammar.router)
app.include_router(analytics.router)
app.include_router(research.router)
app.include_router(submissions.router)
app.include_router(achievements.router)
app.include_router(sync_router.router)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


@app.get("/api/health")
def health():
    return {"status": "ok"}
