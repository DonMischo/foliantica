import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from database import (
    engine, USE_SQLITE,
    # SQLite incremental migrations (existing users upgrading)
    migrate_to_four_level, migrate_new_columns, migrate_indexes,
    migrate_entry_groups, migrate_ai_prompts, migrate_scene_versions,
    migrate_mention_stats, migrate_writing_log, migrate_timeline_tables,
    migrate_codex_entry_sharing, migrate_research, migrate_publishing,
    migrate_publisher_profiles, migrate_achievements, migrate_backfill_word_counts,
    migrate_ai_disabled, migrate_sync_mirror, migrate_research_pdf,
    migrate_research_media,
    # PostgreSQL seed functions (fresh DB, no ALTER TABLE needed)
    seed_ai_prompts, seed_publisher_profiles, seed_export_profiles,
)
from models import Base
from routers import projects, acts, chapters, scenes, codex, settings, ai, export, imports, graph, time, fragments, images, scene_commands, grammar, analytics, research, submissions, achievements
from routers import sync as sync_router

# ── Schema + migrations ───────────────────────────────────────────────────────

if USE_SQLITE:
    # SQLite path: run incremental migrations for users upgrading from older
    # versions. migrate_to_four_level() must run before create_all() because
    # it renames the old 'chapters' table to 'acts'.
    migrate_to_four_level()
    Base.metadata.create_all(bind=engine)
    migrate_new_columns()
    migrate_indexes()
    migrate_entry_groups()
    migrate_ai_prompts()
    migrate_scene_versions()
    migrate_mention_stats()
    migrate_writing_log()
    migrate_timeline_tables()
    migrate_codex_entry_sharing()
    migrate_research()
    migrate_publishing()
    migrate_publisher_profiles()
    migrate_achievements()
    migrate_backfill_word_counts()
    migrate_ai_disabled()
    migrate_sync_mirror()
    migrate_research_pdf()
    migrate_research_media()
else:
    # PostgreSQL path: create_all() handles the full schema in one shot.
    # Then seed static reference data that would otherwise come from the
    # SQLite migrate_* functions (which use SQLite-specific DDL).
    Base.metadata.create_all(bind=engine)
    seed_ai_prompts()
    seed_publisher_profiles()
    seed_export_profiles()

os.makedirs("uploads", exist_ok=True)

# ── Init sync mirror from stored settings ─────────────────────────────────────
def _init_sync() -> None:
    try:
        with engine.connect() as conn:
            row = conn.execute(text(
                "SELECT sync_mirror_enabled, sync_local_dir FROM user_settings LIMIT 1"
            )).fetchone()
            if row:
                sync_router.init(bool(row[0]), row[1])
    except Exception:
        pass


_init_sync()


@asynccontextmanager
async def lifespan(app: FastAPI):
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
