"""
Tests for scenes.py extras — version management, mention stats, writing log, ghost texts.

  - TestSceneReorder     — POST /api/scenes/reorder
  - TestSceneVersions    — POST/GET /api/scenes/{id}/versions + restore + 404
  - TestMentionStats     — GET /api/scenes/{id}/mention-stats, /api/projects/{id}/mention-stats
  - TestMentionsRescan   — POST /api/projects/{id}/mentions/rescan
  - TestWritingLog       — GET /api/projects/{id}/writing-log, /api/writing-log
  - TestGhostTexts       — GET /api/projects/{id}/ghost-texts
  - TestScanMentions     — unit tests for _scan_mentions (pure function)
"""
import json
import pytest


# ── Scene reorder ─────────────────────────────────────────────────────────────

class TestSceneReorder:
    def _create_scene(self, client, chapter_id, title, order_index):
        r = client.post("/api/scenes", json={
            "title": title,
            "content": "<p>Content</p>",
            "chapter_id": chapter_id,
            "order_index": order_index,
        })
        assert r.status_code == 201
        return r.json()

    def test_reorder_swaps_scene_positions(self, client, chapter):
        s1 = self._create_scene(client, chapter["id"], "First", 0)
        s2 = self._create_scene(client, chapter["id"], "Second", 1)

        r = client.post("/api/scenes/reorder", json={"items": [
            {"id": s1["id"], "order_index": 1},
            {"id": s2["id"], "order_index": 0},
        ]})
        assert r.status_code == 204

        # Verify the order changed
        scenes = client.get(f"/api/chapters/{chapter['id']}/scenes").json()
        by_id = {s["id"]: s for s in scenes}
        assert by_id[s1["id"]]["order_index"] == 1
        assert by_id[s2["id"]]["order_index"] == 0

    def test_reorder_ignores_unknown_ids(self, client):
        # Non-existent IDs are silently skipped (no 404)
        r = client.post("/api/scenes/reorder", json={"items": [
            {"id": 99999, "order_index": 0},
        ]})
        assert r.status_code == 204


# ── Scene versions ────────────────────────────────────────────────────────────

class TestSceneVersions:
    def test_create_version_returns_201(self, client, scene):
        r = client.post(f"/api/scenes/{scene['id']}/versions", json={"content": "<p>Version 1</p>"})
        assert r.status_code == 201
        body = r.json()
        assert body["scene_id"] == scene["id"]
        assert "content_hash" in body

    def test_create_version_unknown_scene_returns_404(self, client):
        r = client.post("/api/scenes/99999/versions", json={"content": "<p>Text</p>"})
        assert r.status_code == 404

    def test_dedup_same_content_does_not_create_new_version(self, client, scene):
        content = "<p>Duplicate content</p>"
        r1 = client.post(f"/api/scenes/{scene['id']}/versions", json={"content": content})
        r2 = client.post(f"/api/scenes/{scene['id']}/versions", json={"content": content})
        assert r1.json()["id"] == r2.json()["id"]

    def test_different_content_creates_new_version(self, client, scene):
        r1 = client.post(f"/api/scenes/{scene['id']}/versions", json={"content": "<p>Draft A</p>"})
        r2 = client.post(f"/api/scenes/{scene['id']}/versions", json={"content": "<p>Draft B</p>"})
        assert r1.json()["id"] != r2.json()["id"]

    def test_list_versions_in_desc_order(self, client, scene):
        client.post(f"/api/scenes/{scene['id']}/versions", json={"content": "<p>v1</p>"})
        client.post(f"/api/scenes/{scene['id']}/versions", json={"content": "<p>v2</p>"})
        versions = client.get(f"/api/scenes/{scene['id']}/versions").json()
        assert len(versions) == 2
        # Newest first
        assert versions[0]["id"] > versions[1]["id"]

    def test_get_specific_version(self, client, scene):
        vid = client.post(
            f"/api/scenes/{scene['id']}/versions", json={"content": "<p>Specific</p>"}
        ).json()["id"]
        r = client.get(f"/api/scenes/{scene['id']}/versions/{vid}")
        assert r.status_code == 200
        assert r.json()["content"] == "<p>Specific</p>"

    def test_get_unknown_version_returns_404(self, client, scene):
        r = client.get(f"/api/scenes/{scene['id']}/versions/99999")
        assert r.status_code == 404

    def test_restore_version_sets_scene_content(self, client, scene):
        # Save a version of the old content
        vid = client.post(
            f"/api/scenes/{scene['id']}/versions", json={"content": "<p>Old content</p>"}
        ).json()["id"]

        # Update the scene to different content
        client.patch(f"/api/scenes/{scene['id']}", json={"content": "<p>New content</p>"})

        # Restore the old version
        r = client.post(f"/api/scenes/{scene['id']}/versions/{vid}/restore")
        assert r.status_code == 200

        # Scene content should now be the restored version
        scene_data = client.get(f"/api/scenes/{scene['id']}").json()
        assert scene_data["content"] == "<p>Old content</p>"

    def test_restore_snapshots_current_content_first(self, client, scene):
        # Give the scene some content
        client.patch(f"/api/scenes/{scene['id']}", json={"content": "<p>Current</p>"})

        # Create a saved version to restore to
        vid = client.post(
            f"/api/scenes/{scene['id']}/versions", json={"content": "<p>Saved</p>"}
        ).json()["id"]

        # Update to something else (this is what will be snapshotted on restore)
        client.patch(f"/api/scenes/{scene['id']}", json={"content": "<p>Before restore</p>"})

        client.post(f"/api/scenes/{scene['id']}/versions/{vid}/restore")

        # The pre-restore content should now exist as a version
        versions = client.get(f"/api/scenes/{scene['id']}/versions").json()
        contents = [v["id"] for v in versions]
        # At minimum: the saved version + the snapshotted pre-restore content
        assert len(contents) >= 2

    def test_restore_unknown_scene_returns_404(self, client):
        r = client.post("/api/scenes/99999/versions/1/restore")
        assert r.status_code == 404

    def test_restore_unknown_version_returns_404(self, client, scene):
        r = client.post(f"/api/scenes/{scene['id']}/versions/99999/restore")
        assert r.status_code == 404


