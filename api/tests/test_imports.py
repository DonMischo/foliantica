"""
Tests for api/routers/imports.py and services/importer.py.

  - TestMdToHtml           — unit tests for _md_to_html
  - TestParseStoryMarkdown — unit tests for parse_story_markdown
  - TestParseCodexMarkdown — unit tests for parse_codex_markdown
  - TestImportStoryHTTP    — POST /api/projects/{id}/import/story
  - TestImportCodexHTTP    — POST /api/projects/{id}/import/codex
"""
import io
import pytest

from services.importer import (
    parse_story_markdown,
    parse_codex_markdown,
    _md_to_html,
)


# ── _md_to_html ───────────────────────────────────────────────────────────────

class TestMdToHtml:
    def test_empty_returns_empty(self):
        assert _md_to_html("") == ""

    def test_whitespace_only_returns_empty(self):
        assert _md_to_html("   ") == ""

    def test_single_paragraph(self):
        result = _md_to_html("Hello world")
        assert result == "<p>Hello world</p>"

    def test_two_paragraphs(self):
        result = _md_to_html("First para\n\nSecond para")
        assert "<p>First para</p>" in result
        assert "<p>Second para</p>" in result

    def test_bold_converted(self):
        result = _md_to_html("This is **bold** text.")
        assert "<strong>bold</strong>" in result

    def test_italic_converted(self):
        result = _md_to_html("This is *italic* text.")
        assert "<em>italic</em>" in result

    def test_line_break_within_paragraph(self):
        result = _md_to_html("Line one\nLine two")
        assert "<br>" in result


# ── parse_story_markdown ──────────────────────────────────────────────────────

STORY_4LEVEL = """\
# My Novel

## Act One

### Chapter One

#### Opening Scene

This is the opening scene content.

#### Second Scene

Content of second scene.

### Chapter Two

#### Only Scene

Chapter two, scene one.

## Act Two

### First Chapter

#### Scene Alpha

Alpha content.
"""

STORY_2LEVEL = """\
## Act One

### Scene A

Content of scene A.

### Scene B

Content of scene B.
"""


class TestParseStoryMarkdown:
    def test_empty_text_returns_empty(self):
        title, acts = parse_story_markdown("")
        assert title is None
        assert acts == []

    def test_book_title_extracted(self):
        title, _ = parse_story_markdown(STORY_4LEVEL)
        assert title == "My Novel"

    def test_acts_parsed(self):
        _, acts = parse_story_markdown(STORY_4LEVEL)
        assert len(acts) == 2
        assert acts[0].title == "Act One"
        assert acts[1].title == "Act Two"

    def test_chapters_parsed(self):
        _, acts = parse_story_markdown(STORY_4LEVEL)
        assert len(acts[0].chapters) == 2
        assert acts[0].chapters[0].title == "Chapter One"
        assert acts[0].chapters[1].title == "Chapter Two"

    def test_scenes_parsed(self):
        _, acts = parse_story_markdown(STORY_4LEVEL)
        ch1 = acts[0].chapters[0]
        assert len(ch1.scenes) == 2
        assert ch1.scenes[0].title == "Opening Scene"
        assert ch1.scenes[1].title == "Second Scene"

    def test_scene_content_captured(self):
        _, acts = parse_story_markdown(STORY_4LEVEL)
        scene = acts[0].chapters[0].scenes[0]
        assert "opening scene content" in scene.content_md.lower()

    def test_two_level_format_scenes_under_implicit_chapter(self):
        _, acts = parse_story_markdown(STORY_2LEVEL)
        assert len(acts) == 1
        act = acts[0]
        assert len(act.chapters) == 1
        assert len(act.chapters[0].scenes) == 2

    def test_no_heading_text_returns_empty(self):
        _, acts = parse_story_markdown("Just some plain text with no headings.")
        assert acts == []

    def test_minimal_structure(self):
        md = "## Act\n### Chapter\n#### Scene\nContent here."
        _, acts = parse_story_markdown(md)
        assert len(acts) == 1
        assert acts[0].chapters[0].scenes[0].content_md.strip() == "Content here."


# ── parse_codex_markdown (native format) ─────────────────────────────────────

NATIVE_CODEX = """\
# Characters

## character: Aragorn

**Aliases:** Strider, Elessar
**Color:** red
**Species:** Human

A noble ranger from the North.

**Notes:** Heir of Isildur.

## location: Rivendell

**Color:** #3b82f6

The elven refuge.
"""

LEGACY_CODEX = """\
---
type: character
name: Frodo
aliases:
  - Mr. Underhill
color: yellow
---
A hobbit from the Shire.
---
type: location
name: The Shire
---
Rolling green hills.
"""


