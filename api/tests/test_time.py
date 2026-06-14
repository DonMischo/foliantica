"""
Tests for api/routers/time.py.

  - TestTimeConfig   — GET / PATCH /api/projects/{id}/time-config
  - TestTimeline     — GET /api/projects/{id}/timeline
  - TestTracks       — CRUD for /api/projects/{id}/timeline-tracks
  - TestEvents       — CRUD for /api/projects/{id}/timeline-events
  - TestTimelineV2   — GET /api/projects/{id}/timeline-v2
"""
import json
import pytest

from models import Scene


# ── Helpers ───────────────────────────────────────────────────────────────────

_SCENE_TIME = {"year": 1, "month": 2, "day": 3, "hour": 10}   # Day time (10 < 20)
_NIGHT_TIME  = {"year": 1, "month": 2, "day": 3, "hour": 22}  # Night time (22 >= 20)


def _set_scene_time(db, scene_id, time_data):
    """Set scene_time directly via ORM to avoid SQLAlchemy identity-map caching issues."""
    from models import Scene
    s = db.get(Scene, scene_id)
    s.scene_time = json.dumps(time_data)
    db.commit()
    db.expire_all()


def _make_track(client, project_id, **kwargs):
    defaults = {"name": "Main Track", "color": "#ff0000", "track_type": "parallel", "order_index": 0}
    defaults.update(kwargs)
    r = client.post(f"/api/projects/{project_id}/timeline-tracks", json=defaults)
    assert r.status_code == 200
    return r.json()


def _make_event(client, project_id, **kwargs):
    defaults = {"title": "Test Event"}
    defaults.update(kwargs)
    r = client.post(f"/api/projects/{project_id}/timeline-events", json=defaults)
    assert r.status_code == 200
    return r.json()


# ── Time config ───────────────────────────────────────────────────────────────

class TestTimeConfig:
    def test_get_returns_default_config(self, client, project):
        r = client.get(f"/api/projects/{project['id']}/time-config")
        assert r.status_code == 200
        body = r.json()
        assert "units" in body
        assert "day_night" in body
        # Default enabled units include year, month, day, hour
        enabled_ids = [u["id"] for u in body["units"] if u["enabled"]]
        assert "year" in enabled_ids
        assert "day" in enabled_ids
        assert "hour" in enabled_ids

    def test_get_unknown_project_returns_404(self, client):
        assert client.get("/api/projects/99999/time-config").status_code == 404

    def test_patch_updates_day_night(self, client, project):
        new_config = {
            "units": [
                {"id": "year",   "singular": "Year",   "plural": "Years",   "count_per_parent": 1000, "value_names": [], "enabled": True},
                {"id": "month",  "singular": "Month",  "plural": "Months",  "count_per_parent": 12,   "value_names": [], "enabled": False},
                {"id": "day",    "singular": "Day",    "plural": "Days",    "count_per_parent": 30,   "value_names": [], "enabled": True},
                {"id": "hour",   "singular": "Hour",   "plural": "Hours",   "count_per_parent": 24,   "value_names": [], "enabled": True},
            ],
            "day_night": {"hours_per_day": 24, "night_start_hour": 22.0, "night_duration": 8.0},
        }
        r = client.patch(f"/api/projects/{project['id']}/time-config", json=new_config)
        assert r.status_code == 200
        assert r.json()["day_night"]["night_start_hour"] == 22.0

    def test_patch_persists(self, client, project):
        config_payload = {
            "units": [
                {"id": "year",  "singular": "Year",  "plural": "Years",  "count_per_parent": 1000, "value_names": [], "enabled": True},
                {"id": "month", "singular": "Month", "plural": "Months", "count_per_parent": 12,   "value_names": [], "enabled": False},
                {"id": "day",   "singular": "Day",   "plural": "Days",   "count_per_parent": 30,   "value_names": [], "enabled": True},
                {"id": "hour",  "singular": "Hour",  "plural": "Hours",  "count_per_parent": 24,   "value_names": [], "enabled": False},
            ],
            "day_night": {"hours_per_day": 24, "night_start_hour": 21.0, "night_duration": 9.0},
        }
        client.patch(f"/api/projects/{project['id']}/time-config", json=config_payload)
        r = client.get(f"/api/projects/{project['id']}/time-config")
        assert r.json()["day_night"]["night_start_hour"] == 21.0

    def test_patch_unknown_project_returns_404(self, client):
        assert client.patch("/api/projects/99999/time-config", json={}).status_code == 404


# ── Timeline ──────────────────────────────────────────────────────────────────