# ── Mention stats ─────────────────────────────────────────────────────────────

class TestMentionStats:
    def test_scene_mention_stats_empty_without_codex(self, client, scene):
        r = client.get(f"/api/scenes/{scene['id']}/mention-stats")
        assert r.status_code == 200
        assert r.json() == []

    def test_mention_detected_when_scene_created_with_matching_content(self, client, project, chapter):
        # Create codex entry BEFORE scene so mention scanning finds it
        entry = client.post("/api/codex", json={
            "name": "Gandalf",
            "project_id": project["id"],
            "entry_type": "character",
        }).json()

        scene = client.post("/api/scenes", json={
            "title": "The Meeting",
            "content": "<p>Gandalf arrived at the Shire.</p>",
            "chapter_id": chapter["id"],
            "order_index": 0,
        }).json()

        stats = client.get(f"/api/scenes/{scene['id']}/mention-stats").json()
        matched = [s for s in stats if s["codex_id"] == entry["id"]]
        assert len(matched) == 1
        assert matched[0]["count"] >= 1

    def test_project_mention_stats_aggregated(self, client, project, chapter):
        entry = client.post("/api/codex", json={
            "name": "Frodo",
            "project_id": project["id"],
            "entry_type": "character",
        }).json()

        # Two scenes, both mentioning Frodo
        client.post("/api/scenes", json={
            "title": "Scene A",
            "content": "<p>Frodo left the Shire.</p>",
            "chapter_id": chapter["id"],
            "order_index": 0,
        })
        client.post("/api/scenes", json={
            "title": "Scene B",
            "content": "<p>Frodo met Gandalf.</p>",
            "chapter_id": chapter["id"],
            "order_index": 1,
        })

        stats = client.get(f"/api/projects/{project['id']}/mention-stats").json()
        matched = [s for s in stats if s["codex_id"] == entry["id"]]
        assert len(matched) == 1
        # Aggregated across two scenes — count should be at least 2
        assert matched[0]["count"] >= 2


# ── Mentions rescan ───────────────────────────────────────────────────────────

