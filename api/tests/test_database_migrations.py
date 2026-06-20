"""
Tests for incremental ALTER TABLE migrations in database.py.

These run against the real (embedded) PostgreSQL test database, so a
migration that uses a SQLite-only type like DATETIME — which PostgreSQL
rejects — actually fails here the way it would in production, instead of
being masked by the bare `except Exception: pass` in each migration
function.
"""
from sqlalchemy import text

from database import engine, migrate_achievement_popup_shown


def _drop_popup_shown_at_column():
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE achievement_unlocks DROP COLUMN IF EXISTS popup_shown_at"))


def _has_popup_shown_at_column() -> bool:
    with engine.begin() as conn:
        row = conn.execute(text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'achievement_unlocks' AND column_name = 'popup_shown_at'"
        )).fetchone()
    return row is not None


class TestMigrateAchievementPopupShown:
    def test_adds_column_when_missing(self, db):
        _drop_popup_shown_at_column()
        assert not _has_popup_shown_at_column()

        migrate_achievement_popup_shown()

        assert _has_popup_shown_at_column()

    def test_idempotent_when_column_already_present(self, db):
        # _fresh_schema (via the `db` fixture) already created the column
        # through the ORM model, so this exercises the "already exists" path.
        assert _has_popup_shown_at_column()

        migrate_achievement_popup_shown()  # must not raise

        assert _has_popup_shown_at_column()
