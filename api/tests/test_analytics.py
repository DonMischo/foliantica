"""
Tests for api/routers/analytics.py.

  - TestCountSyllables  — unit tests for _count_syllables pure function
  - TestSentenceStats   — unit tests for _sentence_stats pure function
  - TestFlesch          — unit tests for _flesch pure function
  - TestAnalyticsEndpoint — GET /api/projects/{id}/analytics
  - TestStatsTotals     — GET /api/stats/totals
  - TestStatsPing       — POST /api/stats/ping
"""
import pytest

from routers.analytics import _count_syllables, _sentence_stats, _flesch
from models import WritingLog


# ── _count_syllables ──────────────────────────────────────────────────────────

class TestCountSyllables:
    def test_empty_returns_zero(self):
        assert _count_syllables("") == 0

    def test_single_vowel_cluster(self):
        # "me" → 1 vowel cluster, trailing e silenced but count already 1 → max(1, 1-1)=max(1,0)=1
        assert _count_syllables("me") == 1

    def test_silent_trailing_e(self):
        # "cake" → [a, e] = 2 clusters, trailing e → 2-1 = 1
        assert _count_syllables("cake") == 1

    def test_two_syllables(self):
        # "hello" → hel-lo → [e, o] = 2 clusters, no trailing e
        assert _count_syllables("hello") == 2

    def test_minimum_one_for_consonant_only(self):
        # "brr" → no vowels → max(1, 0) = 1
        assert _count_syllables("brr") == 1

    def test_multisyllabic(self):
        # "education" → vowels: e, u, a, io → 4 clusters, no trailing e → 4
        assert _count_syllables("education") == 4

    def test_punctuation_stripped(self):
        # Same word with/without punctuation
        assert _count_syllables("hello,") == _count_syllables("hello")

    def test_uppercase_handled(self):
        assert _count_syllables("HELLO") == _count_syllables("hello")

    def test_simple_short_word(self):
        # "the" → [e] = 1, trailing e silenced but count > 1 required → stays 1
        assert _count_syllables("the") == 1


# ── _sentence_stats ───────────────────────────────────────────────────────────

class TestSentenceStats:
    def test_empty_returns_zeros(self):
        avg_sl, dial = _sentence_stats("")
        assert avg_sl == 0.0
        assert dial == 0.0

    def test_no_dialogue(self):
        text = "The cat sat on the mat. It was cold outside."
        avg_sl, dial = _sentence_stats(text)
        assert avg_sl > 0
        assert dial == 0.0

    def test_dialogue_ratio_half(self):
        # 1 dialogue line, 1 narration line
        text = '"Hello there."\nShe looked away.'
        _, dial = _sentence_stats(text)
        assert dial == pytest.approx(0.5)

    def test_all_dialogue(self):
        text = '"First line."\n"Second line."'
        _, dial = _sentence_stats(text)
        assert dial == pytest.approx(1.0)

    def test_avg_sentence_length(self):
        # "One two three. Four five six." → two 3-word sentences → avg = 3.0
        text = "One two three. Four five six."
        avg_sl, _ = _sentence_stats(text)
        assert avg_sl == pytest.approx(3.0)

    def test_curly_quote_counts_as_dialogue(self):
        text = "“Hello world.”\nNarration here."
        _, dial = _sentence_stats(text)
        assert dial == pytest.approx(0.5)


# ── _flesch ───────────────────────────────────────────────────────────────────

class TestFlesch:
    def test_empty_returns_zeros(self):
        assert _flesch("") == (0.0, 0.0)

    def test_whitespace_only_returns_zeros(self):
        assert _flesch("   ") == (0.0, 0.0)

    def test_returns_floats(self):
        ease, grade = _flesch("The cat sat on the mat.")
        assert isinstance(ease, float)
        assert isinstance(grade, float)

    def test_ease_clamped_between_0_and_100(self):
        ease, _ = _flesch("The cat sat on the mat. The big dog ran fast.")
        assert 0.0 <= ease <= 100.0

    def test_grade_non_negative(self):
        _, grade = _flesch("The cat sat. The dog ran.")
        assert grade >= 0.0

    def test_simple_text_higher_ease_than_complex(self):
        simple = "The cat sat. The dog ran fast. It was fun."
        complex_ = "Incomprehensible epistemological ramifications necessitate unprecedented consideration."
        ease_s, _ = _flesch(simple)
        ease_c, _ = _flesch(complex_)
        assert ease_s > ease_c