class TestMentionsRescan:
    def test_rescan_empty_project(self, client, project):
        r = client.post(f"/api/projects/{project['id']}/mentions/rescan")
        assert r.status_code == 200
        assert r.json() == {"scanned": 0}

    def test_rescan_returns_scene_count(self, client, project, scene):
        r = client.post(f"/api/projects/{project['id']}/mentions/rescan")
        assert r.status_code == 200
        assert r.json()["scanned"] == 1

    def test_rescan_rebuilds_mention_stats(self, client, project, chapter):
        # Create entry and scene without a match initially
        entry = client.post("/api/codex", json={
            "name": "Aragorn",
            "project_id": project["id"],
            "entry_type": "character",
        }).json()

        # Scene created before codex entry → no stats
        scene = client.post("/api/scenes", json={
            "title": "Battle",
            "content": "<p>Aragorn led the charge.</p>",
            "chapter_id": chapter["id"],
            "order_index": 0,
        }).json()

        # Rescan should now detect the mention
        client.post(f"/api/projects/{project['id']}/mentions/rescan")
        stats = client.get(f"/api/scenes/{scene['id']}/mention-stats").json()
        matched = [s for s in stats if s["codex_id"] == entry["id"]]
        assert len(matched) == 1
        assert matched[0]["count"] >= 1


# ── Scene mention rescan (per-scene) ─────────────────────────────────────────

class TestSceneRescan:
    def test_rescan_unknown_scene_returns_404(self, client):
        r = client.post("/api/scenes/99999/mentions/rescan")
        assert r.status_code == 404

    def test_rescan_returns_scanned_1(self, client, scene):
        r = client.post(f"/api/scenes/{scene['id']}/mentions/rescan")
        assert r.status_code == 200
        assert r.json() == {"scanned": 1}

    def test_rescan_rebuilds_stats_for_late_added_entry(self, client, project, chapter):
        # Scene exists before codex entry → initial scan had nothing to match
        scene = client.post("/api/scenes", json={
            "title": "The Shire",
            "content": "<p>Bilbo sat in his hobbit-hole.</p>",
            "chapter_id": chapter["id"],
            "order_index": 0,
        }).json()

        entry = client.post("/api/codex", json={
            "name": "Bilbo",
            "project_id": project["id"],
            "entry_type": "character",
        }).json()

        # Stats missing before rescan
        before = client.get(f"/api/scenes/{scene['id']}/mention-stats").json()
        assert not any(s["codex_id"] == entry["id"] for s in before)

        client.post(f"/api/scenes/{scene['id']}/mentions/rescan")

        after = client.get(f"/api/scenes/{scene['id']}/mention-stats").json()
        matched = [s for s in after if s["codex_id"] == entry["id"]]
        assert len(matched) == 1
        assert matched[0]["count"] >= 1

    def test_rescan_does_not_touch_other_scenes(self, client, project, chapter):
        entry = client.post("/api/codex", json={
            "name": "Sam",
            "project_id": project["id"],
            "entry_type": "character",
        }).json()

        scene_a = client.post("/api/scenes", json={
            "title": "A",
            "content": "<p>Sam walked home.</p>",
            "chapter_id": chapter["id"],
            "order_index": 0,
        }).json()
        scene_b = client.post("/api/scenes", json={
            "title": "B",
            "content": "<p>No mentions here.</p>",
            "chapter_id": chapter["id"],
            "order_index": 1,
        }).json()

        client.post(f"/api/scenes/{scene_a['id']}/mentions/rescan")

        stats_b = client.get(f"/api/scenes/{scene_b['id']}/mention-stats").json()
        assert not any(s["codex_id"] == entry["id"] for s in stats_b)


# ── Writing log ───────────────────────────────────────────────────────────────

class TestWritingLog:
    def test_project_writing_log_empty_initially(self, client, project):
        r = client.get(f"/api/projects/{project['id']}/writing-log")
        assert r.status_code == 200
        assert r.json() == []

    def test_global_writing_log_empty_initially(self, client):
        r = client.get("/api/writing-log")
        assert r.status_code == 200
        assert r.json() == []

    def test_updating_scene_content_logs_words(self, client, project, scene):
        # Update scene from "Hello world" (2 words) to longer content (adds words)
        client.patch(f"/api/scenes/{scene['id']}", json={
            "content": "<p>This is a longer paragraph with more words than before.</p>",
        })
        log = client.get(f"/api/projects/{project['id']}/writing-log").json()
        assert len(log) == 1
        assert log[0]["words"] > 0

    def test_global_log_aggregates_all_projects(self, client, project, scene):
        client.patch(f"/api/scenes/{scene['id']}", json={
            "content": "<p>Added five new words here.</p>",
        })
        global_log = client.get("/api/writing-log").json()
        assert len(global_log) >= 1
        assert global_log[0]["words"] > 0


# ── Ghost texts ───────────────────────────────────────────────────────────────

