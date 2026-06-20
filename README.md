# Foliantica - Story writing tool

> *Your manuscript. Your world. Your machine.*

**The writing studio built for authors who build worlds.**

You open the app. Your manuscript is there, exactly where you left it. The world-bible is a sidebar click away. The timeline remembers every hour of every day you mapped. Thirty-eight publisher formatting profiles are waiting for submission day. Nothing lives in someone else's cloud.

Foliantica is a **local-first, all-in-one writing studio** — manuscript editor, codex, timeline, corkboard, analytics, and submission tracker in a single desktop app. Offline by default. No subscriptions. No accounts. No telemetry. Your words stay yours.

---

- 🔒 **Fully offline.** Nothing leaves your machine without your say-so.
- 🌍 **World-builder native.** Codex, relations graph, configurable time system, and timeline — built in, not bolted on.
- 📤 **Submission-ready.** One click generates manuscripts formatted for 38+ publishers and agents, downloaded as a ZIP.
- ☁️ **Optional sync.** Point the data folder at Dropbox, Google Drive, or OneDrive — that's all it takes.
- 💬 **A second opinion when everyone else is busy.** Chat about your plot, ask if a scene lands, brainstorm a name — the AI knows your characters and your world, but the story is still yours to write.
- 👥 **Co-work.** Invite a writing partner, editor, or student over the local network or internet — they get their own role, their own access level, and their comments appear live in your editor.
- 🔎 **Prose checker.** Structural feedback on your writing: sentence variety, dialogue ratio, passive voice, weasel words, and more — powered by Vale with multilingual fiction rule sets.

