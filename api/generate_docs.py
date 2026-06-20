"""
Foliantica Technical Documentation Generator
Generates a comprehensive PDF using reportlab.
Run from the api/ directory with the venv active.
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    HRFlowable, KeepTogether,
)
from reportlab.platypus.flowables import Flowable
from reportlab.graphics.shapes import (
    Drawing, Rect, String, Line, Circle, Polygon, Group,
)
from reportlab.graphics import renderPDF
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
import datetime

# ── Palette ──────────────────────────────────────────────────────────────────
INK     = colors.HexColor("#1a1a2e")
ACCENT  = colors.HexColor("#4f6ef7")
ACCENT2 = colors.HexColor("#7c3aed")
GREEN   = colors.HexColor("#10b981")
ORANGE  = colors.HexColor("#f59e0b")
RED     = colors.HexColor("#ef4444")
LIGHT   = colors.HexColor("#f0f4ff")
MID     = colors.HexColor("#c7d2fe")
RULE    = colors.HexColor("#e2e8f0")
WHITE   = colors.white
DARK    = colors.HexColor("#0f172a")

PAGE_W, PAGE_H = A4
MARGIN = 2 * cm

# ── Styles ────────────────────────────────────────────────────────────────────
def make_styles():
    s = getSampleStyleSheet()
    base = dict(fontName="Helvetica", textColor=INK)

    styles = {
        "title": ParagraphStyle("DocTitle", fontName="Helvetica-Bold",
            fontSize=32, textColor=WHITE, leading=40, alignment=TA_CENTER),
        "subtitle": ParagraphStyle("DocSubtitle", fontName="Helvetica",
            fontSize=14, textColor=MID, leading=20, alignment=TA_CENTER,
            spaceAfter=6),
        "h1": ParagraphStyle("H1", fontName="Helvetica-Bold",
            fontSize=18, textColor=ACCENT, leading=24,
            spaceBefore=18, spaceAfter=8),
        "h2": ParagraphStyle("H2", fontName="Helvetica-Bold",
            fontSize=13, textColor=INK, leading=18,
            spaceBefore=12, spaceAfter=6),
        "h3": ParagraphStyle("H3", fontName="Helvetica-Bold",
            fontSize=11, textColor=ACCENT2, leading=15,
            spaceBefore=8, spaceAfter=4),
        "body": ParagraphStyle("Body", fontName="Helvetica",
            fontSize=9.5, textColor=INK, leading=14, spaceAfter=4),
        "mono": ParagraphStyle("Mono", fontName="Courier",
            fontSize=8.5, textColor=DARK, leading=12,
            backColor=colors.HexColor("#f8fafc"),
            borderPadding=4, spaceAfter=4),
        "caption": ParagraphStyle("Caption", fontName="Helvetica-Oblique",
            fontSize=8, textColor=colors.HexColor("#64748b"),
            alignment=TA_CENTER, spaceAfter=6),
        "toc_h": ParagraphStyle("TocH", fontName="Helvetica-Bold",
            fontSize=10, textColor=INK, leading=14),
        "toc_e": ParagraphStyle("TocE", fontName="Helvetica",
            fontSize=9, textColor=colors.HexColor("#475569"), leading=13,
            leftIndent=12),
        "small": ParagraphStyle("Small", fontName="Helvetica",
            fontSize=8, textColor=colors.HexColor("#64748b"), leading=11),
        "tag": ParagraphStyle("Tag", fontName="Helvetica-Bold",
            fontSize=7.5, textColor=WHITE, leading=10),
        "endpoint": ParagraphStyle("Endpoint", fontName="Courier-Bold",
            fontSize=8.5, textColor=DARK, leading=12),
        "footer": ParagraphStyle("Footer", fontName="Helvetica",
            fontSize=7.5, textColor=colors.HexColor("#94a3b8"),
            alignment=TA_CENTER),
    }
    return styles

ST = make_styles()

# ── Page template with header/footer ─────────────────────────────────────────
def on_page(canvas, doc):
    canvas.saveState()
    w, h = A4
    # Top rule
    canvas.setStrokeColor(ACCENT)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, h - MARGIN + 4*mm, w - MARGIN, h - MARGIN + 4*mm)
    # Header text
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#94a3b8"))
    canvas.drawString(MARGIN, h - MARGIN + 6*mm, "Foliantica – Technical Documentation")
    canvas.drawRightString(w - MARGIN, h - MARGIN + 6*mm,
        datetime.date.today().strftime("%B %Y"))
    # Bottom rule
    canvas.line(MARGIN, MARGIN - 4*mm, w - MARGIN, MARGIN - 4*mm)
    canvas.drawCentredString(w / 2, MARGIN - 8*mm, f"— {doc.page} —")
    canvas.restoreState()

# ── Drawing helpers ───────────────────────────────────────────────────────────
class DrawingFlowable(Flowable):
    def __init__(self, drawing):
        super().__init__()
        self._drawing = drawing
        self.width = drawing.width
        self.height = drawing.height

    def draw(self):
        renderPDF.draw(self._drawing, self.canv, 0, 0)

def hpad(n=6):
    return Spacer(1, n)

def rule():
    return HRFlowable(width="100%", thickness=0.5, color=RULE, spaceAfter=6)

def method_badge(method: str) -> str:
    colour = {
        "GET": "#10b981", "POST": "#3b82f6",
        "PATCH": "#f59e0b", "DELETE": "#ef4444", "PUT": "#8b5cf6",
    }.get(method, "#64748b")
    return (f'<font name="Helvetica-Bold" color="{colour}" size="8">'
            f'[{method}]</font>')

# ── Architecture diagram ──────────────────────────────────────────────────────
def arch_diagram():
    W, H = 480, 290
    d = Drawing(W, H)

    layers = [
        ("Electron Shell (Desktop Wrapper)", 250, ACCENT2, WHITE),
        ("Next.js 14 Frontend  ·  TypeScript · Tailwind · TipTap",
         200, ACCENT, WHITE),
        ("FastAPI Backend  ·  Python 3.11  ·  SQLAlchemy 2.0",
         150, GREEN, WHITE),
        ("PostgreSQL 17  ·  (embedded port 5433)",
         100, ORANGE, WHITE),
    ]

    box_h = 38
    for label, y, fill, tc in layers:
        d.add(Rect(20, y, W - 40, box_h, fillColor=fill,
                   strokeColor=WHITE, strokeWidth=1, rx=6, ry=6))
        d.add(String(W / 2, y + 14, label, fontName="Helvetica-Bold",
                     fontSize=9.5, fillColor=tc, textAnchor="middle"))

    # Docker sidecars
    sidecars = [
        ("LanguageTool\n:8081", 20),
        ("Pandoc\n:8082", 105),
        ("spaCy\n:8083", 190),
        ("Vale\n:8084", 275),
        ("Calibre\n:8085", 360),
    ]
    for label, x in sidecars:
        d.add(Rect(x, 20, 75, 50, fillColor=colors.HexColor("#e2e8f0"),
                   strokeColor=RULE, strokeWidth=1, rx=4, ry=4))
        lines = label.split("\n")
        d.add(String(x + 37, 50, lines[0], fontName="Helvetica-Bold",
                     fontSize=7.5, fillColor=INK, textAnchor="middle"))
        d.add(String(x + 37, 38, lines[1], fontName="Courier",
                     fontSize=7, fillColor=colors.HexColor("#64748b"),
                     textAnchor="middle"))

    # Arrow from backend to docker row
    d.add(Line(W / 2, 150, W / 2, 80, strokeColor=colors.HexColor("#94a3b8"),
               strokeWidth=1.5))
    d.add(String(W / 2, 85, "HTTP / optional Docker services",
                 fontName="Helvetica-Oblique", fontSize=7.5,
                 fillColor=colors.HexColor("#94a3b8"), textAnchor="middle"))

    # Arrows between main layers
    for y_start, y_end in [(250, 238), (200, 188)]:
        mid_x = W / 2
        d.add(Line(mid_x - 8, y_start, mid_x + 8, y_start,
                   strokeColor=WHITE, strokeWidth=0))
        d.add(Line(mid_x, y_start, mid_x, y_end + 38,
                   strokeColor=colors.HexColor("#94a3b8"), strokeWidth=1))

    # Labels
    d.add(String(W - 18, 80, "Docker", fontName="Helvetica-Bold",
                 fontSize=7.5, fillColor=colors.HexColor("#94a3b8"),
                 textAnchor="end"))

    return DrawingFlowable(d)


# ── Router coverage chart (horizontal bar) ───────────────────────────────────
COVERAGE = {
    "projects": 87, "acts": 95, "chapters": 91, "scenes": 82,
    "codex": 79, "time": 91, "fragments": 84, "images": 62,
    "scene_commands": 93, "grammar": 71, "prose": 68, "analytics": 89,
    "research": 96, "settings": 52, "ai": 32, "export": 57,
    "imports": 48, "graph": 74, "submissions": 88, "comments": 81,
    "achievements": 78, "sync": 79, "collab": 45, "vale": 65,
}

def coverage_chart():
    items = sorted(COVERAGE.items(), key=lambda x: -x[1])
    bar_h = 13
    gap = 3
    label_w = 100
    bar_area = 280
    H = len(items) * (bar_h + gap) + 30
    W = label_w + bar_area + 60
    d = Drawing(W, H)

    title_y = H - 14
    d.add(String(0, title_y, "Test Coverage by Router (%)",
                 fontName="Helvetica-Bold", fontSize=10, fillColor=INK))

    for i, (name, pct) in enumerate(items):
        y = H - 30 - i * (bar_h + gap)
        # label
        d.add(String(label_w - 4, y + 3, name, fontName="Courier",
                     fontSize=7.5, fillColor=INK, textAnchor="end"))
        # background track
        d.add(Rect(label_w, y, bar_area, bar_h,
                   fillColor=colors.HexColor("#f1f5f9"),
                   strokeColor=RULE, strokeWidth=0.5, rx=3, ry=3))
        # fill
        fill_w = bar_area * pct / 100
        bar_color = GREEN if pct >= 80 else (ORANGE if pct >= 60 else RED)
        d.add(Rect(label_w, y, fill_w, bar_h,
                   fillColor=bar_color, strokeWidth=0, rx=3, ry=3))
        # value
        d.add(String(label_w + fill_w + 4, y + 3, f"{pct}%",
                     fontName="Helvetica-Bold", fontSize=7.5,
                     fillColor=INK))

    return DrawingFlowable(d)


# ── DB schema diagram (simplified) ───────────────────────────────────────────
def db_schema_diagram():
    W, H = 500, 320
    d = Drawing(W, H)

    def box(x, y, w, h, title, fields, fill=LIGHT, title_fill=ACCENT):
        d.add(Rect(x, y, w, h, fillColor=fill, strokeColor=MID,
                   strokeWidth=1, rx=4, ry=4))
        d.add(Rect(x, y + h - 18, w, 18, fillColor=title_fill,
                   strokeColor=title_fill, rx=4, ry=4))
        d.add(String(x + w/2, y + h - 13, title, fontName="Helvetica-Bold",
                     fontSize=8, fillColor=WHITE, textAnchor="middle"))
        for fi, f in enumerate(fields):
            d.add(String(x + 5, y + h - 30 - fi*11, f,
                         fontName="Courier", fontSize=6.5,
                         fillColor=INK))

    def arrow(x1, y1, x2, y2):
        d.add(Line(x1, y1, x2, y2,
                   strokeColor=colors.HexColor("#94a3b8"), strokeWidth=0.8))

    # Project
    box(10, 200, 110, 100, "Project",
        ["id  PK", "title", "description", "cover_image",
         "book_meta  JSON", "time_config  JSON"])

    # Act
    box(150, 240, 90, 70, "Act",
        ["id  PK", "project_id  FK", "title", "order_index"],
        title_fill=ACCENT2)

    # Chapter
    box(270, 240, 90, 70, "Chapter",
        ["id  PK", "act_id  FK", "title", "order_index"],
        title_fill=ACCENT2)

    # Scene
    box(390, 200, 100, 110, "Scene",
        ["id  PK", "chapter_id  FK", "title", "content",
         "word_count", "scene_type", "card_color", "global_order"])

    # CodexEntry
    box(10, 60, 110, 110, "CodexEntry",
        ["id  PK", "project_id  FK", "name", "entry_type",
         "description", "aliases  JSON", "tags  JSON",
         "inventory  JSON"])

    # CodexRelation
    box(150, 80, 100, 80, "CodexRelation",
        ["id  PK", "source_id  FK", "target_id  FK",
         "relation_type"],
        title_fill=ACCENT2)

    # WritingLog
    box(390, 60, 100, 80, "WritingLog",
        ["id  PK", "project_id  FK", "date", "words_added"])

    # UserSettings
    box(270, 60, 100, 80, "UserSettings",
        ["id  PK", "openrouter_api_key", "default_model",
         "theme", "language"])

    # Arrows
    arrow(120, 250, 150, 265)   # Project → Act
    arrow(240, 275, 270, 275)   # Act → Chapter
    arrow(360, 275, 390, 265)   # Chapter → Scene
    arrow(120, 115, 150, 120)   # CodexEntry → CodexRelation
    arrow(120, 210, 150, 210)   # Project → CodexEntry (vertical)
    arrow(400, 200, 440, 140)   # Scene → WritingLog

    # Legend
    d.add(Rect(10, 0, 10, 10, fillColor=ACCENT, strokeWidth=0))
    d.add(String(25, 2, "Core entities", fontName="Helvetica",
                 fontSize=7, fillColor=INK))
    d.add(Rect(120, 0, 10, 10, fillColor=ACCENT2, strokeWidth=0))
    d.add(String(135, 2, "Child entities", fontName="Helvetica",
                 fontSize=7, fillColor=INK))

    return DrawingFlowable(d)


# ── Endpoint colour badge ─────────────────────────────────────────────────────
METHOD_COLOR = {
    "GET": GREEN, "POST": ACCENT, "PATCH": ORANGE,
    "DELETE": RED, "PUT": ACCENT2,
}

# ── Content ───────────────────────────────────────────────────────────────────
ROUTERS = [
    ("projects", "Project management — CRUD, series, corkboard, structure", [
        ("GET",    "/api/projects",                         "List all projects"),
        ("POST",   "/api/projects",                         "Create new project"),
        ("GET",    "/api/projects/{id}",                    "Get project details"),
        ("PATCH",  "/api/projects/{id}",                    "Update project metadata"),
        ("DELETE", "/api/projects/{id}",                    "Delete project (cascade)"),
        ("GET",    "/api/projects/{id}/structure",          "Full act→chapter→scene tree"),
        ("GET",    "/api/projects/{id}/corkboard",          "Scenes with layout positions"),
        ("PATCH",  "/api/projects/{id}/corkboard-prefs",    "Update corkboard preferences"),
        ("POST",   "/api/projects/{id}/connections",        "Create scene connection"),
        ("DELETE", "/api/projects/{id}/connections/{cid}",  "Delete scene connection"),
        ("POST",   "/api/projects/{id}/corkboard/global-order", "Reorder scenes chronologically"),
        ("PATCH",  "/api/projects/{id}/subplot-names",      "Update subplot labels"),
        ("GET",    "/api/projects/series",                  "List series groupings"),
        ("GET",    "/api/projects/{id}/pov-stats",          "POV character word distribution"),
    ]),
    ("acts", "Top-level story divisions", [
        ("GET",    "/api/projects/{id}/acts",   "List acts in project"),
        ("POST",   "/api/acts",                 "Create act"),
        ("PATCH",  "/api/acts/{id}",            "Update act"),
        ("DELETE", "/api/acts/{id}",            "Delete act"),
        ("POST",   "/api/acts/reorder",         "Batch reorder acts"),
        ("GET",    "/api/acts/{id}/read",       "Read-mode flowing prose view"),
    ]),
    ("chapters", "Mid-level groupings within acts", [
        ("GET",    "/api/acts/{id}/chapters",   "List chapters in act"),
        ("POST",   "/api/chapters",             "Create chapter"),
        ("PATCH",  "/api/chapters/{id}",        "Update chapter"),
        ("DELETE", "/api/chapters/{id}",        "Delete chapter"),
        ("POST",   "/api/chapters/reorder",     "Batch reorder chapters"),
        ("GET",    "/api/chapters/{id}/read",   "Read-mode view"),
    ]),
    ("scenes", "Smallest editable unit — content, versions, mentions", [
        ("GET",    "/api/chapters/{id}/scenes",                 "List scenes in chapter"),
        ("POST",   "/api/scenes",                               "Create scene"),
        ("GET",    "/api/scenes/{id}",                          "Get scene"),
        ("PATCH",  "/api/scenes/{id}",                          "Update scene content / metadata"),
        ("DELETE", "/api/scenes/{id}",                          "Delete scene"),
        ("POST",   "/api/scenes/reorder",                       "Batch reorder"),
        ("POST",   "/api/scenes/{id}/versions",                 "Create version snapshot"),
        ("GET",    "/api/scenes/{id}/versions",                 "List version history"),
        ("GET",    "/api/scenes/{id}/versions/{vid}",           "Get version content"),
        ("POST",   "/api/scenes/{id}/versions/{vid}/restore",   "Restore to version"),
        ("GET",    "/api/scenes/{id}/mention-stats",            "Codex mention counts"),
        ("POST",   "/api/scenes/{id}/mentions/rescan",          "Re-scan mentions"),
        ("GET",    "/api/projects/{id}/mention-stats",          "Project-wide mention stats"),
        ("POST",   "/api/projects/{id}/mentions/rescan",        "Rescan all scenes"),
        ("GET",    "/api/projects/{id}/writing-log",            "Daily word counts"),
        ("GET",    "/api/writing-log",                          "All projects writing log"),
        ("GET",    "/api/projects/{id}/ghost-texts",            "AI inline suggestions"),
    ]),
    ("codex", "World-building entries — characters, locations, items, lore", [
        ("GET",    "/api/projects/{id}/codex",          "List entries with share filtering"),
        ("POST",   "/api/codex",                        "Create entry"),
        ("GET",    "/api/codex/{id}",                   "Get entry"),
        ("PATCH",  "/api/codex/{id}",                   "Update entry"),
        ("DELETE", "/api/codex/{id}",                   "Delete entry"),
        ("GET",    "/api/codex/{id}/access",            "Get explicit access list"),
        ("PUT",    "/api/codex/{id}/access",            "Set explicit access list"),
        ("GET",    "/api/codex/{id}/relations",         "Get all relations"),
        ("POST",   "/api/codex/relations",              "Create relation"),
        ("DELETE", "/api/codex/relations/{rid}",        "Delete relation"),
        ("GET",    "/api/codex/{id}/scene-mentions",    "Scenes mentioning this entry"),
    ]),
    ("time", "Custom calendar, timeline tracks and events", [
        ("GET",    "/api/projects/{id}/time-config",              "Get time system config"),
        ("PATCH",  "/api/projects/{id}/time-config",              "Update time system"),
        ("GET",    "/api/projects/{id}/timeline",                 "Timeline grid (scenes × time)"),
        ("GET",    "/api/projects/{id}/timeline-v2",              "Alternative timeline view"),
        ("GET",    "/api/projects/{id}/timeline-tracks",          "List parallel tracks"),
        ("POST",   "/api/projects/{id}/timeline-tracks",          "Create track"),
        ("PATCH",  "/api/projects/{id}/timeline-tracks/{tid}",    "Update track"),
        ("DELETE", "/api/projects/{id}/timeline-tracks/{tid}",    "Delete track"),
        ("GET",    "/api/projects/{id}/timeline-events",          "List events"),
        ("POST",   "/api/projects/{id}/timeline-events",          "Create event"),
        ("PATCH",  "/api/projects/{id}/timeline-events/{eid}",    "Update event"),
        ("DELETE", "/api/projects/{id}/timeline-events/{eid}",    "Delete event"),
    ]),
    ("ai", "AI text generation, chat, synopsis, translation", [
        ("POST",   "/api/ai/generate",                  "Continue / rewrite / brainstorm"),
        ("POST",   "/api/ai/ki",                        "Inline KI node generation"),
        ("POST",   "/api/ai/translate",                 "Translate scene text"),
        ("POST",   "/api/ai/structure",                 "Analyse prose structure"),
        ("POST",   "/api/ai/scenes/{id}/synopsis",      "Auto-generate synopsis"),
        ("POST",   "/api/ai/chat",                      "Context-aware chat sidebar"),
    ]),
    ("export", "Manuscript export via Pandoc — PDF/EPUB/DOCX/Markdown/LaTeX", [
        ("POST",   "/api/export/{id}/export",               "Export single format"),
        ("GET",    "/api/export/fonts",                     "Available font list"),
        ("GET",    "/api/export/{id}/export-profiles",      "List export profiles"),
        ("POST",   "/api/export/{id}/export-profiles",      "Create profile"),
        ("PATCH",  "/api/export/export-profiles/{pid}",     "Update profile"),
        ("DELETE", "/api/export/export-profiles/{pid}",     "Delete profile"),
        ("GET",    "/api/export/{id}/export/structure",     "Scenes to include"),
        ("POST",   "/api/export/{id}/export/batch",         "Publisher pack (multi-format)"),
    ]),
    ("research", "URL clips, text notes, images and PDFs", [
        ("GET",    "/api/projects/{id}/research",           "List research items"),
        ("POST",   "/api/projects/{id}/research",           "Create item"),
        ("PATCH",  "/api/research/{id}",                    "Update item (model_fields_set)"),
        ("DELETE", "/api/research/{id}",                    "Delete item"),
        ("POST",   "/api/research/{id}/fetch-url",          "Fetch / refresh URL metadata"),
    ]),
    ("analytics", "Scene/chapter stats, Flesch scores, writing heatmap", [
        ("GET",    "/api/analytics/projects/{id}/analytics",    "Full project analytics"),
        ("GET",    "/api/analytics/stats/totals",               "Global totals + day-of-week"),
        ("POST",   "/api/analytics/stats/ping",                 "Record stats view"),
    ]),
    ("settings", "App settings, AI providers, prompts, Docker, data folder", [
        ("GET",    "/api/settings",                             "Get all settings"),
        ("POST",   "/api/settings",                             "Update settings"),
        ("GET",    "/api/settings/providers",                   "List AI providers"),
        ("POST",   "/api/settings/providers/active",            "Set active provider"),
        ("POST",   "/api/settings/providers/{pid}",             "Set provider credentials"),
        ("GET",    "/api/settings/providers/{pid}/models",      "List provider models"),
        ("POST",   "/api/settings/providers/model-map",         "Map model → provider"),
        ("GET",    "/api/settings/prompts",                     "List AI prompts"),
        ("POST",   "/api/settings/prompts",                     "Create custom prompt"),
        ("PUT",    "/api/settings/prompts/{pid}",               "Update prompt"),
        ("DELETE", "/api/settings/prompts/{pid}",               "Delete prompt"),
        ("POST",   "/api/settings/prompts/{pid}/revert",        "Revert to factory default"),
        ("GET",    "/api/settings/pg-config",                   "Get PostgreSQL config"),
        ("POST",   "/api/settings/pg-config",                   "Save PostgreSQL config"),
        ("GET",    "/api/settings/service-status",              "Docker service health"),
        ("GET",    "/api/settings/data-dir",                    "Current data folder"),
        ("POST",   "/api/settings/data-dir",                    "Change data folder"),
    ]),
    ("sync", "Cloud backup & restore — Dropbox / Drive / OneDrive", [
        ("GET",    "/api/sync/status",      "Sync status (enabled, mode, last sync)"),
        ("POST",   "/api/sync/trigger",     "Manually trigger sync"),
        ("POST",   "/api/sync/dump",        "Export DB to SQL backup file"),
        ("POST",   "/api/sync/restore",     "Restore from SQL backup file"),
    ]),
    ("collab", "Real-time co-work — invitations, JWT sessions, Cloudflare tunnel", [
        ("GET",    "/api/collab/info",                  "Co-work status"),
        ("GET",    "/api/collab/invitations",           "List invitations"),
        ("POST",   "/api/collab/invitations",           "Create invitation"),
        ("PATCH",  "/api/collab/invitations/{id}",      "Update invitation"),
        ("DELETE", "/api/collab/invitations/{id}",      "Revoke invitation"),
        ("GET",    "/api/collab/invitations/{id}/token","Get JWT token"),
        ("POST",   "/api/collab/join",                  "Guest join (exchange token)"),
        ("GET",    "/api/collab/sessions",              "Active guest sessions"),
        ("POST",   "/api/collab/kick/{sid}",            "Remove guest"),
        ("GET",    "/api/collab/cloudflare/status",     "Cloudflare tunnel status"),
        ("POST",   "/api/collab/cloudflare/open",       "Open tunnel"),
        ("POST",   "/api/collab/cloudflare/close",      "Close tunnel"),
    ]),
    ("grammar", "LanguageTool grammar and style checking", [
        ("POST",   "/api/grammar/check",        "Check text (returns matches)"),
        ("GET",    "/api/grammar/languages",    "Supported language list"),
    ]),
    ("prose", "Vale style checker integration", [
        ("POST",   "/api/prose/check",  "Vale style check on scene text"),
    ]),
    ("vale", "Vale rule management — sync, edit, custom rules", [
        ("GET",    "/api/vale/sync-status",                 "Rule sync status"),
        ("POST",   "/api/vale/sync-rules",                  "Download / sync rules"),
        ("GET",    "/api/vale/rule-meta/{lang}",            "Rule metadata"),
        ("GET",    "/api/vale/rule-entries/{lang}/{name}",  "Rule entries"),
        ("PATCH",  "/api/vale/rule-entries/{lang}/{name}",  "Toggle entry enabled"),
        ("PUT",    "/api/vale/rule-entries/{lang}/{name}",  "Add custom entry"),
        ("GET",    "/api/vale/custom-rules",                "List custom rules"),
        ("PUT",    "/api/vale/custom-rules",                "Update custom rules"),
    ]),
    ("fragments", "Snippets, ideas, archive, custom tabs", [
        ("GET",    "/api/projects/{id}/fragment-tabs",          "Get tab list"),
        ("PATCH",  "/api/projects/{id}/fragment-tabs",          "Update tabs"),
        ("GET",    "/api/projects/{id}/fragments",              "List fragments"),
        ("POST",   "/api/projects/{id}/fragments",              "Create fragment"),
        ("PATCH",  "/api/fragments/{id}",                       "Update fragment"),
        ("DELETE", "/api/fragments/{id}",                       "Delete fragment"),
    ]),
    ("images", "Upload and delete covers, codex images, research media", [
        ("POST",   "/api/projects/{id}/cover",      "Upload project cover"),
        ("DELETE", "/api/projects/{id}/cover",      "Delete cover"),
        ("POST",   "/api/codex/{id}/image",         "Upload codex entry image"),
        ("DELETE", "/api/codex/{id}/image",         "Delete entry image"),
        ("POST",   "/api/research/{id}/media",      "Upload research media"),
        ("DELETE", "/api/research/media/{id}",      "Delete research media"),
    ]),
    ("scene_commands", "Inventory / currency system — commands, balances, logs", [
        ("POST",   "/api/scene_commands/projects/{id}/commands/resync",         "Resync state"),
        ("POST",   "/api/scene_commands/scenes/{id}/commands/sync",             "Sync commands"),
        ("GET",    "/api/scene_commands/projects/{id}/command-history",         "Project history"),
        ("GET",    "/api/scene_commands/scenes/{id}/item-log",                  "Items in scene"),
        ("GET",    "/api/scene_commands/scenes/{id}/currency-balance",          "Currency balance"),
        ("GET",    "/api/scene_commands/codex/{cid}/currencies",                "Character currencies"),
        ("GET",    "/api/scene_commands/projects/{id}/item-log",                "Project items"),
        ("GET",    "/api/scene_commands/projects/{id}/currency-log",            "Project currencies"),
        ("GET",    "/api/scene_commands/codex/{cid}/item-log",                  "Character items"),
        ("GET",    "/api/scene_commands/codex/{cid}/currency-log",              "Character currencies"),
        ("GET",    "/api/scene_commands/codex/{cid}/inventory-summary",         "Inventory summary"),
    ]),
    ("submissions", "Agent / publisher query tracker", [
        ("GET",    "/api/submissions/projects/{id}/submissions",    "List submissions"),
        ("POST",   "/api/submissions/projects/{id}/submissions",    "Log new query"),
        ("PATCH",  "/api/submissions/submissions/{id}",             "Update status"),
        ("DELETE", "/api/submissions/submissions/{id}",             "Delete entry"),
    ]),
    ("comments", "Scene annotations for co-work guests", [
        ("GET",    "/api/comments/scenes/{id}/comments",                    "List annotations"),
        ("POST",   "/api/comments/scenes/{id}/comments",                    "Create annotation"),
        ("PATCH",  "/api/comments/comments/{id}",                           "Update annotation"),
        ("DELETE", "/api/comments/comments/{id}",                           "Delete annotation"),
        ("POST",   "/api/comments/scenes/{id}/comments/sync-positions",     "Sync positions"),
    ]),
    ("achievements", "Achievement unlocks", [
        ("GET",    "/api/achievements",         "List unlocked achievements"),
        ("POST",   "/api/achievements/ack",     "Acknowledge / dismiss popup"),
    ]),
    ("graph", "Relations graph — SVG radial mindmap", [
        ("GET",    "/api/graph/{id}/graph",  "Codex relations graph (SVG)"),
    ]),
    ("imports", "Story and codex import", [
        ("POST",   "/api/imports/{id}/import/story",    "Import story (Markdown / JSON)"),
        ("POST",   "/api/imports/{id}/import/codex",    "Import codex (CSV / JSON / MD)"),
    ]),
]

KEY_FUNCTIONS = [
    ("main.py — lifespan()", "Async startup/shutdown context manager. Waits up to 60 s for "
     "PostgreSQL (Docker may still be starting), creates all ORM tables via "
     "Base.metadata.create_all(), seeds AI prompts and publisher profiles, initialises "
     "the uploads directory, registers SQLAlchemy flush/commit hooks for co-work "
     "broadcasts, and initialises the sync subsystem. On shutdown closes the sync backup "
     "and any open Cloudflare Tunnel."),

    ("main.py — CoworkAuthMiddleware", "Starlette middleware that enforces host/guest "
     "access control on every request. Public paths (/api/health, /api/collab/join, "
     "/api/collab/info) bypass auth. Loopback clients (127.0.0.1, ::1) are always "
     "trusted. Electron injects an X-Foliantica-Host-Secret header that grants full host "
     "access. Remote guests must supply a valid Bearer JWT. Write operations are blocked "
     "when the access_mode is read_only or appearance_only."),

    ("crypto.py — encrypt() / decrypt()", "Fernet symmetric encryption for API keys "
     "stored in UserSettings. The key is loaded from the FOLIANTICA_SECRET_KEY env var, "
     "then ~/.foliantica/.secret_key, then migrated from a legacy CWD location. "
     "decrypt() returns None on failure (handles cross-machine key mismatch gracefully "
     "rather than raising)."),

    ("database.py — get_db()", "FastAPI dependency that yields a SQLAlchemy Session. "
     "Used in every router via Depends(get_db). The engine connects to PostgreSQL on "
     "127.0.0.1:5433 with connection pool size 5, max_overflow 10."),

    ("routers/scenes.py — patch_scene()", "Handles PATCH /api/scenes/{id}. Updates "
     "content, syncs word_count, records a WritingLog entry for the current date, "
     "broadcasts changes to connected co-work guests via the WebSocket hub, and "
     "invalidates cached mention stats when content changes."),

    ("routers/scenes.py — restore_version()", "POST /api/scenes/{id}/versions/{vid}/restore. "
     "Creates a pre-restore snapshot (tagged 'pre-restore'), then overwrites scene content "
     "with the chosen version. SHA-256 deduplication prevents storing identical snapshots. "
     "Versions are pruned to 30 per scene and 30-day retention."),

    ("routers/codex.py — list_entries()", "GET /api/projects/{id}/codex. Applies "
     "three-way share filtering: entries owned by the project are always included; "
     "entries with share_mode='all' from other projects are included; entries with "
     "share_mode='specific' are included only if a CodexEntryAccess row exists for "
     "this project."),

    ("routers/time.py — get_timeline()", "GET /api/projects/{id}/timeline. Iterates "
     "all scenes in scene order, parses scene_time JSON (using the module-aliased "
     "_json.loads — important: module uses `import json as _json`), and builds a "
     "grid mapping scenes to time column positions. Exceptions per-scene are caught "
     "and skipped to prevent one bad scene from breaking the whole response."),

    ("routers/analytics.py — _flesch()", "Pure function computing Flesch Reading Ease "
     "and Flesch-Kincaid Grade Level for a block of text. Uses _count_syllables() on "
     "each word and _sentence_stats() for sentence length. Returns (0.0, 0.0) for "
     "empty or punctuation-only input. Ease is clamped to [0, 100]."),

    ("routers/sync.py — _do_pg_dump()", "Generates a portable SQL backup by iterating "
     "all ORM tables and rows, serialising values via _pg_literal(). Deliberately "
     "omits openrouter_api_key and ai_providers_cfg columns so encrypted secrets "
     "never leave the machine. Output is a plain .sql file readable by restore_from_dump()."),

    ("routers/sync.py — restore_from_dump()", "Reads the SQL backup, saves the "
     "machine-local encrypted keys before restore, replays all SQL statements via "
     "_iter_sql_statements() (which correctly handles semicolons inside E'' strings), "
     "then re-applies the saved keys. Ensures API keys survive cross-machine restores."),

    ("routers/sync.py — _iter_sql_statements()", "Generator that splits a SQL dump "
     "into individual statements. Correctly handles: semicolons inside E'' escape "
     "strings, doubled single-quotes (E'it''s ok'), backslash escapes (\\n, \\t), "
     "and comment lines (-- ...). Trailing statements without a semicolon are yielded."),

    ("routers/sync.py — _pg_literal()", "Converts a Python value to a PostgreSQL "
     "literal string for the SQL dump. None → NULL, bool → TRUE/FALSE, int/float → "
     "numeric repr, str → E'...' with backslash and quote escaping."),

    ("routers/ai.py — generate()", "POST /api/ai/generate. Streams text from the "
     "active AI provider (OpenRouter or local). Builds a context window from the "
     "current scene, adjacent scenes, and selected codex entries. Supports modes: "
     "continue, rewrite, brainstorm, and ask. Returns a Server-Sent Events stream."),

    ("routers/research.py — patch_research()", "PATCH /api/research/{id}. Uses "
     "model.model_fields_set to distinguish 'field explicitly set to None' from "
     "'field omitted from request body', so that sending linked_scene_id=null actually "
     "unlinks the scene rather than being ignored."),

    ("routers/export.py — export_project()", "POST /api/export/{id}/export. Renders "
     "the manuscript as Markdown, then calls the Pandoc Docker sidecar with the chosen "
     "ExportOptions (font, size, line-spacing, page numbers, drop caps, etc.). Supports "
     "PDF, EPUB, DOCX, Markdown, and LaTeX output."),

    ("routers/scene_commands.py — sync_commands()", "POST /api/scene_commands/scenes/{id}/commands/sync. "
     "Accepts a list of currency/item commands (add, remove, set) for a scene, persists "
     "them as SceneCommand rows, and returns the updated balances and logs for the "
     "requesting character."),
]

ENV_VARS = [
    ("LW_PG_HOST",          "127.0.0.1",        "PostgreSQL host"),
    ("LW_PG_PORT",          "5433",             "PostgreSQL port (embedded cluster)"),
    ("LW_PG_USER",          "foliantica",       "Database user"),
    ("LW_PG_PASS",          "foliantica",       "Database password"),
    ("LW_PG_DB",            "foliantica",       "Database name"),
    ("FOLIANTICA_SECRET_KEY","(auto-generated)", "Fernet key for API-key encryption"),
    ("FOLIANTICA_HOST_SECRET","(Electron only)", "Electron host authentication secret"),
    ("LT_LANGS",            "de,en",            "LanguageTool language models (.env)"),
    ("PYTEST_CURRENT_TEST", "(test runner)",    "Disables seed data during test runs"),
    ("LW_CONFIG_FILE",      "(internal)",       "Path to local config JSON (testable)"),
]

TECH_STACK = [
    ("FastAPI", "0.109+", "REST API framework, async, OpenAPI auto-docs"),
    ("SQLAlchemy", "2.0", "ORM, declarative mapped_column, connection pool"),
    ("PostgreSQL", "17", "Primary database (embedded on port 5433)"),
    ("psycopg2", "2.x", "PostgreSQL driver"),
    ("Alembic", "1.x", "Schema migrations"),
    ("Cryptography (Fernet)", "42+", "API-key encryption at rest"),
    ("Next.js", "14", "App Router, TypeScript, Tailwind CSS frontend"),
    ("TipTap", "3", "Rich text editor with custom extensions"),
    ("Zustand", "5", "Frontend UI state management"),
    ("TanStack Query", "5", "Server state, caching, mutations"),
    ("Electron", "42", "Desktop wrapper (Windows / macOS / Linux)"),
    ("Pandoc (Docker)", "3+", "PDF / EPUB / DOCX export via LaTeX"),
    ("LanguageTool (Docker)", "6+", "Grammar and style checking"),
    ("Vale (Docker)", "3+", "Prose style rules"),
    ("spaCy (Docker)", "3+", "Named entity recognition for mention scanning"),
    ("pytest", "8+", "Python test suite (1 036 tests)"),
    ("Playwright", "1.x", "End-to-end browser tests"),
]

DOCKER_SERVICES = [
    ("PostgreSQL",   "5433", "postgres",     "Primary database (optional — embedded by default)"),
    ("LanguageTool", "8081", "languagetool", "Grammar check (needs Java heap 512 m–2 g)"),
    ("Pandoc",       "8082", "pandoc",       "PDF/EPUB/DOCX export (custom image with LaTeX)"),
    ("spaCy",        "8083", "spacy",        "Token-aware NER for mention scanning"),
    ("Calibre",      "8084", "calibre",      "eBook conversion (optional)"),
    ("Vale",         "8085", "vale",         "Style checking (optional)"),
]

# ── Build story ───────────────────────────────────────────────────────────────
def build_story():
    story = []

    # ── Title page ────────────────────────────────────────────────────────────
    # Dark background title page
    story.append(Spacer(1, 3.5*cm))
    title_bg = Table(
        [[Paragraph("Foliantica", ST["title"])],
         [Paragraph("Technical Documentation", ST["subtitle"])],
         [Spacer(1, 8)],
         [Paragraph("API Reference · Architecture · Setup Guide · Appendix",
                    ST["subtitle"])]],
        colWidths=[PAGE_W - 2*MARGIN],
        style=TableStyle([
            ("BACKGROUND", (0,0), (-1,-1), DARK),
            ("ROUNDEDCORNERS", (0,0), (-1,-1), [12]),
            ("TOPPADDING",    (0,0), (-1,-1), 24),
            ("BOTTOMPADDING", (0,0), (-1,-1), 24),
            ("LEFTPADDING",   (0,0), (-1,-1), 24),
            ("RIGHTPADDING",  (0,0), (-1,-1), 24),
        ]),
    )
    story.append(title_bg)
    story.append(Spacer(1, 1.2*cm))

    meta_rows = [
        ["Version", "1.0"],
        ["Date", datetime.date.today().strftime("%B %d, %Y")],
        ["Stack", "FastAPI · SQLAlchemy 2 · PostgreSQL · Next.js 14 · Electron"],
        ["Test coverage", "1 036 tests · 80 %+ overall"],
    ]
    meta_table = Table(meta_rows, colWidths=[4*cm, PAGE_W - 2*MARGIN - 4*cm],
        style=TableStyle([
            ("FONTNAME",     (0,0), (0,-1), "Helvetica-Bold"),
            ("FONTNAME",     (1,0), (1,-1), "Helvetica"),
            ("FONTSIZE",     (0,0), (-1,-1), 9),
            ("TEXTCOLOR",    (0,0), (0,-1), ACCENT),
            ("TEXTCOLOR",    (1,0), (1,-1), INK),
            ("ROWBACKGROUNDS", (0,0), (-1,-1), [LIGHT, WHITE]),
            ("TOPPADDING",   (0,0), (-1,-1), 5),
            ("BOTTOMPADDING",(0,0), (-1,-1), 5),
            ("LEFTPADDING",  (0,0), (-1,-1), 8),
            ("RIGHTPADDING", (0,0), (-1,-1), 8),
            ("GRID",         (0,0), (-1,-1), 0.3, RULE),
        ]))
    story.append(meta_table)
    story.append(PageBreak())

    # ── Table of contents ─────────────────────────────────────────────────────
    story.append(Paragraph("Contents", ST["h1"]))
    story.append(rule())
    toc = [
        ("1", "Architecture Overview",          "3"),
        ("1.1", "System Layers",                "3"),
        ("1.2", "Technology Stack",             "4"),
        ("1.3", "Database Schema",              "5"),
        ("2", "Setup Guide",                    "6"),
        ("2.1", "Prerequisites",                "6"),
        ("2.2", "Running from Source",          "6"),
        ("2.3", "Environment Variables",        "7"),
        ("2.4", "Docker Services",              "7"),
        ("3", "API Reference",                  "8"),
        *[(f"3.{i+1}", f"{r[0]} router", "—")
          for i, r in enumerate(ROUTERS)],
        ("4", "Test Coverage",                  "—"),
        ("A", "Appendix — Function Descriptions","—"),
    ]
    for num, label, pg in toc:
        indent = 12 if len(num) > 1 else 0
        row_style = ST["toc_h"] if len(num) == 1 else ST["toc_e"]
        story.append(Table(
            [[Paragraph(f"{num}.  {label}", row_style),
              Paragraph(pg, ST["small"])]],
            colWidths=[PAGE_W - 2*MARGIN - 1.5*cm, 1.5*cm],
            style=TableStyle([
                ("VALIGN",       (0,0), (-1,-1), "MIDDLE"),
                ("LEFTPADDING",  (0,0), (0,0),   indent),
                ("TOPPADDING",   (0,0), (-1,-1),  2),
                ("BOTTOMPADDING",(0,0), (-1,-1),  2),
                ("ALIGN",        (1,0), (1,0),   "RIGHT"),
            ])))
    story.append(PageBreak())

    # ── Chapter 1: Architecture ───────────────────────────────────────────────
    story.append(Paragraph("1  Architecture Overview", ST["h1"]))
    story.append(rule())
    story.append(Paragraph(
        "Foliantica is a <b>local-first, all-in-one writing studio</b> for authors. "
        "It runs entirely on the author's machine with no mandatory cloud dependency. "
        "The architecture is a layered monolith: an Electron shell wraps a Next.js "
        "web frontend and a FastAPI Python backend, all communicating over localhost. "
        "Optional Docker sidecars extend functionality (grammar checking, export, AI "
        "mention scanning) but are not required for core writing features.",
        ST["body"]))
    story.append(hpad(8))

    story.append(Paragraph("1.1  System Layers", ST["h2"]))
    story.append(arch_diagram())
    story.append(Paragraph(
        "Figure 1 — Foliantica system layers. Arrows indicate HTTP communication. "
        "Docker sidecars are optional and communicate with the FastAPI backend only.",
        ST["caption"]))
    story.append(hpad(10))

    story.append(Paragraph(
        "The backend exposes a REST API on <font name='Courier'>http://localhost:8799</font>. "
        "The Next.js frontend runs on port 3 000 and proxies all "
        "<font name='Courier'>/api/*</font> requests to the FastAPI backend. "
        "The Electron shell injects an <font name='Courier'>X-Foliantica-Host-Secret</font> "
        "header that grants full write access without a JWT token. "
        "Remote co-work guests connect over a Cloudflare Tunnel and authenticate with a "
        "short-lived JWT issued by the host.",
        ST["body"]))

    story.append(hpad(10))
    story.append(Paragraph("1.2  Technology Stack", ST["h2"]))

    stack_data = [["Component", "Version", "Purpose"]] + TECH_STACK
    stack_table = Table(stack_data,
        colWidths=[3.5*cm, 2*cm, PAGE_W - 2*MARGIN - 5.5*cm],
        style=TableStyle([
            ("BACKGROUND",   (0,0), (-1,0), DARK),
            ("TEXTCOLOR",    (0,0), (-1,0), WHITE),
            ("FONTNAME",     (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTSIZE",     (0,0), (-1,-1), 8.5),
            ("ROWBACKGROUNDS",(0,1),(-1,-1), [LIGHT, WHITE]),
            ("GRID",         (0,0), (-1,-1), 0.3, RULE),
            ("TOPPADDING",   (0,0), (-1,-1), 4),
            ("BOTTOMPADDING",(0,0), (-1,-1), 4),
            ("LEFTPADDING",  (0,0), (-1,-1), 6),
        ]))
    story.append(stack_table)
    story.append(PageBreak())

    story.append(Paragraph("1.3  Database Schema", ST["h2"]))
    story.append(Paragraph(
        "The ORM is SQLAlchemy 2.0 with PostgreSQL 17 as the primary store "
        "(SQLite in WAL mode is supported as a fallback). All models use "
        "<font name='Courier'>mapped_column</font> with type annotations. "
        "JSON columns are used for flexible sub-structures (book metadata, "
        "time config, aliases, tags, inventory, export options).",
        ST["body"]))
    story.append(hpad(6))
    story.append(db_schema_diagram())
    story.append(Paragraph(
        "Figure 2 — Core ORM models (simplified). FK = Foreign Key, PK = Primary Key.",
        ST["caption"]))
    story.append(hpad(8))

    # Key models table
    models = [
        ["Model", "Table", "Key fields"],
        ["Project", "projects", "title, description, book_meta (JSON), time_config (JSON)"],
        ["Act", "acts", "project_id FK, title, order_index"],
        ["Chapter", "chapters", "act_id FK, title, order_index"],
        ["Scene", "scenes", "chapter_id FK, content, word_count, scene_type, card_color, global_order"],
        ["CodexEntry", "codex_entries", "project_id FK, name, entry_type, aliases/tags/inventory (JSON)"],
        ["CodexRelation", "codex_relations", "source_id FK, target_id FK, relation_type"],
        ["TimelineTrack", "timeline_tracks", "project_id FK, name, color, track_type"],
        ["TimelineEvent", "timeline_events", "track_id FK, title, scene_time (JSON)"],
        ["SceneVersion", "scene_versions", "scene_id FK, content, sha256, label, kind"],
        ["WritingLog", "writing_log", "project_id FK, date (YYYY-MM-DD), words_added"],
        ["Fragment", "fragments", "project_id FK, tab, title, content, category"],
        ["ResearchItem", "research_items", "project_id FK, url, text_content, tags (JSON)"],
        ["UserSettings", "user_settings", "openrouter_api_key (encrypted), theme, language"],
        ["AIPrompt", "ai_prompts", "name, system, user_template, is_built_in, built_in_key"],
        ["ExportProfile", "export_profiles", "project_id (nullable), name, options_json"],
        ["PublisherProfile", "publisher_profiles", "short_name, category, word_count_min/max"],
        ["QuerySubmission", "query_submissions", "project_id FK, agent_name, status, date_sent"],
        ["SceneCommand", "scene_commands", "scene_id FK, command_type, character_id, data (JSON)"],
        ["AchievementUnlock", "achievement_unlocks", "key, unlocked_at, popup_shown_at"],
        ["ValeRuleEntry", "vale_rule_entries", "lang, rule_name, entry_key, entry_value, enabled"],
    ]
    models_t = Table(models,
        colWidths=[3.5*cm, 3.5*cm, PAGE_W - 2*MARGIN - 7*cm],
        style=TableStyle([
            ("BACKGROUND",   (0,0), (-1,0), DARK),
            ("TEXTCOLOR",    (0,0), (-1,0), WHITE),
            ("FONTNAME",     (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTNAME",     (0,1), (1,-1), "Courier"),
            ("FONTSIZE",     (0,0), (-1,-1), 7.5),
            ("ROWBACKGROUNDS",(0,1),(-1,-1), [LIGHT, WHITE]),
            ("GRID",         (0,0), (-1,-1), 0.3, RULE),
            ("TOPPADDING",   (0,0), (-1,-1), 3),
            ("BOTTOMPADDING",(0,0), (-1,-1), 3),
            ("LEFTPADDING",  (0,0), (-1,-1), 5),
        ]))
    story.append(models_t)
    story.append(PageBreak())

    # ── Chapter 2: Setup Guide ────────────────────────────────────────────────
    story.append(Paragraph("2  Setup Guide", ST["h1"]))
    story.append(rule())

    story.append(Paragraph("2.1  Prerequisites", ST["h2"]))
    prereqs = [
        ["Requirement", "Version", "Notes"],
        ["Node.js", "20 LTS+", "For Next.js frontend build"],
        ["Python", "3.11+", "Backend runtime"],
        ["uv", "0.4+", "Fast Python package manager (replaces pip)"],
        ["Docker Desktop", "4+", "For optional sidecars (LanguageTool, Pandoc, etc.)"],
        ["Git", "2+", "Source checkout"],
        ["PostgreSQL", "17 (optional)", "Via Docker or system install; embedded on port 5433"],
    ]
    story.append(Table(prereqs,
        colWidths=[3.5*cm, 3*cm, PAGE_W - 2*MARGIN - 6.5*cm],
        style=TableStyle([
            ("BACKGROUND",   (0,0), (-1,0), DARK),
            ("TEXTCOLOR",    (0,0), (-1,0), WHITE),
            ("FONTNAME",     (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTSIZE",     (0,0), (-1,-1), 8.5),
            ("ROWBACKGROUNDS",(0,1),(-1,-1), [LIGHT, WHITE]),
            ("GRID",         (0,0), (-1,-1), 0.3, RULE),
            ("TOPPADDING",   (0,0), (-1,-1), 4),
            ("BOTTOMPADDING",(0,0), (-1,-1), 4),
            ("LEFTPADDING",  (0,0), (-1,-1), 6),
        ])))
    story.append(hpad(10))

    story.append(Paragraph("2.2  Running from Source", ST["h2"]))
    steps = [
        ("1. Clone the repository",
         "git clone https://github.com/your-org/foliantica.git\ncd foliantica"),
        ("2. Install Python dependencies (api/)",
         "cd api\nuv sync\n# activates .venv automatically"),
        ("3. Install Node dependencies (web/)",
         "cd ../web\nnpm install"),
        ("4. Start optional Docker services",
         ".\\scripts\\test-stack-start.ps1   # Windows\n"
         "./scripts/test-stack-start.sh     # macOS / Linux"),
        ("5. Launch all services (dev mode)",
         ".\\LaunchFoliantica.bat   # Windows\n"
         "./launch.sh              # macOS / Linux\n"
         "# Opens http://localhost:3000"),
        ("6. Run tests (Python)",
         "cd api\n.venv\\Scripts\\python.exe -m pytest --tb=short -q"),
    ]
    for title, code in steps:
        story.append(Paragraph(title, ST["h3"]))
        story.append(Paragraph(code.replace("\n", "<br/>"), ST["mono"]))
        story.append(hpad(4))

    story.append(hpad(8))
    story.append(Paragraph("2.3  Environment Variables", ST["h2"]))
    story.append(Paragraph(
        "All variables have sensible defaults for local development. "
        "Only FOLIANTICA_SECRET_KEY is required in production (auto-generated on first run "
        "if absent).",
        ST["body"]))
    story.append(hpad(4))

    env_data = [["Variable", "Default", "Description"]] + [list(r) for r in ENV_VARS]
    story.append(Table(env_data,
        colWidths=[4.5*cm, 3*cm, PAGE_W - 2*MARGIN - 7.5*cm],
        style=TableStyle([
            ("BACKGROUND",   (0,0), (-1,0), DARK),
            ("TEXTCOLOR",    (0,0), (-1,0), WHITE),
            ("FONTNAME",     (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTNAME",     (0,1), (1,-1), "Courier"),
            ("FONTSIZE",     (0,0), (-1,-1), 8),
            ("ROWBACKGROUNDS",(0,1),(-1,-1), [LIGHT, WHITE]),
            ("GRID",         (0,0), (-1,-1), 0.3, RULE),
            ("TOPPADDING",   (0,0), (-1,-1), 4),
            ("BOTTOMPADDING",(0,0), (-1,-1), 4),
            ("LEFTPADDING",  (0,0), (-1,-1), 6),
        ])))
    story.append(hpad(10))

    story.append(Paragraph("2.4  Docker Services", ST["h2"]))
    story.append(Paragraph(
        "All Docker services are optional. Enable them via "
        "<font name='Courier'>docker compose --profile &lt;name&gt; up -d</font> "
        "or through the Settings → External Services UI.",
        ST["body"]))
    story.append(hpad(4))
    docker_data = [["Service", "Port", "Profile", "Purpose"]] + \
                  [list(r) for r in DOCKER_SERVICES]
    story.append(Table(docker_data,
        colWidths=[2.8*cm, 1.5*cm, 2.5*cm, PAGE_W - 2*MARGIN - 6.8*cm],
        style=TableStyle([
            ("BACKGROUND",   (0,0), (-1,0), DARK),
            ("TEXTCOLOR",    (0,0), (-1,0), WHITE),
            ("FONTNAME",     (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTNAME",     (0,1), (1,-1), "Courier"),
            ("FONTSIZE",     (0,0), (-1,-1), 8.5),
            ("ROWBACKGROUNDS",(0,1),(-1,-1), [LIGHT, WHITE]),
            ("GRID",         (0,0), (-1,-1), 0.3, RULE),
            ("TOPPADDING",   (0,0), (-1,-1), 4),
            ("BOTTOMPADDING",(0,0), (-1,-1), 4),
            ("LEFTPADDING",  (0,0), (-1,-1), 6),
        ])))
    story.append(PageBreak())

    # ── Chapter 3: API Reference ──────────────────────────────────────────────
    story.append(Paragraph("3  API Reference", ST["h1"]))
    story.append(rule())
    story.append(Paragraph(
        "The FastAPI backend exposes <b>25 routers</b> with a combined total of "
        "<b>~140 endpoints</b>. All routes are prefixed with "
        "<font name='Courier'>/api</font>. "
        "The OpenAPI interactive docs are available at "
        "<font name='Courier'>http://localhost:8799/docs</font> when the backend is running.",
        ST["body"]))
    story.append(hpad(6))

    # Method legend
    legend_items = []
    for method, colour in [("GET", "#10b981"), ("POST", "#3b82f6"),
                            ("PATCH", "#f59e0b"), ("DELETE", "#ef4444"),
                            ("PUT", "#8b5cf6")]:
        legend_items.append(
            f'<font name="Helvetica-Bold" color="{colour}" size="8">[{method}]</font>'
            f'<font name="Helvetica" size="8" color="#475569"> {method.lower()}  </font>'
        )
    story.append(Paragraph("  ".join(legend_items), ST["body"]))
    story.append(hpad(8))

    for idx, (router_name, description, endpoints) in enumerate(ROUTERS):
        # Section header
        header = Table(
            [[Paragraph(f"3.{idx+1}  {router_name}", ST["h2"]),
              Paragraph(description, ST["small"])]],
            colWidths=[4*cm, PAGE_W - 2*MARGIN - 4*cm],
            style=TableStyle([
                ("VALIGN",      (0,0), (-1,-1), "MIDDLE"),
                ("TOPPADDING",  (0,0), (-1,-1), 0),
                ("BOTTOMPADDING",(0,0), (-1,-1), 0),
            ]))
        story.append(KeepTogether([
            header,
            HRFlowable(width="100%", thickness=0.3, color=MID, spaceAfter=4),
        ]))

        rows = []
        for method, path, desc in endpoints:
            badge_color = {
                "GET": "#10b981", "POST": "#3b82f6",
                "PATCH": "#f59e0b", "DELETE": "#ef4444", "PUT": "#8b5cf6",
            }.get(method, "#64748b")
            method_cell = Paragraph(
                f'<font name="Helvetica-Bold" color="{badge_color}" size="8">'
                f'{method}</font>', ST["body"])
            path_cell = Paragraph(
                f'<font name="Courier" size="8">{path}</font>', ST["body"])
            desc_cell = Paragraph(desc, ST["small"])
            rows.append([method_cell, path_cell, desc_cell])

        ep_table = Table(rows,
            colWidths=[1.4*cm, 7.5*cm, PAGE_W - 2*MARGIN - 8.9*cm],
            style=TableStyle([
                ("ROWBACKGROUNDS", (0,0), (-1,-1), [LIGHT, WHITE]),
                ("TOPPADDING",    (0,0), (-1,-1), 3),
                ("BOTTOMPADDING", (0,0), (-1,-1), 3),
                ("LEFTPADDING",   (0,0), (-1,-1), 5),
                ("GRID",          (0,0), (-1,-1), 0.2, RULE),
                ("VALIGN",        (0,0), (-1,-1), "MIDDLE"),
            ]))
        story.append(ep_table)
        story.append(hpad(10))

    story.append(PageBreak())

    # ── Chapter 4: Test Coverage ──────────────────────────────────────────────
    story.append(Paragraph("4  Test Coverage", ST["h1"]))
    story.append(rule())
    story.append(Paragraph(
        "The Python test suite uses <b>pytest</b> with <font name='Courier'>pytest-cov</font>. "
        "All 1 036 tests run against a real PostgreSQL database (port 5433) — no mocks for the "
        "database layer. Coverage is measured against "
        "<font name='Courier'>api/routers/</font> only.",
        ST["body"]))
    story.append(hpad(4))

    summary_rows = [
        ["Metric", "Value"],
        ["Total tests", "1 036"],
        ["Failures", "0"],
        ["Errors", "0"],
        ["Overall router coverage", "~80 %"],
        ["Highest coverage", "research.py (96 %)"],
        ["Lowest coverage", "ai.py (32 %) — streaming responses hard to mock"],
    ]
    story.append(Table(summary_rows,
        colWidths=[6*cm, PAGE_W - 2*MARGIN - 6*cm],
        style=TableStyle([
            ("BACKGROUND",   (0,0), (-1,0), DARK),
            ("TEXTCOLOR",    (0,0), (-1,0), WHITE),
            ("FONTNAME",     (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTSIZE",     (0,0), (-1,-1), 9),
            ("ROWBACKGROUNDS",(0,1),(-1,-1), [LIGHT, WHITE]),
            ("GRID",         (0,0), (-1,-1), 0.3, RULE),
            ("TOPPADDING",   (0,0), (-1,-1), 5),
            ("BOTTOMPADDING",(0,0), (-1,-1), 5),
            ("LEFTPADDING",  (0,0), (-1,-1), 8),
            ("FONTNAME",     (0,1), (0,-1), "Helvetica-Bold"),
            ("TEXTCOLOR",    (0,1), (0,-1), ACCENT),
        ])))
    story.append(hpad(12))
    story.append(coverage_chart())
    story.append(Paragraph(
        "Figure 3 — Per-router test coverage. Green ≥ 80 %, amber 60–79 %, red < 60 %.",
        ST["caption"]))
    story.append(hpad(8))
    story.append(Paragraph(
        "<b>Low-coverage areas and reasons:</b>",
        ST["h3"]))
    low_cov = [
        ["Router", "Coverage", "Reason"],
        ["ai.py", "32 %", "Server-Sent Events streaming; async generator hard to drive in TestClient"],
        ["export.py", "57 %", "Requires Pandoc Docker sidecar; skipped in offline CI"],
        ["imports.py", "48 %", "Large file uploads; happy-path only tested"],
        ["collab.py", "45 %", "WebSocket + Cloudflare Tunnel; needs live network"],
        ["settings.py", "52 %", "Docker compose calls require process isolation"],
    ]
    story.append(Table(low_cov,
        colWidths=[2.8*cm, 2*cm, PAGE_W - 2*MARGIN - 4.8*cm],
        style=TableStyle([
            ("BACKGROUND",   (0,0), (-1,0), DARK),
            ("TEXTCOLOR",    (0,0), (-1,0), WHITE),
            ("FONTNAME",     (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTSIZE",     (0,0), (-1,-1), 8.5),
            ("ROWBACKGROUNDS",(0,1),(-1,-1), [LIGHT, WHITE]),
            ("GRID",         (0,0), (-1,-1), 0.3, RULE),
            ("TOPPADDING",   (0,0), (-1,-1), 4),
            ("BOTTOMPADDING",(0,0), (-1,-1), 4),
            ("LEFTPADDING",  (0,0), (-1,-1), 6),
            ("FONTNAME",     (0,1), (0,-1), "Courier"),
            ("TEXTCOLOR",    (1,1), (1,-1), RED),
        ])))
    story.append(PageBreak())

    # ── Appendix A: Function descriptions ────────────────────────────────────
    story.append(Paragraph("Appendix A  —  Key Function Descriptions", ST["h1"]))
    story.append(rule())
    story.append(Paragraph(
        "This appendix describes the most important functions in the Foliantica backend. "
        "Pure helper functions and trivial CRUD wrappers are omitted. "
        "File paths are relative to the <font name='Courier'>api/</font> directory.",
        ST["body"]))
    story.append(hpad(8))

    for fn_sig, fn_desc in KEY_FUNCTIONS:
        story.append(KeepTogether([
            Paragraph(fn_sig, ST["h3"]),
            Paragraph(fn_desc, ST["body"]),
            hpad(4),
            HRFlowable(width="100%", thickness=0.3, color=RULE, spaceAfter=2),
        ]))

    story.append(PageBreak())

    # ── Appendix B: Publisher profiles ───────────────────────────────────────
    story.append(Paragraph("Appendix B  —  Built-in Publisher Profiles", ST["h1"]))
    story.append(rule())
    story.append(Paragraph(
        "Foliantica ships with <b>38 publisher / agent formatting profiles</b> seeded at "
        "startup. These are read-only reference profiles (is_active = True). Users can "
        "create additional custom ExportProfiles per project.",
        ST["body"]))
    story.append(hpad(6))
    categories = [
        ("Standard Manuscript",    ["SMF Times New Roman", "SMF Courier"]),
        ("US Trade Publishers",    ["Berkley / PRH", "Harlequin"]),
        ("UK Publishers",          ["Pan Macmillan", "Hachette UK", "Bloomsbury",
                                    "Tor UK", "Soho Press"]),
        ("Literary Agencies",      ["Curtis Brown", "Janklow & Nesbit", "Writers House"]),
        ("Self-Publishing",        ["Amazon KDP", "Draft2Digital"]),
        ("German Publishers (10)", ["Rowohlt", "S. Fischer", "Suhrkamp", "Hanser",
                                    "Piper", "Droemer Knaur", "Bastei Lübbe",
                                    "Aufbau", "Ullstein", "dtv"]),
        ("French Publishers (8)",  ["Gallimard", "Seuil", "Flammarion", "Albin Michel",
                                    "Actes Sud", "Bragelonne", "L'Atalante"]),
        ("Spanish Publishers (7)", ["Planeta", "Alfaguara", "Anagrama", "Tusquets",
                                    "Siruela", "Ediciones Urano", "Roca Editorial"]),
    ]
    for cat, names in categories:
        story.append(Paragraph(cat, ST["h3"]))
        story.append(Paragraph(", ".join(names), ST["body"]))
        story.append(hpad(2))

    story.append(hpad(12))
    story.append(Paragraph("Appendix C  —  Pydantic Schema Reference", ST["h1"]))
    story.append(rule())
    schemas = [
        ("ProjectOut", "id, title, description, book_meta (BookMeta), cover_image, "
         "main_plot_color, shared_codex_project_id, created_at, updated_at"),
        ("BookMeta", "author, author_sort, subtitle, language (BCP 47), publisher, "
         "published_date, isbn, rights, series, series_index, genre, synopsis, translator"),
        ("SceneOut", "id, chapter_id, title, content, synopsis, word_count, scene_type, "
         "card_color, subplot, global_order, pov_character_id, scene_time (JSON), "
         "node_x, node_y, created_at, updated_at"),
        ("CodexEntryOut", "id, project_id, name, aliases, entry_type, description, notes, "
         "color, tags, is_main_char, inventory, image_path, share_mode, share_future, "
         "created_at, updated_at"),
        ("ExportOptions", "format (pdf|epub|docx|markdown|latex), font, font_size, "
         "line_spacing, text_align, heading_align, paragraph_indent, page_numbers, "
         "include_act_headings, include_chapter_headings, include_scene_titles, drop_caps"),
        ("AIGenerateRequest", "scene_id, mode (continue|rewrite|brainstorm|ask), "
         "prompt (str), context_scenes (list[int]), codex_entries (list[int])"),
        ("SettingsOut", "openrouter_api_key (masked), default_model, theme, language, "
         "all feature flags, service URLs (pandoc_url, lt_url, spacy_url, vale_url), "
         "sync_mirror_enabled, sync_mirror_dir"),
        ("QuerySubmission", "id, project_id, agent_name, agency, email, "
         "submission_type, date_sent, response_deadline, status, notes"),
    ]
    for name, fields in schemas:
        story.append(KeepTogether([
            Paragraph(name, ST["h3"]),
            Paragraph(f"<i>Fields:</i>  {fields}", ST["body"]),
            hpad(3),
        ]))

    return story


# ── Generate PDF ──────────────────────────────────────────────────────────────
def generate():
    output = "foliantica_technical_docs.pdf"
    doc = SimpleDocTemplate(
        output,
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN + 8*mm,
        bottomMargin=MARGIN + 8*mm,
        title="Foliantica Technical Documentation",
        author="Foliantica",
        subject="Architecture, API Reference, Setup Guide",
    )
    story = build_story()
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    print(f"Generated: {output}")


if __name__ == "__main__":
    generate()
