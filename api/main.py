import os
from contextlib import asynccontextmanager

import jwt as _pyjwt
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
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
from routers import collab as collab_router

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
    #
    # Retry up to 60 s — Docker-managed PG may still be starting when the
    # API launches (container healthcheck takes a few seconds after `up -d`).
    import time as _time
    _pg_ready = False
    for _attempt in range(60):
        try:
            Base.metadata.create_all(bind=engine)
            _pg_ready = True
            break
        except Exception as _e:
            if _attempt == 0:
                print(f"[startup] Waiting for PostgreSQL… ({_e.__class__.__name__})", flush=True)
            _time.sleep(1)
    if not _pg_ready:
        raise RuntimeError(
            "PostgreSQL did not become available within 60 seconds. "
            "Check that the database is running and the connection settings are correct."
        )
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
        # Always call init — in PG mode it starts the background dump thread
        # unconditionally (regardless of the Data Mirror toggle).
        if row:
            sync_router.init(bool(row[0]), row[1])
        else:
            sync_router.init(False, None)   # no settings row yet; use defaults
    except Exception:
        pass


_init_sync()


# ── Co-work: SQLAlchemy change-detection hooks ───────────────────────────────
# after_flush  captures which tables are dirty before the commit clears them.
# after_commit fires after the transaction succeeds and triggers the broadcast.
#
# Both hooks run synchronously inside the async request handler's thread, so
# collab_router.broadcast_change() uses asyncio.get_running_loop().create_task()
# to schedule the coroutine on the already-running event loop.

def _register_collab_hooks() -> None:
    from sqlalchemy import event as _sa_event
    from sqlalchemy.orm import Session as _SASession

    @_sa_event.listens_for(_SASession, "after_flush")
    def _capture(session, ctx):
        tables: set[str] = set()
        for obj in list(session.new) + list(session.dirty) + list(session.deleted):
            tbl = getattr(obj.__class__, "__tablename__", None)
            if tbl:
                tables.add(tbl)
        if tables:
            session.info.setdefault("collab_tables", set()).update(tables)

    @_sa_event.listens_for(_SASession, "after_commit")
    def _broadcast(session):
        tables = session.info.pop("collab_tables", set())
        if tables:
            collab_router.broadcast_change(list(tables))


_register_collab_hooks()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    sync_router.shutdown_backup()
    import asyncio as _asyncio
    # Clean up UPnP port mappings if any were opened this session.
    # A secondary atexit hook in collab.py catches hard-exit scenarios.
    if collab_router._upnp_active:
        await _asyncio.to_thread(collab_router.upnp_close)
    # Terminate the Cloudflare Tunnel process if running.
    if collab_router._cf_active:
        await _asyncio.to_thread(collab_router.cloudflare_close)


app = FastAPI(title="Foliantica API", version="0.1.0", lifespan=lifespan)

# ── CORS ──────────────────────────────────────────────────────────────────────
# When co-work is enabled the Next.js server forwards requests from guest
# browsers, so we must allow any origin.  When disabled, restrict to localhost.
if collab_router.is_cowork_enabled():
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


# ── Co-work auth middleware ───────────────────────────────────────────────────
# The Next.js proxy (route.ts) forwards the real client IP as X-Client-IP.
# Requests from 127.0.0.1 (host browser or the proxy itself when the guest's
# request has no X-Client-IP override) are always trusted.
# External clients must supply a valid Bearer JWT issued by /api/collab/join.

_COWORK_PUBLIC_PATHS = {"/api/health", "/api/collab/join", "/api/collab/info"}

class CoworkAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # OPTIONS preflight — always pass through so CORS headers are set
        if request.method == "OPTIONS":
            return await call_next(request)

        # Only enforce when co-work is enabled
        if not collab_router.is_cowork_enabled():
            return await call_next(request)

        # Public endpoints (join + health) — no auth required
        if request.url.path in _COWORK_PUBLIC_PATHS:
            return await call_next(request)

        # Determine real client IP.  The Next.js proxy sets X-Client-IP from
        # the browser's IP; if absent, fall back to the direct connection IP.
        client_ip = (
            request.headers.get("X-Client-IP")
            or (request.client.host if request.client else "127.0.0.1")
        )

        # Localhost is always trusted (host browser, internal calls)
        if client_ip in ("127.0.0.1", "::1"):
            return await call_next(request)

        # External client: require a valid Bearer JWT
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return JSONResponse({"detail": "Authentication required."}, status_code=401)

        token = auth[len("Bearer "):]
        try:
            collab_router.verify_session_jwt(token)
        except _pyjwt.ExpiredSignatureError:
            return JSONResponse({"detail": "Session expired. Please rejoin."}, status_code=401)
        except _pyjwt.InvalidTokenError:
            return JSONResponse({"detail": "Invalid session token."}, status_code=401)

        return await call_next(request)


app.add_middleware(CoworkAuthMiddleware)

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
app.include_router(collab_router.router)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


@app.get("/api/health")
def health():
    return {"status": "ok"}
