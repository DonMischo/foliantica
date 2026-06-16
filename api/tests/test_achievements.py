"""
Tests for the achievement system:
  - _compute_streaks edge cases
  - _compute_metrics correctness
  - GET /achievements: unlock on first earn, show_toast field
  - POST /achievements/ack: marks popup_shown_at, clears show_toast
"""
from datetime import date, timedelta

import pytest

from models import WritingLog, Scene, Project, Act, Chapter, AchievementUnlock
from routers.achievements import _compute_streaks


# ── _compute_streaks unit tests ───────────────────────────────────────────────

class TestComputeStreaks:
    def test_empty(self):
        assert _compute_streaks([]) == (0, 0)

    def test_single_day_today(self):
        today = date.today().isoformat()
        current, longest = _compute_streaks([today])
        assert longest == 1
        assert current == 1

    def test_single_day_past(self):
        past = (date.today() - timedelta(days=5)).isoformat()
        current, longest = _compute_streaks([past])
        assert longest == 1
        assert current == 0   # streak broke 4 days ago

    def test_consecutive_days_ending_today(self):
        days = [(date.today() - timedelta(days=i)).isoformat() for i in range(5)]
        current, longest = _compute_streaks(days)
        assert longest == 5
        assert current == 5

    def test_streak_broken(self):
        # days 0,1,2 then gap, then days 6,7,8 (past)
        today = date.today()
        days = (
            [(today - timedelta(days=i)).isoformat() for i in range(3)] +
            [(today - timedelta(days=6 + i)).isoformat() for i in range(3)]
        )
        current, longest = _compute_streaks(days)
        assert longest == 3
        assert current == 3   # today is in the recent run

    def test_duplicates_ignored(self):
        today = date.today().isoformat()
        current, longest = _compute_streaks([today, today, today])
        assert longest == 1
        assert current == 1

    def test_longest_vs_current(self):
        # A long streak in the past, a short one ending today
        today = date.today()
        old_run = [(today - timedelta(days=20 + i)).isoformat() for i in range(10)]
        new_run = [(today - timedelta(days=i)).isoformat() for i in range(2)]
        current, longest = _compute_streaks(old_run + new_run)
        assert longest == 10
        assert current == 2


# ── GET /achievements ─────────────────────────────────────────────────────────

