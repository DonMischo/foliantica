from datetime import datetime, UTC
from typing import Optional
import json

from sqlalchemy import (
    Integer, String, Text, DateTime, ForeignKey, Enum, JSON, event, Index, UniqueConstraint
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
import enum


class Base(DeclarativeBase):
    pass


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    time_config: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    fragment_tabs: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON: ["tab-id", ...]
    book_meta: Mapped[Optional[str]] = mapped_column(Text, nullable=True)      # JSON: BookMeta dict
    shared_codex_project_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # FK to projects.id (no cascade)
    cover_image: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    main_plot_color: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    subplot_names: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON: ["name", ...]
    corkboard_prefs: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON: layout, toggles, colors, stack names

    acts: Mapped[list["Act"]] = relationship(
        "Act", back_populates="project", cascade="all, delete-orphan",
        order_by="Act.order_index"
    )
    codex_entries: Mapped[list["CodexEntry"]] = relationship(
        "CodexEntry", back_populates="project", cascade="all, delete-orphan"
    )
    fragments: Mapped[list["Fragment"]] = relationship(
        "Fragment", back_populates="project", cascade="all, delete-orphan"
    )
    timeline_tracks: Mapped[list["TimelineTrack"]] = relationship(
        "TimelineTrack", cascade="all, delete-orphan"
    )
    research_items: Mapped[list["ResearchItem"]] = relationship(
        "ResearchItem", back_populates="project", cascade="all, delete-orphan"
    )
    query_submissions: Mapped[list["QuerySubmission"]] = relationship(
        "QuerySubmission", cascade="all, delete-orphan"
    )


class Act(Base):
    """Top-level structural grouping within a project (## in source files)."""
    __tablename__ = "acts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    project: Mapped["Project"] = relationship("Project", back_populates="acts")
    chapters: Mapped[list["Chapter"]] = relationship(
        "Chapter", back_populates="act", cascade="all, delete-orphan",
        order_by="Chapter.order_index"
    )


class Chapter(Base):
    """Mid-level grouping within an act (### in source files)."""
    __tablename__ = "chapters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    act_id: Mapped[int] = mapped_column(Integer, ForeignKey("acts.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    act: Mapped["Act"] = relationship("Act", back_populates="chapters")
    scenes: Mapped[list["Scene"]] = relationship(
        "Scene", back_populates="chapter", cascade="all, delete-orphan",
        order_by="Scene.order_index"
    )


class Scene(Base):
    """Smallest editable unit (#### in source files)."""
    __tablename__ = "scenes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    chapter_id: Mapped[int] = mapped_column(Integer, ForeignKey("chapters.id", ondelete="CASCADE"), index=True)
    title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default="")
    synopsis: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    scene_time: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    subplot: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)   # null = main plot
    global_order: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # chronological position across all subplots
    stack_group: Mapped[Optional[str]] = mapped_column(String(36), nullable=True) # scenes sharing this value form a draggable stack
    node_x: Mapped[Optional[float]] = mapped_column(nullable=True)  # canvas x position (React Flow)
    node_y: Mapped[Optional[float]] = mapped_column(nullable=True)  # canvas y position (React Flow)
    pov_character_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # codex_entries.id — POV character for this scene
    beat: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # plot beat label (e.g. "Inciting Incident")
    scene_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # action | dialogue | introspection | description | transition
    card_color: Mapped[Optional[str]] = mapped_column(String(7), nullable=True)  # corkboard card tint (hex)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    chapter: Mapped["Chapter"] = relationship("Chapter", back_populates="scenes")
    commands: Mapped[list["SceneCommand"]] = relationship(
        "SceneCommand", back_populates="scene", cascade="all, delete-orphan",
        order_by="SceneCommand.order_index"
    )


class EntryType(str, enum.Enum):
    character = "character"
    location = "location"
    item = "item"
    relic = "relic"
    lore = "lore"
    custom = "custom"