class TestTimeline:
    def test_unknown_project_returns_404(self, client):
        assert client.get("/api/projects/99999/timeline").status_code == 404

    def test_empty_timeline_no_entries(self, client, project):
        r = client.get(f"/api/projects/{project['id']}/timeline")
        assert r.status_code == 200
        body = r.json()
        assert body["entries"] == []
        assert "config" in body
        assert "is_shared" in body

    def test_scene_without_time_excluded(self, client, scene, project):
        # scene fixture has no scene_time set
        r = client.get(f"/api/projects/{project['id']}/timeline")
        assert r.json()["entries"] == []

    def test_scene_with_time_appears(self, client, db, scene, project):
        _set_scene_time(db, scene["id"], _SCENE_TIME)
        r = client.get(f"/api/projects/{project['id']}/timeline")
        entries = r.json()["entries"]
        assert len(entries) == 1
        e = entries[0]
        assert e["scene_id"] == scene["id"]
        assert "time_display" in e
        assert "sort_key" in e

    def test_day_night_label_day(self, client, db, scene, project):
        _set_scene_time(db, scene["id"], _SCENE_TIME)   # hour=10 → Day
        entries = client.get(f"/api/projects/{project['id']}/timeline").json()["entries"]
        assert entries[0]["day_night"] == "Day"

    def test_day_night_label_night(self, client, db, scene, project):
        _set_scene_time(db, scene["id"], _NIGHT_TIME)   # hour=22 → Night
        entries = client.get(f"/api/projects/{project['id']}/timeline").json()["entries"]
        assert entries[0]["day_night"] == "Night"


# ── Timeline Tracks ───────────────────────────────────────────────────────────

class TestTracks:
    def test_list_empty(self, client, project):
        r = client.get(f"/api/projects/{project['id']}/timeline-tracks")
        assert r.status_code == 200
        assert r.json() == []

    def test_create_returns_track(self, client, project):
        r = client.post(f"/api/projects/{project['id']}/timeline-tracks", json={
            "name": "Political", "color": "#3b82f6", "track_type": "parallel", "order_index": 0,
        })
        assert r.status_code == 200
        body = r.json()
        assert body["id"] > 0
        assert body["name"] == "Political"
        assert body["color"] == "#3b82f6"
        assert body["project_id"] == project["id"]

    def test_list_shows_created_track(self, client, project):
        _make_track(client, project["id"], name="Alpha")
        tracks = client.get(f"/api/projects/{project['id']}/timeline-tracks").json()
        assert any(t["name"] == "Alpha" for t in tracks)

    def test_create_with_time_bounds(self, client, project):
        r = client.post(f"/api/projects/{project['id']}/timeline-tracks", json={
            "name": "Bounded",
            "start_time": {"year": 1, "day": 1},
            "end_time":   {"year": 2, "day": 1},
        })
        assert r.status_code == 200
        body = r.json()
        assert body["start_time"] == {"year": 1, "day": 1}
        assert body["end_time"]   == {"year": 2, "day": 1}

    def test_update_track_name(self, client, project):
        track = _make_track(client, project["id"], name="Before")
        r = client.patch(
            f"/api/projects/{project['id']}/timeline-tracks/{track['id']}",
            json={"name": "After"},
        )
        assert r.status_code == 200
        assert r.json()["name"] == "After"

    def test_update_unknown_track_returns_404(self, client, project):
        r = client.patch(
            f"/api/projects/{project['id']}/timeline-tracks/99999",
            json={"name": "x"},
        )
        assert r.status_code == 404

    def test_delete_track(self, client, project):
        track = _make_track(client, project["id"])
        r = client.delete(f"/api/projects/{project['id']}/timeline-tracks/{track['id']}")
        assert r.status_code == 204
        tracks = client.get(f"/api/projects/{project['id']}/timeline-tracks").json()
        assert not any(t["id"] == track["id"] for t in tracks)

    def test_delete_unknown_track_returns_404(self, client, project):
        r = client.delete(f"/api/projects/{project['id']}/timeline-tracks/99999")
        assert r.status_code == 404


# ── Timeline Events ───────────────────────────────────────────────────────────

