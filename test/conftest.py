"""
Shared pytest fixtures for tests that require a live PostgreSQL database.

The ensure_pg_schema_and_seed fixture runs once per session and is a no-op
when PostgreSQL is not available (e.g. when running test_crypto.py alone).
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "api"))

os.environ.setdefault("LW_PG_PORT",   "5433")
os.environ.setdefault("LW_PG_USER",   "foliantica")
os.environ.setdefault("LW_PG_PASS",   "foliantica")
os.environ.setdefault("LW_PG_DB",     "foliantica")

import pytest


@pytest.fixture(scope="session", autouse=True)
def ensure_pg_schema_and_seed():
    """Create all tables and seed the minimum rows needed by the test suite.

    Silently skipped when PostgreSQL is not reachable (e.g. running only
    test_crypto.py, which has no database dependency).

    Seeded data keeps the test assertions in test_pg_transfer.py and
    test_sync_dump.py meaningful:
      - user_settings  (1 row)
      - projects       (1 row)
      - acts           (1 row)
      - chapters       (1 row)
      - scenes         (1 row — needed for dump/transfer core-table checks)
      - codex_entries  (1 row — same)
    """
    try:
        from models import Base, UserSettings, Project, Act, Chapter, Scene, CodexEntry
        from database import engine, SessionLocal

        Base.metadata.create_all(bind=engine)

        db = SessionLocal()
        try:
            # user_settings ────────────────────────────────────────────────────
            if not db.query(UserSettings).first():
                db.add(UserSettings())
                db.flush()

            # project ──────────────────────────────────────────────────────────
            proj = db.query(Project).first()
            if not proj:
                proj = Project(title="Conftest Seed Project")
                db.add(proj)
                db.flush()   # populate proj.id before FK references

            # act → chapter → scene ────────────────────────────────────────────
            act = db.query(Act).filter_by(project_id=proj.id).first()
            if not act:
                act = Act(project_id=proj.id, title="Seed Act", order_index=0)
                db.add(act)
                db.flush()

            ch = db.query(Chapter).filter_by(act_id=act.id).first()
            if not ch:
                ch = Chapter(act_id=act.id, title="Seed Chapter", order_index=0)
                db.add(ch)
                db.flush()

            if not db.query(Scene).filter_by(chapter_id=ch.id).first():
                db.add(Scene(
                    chapter_id=ch.id,
                    title="Seed Scene",
                    content="Seed content.",
                    order_index=0,
                    word_count=2,
                ))
                db.flush()

            # codex entry ──────────────────────────────────────────────────────
            if not db.query(CodexEntry).filter_by(project_id=proj.id).first():
                db.add(CodexEntry(
                    project_id=proj.id,
                    name="Seed Character",
                    entry_type="character",
                ))

            db.commit()
        finally:
            db.close()
    except Exception:
        pass  # PG not available — DB-dependent tests will fail on their own terms