class TestGhostTexts:
    def test_empty_project_returns_empty_list(self, client, project):
        r = client.get(f"/api/projects/{project['id']}/ghost-texts")
        assert r.status_code == 200
        assert r.json() == []

    def test_scene_without_ghost_not_returned(self, client, project, scene):
        r = client.get(f"/api/projects/{project['id']}/ghost-texts")
        assert r.status_code == 200
        assert r.json() == []

    def test_scene_with_ghost_span_returned(self, client, project, scene):
        ghost_content = '<p>Normal text <span data-ghost="true">AI suggestion here</span> end.</p>'
        client.patch(f"/api/scenes/{scene['id']}", json={"content": ghost_content})

        r = client.get(f"/api/projects/{project['id']}/ghost-texts")
        assert r.status_code == 200
        result = r.json()
        assert len(result) == 1
        assert result[0]["scene_id"] == scene["id"]
        assert "AI suggestion here" in result[0]["ghost_texts"]

    def test_multiple_ghost_spans_all_captured(self, client, project, scene):
        content = (
            '<p><span data-ghost="true">First ghost</span>'
            ' and <span data-ghost="true">Second ghost</span></p>'
        )
        client.patch(f"/api/scenes/{scene['id']}", json={"content": content})

        result = client.get(f"/api/projects/{project['id']}/ghost-texts").json()
        ghosts = result[0]["ghost_texts"]
        assert "First ghost" in ghosts
        assert "Second ghost" in ghosts


# ── Version pruning ───────────────────────────────────────────────────────────

class TestVersionPruning:
    def test_keeps_30_newest_even_when_all_are_old(self, client, scene, db):
        """The contract is "keep the 30 most recent versions". Versions older
        than 30 days that are still among the newest 30 must NOT be purged."""
        from datetime import datetime, timedelta
        from models import SceneVersion
        from routers.scenes import _prune_versions

        base = datetime(2020, 1, 1)  # all far older than 30 days
        for i in range(35):
            db.add(SceneVersion(
                scene_id=scene["id"],
                content=f"<p>v{i}</p>",
                content_hash=f"hash{i}",
                created_at=base + timedelta(minutes=i),
            ))
        db.commit()

        _prune_versions(scene["id"], db)
        db.commit()

        remaining = (
            db.query(SceneVersion)
            .filter(SceneVersion.scene_id == scene["id"])
            .order_by(SceneVersion.created_at.desc())
            .all()
        )
        assert len(remaining) == 30
        contents = {v.content for v in remaining}
        assert "<p>v34</p>" in contents   # newest kept
        assert "<p>v5</p>" in contents    # 30th-newest kept
        assert "<p>v4</p>" not in contents  # oldest beyond cap pruned
        assert "<p>v0</p>" not in contents


# ── Nullable field clears (explicit null must clear, not be ignored) ──────────

class TestSceneNullableClears:
    def test_clear_node_position_with_null(self, client, scene):
        client.patch(f"/api/scenes/{scene['id']}", json={"node_x": 10.5, "node_y": 20.0})
        s = client.get(f"/api/scenes/{scene['id']}").json()
        assert s["node_x"] == 10.5 and s["node_y"] == 20.0

        # Explicit null must clear the value (remove from corkboard canvas)
        client.patch(f"/api/scenes/{scene['id']}", json={"node_x": None, "node_y": None})
        s = client.get(f"/api/scenes/{scene['id']}").json()
        assert s["node_x"] is None
        assert s["node_y"] is None

    def test_clear_synopsis_with_null(self, client, scene):
        client.patch(f"/api/scenes/{scene['id']}", json={"synopsis": "A summary"})
        assert client.get(f"/api/scenes/{scene['id']}").json()["synopsis"] == "A summary"

        client.patch(f"/api/scenes/{scene['id']}", json={"synopsis": None})
        assert client.get(f"/api/scenes/{scene['id']}").json()["synopsis"] is None

    def test_clear_global_order_with_null(self, client, scene):
        client.patch(f"/api/scenes/{scene['id']}", json={"global_order": 5})
        assert client.get(f"/api/scenes/{scene['id']}").json()["global_order"] == 5

        client.patch(f"/api/scenes/{scene['id']}", json={"global_order": None})
        assert client.get(f"/api/scenes/{scene['id']}").json()["global_order"] is None


# ── Scene delete cascades to versions ────────────────────────────────────────

