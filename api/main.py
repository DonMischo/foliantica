import asyncio
import hmac
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
    engine,
    migrate_indexes, migrate_codex_entry_sharing,
    migrate_ai_disabled, migrate_research_pdf,
    migrate_ai_providers, migrate_corkboard,
    migrate_achievement_popup_shown, migrate_sync_mirror,
    migrate_spacy, migrate_calibre, migrate_vale, migrate_vale_custom_rules, migrate_vale_disabled_entries,
    migrate_vale_rule_entries_table, migrate_vale_sync_meta, migrate_project_language,
    migrate_ai_prompts_word_count, migrate_backfill_word_counts,
    seed_ai_prompts, seed_publisher_profiles, seed_export_profiles,
)
from models import Base
from routers import projects, acts, chapters, scenes, codex, settings, ai, export, imports, graph, time, fragments, images, scene_commands, grammar, analytics, research, submissions, achievements, vale
from routers import sync as sync_router
from routers import collab as collab_router


def _register_collab_hooks() -> None:
    """Register SQLAlchemy flush/commit hooks that broadcast DB changes to co-work guests."""
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

    # Seed static reference data — skip in tests: _fresh_schema drops all
    # tables between tests, and seeded rows would break tests expecting empty state.
    if not os.environ.get("PYTEST_CURRENT_TEST"):
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
    migrate_vale()
    migrate_vale_custom_rules()
    migrate_vale_disabled_entries()
    migrate_vale_rule_entries_table()
    migrate_vale_sync_meta()
    migrate_project_language()
    migrate_ai_prompts_word_count()
    migrate_backfill_word_counts()

    os.makedirs("uploads", exist_ok=True)
    _init_sync()
    _register_collab_hooks()
    yield
    sync_router.shutdown_backup()
    import asyncio as _asyncio
    # Terminate the Cloudflare Tunnel process if running.
    if collab_router._cf_active:
        await _asyncio.to_thread(collab_router.cloudflare_close)


app = FastAPI(title="Foliantica API", version="0.1.0", lifespan=lifespan)

# ── CORS ──────────────────────────────────────────────────────────────────────
# No legitimate browser flow ever calls FastAPI's REST API cross-origin — the
# frontend always goes through Next.js's same-origin proxy (web/src/lib/api.ts
# BASE = "/api"), and the collab WebSocket is proxied through Next.js too
# (server-wrapper.js), so it isn't CORS-governed traffic either. A wildcard
# here would only ever help an attacker (a malicious page on the host's own
# machine doing fetch() straight to this port), never a real guest.
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

# Per-launch secret, set by Electron and injected into its own window's
# requests only (see electron/main.js + COWORKING_NETWORK_SECURITY_SUMMARY.md).
# Absent in the non-Electron launch path (LaunchFoliantica.bat) — host-trust
# there falls back entirely to the peer + Origin checks below.
_HOST_SECRET = os.environ.get("FOLIANTICA_HOST_SECRET", "")

class CoworkAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # OPTIONS preflight — always pass through so CORS headers are set
        if request.method == "OPTIONS":
            return await call_next(request)

        # Public endpoints (join + health) — no auth required
        if request.url.path in _COWORK_PUBLIC_PATHS:
            return await call_next(request)

        # Strongest signal: a secret only Electron's own window can attach
        # (injected below the page's JS via webRequest, invisible to any
        # other process or browser tab on the machine). If present and
        # correct, trust outright — this is the only check that defends
        # against a malicious LOCAL process that can fake both a genuine
        # loopback connection and an Origin header, which the checks below
        # can't distinguish from the real thing.
        provided_secret = request.headers.get("X-Foliantica-Host-Secret", "")
        if _HOST_SECRET and hmac.compare_digest(provided_secret, _HOST_SECRET):
            return await call_next(request)

        # Verified TCP peer of THIS connection — not spoofable by the client,
        # unlike any header. Uvicorn on dual-stack sockets represents IPv4
        # loopback as the IPv4-mapped IPv6 address ::ffff:127.0.0.1;
        # normalise it so the trust check below uses plain IPv4.
        peer_host = request.client.host if request.client else "127.0.0.1"
        if peer_host.startswith("::ffff:"):
            peer_host = peer_host[7:]
        peer_is_loopback = peer_host in ("127.0.0.1", "::1")

        # X-Client-IP is set by the Next.js proxy (route.ts) to relay the
        # real browser IP through its own loopback hop to FastAPI. It must
        # only be trusted when the peer making THIS request is itself
        # loopback — i.e. it can only have been set by that local proxy
        # process. Otherwise it's client-suppliable and trivially spoofed:
        # since co-work makes FastAPI bind 0.0.0.0, any device on the LAN
        # could otherwise curl this port directly with
        # "X-Client-IP: 127.0.0.1" and be granted full host-level trust
        # with zero auth. This mirrors uvicorn's own ProxyHeadersMiddleware,
        # which only honors X-Forwarded-For from a configured trusted host.
        if peer_is_loopback:
            client_ip = request.headers.get("X-Client-IP") or peer_host
            if client_ip.startswith("::ffff:"):
                client_ip = client_ip[7:]
        else:
            client_ip = peer_host

        # Localhost is always trusted (host browser, internal calls)
        if client_ip in ("127.0.0.1", "::1"):
            return await call_next(request)

        # Non-trusted peer: co-work must be enabled for guest access to be
        # possible at all. Checked here (not as an early bypass above) so
        # that disabling co-work immediately revokes ALL guest access,
        # including already-issued JWTs — not just new joins. The server's
        # bind address only changes on app restart (electron/main.js reads
        # it once at startup), so a LAN device can still reach this port
        # for a while after co-work is toggled off; this is what actually
        # closes that window rather than relying on the rebind.
        if not collab_router.is_cowork_enabled():
            return JSONResponse({"detail": "Co-work is disabled."}, status_code=403)

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
app.include_router(vale.router)
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