class CodexEntry(Base):
    __tablename__ = "codex_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    aliases: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default="[]")
    entry_type: Mapped[str] = mapped_column(
        String, nullable=False, default="custom"
    )
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default="")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    color: Mapped[str] = mapped_column(String(7), default="#eab308")
    entry_group: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array of group strings
    species:     Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    subtype:     Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    name_type:   Mapped[Optional[str]] = mapped_column(String(50),  nullable=True)  # name generation style
    tags:        Mapped[Optional[str]] = mapped_column(Text, nullable=True, default="[]")
    is_main_char: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    inventory:   Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON: CharacterInventory
    image_path:  Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    # Sharing: "all" = visible to all linked projects (default)
    #          "specific" = only projects listed in codex_entry_access
    #          "none" = private to owner project only
    share_mode:   Mapped[str] = mapped_column(String(20), nullable=False, default="all")
    share_future: Mapped[int] = mapped_column(Integer, nullable=False, default=1)  # auto-share with future linked projects
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    project: Mapped["Project"] = relationship("Project", back_populates="codex_entries")
    relations_from: Mapped[list["CodexRelation"]] = relationship(
        "CodexRelation", foreign_keys="CodexRelation.source_id",
        back_populates="source", cascade="all, delete-orphan"
    )
    relations_to: Mapped[list["CodexRelation"]] = relationship(
        "CodexRelation", foreign_keys="CodexRelation.target_id",
        back_populates="target", cascade="all, delete-orphan"
    )

    def get_aliases(self) -> list[str]:
        try:
            return json.loads(self.aliases or "[]")
        except (json.JSONDecodeError, TypeError):
            return []

    def set_aliases(self, aliases: list[str]) -> None:
        self.aliases = json.dumps(aliases)

    def get_tags(self) -> list[str]:
        try:
            return json.loads(self.tags or "[]")
        except (json.JSONDecodeError, TypeError):
            return []

    def set_tags(self, tags: list[str]) -> None:
        self.tags = json.dumps(tags)

    def get_groups(self) -> list[str]:
        try:
            val = json.loads(self.entry_group or "[]")
            if isinstance(val, list):
                return [str(v) for v in val if v]
            # Legacy: plain string value
            return [str(val)] if val else []
        except (json.JSONDecodeError, TypeError):
            return [self.entry_group] if self.entry_group else []

    def set_groups(self, groups: list[str]) -> None:
        self.entry_group = json.dumps(groups)