class TestSceneDeleteCascade:
    """SceneVersion.scene_id has ondelete="CASCADE" — deleting a scene must
    remove all its versions."""

    def test_delete_scene_removes_its_versions(self, client, chapter, db):  # noqa: keep
        from models import SceneVersion

        scene = client.post("/api/scenes", json={
            "title": "Doomed Scene", "content": "<p>Text</p>",
            "chapter_id": chapter["id"], "order_index": 0,
        }).json()

        # Create a couple of versions
        client.post(f"/api/scenes/{scene['id']}/versions", json={"content": "<p>v1</p>"})
        client.post(f"/api/scenes/{scene['id']}/versions", json={"content": "<p>v2</p>"})

        versions_before = (
            db.query(SceneVersion)
            .filter(SceneVersion.scene_id == scene["id"])
            .count()
        )
        assert versions_before == 2

        client.delete(f"/api/scenes/{scene['id']}")
        db.expire_all()

        versions_after = (
            db.query(SceneVersion)
            .filter(SceneVersion.scene_id == scene["id"])
            .count()
        )
        assert versions_after == 0


# ── _scan_mentions unit tests ─────────────────────────────────────────────────

class TestScanMentions:
    """Unit tests for the _scan_mentions pure function.

    Tests against CodexEntry-like objects (using types.SimpleNamespace so we
    don't need a running DB).
    """

    from types import SimpleNamespace

    def _entry(self, id: int, name: str, aliases: list[str] | None = None) -> object:
        from types import SimpleNamespace
        return SimpleNamespace(
            id=id,
            name=name,
            aliases=json.dumps(aliases) if aliases is not None else None,
        )

    def _scan(self, content: str, entries: list, lang: str = "en") -> dict:
        from routers.scenes import _scan_mentions
        return _scan_mentions(content, entries, lang)

    def test_no_entries_returns_empty(self):
        assert self._scan("<p>Clara walked home.</p>", []) == {}

    def test_basic_name_match(self):
        entry = self._entry(1, "Clara")
        r = self._scan("<p>Clara walked home.</p>", [entry])
        assert r == {1: 1}

    def test_case_insensitive_match(self):
        entry = self._entry(1, "Clara")
        r = self._scan("<p>clara walked home.</p>", [entry])
        assert r == {1: 1}

    def test_multiple_occurrences_counted(self):
        entry = self._entry(1, "Sam")
        r = self._scan("<p>Sam saw Sam. Sam laughed.</p>", [entry])
        assert r == {1: 3}

    def test_alias_matched(self):
        entry = self._entry(1, "Samuel", ["Sam", "Sammy"])
        r = self._scan("<p>Sam walked by.</p>", [entry])
        assert r == {1: 1}

    def test_name_and_alias_both_counted(self):
        entry = self._entry(1, "Samuel", ["Sam"])
        r = self._scan("<p>Samuel saw Sam later.</p>", [entry])
        assert r == {1: 2}

    def test_html_stripped_before_matching(self):
        entry = self._entry(1, "Clara")
        # Name split across tags would not be a valid match in the original HTML
        r = self._scan("<p><strong>Clara</strong> walked home.</p>", [entry])
        assert r == {1: 1}

    def test_no_match_returns_zero_count_omitted(self):
        entry = self._entry(1, "Bilbo")
        r = self._scan("<p>Clara walked home.</p>", [entry])
        assert 1 not in r

    def test_word_boundary_prevents_substring_match(self):
        # "Sam" should not match inside "Samuel" or "Samurai"
        entry = self._entry(1, "Sam")
        r = self._scan("<p>Samuel and Samurai live here.</p>", [entry])
        assert 1 not in r

    def test_special_regex_chars_in_name_handled(self):
        # Names like "J.R.R. Tolkien" contain dots that would break an unescaped regex.
        entry = self._entry(1, "J.R.R. Tolkien")
        r = self._scan("<p>J.R.R. Tolkien wrote the book.</p>", [entry])
        assert r == {1: 1}

    def test_name_with_parentheses_escaped(self):
        entry = self._entry(1, "The One (Ring)")
        r = self._scan("<p>They feared The One (Ring) above all.</p>", [entry])
        assert r == {1: 1}

    def test_entry_with_no_aliases_json_null(self):
        # aliases=None in DB — should not crash
        entry = self._entry(1, "Miya", aliases=None)
        r = self._scan("<p>Miya smiled.</p>", [entry])
        assert r == {1: 1}

    def test_entry_with_empty_aliases_list(self):
        entry = self._entry(1, "Lena", aliases=[])
        r = self._scan("<p>Lena arrived.</p>", [entry])
        assert r == {1: 1}

    def test_multiple_entries_independently_counted(self):
        e1 = self._entry(1, "Clara")
        e2 = self._entry(2, "Miya")
        r = self._scan("<p>Clara met Miya. Clara waved.</p>", [e1, e2])
        assert r == {1: 2, 2: 1}

    def test_empty_content_returns_empty(self):
        entry = self._entry(1, "Clara")
        assert self._scan("", [entry]) == {}

    def test_unicode_name_matched(self):
        entry = self._entry(1, "Ärger")
        r = self._scan("<p>Ärger war groß.</p>", [entry])
        assert r == {1: 1}