class TestGetAchievements:
    def test_returns_list(self, client):
        r = client.get("/api/achievements")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) > 0

    def test_all_have_required_fields(self, client):
        for ach in client.get("/api/achievements").json():
            assert "key" in ach
            assert "name" in ach
            assert "earned" in ach
            assert "show_toast" in ach
            assert "progress" in ach
            assert "progress_max" in ach

    def test_not_earned_by_default(self, client):
        data = client.get("/api/achievements").json()
        # Fresh DB — nothing should be earned
        assert all(not a["earned"] for a in data)

    def test_project_achievement_earned(self, client, project):
        data = client.get("/api/achievements").json()
        proj_ach = next(a for a in data if a["key"] == "project_1")
        assert proj_ach["earned"] is True

    def test_unlock_record_created(self, client, db, project):
        client.get("/api/achievements")
        unlock = db.query(AchievementUnlock).filter_by(key="project_1").first()
        assert unlock is not None
        assert unlock.unlocked_at is not None

    def test_show_toast_true_on_first_earn(self, client, project):
        data = client.get("/api/achievements").json()
        proj_ach = next(a for a in data if a["key"] == "project_1")
        assert proj_ach["show_toast"] is True

    def test_show_toast_false_after_unlock_record_exists(self, client, db, project):
        # Simulate a previous session: unlock already recorded with popup shown
        db.add(AchievementUnlock(key="project_1", popup_shown_at=__import__("datetime").datetime.utcnow()))
        db.commit()
        data = client.get("/api/achievements").json()
        proj_ach = next(a for a in data if a["key"] == "project_1")
        assert proj_ach["show_toast"] is False

    def test_word_achievements(self, client, db):
        # Seed 1000 words via scene word_count
        proj = Project(title="P")
        db.add(proj)
        db.flush()
        act = Act(title="A", project_id=proj.id, order_index=0)
        db.add(act)
        db.flush()
        ch = Chapter(title="C", act_id=act.id, order_index=0)
        db.add(ch)
        db.flush()
        db.add(Scene(title="S", chapter_id=ch.id, order_index=0,
                     content="<p>x</p>", word_count=1000))
        db.commit()

        data = client.get("/api/achievements").json()
        w100 = next(a for a in data if a["key"] == "words_100")
        w1k  = next(a for a in data if a["key"] == "words_1k")
        w5k  = next(a for a in data if a["key"] == "words_5k")
        assert w100["earned"] is True
        assert w1k["earned"]  is True
        assert w5k["earned"]  is False  # only 1000 words, threshold is 5000

    def test_streak_achievement(self, client, db):
        proj = Project(title="P")
        db.add(proj)
        db.flush()
        today = date.today()
        for i in range(7):
            db.add(WritingLog(project_id=proj.id,
                              date=(today - timedelta(days=i)).isoformat(),
                              words_added=200))
        db.commit()

        data = client.get("/api/achievements").json()
        streak_1 = next(a for a in data if a["key"] == "streak_1")
        streak_7 = next(a for a in data if a["key"] == "streak_7")
        streak_14 = next(a for a in data if a["key"] == "streak_14")
        assert streak_1["earned"] is True
        assert streak_7["earned"] is True
        assert streak_14["earned"] is False

    def test_progress_capped_at_threshold(self, client, db):
        # 50 words — progress for words_100 should be 50, not more
        proj = Project(title="P")
        db.add(proj)
        db.flush()
        act = Act(title="A", project_id=proj.id, order_index=0)
        db.add(act)
        db.flush()
        ch = Chapter(title="C", act_id=act.id, order_index=0)
        db.add(ch)
        db.flush()
        db.add(Scene(title="S", chapter_id=ch.id, order_index=0,
                     content="<p>x</p>", word_count=50))
        db.commit()

        data = client.get("/api/achievements").json()
        w100 = next(a for a in data if a["key"] == "words_100")
        assert w100["progress"] == 50
        assert w100["progress_max"] == 100
        assert w100["earned"] is False

    def test_idempotent_unlock(self, client, db, project):
        # Calling GET twice should not create duplicate unlock rows
        client.get("/api/achievements")
        client.get("/api/achievements")
        count = db.query(AchievementUnlock).filter_by(key="project_1").count()
        assert count == 1


# ── POST /achievements/ack ────────────────────────────────────────────────────

class TestAckAchievements:
    def test_ack_sets_popup_shown(self, client, db, project):
        # Earn the achievement first
        client.get("/api/achievements")

        r = client.post("/api/achievements/ack", json={"keys": ["project_1"]})
        assert r.status_code == 200
        assert r.json()["ok"] is True

        unlock = db.query(AchievementUnlock).filter_by(key="project_1").first()
        db.refresh(unlock)
        assert unlock.popup_shown_at is not None

    def test_show_toast_false_after_ack(self, client, project):
        client.get("/api/achievements")
        client.post("/api/achievements/ack", json={"keys": ["project_1"]})

        data = client.get("/api/achievements").json()
        proj_ach = next(a for a in data if a["key"] == "project_1")
        assert proj_ach["show_toast"] is False

    def test_ack_empty_list_is_noop(self, client):
        r = client.post("/api/achievements/ack", json={"keys": []})
        assert r.status_code == 200

    def test_ack_unknown_key_is_noop(self, client):
        r = client.post("/api/achievements/ack", json={"keys": ["does_not_exist"]})
        assert r.status_code == 200

    def test_ack_only_affects_unshown(self, client, db, project):
        from datetime import datetime
        # Pre-set popup_shown_at to a known time
        client.get("/api/achievements")
        unlock = db.query(AchievementUnlock).filter_by(key="project_1").first()
        original_time = datetime(2000, 1, 1)
        unlock.popup_shown_at = original_time
        db.commit()

        # Second ack should NOT update an already-shown entry
        client.post("/api/achievements/ack", json={"keys": ["project_1"]})
        db.refresh(unlock)
        assert unlock.popup_shown_at == original_time