class TestParseCodexMarkdown:
    def test_native_entry_count(self):
        entries = parse_codex_markdown(NATIVE_CODEX)
        assert len(entries) == 2

    def test_native_name_parsed(self):
        entries = parse_codex_markdown(NATIVE_CODEX)
        assert entries[0].name == "Aragorn"

    def test_native_entry_type_parsed(self):
        entries = parse_codex_markdown(NATIVE_CODEX)
        assert entries[0].entry_type == "character"
        assert entries[1].entry_type == "location"

    def test_native_aliases_parsed(self):
        entries = parse_codex_markdown(NATIVE_CODEX)
        assert "Strider" in entries[0].aliases
        assert "Elessar" in entries[0].aliases

    def test_native_color_resolved(self):
        entries = parse_codex_markdown(NATIVE_CODEX)
        # "red" → "#ef4444"
        assert entries[0].color == "#ef4444"
        # "#3b82f6" passed through as-is
        assert entries[1].color == "#3b82f6"

    def test_native_description_captured(self):
        entries = parse_codex_markdown(NATIVE_CODEX)
        assert "noble ranger" in entries[0].description

    def test_native_notes_captured(self):
        entries = parse_codex_markdown(NATIVE_CODEX)
        assert entries[0].notes is not None
        assert "Isildur" in entries[0].notes

    def test_native_species_parsed(self):
        entries = parse_codex_markdown(NATIVE_CODEX)
        assert entries[0].species == "Human"

    def test_legacy_format_detected(self):
        entries = parse_codex_markdown(LEGACY_CODEX)
        assert len(entries) == 2

    def test_legacy_name_parsed(self):
        entries = parse_codex_markdown(LEGACY_CODEX)
        names = [e.name for e in entries]
        assert "Frodo" in names
        assert "The Shire" in names

    def test_legacy_aliases_parsed(self):
        entries = parse_codex_markdown(LEGACY_CODEX)
        frodo = next(e for e in entries if e.name == "Frodo")
        assert "Mr. Underhill" in frodo.aliases

    def test_legacy_description_captured(self):
        entries = parse_codex_markdown(LEGACY_CODEX)
        frodo = next(e for e in entries if e.name == "Frodo")
        assert "hobbit" in frodo.description

    def test_empty_text_returns_empty(self):
        assert parse_codex_markdown("") == []

    def test_invalid_type_defaults_to_custom(self):
        md = "## banana: Weird Entry\nSome description.\n"
        entries = parse_codex_markdown(md)
        assert entries[0].entry_type == "custom"


# ── POST /api/projects/{id}/import/story ─────────────────────────────────────

class TestImportStoryHTTP:
    def _upload(self, client, project_id, content):
        return client.post(
            f"/api/projects/{project_id}/import/story",
            files={"file": ("story.md", io.BytesIO(content.encode()), "text/markdown")},
        )

    def test_unknown_project_returns_404(self, client):
        r = self._upload(client, 99999, "## Act\n### Ch\n#### Sc\nText.")
        assert r.status_code == 404

    def test_empty_content_returns_400(self, client, project):
        r = self._upload(client, project["id"], "No headings here.")
        assert r.status_code == 400

    def test_import_creates_acts_and_chapters(self, client, project):
        md = "## Act One\n### Chapter One\n#### Opening\nContent."
        r = self._upload(client, project["id"], md)
        assert r.status_code == 200
        body = r.json()
        assert body["acts"] == 1
        assert body["chapters"] == 1
        assert body["scenes"] == 1

    def test_imported_acts_appear_in_list(self, client, project):
        md = "## Act Alpha\n### Chapter\n#### Scene\nText."
        self._upload(client, project["id"], md)
        acts = client.get(f"/api/projects/{project['id']}/acts").json()
        assert any(a["title"] == "Act Alpha" for a in acts)

    def test_two_acts_imported(self, client, project):
        md = "## Act I\n### Ch\n#### Sc\nA.\n## Act II\n### Ch2\n#### Sc2\nB."
        r = self._upload(client, project["id"], md)
        assert r.json()["acts"] == 2

    def test_import_appends_to_existing(self, client, project):
        # First import
        self._upload(client, project["id"], "## First Act\n### Ch\n#### Sc\nText.")
        # Second import appends
        r = self._upload(client, project["id"], "## Second Act\n### Ch\n#### Sc\nText.")
        assert r.status_code == 200
        acts = client.get(f"/api/projects/{project['id']}/acts").json()
        titles = [a["title"] for a in acts]
        assert "First Act" in titles
        assert "Second Act" in titles


# ── POST /api/projects/{id}/import/codex ─────────────────────────────────────

class TestImportCodexHTTP:
    def _upload(self, client, project_id, content):
        return client.post(
            f"/api/projects/{project_id}/import/codex",
            files={"file": ("codex.md", io.BytesIO(content.encode()), "text/markdown")},
        )

    def test_unknown_project_returns_404(self, client):
        r = self._upload(client, 99999, "## character: Hero\nDescription.")
        assert r.status_code == 404

    def test_empty_content_returns_400(self, client, project):
        r = self._upload(client, project["id"], "No entries here, just text.")
        assert r.status_code == 400

    def test_import_creates_entries(self, client, project):
        md = "## character: Gandalf\nA wizard.\n## location: Mirkwood\nA dark forest.\n"
        r = self._upload(client, project["id"], md)
        assert r.status_code == 200
        body = r.json()
        assert body["created"] == 2
        assert body["skipped"] == 0

    def test_imported_entries_appear_in_codex(self, client, project):
        md = "## character: Bilbo\nA hobbit.\n"
        self._upload(client, project["id"], md)
        entries = client.get(f"/api/projects/{project['id']}/codex").json()
        assert any(e["name"] == "Bilbo" for e in entries)

    def test_legacy_yaml_format_imported(self, client, project):
        md = "---\ntype: character\nname: Sam\n---\nLoyalty above all.\n"
        r = self._upload(client, project["id"], md)
        assert r.status_code == 200
        assert r.json()["created"] == 1