class SceneConnection(Base):
    """User-drawn typed cable between two scenes on the corkboard."""
    __tablename__ = "scene_connections"
    __table_args__ = (
        UniqueConstraint("source_scene_id", "target_scene_id", "connection_type"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    source_scene_id: Mapped[int] = mapped_column(Integer, ForeignKey("scenes.id", ondelete="CASCADE"), index=True)
    target_scene_id: Mapped[int] = mapped_column(Integer, ForeignKey("scenes.id", ondelete="CASCADE"), index=True)
    connection_type: Mapped[str] = mapped_column(String(50), nullable=False, default="reference")
    label: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class CodexRelation(Base):
    __tablename__ = "codex_relations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    source_id: Mapped[int] = mapped_column(Integer, ForeignKey("codex_entries.id", ondelete="CASCADE"), index=True)
    target_id: Mapped[int] = mapped_column(Integer, ForeignKey("codex_entries.id", ondelete="CASCADE"), index=True)
    relation_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    source: Mapped["CodexEntry"] = relationship(
        "CodexEntry", foreign_keys=[source_id], back_populates="relations_from"
    )
    target: Mapped["CodexEntry"] = relationship(
        "CodexEntry", foreign_keys=[target_id], back_populates="relations_to"
    )


class CodexEntryAccess(Base):
    """Explicit per-project access list for entries with share_mode='specific'."""
    __tablename__ = "codex_entry_access"

    id:         Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entry_id:   Mapped[int] = mapped_column(Integer, ForeignKey("codex_entries.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[int] = mapped_column(Integer, nullable=False)  # no FK: project may not exist yet

    __table_args__ = (UniqueConstraint("entry_id", "project_id"),)


class Fragment(Base):
    """Small text piece stored in a project tab (snippets, ideas, archive, custom)."""
    __tablename__ = "fragments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    tab: Mapped[str] = mapped_column(String(100), default="snippets")
    title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default="")
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    project: Mapped["Project"] = relationship("Project", back_populates="fragments")


class SceneCommand(Base):
    """Tracks currency/item changes embedded as commands in a scene's text."""
    __tablename__ = "scene_commands"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    scene_id: Mapped[int] = mapped_column(Integer, ForeignKey("scenes.id", ondelete="CASCADE"), index=True)
    command_type: Mapped[str] = mapped_column(String(50))   # "currency" | "item"
    character_id: Mapped[int] = mapped_column(Integer)       # codex_entries.id
    item_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # codex_entries.id (item type)
    data: Mapped[Optional[str]] = mapped_column(Text, nullable=True)        # JSON
    scene_time: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON SceneTime snapshot
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    scene: Mapped["Scene"] = relationship("Scene", back_populates="commands")


class UserSettings(Base):
    __tablename__ = "user_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    openrouter_api_key: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    default_model: Mapped[str] = mapped_column(
        String(100), default="anthropic/claude-3.5-sonnet"
    )
    default_chat_model: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    default_synopsis_model: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    default_codex_model: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    theme: Mapped[str] = mapped_column(String(20), default="dark")
    enabled_models: Mapped[str] = mapped_column(Text, default="[]")  # JSON list of model IDs
    language: Mapped[str] = mapped_column(String(10), default="en")
    show_paragraph_numbers: Mapped[int] = mapped_column(Integer, default=0)
    typewriter_mode: Mapped[int] = mapped_column(Integer, default=0)
    typewriter_offset: Mapped[int] = mapped_column(Integer, default=50)
    session_timer_enabled: Mapped[int] = mapped_column(Integer, default=1)
    # External service settings
    grammar_check_enabled: Mapped[int] = mapped_column(Integer, default=0)
    grammar_check_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    grammar_languages: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON: ["en"]
    pandoc_enabled: Mapped[int] = mapped_column(Integer, default=0)
    pandoc_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    spacy_enabled: Mapped[int] = mapped_column(Integer, default=0)
    spacy_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    calibre_enabled: Mapped[int] = mapped_column(Integer, default=0)
    calibre_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    calibre_mode: Mapped[str] = mapped_column(Text, default="off")
    vale_mode: Mapped[str] = mapped_column(Text, default="off")
    vale_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    vale_config_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    vale_custom_rules: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON
    ai_disabled: Mapped[int] = mapped_column(Integer, default=0)
    # Multi-provider AI adapter (Phase 2)
    active_provider: Mapped[str] = mapped_column(String(50), default="openrouter")
    ai_providers_cfg: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON
    sync_mirror_enabled: Mapped[int] = mapped_column(Integer, default=0)
    sync_local_dir: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Counters — incremented by raw SQL in analytics.py / export.py.
    # Kept out of migrate_new_columns() for SQLite compat; must live in the
    # model so create_all() creates them on PostgreSQL.
    stats_views: Mapped[int] = mapped_column(Integer, default=0)
    export_count: Mapped[int] = mapped_column(Integer, default=0)


class AIPrompt(Base):
    __tablename__ = "ai_prompts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    system: Mapped[str] = mapped_column(Text, default="")
    user_template: Mapped[str] = mapped_column(Text, default="")
    is_built_in: Mapped[int] = mapped_column(Integer, default=0)
    built_in_key: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    word_count: Mapped[int] = mapped_column(Integer, default=400)


class MentionStat(Base):
    """Cached count of how many times a codex entry is mentioned in a scene."""
    __tablename__ = "mention_stats"

    id:       Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scene_id: Mapped[int] = mapped_column(Integer, ForeignKey("scenes.id", ondelete="CASCADE"), index=True)
    codex_id: Mapped[int] = mapped_column(Integer, ForeignKey("codex_entries.id", ondelete="CASCADE"), index=True)
    count:    Mapped[int] = mapped_column(Integer, default=0)


class WritingLog(Base):
    """Daily writing activity. One row per (project, date); used for streaks + heatmap."""
    __tablename__ = "writing_log"

    id:          Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id:  Mapped[int] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    date:        Mapped[str] = mapped_column(String(10), nullable=False)  # YYYY-MM-DD
    words_added: Mapped[int] = mapped_column(Integer, default=0)

    __table_args__ = (UniqueConstraint("project_id", "date"),)


class SceneVersion(Base):
    __tablename__ = "scene_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scene_id: Mapped[int] = mapped_column(Integer, ForeignKey("scenes.id", ondelete="CASCADE"), index=True)
    content: Mapped[str] = mapped_column(Text, default="")
    content_hash: Mapped[str] = mapped_column(String(64))   # sha256 hex for dedup
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class TimelineTrack(Base):
    __tablename__ = "timeline_tracks"
    id:           Mapped[int]           = mapped_column(Integer, primary_key=True)
    project_id:   Mapped[int]           = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name:         Mapped[str]           = mapped_column(String(200), default="Timeline")
    color:        Mapped[str]           = mapped_column(String(20),  default="#6b7280")
    track_type:   Mapped[str]           = mapped_column(String(20),  default="parallel")   # "parallel" | anything
    order_index:  Mapped[int]           = mapped_column(Integer, default=0)
    start_time:   Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON scene_time dict or NULL
    end_time:     Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON scene_time dict or NULL
    created_at:   Mapped[datetime]      = mapped_column(DateTime, default=_now)


class ResearchItem(Base):
    """Per-project research clipping — URL, text excerpt, or image — linkable to scenes/codex."""
    __tablename__ = "research_items"

    id:               Mapped[int]           = mapped_column(Integer, primary_key=True, index=True)
    project_id:       Mapped[int]           = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    title:            Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    url:              Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    url_title:        Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    url_description:  Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    url_image:        Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    text_content:     Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Legacy single-file columns — kept for the migration; use ResearchMedia going forward.
    image_path:       Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    pdf_path:         Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    linked_scene_id:  Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    linked_codex_id:  Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    tags:             Mapped[str]           = mapped_column(Text, nullable=False, default="[]")
    created_at:       Mapped[datetime]      = mapped_column(DateTime, default=_now)
    updated_at:       Mapped[datetime]      = mapped_column(DateTime, default=_now, onupdate=_now)

    project: Mapped["Project"] = relationship("Project", back_populates="research_items")
    media:   Mapped[list["ResearchMedia"]] = relationship(
        "ResearchMedia", back_populates="item",
        cascade="all, delete-orphan",
        order_by="ResearchMedia.order_index",
    )

    def get_tags(self) -> list[str]:
        try:
            return json.loads(self.tags or "[]")
        except (json.JSONDecodeError, TypeError):
            return []


class ResearchMedia(Base):
    """One image or PDF attached to a ResearchItem (supports multiple per item)."""
    __tablename__ = "research_media"

    id:               Mapped[int]      = mapped_column(Integer, primary_key=True, index=True)
    research_item_id: Mapped[int]      = mapped_column(Integer, ForeignKey("research_items.id", ondelete="CASCADE"), index=True)
    kind:             Mapped[str]      = mapped_column(String(10), nullable=False)   # "image" | "pdf"
    path:             Mapped[str]      = mapped_column(String(500), nullable=False)
    order_index:      Mapped[int]      = mapped_column(Integer, default=0)
    created_at:       Mapped[datetime] = mapped_column(DateTime, default=_now)

    item: Mapped["ResearchItem"] = relationship("ResearchItem", back_populates="media")


class QuerySubmission(Base):
    """Literary-agent / publisher query tracking per project."""
    __tablename__ = "query_submissions"

    id:                Mapped[int]           = mapped_column(Integer, primary_key=True)
    project_id:        Mapped[int]           = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    agent_name:        Mapped[str]           = mapped_column(Text, default="")
    agency:            Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    email:             Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # What was submitted: "query" | "partial" | "full" | "synopsis"
    submission_type:   Mapped[str]           = mapped_column(Text, default="query")
    date_sent:         Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # ISO date
    response_deadline: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # ISO date
    # Pipeline status: queried | partial_requested | full_requested | offer | pass | no_response | withdrawn
    status:            Mapped[str]           = mapped_column(Text, default="queried")
    notes:             Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at:        Mapped[datetime]      = mapped_column(DateTime, default=_now)
    updated_at:        Mapped[datetime]      = mapped_column(DateTime, default=_now, onupdate=_now)


class ExportProfile(Base):
    """Named export configuration (global or per-project)."""
    __tablename__ = "export_profiles"

    id:           Mapped[int]           = mapped_column(Integer, primary_key=True)
    project_id:   Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True)
    name:         Mapped[str]           = mapped_column(Text)
    description:  Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_builtin:   Mapped[int]           = mapped_column(Integer, default=0)  # 1 = read-only pre-seeded
    options_json: Mapped[str]           = mapped_column(Text, default="{}")  # serialised ExportOptions fields
    created_at:   Mapped[datetime]      = mapped_column(DateTime, default=_now)
    updated_at:   Mapped[datetime]      = mapped_column(DateTime, default=_now, onupdate=_now)


class PublisherProfile(Base):
    """Read-only reference profiles for publisher/agent manuscript requirements."""
    __tablename__ = "publisher_profiles"

    id:               Mapped[int]           = mapped_column(Integer, primary_key=True)
    short_name:       Mapped[str]           = mapped_column(String(100))  # filename prefix, e.g. "CurtisBrown_AU"
    name:             Mapped[str]           = mapped_column(Text)          # display name
    category:         Mapped[str]           = mapped_column(String(50))   # standard | us_trade | uk_trade | agency | genre | selfpub
    description:      Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    word_count_min:   Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    word_count_max:   Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    accepts_unagented: Mapped[int]          = mapped_column(Integer, default=0)   # 1 = yes
    submission_url:   Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    options_json:     Mapped[str]           = mapped_column(Text, default="{}")   # ExportOptions fields
    is_active:        Mapped[int]           = mapped_column(Integer, default=1)
    created_at:       Mapped[datetime]      = mapped_column(DateTime, default=_now)
    updated_at:       Mapped[datetime]      = mapped_column(DateTime, default=_now, onupdate=_now)


class AchievementUnlock(Base):
    """Records the first time an achievement was earned. One row per achievement key."""
    __tablename__ = "achievement_unlocks"

    id:             Mapped[int]               = mapped_column(Integer, primary_key=True, autoincrement=True)
    key:            Mapped[str]               = mapped_column(String(100), nullable=False, unique=True)
    unlocked_at:    Mapped[datetime]          = mapped_column(DateTime, default=_now)
    popup_shown_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class TimelineEvent(Base):
    __tablename__ = "timeline_events"
    id:           Mapped[int]           = mapped_column(Integer, primary_key=True)
    project_id:   Mapped[int]           = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    track_id:     Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("timeline_tracks.id", ondelete="SET NULL"), nullable=True, index=True)
    title:        Mapped[str]           = mapped_column(String(500), default="Untitled Event")
    description:  Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    scene_time:   Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON
    color:        Mapped[str]           = mapped_column(String(20),  default="#6b7280")
    created_at:   Mapped[datetime]      = mapped_column(DateTime, default=_now)
