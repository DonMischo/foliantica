"""
Shared fixtures for the Foliantica API test suite.

Each test gets a fresh in-memory SQLite database and a FastAPI TestClient
wired to it via the get_db dependency override.  Production data (foliantica.db)
is never opened or modified.

Isolation guarantee:
  api/conftest.py sets LW_SQLITE_PATH=:memory: before any module is imported.
  database.py reads that env var and creates a StaticPool in-memory engine.
  All startup migrations in main.py run against that same in-memory DB.
  Every test then drops and recreates the schema for full per-test isolation.
"""
import pytest
from fastapi.testclient import TestClient

from models import Base
# database.py has already been configured with an in-memory StaticPool engine
# by api/conftest.py (sets LW_SQLITE_PATH=:memory: before any import).
from database import engine as _engine, SessionLocal as _SessionLocal, get_db
from main import app  # noqa: must import after api/conftest.py sets env vars


@pytest.fixture(autouse=True)
def _fresh_schema():
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
    """FastAPI TestClient connected to the per-test in-memory DB."""
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
    """Expose the shared in-memory engine for tests that need to patch module-level engines."""
    return _engine
