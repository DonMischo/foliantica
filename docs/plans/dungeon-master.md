# AI Dungeon Master — Implementation Plan

Status: ALL PHASES (0–4) complete (2026-07-18). Later ideas: pgvector
retrieval, export campaign as book draft, sheet panel in codex detail.

Phase-4 notes: oracle draws are seeded by scene id (deterministic per scene,
nothing stored) from `api/data/oracles.json`, which also holds the ban list
(English + German patterns). The cliché check runs client-side against
GET /api/dm/style; reroll undoes the turn's effects, deletes the narration
(latest-turn-only, server-enforced), and re-streams. Session zero composes
`campaign_brief` deterministically (no AI needed) and creates lore entries
from the world truths; raw answers persist in dm_prefs for prefill.

Phase-2 notes: RPG gear lives in `rpg_sheet.gear` as [{name, qty}] (not the
entry-linked CharacterInventory — revisit linking gear to item entries later).
A full sheet-editing panel in the codex entry detail is still open; the Play
view party card covers HP/condition tracking during play.

An AI-driven dungeon master as a new project kind (`rpg`) beside book projects.
Story-first play with a classic D&D dice set and a simple ruleset; the DM tracks
scenes, NPCs, characters, stats, and inventory in the existing codex.

Memory architecture inspired by [TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)
(MIT, TypeScript/OpenClaw — we borrow the design, not the code): a four-tier
memory pyramid with full traceability from every compressed fact back to its
source turn.

## Reused infrastructure

- Codex: entries, portraits + `image_crop`, relations graph, sharing (fresh/copy/share)
- AI: `api/ai_providers.py` multi-provider SSE streaming, `ai_prompts` template
  table, per-op model overrides in `UserSettings`, structured-JSON extraction
  pattern from `/ki` `create_entry`
- Name generator (`NameGeneratorWidget`) — gets a server-side twin

## Data model

- `Project.kind` — `'book' | 'rpg'`, default `'book'` (Phase 0)
- `CodexEntry.rpg_sheet` — nullable JSON: stats, HP, conditions (Phase 2)
- `dm_sessions` — game sessions; `summary` column is the L2 memory layer (Phase 1)
- `dm_turns` (L0) — role (`player|dm|roll|system`), content, `rolls` JSON,
  `effects` JSON (Phase 1)
- `dm_facts` (L1) — kind (`fact|thread|secret|foreshadow`), text, optional
  codex_entry_id, `source_turn_id` (traceability), status, weight (Phase 3)
- `dm_scenes` — location codex ref, present NPC ids, situation, is_current (Phase 2)
- `Project.campaign_brief` (L3) — living "story so far + tone + world truths" (Phase 3)

## Turn loop (`api/routers/dm.py`)

1. **Context build** (`api/services/dm_context.py`): campaign brief (L3) +
   current scene card + sheets of present NPCs/PCs + retrieved facts (L1, via
   codex-name matching + Postgres FTS) + last ~10 turns (L0). Embeddings/pgvector
   deferred — packaging burden in embedded PG.
2. **Narrate** — SSE stream, persisted as a turn.
3. **Extract effects** — second low-temperature structured call: codex upserts,
   inventory/stat deltas, scene changes, new facts, roll requests. Applied with
   undo (LLM bookkeeping will occasionally be wrong).
4. **Dice gate** — a requested roll locks the reply box until rolled/entered.

**Consolidation:** every ~10 turns extract facts (L1); on session end write the
session summary (L2); refresh campaign brief (L3). Context cost stays flat.

## Dice

Two input paths, always both available:

- **Roll for me** — server-side RNG, stored in the turn's `rolls` JSON.
- **Table roll** — player throws physical dice and types the result(s); range
  validation only; flagged `manual: true` in the log.

Per-project `dice_mode: digital | physical` preference decides the default a
roll-request presents; in physical mode the DM always waits for entry. Dice are
never rolled by the model.

## Character generator (codex wizard)

Produces a normal `character` codex entry + filled `rpg_sheet` — fully
player-editable afterward (existing `CodexEntryDetail` + new sheet panel).

1. Species & class from `api/data/ruleset_simple.json` (traits, name-style hint,
   stat priorities, signature abilities, starting kit)
2. Stats: 4d6-drop-lowest or standard array — physical entry supported
3. Name from the name-generator service, rerollable, or custom
4. AI flavor (appearance, personality, quirk, hook) under the anti-slop contract
5. Review & edit before save

The DM's effects-extractor uses the **same service** for NPC stat blocks — one
code path, names stay out of the model's hands.

## Anti-Eldoria creativity kit

All editable templates in the `ai_prompts` table:

- **Ban-list, enforced twice**: prompt blocklist (Eldoria, Elara, Thorne, Kael,
  "tapestry of", "the air crackled", taverns "The Prancing/Gilded/Rusty X",
  hooded quest-givers, "little did they know") + cheap post-generation check
  that flags violations for regeneration. User-editable.
- **Names from code**, per-project name style.
- **Random oracle tables** rolled server-side per scene (NPC quirk, weather,
  complication, texture, antagonist offscreen move) injected as constraints —
  randomness from dice, not model priors.
- **Style contract**: concrete sensory specifics over adjectives; every NPC
  wants something and is mid-activity; failure changes the situation instead of
  blocking; consequences persist (backed by facts).
- **Session zero wizard**: tone/genre/world-truths/lines-veils questionnaire +
  character wizard → initial campaign brief and starter codex.
- Per-op temperature/model: hot for narration, cold for extraction.

## UI

- `web/src/app/projects/[id]/dm/page.tsx`: transcript (persistent, backed by
  `dm_turns`), roll-request banners, right rail with scene card (portraits),
  party sheet, open threads, dice tray (d4–d100, advantage toggle, manual entry).
- `ProjectSidebar.tsx` branches on `project.kind`: RPG shows Play/Codex/Relations,
  hides book-only views. Dashboard dialog gets a project-type choice; the
  existing fresh/copy/share codex selector works for campaigns (share a book's
  world into a campaign).
- Codex + relations pages work unchanged.

## Phases

| Phase | Delivers | Verify |
|---|---|---|
| **0 — Kind** | `kind` column + migration, RPG creation flow, sidebar branching, empty Play view | Create RPG project; book projects unaffected; migration up/down |
| **1 — Play loop** | Sessions/turns tables, streaming DM chat with persistent history, DM persona prompt v1, dice tray with digital + manual paths, `dice_mode` pref | Play 20 turns, restart app, history intact; both roll paths persist, manual flagged |
| **2 — State keeping** | Effects extraction → codex upserts, `rpg_sheet` + inventory deltas, scene tracking, roll gating, undo, character wizard, NPC generation through it | NPC introduced in play appears in codex with generated name; wizard PC with table-rolled stats is editable; loot updates inventory |
| **3 — Memory pyramid** | `dm_facts` extraction, session summaries, campaign brief, FTS retrieval, layered context builder | Session-1 detail referenced in session 5 under capped context; fact→turn links resolve |
| **4 — Creativity kit** | Ban-list + post-check, oracle tables, name-gen injection, session-zero wizard | 10 generated NPCs/scenes: zero ban-list hits, no repeated names, distinct quirks |

Later: pgvector retrieval; **"export campaign as book draft"** (sessions →
chapters, turns → prose scenes) — the DM as a first-draft engine.

Biggest risk: Phase 2 effects-extraction reliability — isolated, undoable, cold
cheap model. Biggest differentiators: Phase 3 (memory that doesn't degrade) and
Phase 4 (randomness from code).
