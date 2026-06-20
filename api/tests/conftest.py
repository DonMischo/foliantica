"""
Shared fixtures for the Foliantica API test suite.

Each test gets a fresh PostgreSQL schema and a FastAPI TestClient wired to it
via the get_db dependency override.  The production database is never touched.

Isolation guarantee:
  api/conftest.py points LW_PG_DB at "foliantica_test" before any module is
  imported.  The _ensure_test_db fixture (session-scoped) creates that database
  if it doesn't exist.  Every test then drops and recreates the schema for full
  per-test isolation.

Co-work isolation:
  isolated_state (autouse) resets all collab module-level state and redirects
  the config file path before every test so ~/.foliantica/config.json is never
  read or written during the test run.
"""
import os
import shutil
import subprocess
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pathlib import Path

import routers.collab as collab_mod
from routers.collab import router as collab_router
from models import Base
from database import engine as _engine, SessionLocal as _SessionLocal, get_db
from main import app  # noqa: must import after api/conftest.py sets env vars


def _pg_is_up() -> bool:
    """Return True only when PostgreSQL is fully ready to accept connections."""
    import psycopg2
    try:
        conn = psycopg2.connect(
            host=os.getenv("LW_PG_HOST", "127.0.0.1"),
            port=int(os.getenv("LW_PG_PORT", "5433")),
            user=os.getenv("LW_PG_USER", "foliantica"),
            password=os.getenv("LW_PG_PASS", "foliantica"),
            dbname="postgres",
            connect_timeout=1,
        )
        conn.close()
        return True
    except Exception:
        return False


@pytest.fixture(scope="session", autouse=True)
def _start_pg():
    """Start the embedded test PostgreSQL on port 5433 if not already running.

    Uses scripts/start-test-pg.mjs (node embedded-postgres).  A no-op when
    PG is already up (e.g. user started LaunchFoliantica.bat manually).
    Polls the TCP port rather than parsing stdout so pipe buffering never stalls.
    """
    import time

    if _pg_is_up():
        yield
        return

    # Remove a stale data directory left by a previously killed process.
    # embedded-postgres only cleans up via pg.stop() on graceful exit.
    data_dir = Path(os.environ.get("TEMP", os.environ.get("TMPDIR", "/tmp"))) / "foliantica-pg-test"
    if data_dir.exists():
        shutil.rmtree(data_dir, ignore_errors=True)

    root = Path(__file__).parent.parent.parent   # repo root
    proc = subprocess.Popen(
        ["node", str(root / "scripts" / "start-test-pg.mjs")],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if _pg_is_up():
            break
        if proc.poll() is not None:
            raise RuntimeError("Embedded PG process exited before becoming ready")
        time.sleep(0.5)
    else:
        proc.terminate()
        raise RuntimeError(
            "Embedded PostgreSQL did not become ready within 60 s. "
            "Check that Node.js and the embedded-postgres package are installed "
            f"(scripts/start-test-pg.mjs, port {os.getenv('LW_PG_PORT', '5433')})."
        )

    yield

    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


@pytest.fixture(scope="session", autouse=True)
def _ensure_test_db(_start_pg):
    """Create the foliantica_test database if it doesn't exist."""
    import psycopg2
    from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

    conn = psycopg2.connect(
        host=os.getenv("LW_PG_HOST", "127.0.0.1"),
        port=int(os.getenv("LW_PG_PORT", "5433")),
        user=os.getenv("LW_PG_USER", "foliantica"),
        password=os.getenv("LW_PG_PASS", "foliantica"),
        dbname="postgres",
    )
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM pg_database WHERE datname = 'foliantica_test'")
    if not cur.fetchone():
        cur.execute("CREATE DATABASE foliantica_test")
    cur.close()
    conn.close()


@pytest.fixture(autouse=True)
def _fresh_schema(_ensure_test_db):
    """Drop and recreate every table before each test — full isolation."""
    Base.metadata.drop_all(_engine)
    Base.metadata.create_all(_engine)
    yield
    # cleanup happens implicitly on next test's drop_all


@pytest.fixture(autouse=True)
def isolated_state(tmp_path, monkeypatch):
    """Reset all collab module-level state and redirect config before every test."""
    collab_mod._sessions.clear()
    collab_mod._bans.clear()
    collab_mod._locks.clear()
    collab_mod._presence.clear()
    collab_mod.manager._connections.clear()

    collab_mod._cf_active = False
    collab_mod._cf_url = None
    collab_mod._cf_process = None

    monkeypatch.setattr(collab_mod, "_CONFIG_PATH", tmp_path / "config.json")

    yield

    collab_mod._sessions.clear()
    collab_mod._bans.clear()
    collab_mod._locks.clear()
    collab_mod._presence.clear()
    collab_mod.manager._connections.clear()
    collab_mod._cf_active = False
    collab_mod._cf_url = None
    collab_mod._cf_process = None


@pytest.fixture
def db(_fresh_schema):
    """SQLAlchemy session for direct DB seeding / assertions."""
    session = _SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db):
    """FastAPI TestClient connected to the per-test database.

    Simulates the real production topology: every HTTP request reaches
    FastAPI via the Next.js proxy's own loopback hop (route.ts always
    targets http://127.0.0.1:<port>), host or guest alike — so the TCP
    peer CoworkAuthMiddleware sees is always 127.0.0.1 in practice. We set
    that explicitly via TestClient's `client=` param (httpx's default peer
    is the literal string "testclient", not a loopback address).

    Also defaults X-Client-IP: 127.0.0.1, mirroring what the proxy sets for
    the host's own browser requests, so requests are host-trusted by
    default. Tests simulating a guest/external client pass their own
    X-Client-IP per-request (e.g. do_join's client_ip param), which
    overrides this default — the middleware only honors that header
    because the peer above is loopback; see test_collab_auth.py's
    TestProxyTrustBoundary for the case where it must NOT be honored.
    """
    def _override():
        yield db

    app.dependency_overrides[get_db] = _override
    with TestClient(app, raise_server_exceptions=True, client=("127.0.0.1", 51000)) as c:
        c.headers["X-Client-IP"] = "127.0.0.1"
        yield c
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def ws_client(client):
    """Separate TestClient, sharing `client`'s app/db wiring, for WebSocket
    connections specifically.

    In production the WS endpoint is reached directly by the browser, never
    through the Next.js proxy (it can't tunnel upgrade requests) — unlike
    HTTP, where the peer is always the proxy's own loopback hop. httpx's
    default (non-loopback) peer ("testclient") models that direct-guest
    connection correctly, so this intentionally does NOT set client=(...)
    the way the `client` fixture does. Depends on `client` only for fixture
    ordering (so dependency_overrides is already wired); use `client` for
    any HTTP setup (e.g. make_invitation) in the same test and this fixture
    only for .websocket_connect().
    """
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c


