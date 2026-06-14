"""
Shared fixtures for the Foliantica API test suite.

Each test gets a fresh PostgreSQL schema and a FastAPI TestClient wired to it
via the get_db dependency override.  The production database is never touched.

Isolation guarantee:
  api/conftest.py points LW_PG_DB at "foliantica_test" before any module is
  imported.  The _ensure_test_db fixture (session-scoped) creates that database
  if it doesn't exist.  Every test then drops and recreates the schema for full
  per-test isolation.
"""
import os
import pytest
from fastapi.testclient import TestClient

from models import Base
from database import engine as _engine, SessionLocal as _SessionLocal, get_db
from main import app  # noqa: must import after api/conftest.py sets env vars


@pytest.fixture(scope="session", autouse=True)
def _ensure_test_db():
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
    """FastAPI TestClient connected to the per-test database."""
    def _override():
        yield db

    app.dependency_overrides[get_db] = _override
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


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