# ── GET /api/projects/{id}/analytics ─────────────────────────────────────────

class TestAnalyticsEndpoint:
    def test_unknown_project_returns_404(self, client):
        assert client.get("/api/projects/99999/analytics").status_code == 404

    def test_empty_project(self, client, project):
        r = client.get(f"/api/projects/{project['id']}/analytics")
        assert r.status_code == 200
        body = r.json()
        assert body["scenes"] == []
        assert body["chapters"] == []
        assert body["total_word_count"] == 0
        assert body["scene_type_dist"] == {}

    def test_scene_appears_in_analytics(self, client, scene, project):
        r = client.get(f"/api/projects/{project['id']}/analytics")
        assert r.status_code == 200
        body = r.json()
        assert len(body["scenes"]) == 1
        assert len(body["chapters"]) == 1
        s = body["scenes"][0]
        assert s["scene_id"] == scene["id"]
        assert "word_count" in s
        assert "avg_sentence_length" in s
        assert "dialogue_ratio" in s

    def test_scene_type_counted_in_distribution(self, client, scene, project):
        client.patch(f"/api/scenes/{scene['id']}", json={"scene_type": "action"})
        r = client.get(f"/api/projects/{project['id']}/analytics")
        body = r.json()
        assert body["scene_type_dist"].get("action") == 1


# ── GET /api/stats/totals ─────────────────────────────────────────────────────

class TestStatsTotals:
    def test_empty_db_zero_words(self, client):
        r = client.get("/api/stats/totals")
        assert r.status_code == 200
        body = r.json()
        assert body["total_words"] == 0
        assert body["project_words"] == []
        assert body["pov_words"] == []
        assert len(body["day_of_week"]) == 7

    def test_day_of_week_has_seven_entries(self, client):
        body = client.get("/api/stats/totals").json()
        days = [d["day"] for d in body["day_of_week"]]
        assert set(days) == {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"}

    def test_writing_log_counted_in_day_of_week(self, client, db, project):
        db.add(WritingLog(project_id=project["id"], date="2024-01-01", words_added=200))
        db.commit()
        body = client.get("/api/stats/totals").json()
        total = sum(d["words"] for d in body["day_of_week"])
        assert total >= 200

    def test_scene_length_buckets_populated(self, client, scene, db, project):
        # Force a specific word_count so we know exactly which bucket it falls in
        from models import Scene
        db.query(Scene).filter(Scene.id == scene["id"]).update({"word_count": 50})
        db.commit()
        body = client.get("/api/stats/totals").json()
        buckets = body["scene_length_buckets"]
        assert isinstance(buckets, list)
        assert len(buckets) > 0
        # The scene with word_count=50 must be counted in at least one bucket
        assert sum(b["count"] for b in buckets) >= 1


# ── POST /api/stats/ping ──────────────────────────────────────────────────────

class TestStatsPing:
    def test_ping_returns_ok(self, client):
        r = client.post("/api/stats/ping")
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_ping_increments_stats_views_counter(self, client, db):
        """Each ping must increment the stats_views counter in user_settings."""
        from sqlalchemy import text
        # Ensure the settings row exists (ping does a bare UPDATE with no INSERT fallback)
        client.get("/api/settings")
        row = db.execute(text("SELECT stats_views FROM user_settings LIMIT 1")).fetchone()
        assert row is not None
        before = row[0] or 0

        client.post("/api/stats/ping")
        db.expire_all()
        row2 = db.execute(text("SELECT stats_views FROM user_settings LIMIT 1")).fetchone()
        assert row2[0] == before + 1
