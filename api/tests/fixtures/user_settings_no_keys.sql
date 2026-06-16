-- Minimal user_settings dump simulating a restore from another machine.
-- Encrypted columns (openrouter_api_key, ai_providers_cfg) are intentionally
-- absent — _do_pg_dump excludes them so they never leave the originating machine.
-- All NOT NULL columns must be listed explicitly; SQLAlchemy Python-level
-- `default=` values are not reflected in the DB schema as server-side DEFAULTs.
DELETE FROM user_settings;
INSERT INTO user_settings (
    id, default_model, theme, enabled_models, language,
    show_paragraph_numbers, typewriter_mode, typewriter_offset,
    session_timer_enabled, grammar_check_enabled, pandoc_enabled,
    spacy_enabled, calibre_enabled, calibre_mode, vale_mode,
    ai_disabled, active_provider, sync_mirror_enabled,
    stats_views, export_count
) VALUES (
    1, '', 'dark', '[]', 'en',
    0, 0, 50,
    1, 0, 0,
    0, 0, 'off', 'off',
    0, 'openrouter', 0,
    0, 0
);