→ [See the full feature list](#features)

Available as a **standalone desktop app** (Windows, macOS, Linux) or run directly from source.

---

## Get Started

### Desktop App (recommended)

Download the latest installer from [Releases](../../releases) and run it — no Node.js or Python required.

**Cloud sync:** Go to **Settings → Data Folder**, point Foliantica at any folder inside Dropbox, Google Drive, or OneDrive. Foliantica can migrate your existing data to the new location in one click.

### Run from Source

Double-click **`LaunchFoliantica.bat`** (Windows) — it starts the backend, frontend, and the Docker sidecars (LanguageTool + Pandoc) in one step.

```powershell
.\LaunchFoliantica.bat
```

Then open **http://localhost:3000** in your browser.

> Requires Node.js 20+, Python 3.11+, [uv](https://github.com/astral-sh/uv), and Docker Desktop (for grammar check and PDF/EPUB/DOCX export).

### Build the Desktop App

```powershell
.\build.ps1       # Windows
./build.sh        # macOS / Linux
```

Requires Node.js 20+, Python 3.11+, [uv](https://github.com/astral-sh/uv), and Docker Desktop. Produces an installer in `dist/`.

---

## Features

### ✍️ Story Editor

- **4-level hierarchy**: Project → Act → Chapter → Scene
- Drag-and-drop reordering at every level; hover any divider and click **+** to insert a scene between existing ones
- Double-click any act or chapter title to rename inline; scene titles auto-generated from content when left blank
- Debounced **autosave** (1 s) + periodic interval save; localStorage fallback when the backend is unreachable
- Word count in the status bar; per-scene counts persist to the database
- **Slash commands** (`/`) — headings, lists, blockquote, task list, table, divider, images, currency/item nodes, AI nodes, timeline events, and more
- **Rich formatting toolbar** — appears on text selection with bold, italic, underline, strikethrough, headings, lists, blockquote, and text alignment
- **Smart typography** — curly quotes, en/em dashes, and ellipses applied automatically as you type
- **Tables** (`/table`), **task lists** (`/tasklist`), embedded images
- **Spellcheck** with native dictionary suggestions — right-click any underlined word to correct or add it to your personal dictionary; language follows the project's book metadata
- **Typewriter mode** — cursor stays pinned at a configurable vertical offset as you write
- **Focus mode** — dims everything outside the active paragraph
- **Paragraph numbers** — optional markers at a configurable interval
- **Find & Replace** — Ctrl+F / Cmd+F with match highlighting and replace
- **Ghost text** — AI-powered inline autocomplete suggestions drawn from your own prose style
- **Read view** — flowing, story-typography prose per chapter or per act

### 🗒️ Scene Plan

- Per-scene **checklist** — click the clipboard icon next to any scene name in the sidebar
- Add, check off, edit inline (double-click), or bulk-clear completed tasks
- Progress bar fills as tasks are ticked; a green badge replaces the count when all are done

### 🕓 Version History

- **Automatic snapshots** every 5 minutes while a scene is open (only when content changed)
- **Scene-leave snapshot** on navigation; **pre-restore snapshot** before any restore
- SHA-256 deduplication — identical content never stored twice
- Retention: up to 30 versions per scene; oldest pruned after 30 days
- **History sidebar** — relative timestamps, inline preview, one-click restore with confirmation

### 📋 Corkboard

- Visual scene-card view across acts and chapters
- **Subplot columns** — drag scenes into parallel plot threads; main plot always leftmost
- **Stack groups** — scenes sharing a stack value move as one unit
- Cards show synopsis, word count, POV character, and beat label
- Free-canvas mode with React Flow positions

### 👥 Co-work

- **Invite a guest** with a named invitation link — share it over the network or open a Cloudflare Tunnel for internet access (no port-forwarding required)
- **QR code** in Settings → Co-work for easy mobile join
- **Role-based access modes**: Read-only, Appearance-only, Assigned scenes, Editor, and full access
- **Editor role** — full write access to assigned scenes; saves go directly to the author's database
- **Student mode** — restrict a guest to specific scenes; teacher sees all sessions in a dashboard
- **Inline comments** — guests (and the author) highlight any passage and leave a threaded note; comments appear as coloured overlays in the editor
- **Comment categories** — tag annotations as Question, Suggestion, Correction, or Praise; filter by category with the pill bar
- **Live presence** — avatars appear in the toolbar when a guest is viewing the same scene
- **Scene soft-locks** — a gentle indicator when two people are editing the same scene at the same time
- **Real-time push** — edits, presence, and comments sync via WebSocket; no polling
- **Session management** — see all active guests, kick a session, revoke an invitation at any time

### 🔎 Prose Checker

- **Structural analysis** at a glance: sentence length variance, average sentence length, dialogue ratio, passive-voice rate, and weasel-word density — all shown in the Vale panel
- **Vale-powered style rules** — a curated fiction rule set covering:
  - *Passive voice* — flags passive constructions in prose
  - *Weasel words* — hedging language that weakens sentences
  - *Buzzwords* — clichéd phrases common in genre fiction
  - *Nominal style* — verb-turned-nouns that slow pacing
  - *Redundancy* — pleonastic phrases (e.g. "end result", "past history")
  - *Adverbs* (German: adverbien) — overused adverbs
- **Multilingual** — rule sets for English, German, Dutch, Italian, and Polish
- **Per-entry configuration** — open any rule's entry list, enable/disable individual tokens, or add your own custom entries
- **Custom rules** — write your own regex-based existence or substitution rules in the Custom section
- **Jump-to** — click any Vale finding to jump to the exact occurrence in the editor (handles repeated phrases and inflected forms)
- Runs entirely on your machine via the Vale Docker sidecar; your prose never leaves

### 📊 Analytics

- **Scene-level breakdown** — word count, scene type, average sentence length, dialogue ratio
- **Chapter-level stats** — Flesch readability score, Kincaid grade level, scene type distribution
- **Project totals** — total word count, overall scene type chart
- **Writing log** — daily word counts and streaks; calendar heat-map style view

### 📚 Codex (World-Building Database)

- Entry types: **Character**, **Location**, **Item**, **Lore**, **Custom**
- Fields: name, aliases, description, notes, colour tag, groups, species / subtype, tags
- **Main character flag** — protagonists starred (★) in dropdowns and centred in the relations graph
- **Character inventory** — custom currencies and possessions (linked items, quantity, notes)
- Inline **Codex highlighting** — any word matching an entry name or alias gets a coloured underline; click to open the entry
- **List view** and **Grid view** — sortable by name, type, group, colour, or tags
- **Filters** — type, group, species, subtype, tags — multi-select, combine freely
- **Multi-select + bulk-edit** — change type, subtype/species, add shared tags/relations, or delete in one action
- **Typed relations** between entries (Friend, Enemy, Family, Leads, Possession, custom…)
- **Share mode** per entry — control which linked projects can read it
- **Import** from CSV, JSON, or a folder of `.md` files
- **Mention stats** — see which scenes reference each codex entry and how often

### 🔗 Shared Codex & Series Management

- Link a project to an existing world-bible — both projects share the same codex entries in real time
- Or **copy** the codex to start an independent fork
- **Series view** — group projects by series, set order index, role labels (Prequel, Book 1…), and shared cover images
- Shared projects share a combined timeline spanning all their scenes

### 🕸️ Relations Graph

- SVG radial mindmap — one entry at centre, linked entries on the inner ring, second-degree connections on the outer ring
- **Depth slider (1–3)** — control relationship hops
- Click any node to re-centre; right-click for *Edit Entry* / *Remove Relation*
- Solid lines = explicit relations; dashed lines = inline `[rel:]` tags detected in scene prose

### 🕐 Time System

- Per-project **configurable time units** — any combination of Age, Year, Season, Month, Day, Hour, Minute, Second; rename any unit to fit your world
- Custom count-per-parent (e.g. 13 months/year) and **named values** (e.g. custom month or season names)
- **Day/Night cycle dial** — set day length, night start, and night duration; visualised as a purple arc on the SVG clock
- Per-scene **Time panel** — inputs for each enabled unit with a live preview badge and ☀ / 🌙 label

### 📅 Timeline

- Horizontal grid — rows are scenes, columns are time points
- Column headers show formatted in-world time with ☀ / 🌙 badge; click a cell to jump to that scene
- **Timeline tracks** — parallel story threads (e.g. "Parallel world", "Backstory") with custom colour and time range
- **Timeline events** — free-standing named events at any time point, linked to a track; insert directly from the editor with `/timeline`
- Shared-codex projects display a combined multi-project timeline

### 🔬 Research Board

- Clip **URLs** (auto-fetches title, description, and preview image), **text notes**, **images**, and **PDFs**
- **Drag-and-drop** or **Ctrl+V** paste to attach an image to any clip — works even with a text field focused
- **PDF upload** — attach a document to a clip and preview it inline (canvas-based, works in Electron and browser)
- **Image lightbox** — click the expand button on hover to view the full image; press Esc to close
- Cards displayed in a 3:4 portrait grid; edit dialog shows text fields alongside a media preview
- Tag freely; filter by tag in the sidebar
- Link any clip to a specific scene or codex entry
- Open the original URL in one click

### 🗃️ Fragments

- **Snippets**, **Ideas**, and **Archive** tabs built in; add any number of custom tabs
- Lightweight note cards with category labels and drag-to-reorder
- Great for cut prose, worldbuilding scraps, and anything that doesn't belong in a scene yet

### 🤖 AI Assistant

- Sidebar panel — **Continue**, **Rewrite**, **Brainstorm**, **Ask**, **Custom** modes
- **`/ki` inline AI node** — insert a generation block directly into the prose:
  - Choose a prompt (Story Generation, Lector Review, Codex Distillation, or any custom prompt)
  - Inject **codex entries** and **extra scenes** as context
  - Set a **word count** target
- **Auto-synopsis** — one-click scene synopsis generation from the scene toolbar
- Streams output from any [OpenRouter](https://openrouter.ai) model
- **Per-operation model overrides** — dedicate a model to synopsis, codex distillation, and scene chat independently of the global default
- Project language propagates to all AI prompts automatically (e.g. writes in German when `language: "de"`)

### 📝 AI Prompts

- Built-in prompts: **Story Generation**, **Lector Review**, **Codex Entry Distillation**
- **Custom prompts** — name, system instruction, user template, and word count target
- Template placeholders: `{{SCENE_CONTENT}}`, `{{CODEX_ENTRIES}}`, `{{USER_PROMPT}}`, `{{LANGUAGE}}`, `{{WORD_COUNT}}`, `{{ENTRY_TYPE}}`
- Manage all prompts in **Settings → AI Prompts**; revert built-ins to factory defaults any time

### 🔍 Grammar & Style Check

- Powered by **LanguageTool** (self-hosted via Docker — your text never leaves your machine)
- Colour-coded highlighting by category: grammar, style, spelling, punctuation
- Click any issue to jump to the exact occurrence in the editor (handles repeated phrases correctly)
- One-click **Apply suggestion** to accept a fix; 3-minute timeout with a patience message while the check runs
- Supported languages: English, German, French, Spanish, Portuguese, Italian, Dutch, Polish, Russian, and more

### 📤 Export

- **Markdown** — clean `.md` output
- **LaTeX** — `\chapter` / `\section` structure, proper escaping, configurable font/size/margins/drop-caps
- **PDF** — via Pandoc (Docker); full LaTeX pipeline with custom typography
- **EPUB** — via Pandoc; configurable fonts, colours, page margin
- **DOCX** — Word document via Pandoc; reference-doc font/spacing pipeline
- **Scene selection**, heading inclusion, and full typography (font, size, line spacing, indent, alignment, margins, page numbers, drop caps) configurable per export
- **Saved profiles** — star any set of settings as a named preset (built-in: Classic Novel, Manuscript, Modern; save your own)
- **EPUB Style export** — standalone CSS + optional cover image for custom EPUB toolchains

### 📬 Publisher Pack & Query Tracker

- **38 publisher / agent formatting profiles** across 9 categories:
  - Standard Formats (SMF TNR, SMF Courier)
  - US Trade (Berkley / PRH)
  - UK Publishers (Pan Macmillan, Hachette, Bloomsbury)
  - Literary Agencies (Curtis Brown UK/AU, Janklow & Nesbit, Writers House)
  - Genre Imprints (Tor UK, Soho Crime, Harlequin)
  - Self-Publishing (Amazon KDP, Draft2Digital)
  - German Publishers (Rowohlt, S. Fischer, Suhrkamp, Hanser, Piper, Droemer Knaur, Bastei Lübbe, Aufbau, Ullstein, dtv)
  - French Publishers (Gallimard, Seuil, Flammarion, Albin Michel, Actes Sud, Bragelonne, L'Atalante)
  - Spanish Publishers (Planeta, Alfaguara, Anagrama, Tusquets, Siruela, Ediciones Urano, Roca Editorial)
- **Publisher Pack mode** in the export dialog — tick any combination of publishers, click *Export Pack*, and download a ZIP of all manuscripts named `Publisher_Title.ext`
- Each profile shows its format badge (DOCX / EPUB / PDF), word count range, Open / Agented status, and a link to the publisher's submission guidelines
- Collapsible category groups with select-all toggles; collapse-all / expand-all shortcut
- **Query Tracker** — log every agent and publisher query: date sent, response deadline, submission type, status (Queried → Partial → Full → Offer / Pass), and notes
- Status overview strip showing live counts and a pipeline progress bar

---

## Stack

| Layer | Tech |
|-------|------|
| Desktop | Electron 42, electron-builder |
| Frontend | Next.js 14, TypeScript, Tailwind CSS, shadcn/ui |
| Editor | TipTap v3 — Typography, Underline, TextAlign, TaskList, Table + custom extensions |
| State | Zustand + TanStack Query v5 |
| Backend | FastAPI, SQLAlchemy 2.0, PostgreSQL 17 / SQLite (WAL) |
| AI | OpenRouter (any model, proxied via backend) |
| Export | Markdown, LaTeX, PDF / EPUB / DOCX via Pandoc (Docker sidecar) |
| Style check | Vale (Docker sidecar) — multilingual fiction rule sets |
| Co-work | WebSocket event push, JWT guest auth, Cloudflare Tunnel |

---

## Settings

- **OpenRouter API key** — stored server-side, never sent to the browser
- **AI models** — global default; separate overrides for chat, synopsis, and codex distillation; per-model enable/disable for `/ki`
- **Themes** — Dark, Light, and themed variants
- **Editor** — paragraph numbers, typewriter mode and offset, session timer
- **Grammar Check** — enable, set LanguageTool service URL and active languages
- **Prose / Vale** — enable Vale style check, set service URL, manage rule sets and custom rules
- **Co-work** — enable guest access, create named invitations, set access modes, open a Cloudflare Tunnel for internet access
- **PDF/EPUB/DOCX Export** — enable Pandoc service and set its URL
- **Data folder** — point to Dropbox / Drive / OneDrive for cross-device sync; migrate existing data in one click
- **AI Prompts** — edit, create, delete, revert built-ins to factory defaults
- **Codex highlight** — toggle the coloured underline for codex entry names in the editor

---

## Tips & Hints

| Tip | How |
|-----|-----|
| Rename an act or chapter | Double-click its title in the sidebar |
| Insert a scene between two scenes | Hover the divider → click **+** |
| Reorder anything | Grab the ⠿ drag handle on hover |
| Plan your scene | Click the 📋 icon next to its name in the sidebar |
| Open a codex entry from the editor | Click the coloured underline under any highlighted word |
| Fix a spelling error | Right-click the underlined word → pick a suggestion |
| Add a word to the dictionary | Right-click → **Add to dictionary** |
| Insert a table | Type `/table` in the editor |
| Insert a task list | Type `/tasklist` in the editor |
| Smart quotes & em-dashes | Just type — they're applied automatically |
| Format selected text | Select text → bubble toolbar |
| Add an in-world event to the timeline | Type `/timeline` in the editor |
| Jump to a scene from the timeline | Click the cell |
| Clear a scene's time stamp | Time panel → **Clear** |
| Bulk-edit codex entries | Check multiple entries → floating action bar |
| Sort codex by tags | List view → click the **Tags** column header |
| Add custom month/season names | Time System → unit row → **Custom names** |
| Export a single manuscript | Sidebar → **Export → Single** |
| Export to multiple publishers at once | Sidebar → **Export → Publisher Pack** |
| Track an agent query | Sidebar overflow → **Query Tracker** |
| Mark a protagonist | Codex entry → **Main character** checkbox |
| Share a world bible across projects | New Project → **Share codex** |
| Track character possessions | Codex entry (character) → **Inventory** tab |
| Browse scene snapshots | Scene editor → **History** button |
| Restore an older version | History sidebar → hover a version → ↺ |
| Generate text inline with AI | Type `/ki`, configure the node, click **Generate** |
| Set the language for AI output | Project → Book Metadata → Language field (e.g. `de`) |
| Clip a research URL | Research tab → paste URL → Enter |
| Attach an image to a clip | Drag onto the card, or Ctrl+V while hovering |
| Attach a PDF to a clip | Open the clip → PDF upload button |
| Preview an attached image full-size | Hover the image → click ↗ |
| Preview an attached PDF | Click the PDF button on the card |
| Move cut prose to Fragments | Fragments tab → Snippets or Archive |
| Invite a co-worker | Settings → Co-work → New Invitation |
| Share via internet (no port-forwarding) | Settings → Co-work → Open Cloudflare Tunnel |
| Leave a comment on a passage | Select text → speech-bubble icon → type comment |
| Filter comments by category | Comment bar → pick a category pill |
| Run prose / style check | Vale panel → Run Style Check |
| Jump to a Vale finding in the editor | Click the finding in the Vale panel |
| Add your own style rule entry | Vale panel → rule → Configure → Add entry |
| Toggle codex highlight underlines | Settings → Editor → Codex highlight |

---

## Project Structure

```
foliantica/
├── electron/             # Electron main process + splash screen
│   └── assets/           # App icons (ico, icns, png)
├── api/                  # FastAPI backend
│   ├── routers/          # projects, scenes, codex, time, graph, ai,
│   │                     #   settings, export, imports, analytics,
│   │                     #   submissions, research, fragments, grammar,
│   │                     #   prose, vale, collab, comments, sync,
│   │                     #   scene_commands, achievements
│   ├── services/         # Tag parsing, AI streaming, export renderers
│   ├── models.py         # SQLAlchemy ORM models
│   ├── schemas.py        # Pydantic request/response schemas
│   └── database.py       # Engine, session, migration helpers, publisher seed data
├── docker/
│   └── pandoc/           # Pandoc + LaTeX sidecar (PDF/EPUB/DOCX export)
└── web/                  # Next.js 14 frontend
    └── src/
        ├── app/          # App Router pages
        │                 #   (editor, codex, timeline, corkboard, analytics,
        │                 #    research, fragments, queries, settings…)
        ├── components/   # Editor, Codex, AI panel, Export dialog,
        │                 #   Corkboard, Analytics, Research, Fragments,
        │                 #   Query Tracker, Version History, Scene Plan
        ├── store/        # Zustand UI store + TanStack Query hooks
        └── types/        # Shared TypeScript interfaces
```