@pytest.fixture
def collab_client():
    """Minimal FastAPI TestClient with only the collab router (no DB needed)."""
    a = FastAPI()
    a.include_router(collab_router)
    return TestClient(a, raise_server_exceptions=True)


# ── Convenience seeders ───────────────────────────────────────────────────────

@pytest.fixture
def project(client):
    """Create and return a minimal project via the API."""
    r = client.post("/api/projects", json={"title": "Test Project"})
    assert r.status_code == 201
    return r.json()


@pytest.fixture
def act(client, project):
    """Create and return the first act under the test project."""
    r = client.post("/api/acts",
                    json={"title": "Act 1", "project_id": project["id"], "order_index": 0})
    assert r.status_code == 201
    return r.json()


@pytest.fixture
def chapter(client, act):
    """Create and return a chapter under the test act."""
    r = client.post("/api/chapters",
                    json={"title": "Chapter 1", "act_id": act["id"], "order_index": 0})
    assert r.status_code == 201
    return r.json()


@pytest.fixture
def scene(client, chapter):
    """Create and return a scene under the test chapter."""
    r = client.post("/api/scenes",
                    json={"title": "Scene 1", "content": "<p>Hello world</p>",
                          "chapter_id": chapter["id"], "order_index": 0})
    assert r.status_code == 201
    return r.json()


@pytest.fixture
def test_engine():
    """Expose the shared engine for tests that need to patch module-level engines."""
    return _engine


# ── Co-work API helpers (imported by test_collab.py) ─────────────────────────

def make_invitation(client, *, name="Alice", role="coauthor", pin=None,
                    max_sessions=1, assigned_items=None):
    """POST /api/collab/invitations and assert 201."""
    body: dict = {"name": name, "role": role, "max_sessions": max_sessions}
    if pin is not None:
        body["pin"] = pin
    if assigned_items is not None:
        body["assigned_items"] = assigned_items
    r = client.post("/api/collab/invitations", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def do_join(client, *, token, display_name="Guest", pin=None, client_ip=None):
    """POST /api/collab/join, return the raw Response."""
    body = {"token": token, "display_name": display_name}
    if pin is not None:
        body["pin"] = pin
    headers = {}
    if client_ip:
        headers["X-Client-IP"] = client_ip
    return client.post("/api/collab/join", json=body, headers=headers)


def join_ok(client, *, token, display_name="Guest", pin=None):
    """POST /api/collab/join and assert 200, return JSON."""
    r = do_join(client, token=token, display_name=display_name, pin=pin)
    assert r.status_code == 200, r.text
    return r.json()