# ── _scan_mentions: German genitive ("Miyas" = "Miya's") ──────────────────────

class TestScanMentionsGermanGenitive:
    """German forms the possessive by fusing "-s" onto the name with no
    separator ("Miyas Schwert"), unlike English's apostrophe ("Miya's sword").
    lang="de" must recognize the fused form as a mention; lang="en" (default)
    must not, since an unrelated word could coincidentally end in the name."""

    def _entry(self, id: int, name: str, aliases: list[str] | None = None) -> object:
        from types import SimpleNamespace
        return SimpleNamespace(
            id=id,
            name=name,
            aliases=json.dumps(aliases) if aliases is not None else None,
        )

    def _scan(self, content: str, entries: list, lang: str = "en") -> dict:
        from routers.scenes import _scan_mentions
        return _scan_mentions(content, entries, lang)

    def test_bare_name_still_matches_in_german(self):
        entry = self._entry(1, "Miya")
        r = self._scan("<p>Miya ging nach Hause.</p>", [entry], lang="de")
        assert r == {1: 1}

    def test_genitive_form_not_matched_without_german_lang(self):
        entry = self._entry(1, "Miya")
        r = self._scan("<p>Miyas Schwert glänzte.</p>", [entry])  # default lang="en"
        assert 1 not in r

    def test_genitive_form_matched_with_german_lang(self):
        entry = self._entry(1, "Miya")
        r = self._scan("<p>Miyas Schwert glänzte.</p>", [entry], lang="de")
        assert r == {1: 1}

    def test_bare_and_genitive_both_counted(self):
        entry = self._entry(1, "Miya")
        r = self._scan("<p>Miya zog. Miyas Schwert glänzte.</p>", [entry], lang="de")
        assert r == {1: 2}

    def test_genitive_alias_matched(self):
        entry = self._entry(1, "Miyabelle", ["Miya"])
        r = self._scan("<p>Miyas Schwert glänzte.</p>", [entry], lang="de")
        assert r == {1: 1}

    def test_unrelated_word_not_matched(self):
        # "Klaras" should not spuriously match "Klara" via genitive if absent
        entry = self._entry(1, "Klara")
        r = self._scan("<p>Etwas anderes geschah.</p>", [entry], lang="de")
        assert 1 not in r

    def test_sibilant_ending_name_gets_no_fused_suffix(self):
        # "Klaus" forms the genitive with an apostrophe ("Klaus'"), not a fused
        # -s ("Klauss") — the bare name must still match on its own.
        entry = self._entry(1, "Klaus")
        r = self._scan("<p>Klaus kam vorbei.</p>", [entry], lang="de")
        assert r == {1: 1}
        r2 = self._scan("<p>Klauss Schwert glänzte.</p>", [entry], lang="de")
        assert 1 not in r2

    def test_multiword_name_suffixes_last_word(self):
        entry = self._entry(1, "Miya Sturmwind")
        r = self._scan("<p>Miya Sturmwinds Schwert glänzte.</p>", [entry], lang="de")
        assert r == {1: 1}


# ── _genitive_suffixed unit tests ──────────────────────────────────────────────

class TestGenitiveSuffixed:
    def _fn(self, name: str):
        from routers.scenes import _genitive_suffixed
        return _genitive_suffixed(name)

    def test_simple_name(self):
        assert self._fn("Miya") == "Miyas"

    def test_multiword_suffixes_last_word_only(self):
        assert self._fn("Miya Sturmwind") == "Miya Sturmwinds"

    def test_sibilant_ending_returns_none(self):
        for name in ["Klaus", "Felix", "Fritz", "Franz", "Voß"]:
            assert self._fn(name) is None, name

    def test_empty_string_returns_none(self):
        assert self._fn("") is None

    def test_whitespace_only_returns_none(self):
        assert self._fn("   ") is None