class TestEvents:
    def test_list_empty(self, client, project):
        r = client.get(f"/api/projects/{project['id']}/timeline-events")
        assert r.status_code == 200
        assert r.json() == []

    def test_create_returns_event(self, client, project):
        r = client.post(f"/api/projects/{project['id']}/timeline-events", json={
            "title": "Battle of Helm's Deep",
        })
        assert r.status_code == 200
        body = r.json()
        assert body["id"] > 0
        assert body["title"] == "Battle of Helm's Deep"
        assert body["project_id"] == project["id"]

    def test_create_event_with_scene_time(self, client, project):
        r = client.post(f"/api/projects/{project['id']}/timeline-events", json={
            "title": "Coronation",
            "scene_time": {"year": 3, "month": 4, "day": 15, "hour": 12},
        })
        assert r.status_code == 200
        assert r.json()["scene_time"] == {"year": 3, "month": 4, "day": 15, "hour": 12}

    def test_create_event_linked_to_track(self, client, project):
        track = _make_track(client, project["id"])
        r = client.post(f"/api/projects/{project['id']}/timeline-events", json={
            "title": "Linked Event",
            "track_id": track["id"],
        })
        assert r.status_code == 200
        assert r.json()["track_id"] == track["id"]

    def test_list_shows_created_event(self, client, project):
        _make_event(client, project["id"], title="EarlyEvent")
        events = client.get(f"/api/projects/{project['id']}/timeline-events").json()
        assert any(e["title"] == "EarlyEvent" for e in events)

    def test_update_event_title(self, client, project):
        event = _make_event(client, project["id"], title="Old Title")
        r = client.patch(
            f"/api/projects/{project['id']}/timeline-events/{event['id']}",
            json={"title": "New Title"},
        )
        assert r.status_code == 200
        assert r.json()["title"] == "New Title"

    def test_update_unknown_event_returns_404(self, client, project):
        r = client.patch(
            f"/api/projects/{project['id']}/timeline-events/99999",
            json={"title": "x"},
        )
        assert r.status_code == 404

    def test_delete_event(self, client, project):
        event = _make_event(client, project["id"])
        r = client.delete(f"/api/projects/{project['id']}/timeline-events/{event['id']}")
        assert r.status_code == 204
        events = client.get(f"/api/projects/{project['id']}/timeline-events").json()
        assert not any(e["id"] == event["id"] for e in events)

    def test_delete_unknown_event_returns_404(self, client, project):
        r = client.delete(f"/api/projects/{project['id']}/timeline-events/99999")
        assert r.status_code == 404


# ── Timeline V2 ───────────────────────────────────────────────────────────────

class TestTimelineV2:
    def test_unknown_project_returns_404(self, client):
        assert client.get("/api/projects/99999/timeline-v2").status_code == 404

    def test_empty_project_has_empty_nodes(self, client, project):
        r = client.get(f"/api/projects/{project['id']}/timeline-v2")
        assert r.status_code == 200
        body = r.json()
        assert body["story_nodes"] == []
        assert body["event_nodes"] == []
        assert "tracks" in body
        assert "config" in body

    def test_scene_with_time_appears_as_story_node(self, client, db, scene, project):
        _set_scene_time(db, scene["id"], _SCENE_TIME)
        body = client.get(f"/api/projects/{project['id']}/timeline-v2").json()
        assert len(body["story_nodes"]) == 1
        node = body["story_nodes"][0]
        assert node["type"] == "scene"
        assert node["scene_id"] == scene["id"]
        assert node["id"] == f"scene-{scene['id']}"

    def test_event_appears_as_event_node(self, client, project):
        _make_event(client, project["id"], title="My Event")
        body = client.get(f"/api/projects/{project['id']}/timeline-v2").json()
        assert len(body["event_nodes"]) == 1
        node = body["event_nodes"][0]
        assert node["type"] == "event"
        assert node["title"] == "My Event"

    def test_track_appears_in_tracks(self, client, project):
        _make_track(client, project["id"], name="Subplot A")
        body = client.get(f"/api/projects/{project['id']}/timeline-v2").json()
        assert any(t["name"] == "Subplot A" for t in body["tracks"])


# ── Track → event cascade (SET NULL) ─────────────────────────────────────────

class TestTrackEventCascade:
    """Deleting a track must set event.track_id to NULL, not delete the event."""

    def test_delete_track_nullifies_event_track_id(self, client, project):
        track = _make_track(client, project["id"], name="Doomed Track")
        event = _make_event(client, project["id"], title="Orphan Event",
                            track_id=track["id"])
        assert event["track_id"] == track["id"]

        client.delete(f"/api/projects/{project['id']}/timeline-tracks/{track['id']}")

        events = client.get(f"/api/projects/{project['id']}/timeline-events").json()
        match = next(e for e in events if e["id"] == event["id"])
        assert match["track_id"] is None   # SET NULL via FK ondelete

    def test_delete_track_does_not_delete_events(self, client, project):
        track = _make_track(client, project["id"])
        event = _make_event(client, project["id"], title="Survivor",
                            track_id=track["id"])

        client.delete(f"/api/projects/{project['id']}/timeline-tracks/{track['id']}")

        events = client.get(f"/api/projects/{project['id']}/timeline-events").json()
        assert any(e["id"] == event["id"] for e in events)
