import base64 as _b64
import html as _html
import json
import re
from pathlib import Path
from jinja2 import Environment
from models import Project

_jinja = Environment(autoescape=False)


# ── Book metadata helper ──────────────────────────────────────────────────────

def _get_meta(project: Project) -> dict:
    if not project.book_meta:
        return {}
    try:
        return json.loads(project.book_meta)
    except Exception:
        return {}


# ── HTML → plain text ─────────────────────────────────────────────────────────

def _strip_html(html: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", html or "")
    text = re.sub(r"</p>", "\n\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()


# ── LaTeX character escaping ──────────────────────────────────────────────────

_LATEX_ESCAPES = str.maketrans({
    "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#",
    "_": r"\_", "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}", "\\": r"\textbackslash{}",
})


def _escape_latex(text: str) -> str:
    return (text or "").translate(_LATEX_ESCAPES)


# ── YAML string escaping ──────────────────────────────────────────────────────

def _yaml_str(value: str) -> str:
    escaped = (value or "").replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


# ── Scene-image node extraction ───────────────────────────────────────────────
# TipTap renders custom image nodes as:
#   <div data-type="scene-image" data-src="uploads/…" data-caption="…"></div>
# We replace them with placeholders so the rest of the pipeline can process
# plain text / HTML, then substitute format-specific output at the end.

_SCENE_IMG_RE = re.compile(
    r'<div\b([^>]*\bdata-type="scene-image"[^>]*)>\s*(?:</div>)?\s*',
    re.IGNORECASE | re.DOTALL,
)
_IMG_PH = "\x00IMG{}\x00"         # null-byte delimited so LaTeX escaping ignores it
_IMG_PH_RE = re.compile(r"\x00IMG(\d+)\x00")


def _img_attr(attrs: str, name: str) -> str:
    m = re.search(rf'{re.escape(name)}="([^"]*)"', attrs)
    return m.group(1) if m else ""


def _extract_images(html: str) -> "tuple[str, list[tuple[str,str]]]":
    """Replace scene-image divs with placeholders.
    Returns (html_with_placeholders, [(src, caption), ...])."""
    imgs: list[tuple[str, str]] = []

    def _sub(m):
        a = m.group(1)
        imgs.append((_img_attr(a, "data-src"), _img_attr(a, "data-caption")))
        return _IMG_PH.format(len(imgs) - 1)

    return _SCENE_IMG_RE.sub(_sub, html), imgs


def _img_md(src: str, cap: str) -> str:
    if not src:
        return ""
    rel = "../" + src.replace("\\", "/")
    return f"\n\n![{cap}]({rel})\n\n"


def _img_latex(src: str, cap: str) -> str:
    if not src:
        return ""
    rel = "../" + src.replace("\\", "/")
    cap_line = f"\n\\caption{{{_escape_latex(cap)}}}" if cap else ""
    return (
        f"\n\\begin{{figure}}[htbp]\n\\centering\n"
        f"\\includegraphics[width=0.85\\linewidth]{{{rel}}}{cap_line}\n"
        f"\\end{{figure}}\n\n"
    )


def _img_html(src: str, cap: str) -> str:
    if not src:
        return ""
    p = Path(src)
    if not p.exists():
        return ""
    data = p.read_bytes()
    ext = p.suffix.lower().lstrip(".")
    mime = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png",
            "webp": "webp", "gif": "gif"}.get(ext, "jpeg")
    b64 = _b64.b64encode(data).decode()
    cap_e = _html.escape(cap)
    fig = f"<figcaption>{cap_e}</figcaption>" if cap else ""
    return f'<figure><img src="data:image/{mime};base64,{b64}" alt="{cap_e}"/>{fig}</figure>\n'


# ── Style helpers (LaTeX) ─────────────────────────────────────────────────────

_H_SIZE_TO_LATEX: dict[str, str] = {
    "2em":    r"\LARGE",
    "1.75em": r"\Large",
    "1.5em":  r"\large",
    "1.4em":  r"\large",
    "1.25em": r"\normalsize",
    "1.15em": r"\normalsize",
    "1.1em":  r"\normalsize",
    "1em":    r"\normalsize",
}


def _h_latex_size(v: str) -> str:
    return _H_SIZE_TO_LATEX.get(v, r"\large")


def _h_latex_align(v: str) -> str:
    return r"\centering" if v == "center" else ""


def _h3_latex_style(v: str) -> str:
    return {"italic": r"\itshape", "bold": r"\bfseries", "normal": ""}.get(v, r"\itshape")


def _apply_dropcap_latex(text: str) -> str:
    """Wrap the first letter of text with \\lettrine{}{} for drop caps."""
    m = re.match(r'^([A-Za-zÀ-ÖØ-öø-ÿ])([\w]*)(.*)$', text.lstrip(), re.DOTALL)
    if m:
        return (
            f"\\lettrine[lines=3]{{{m.group(1)}}}{{{m.group(2)}}}"
            f"{m.group(3)}"
        )
    return text


# ── Helpers ───────────────────────────────────────────────────────────────────

def _scene_ids_set(opts) -> "set[int] | None":
    return set(opts.scene_ids) if opts.scene_ids is not None else None


def _line_spacing_latex(val: str) -> str:
    return {
        "1":   "\\singlespacing",
        "1.5": "\\onehalfspacing",
        "2":   "\\doublespacing",
    }.get(val, "\\onehalfspacing")


def _font_size_latex(val: str) -> str:
    return val if val in {"10pt", "11pt", "12pt"} else "12pt"


def _gv(opts, name: str, default):
    """getattr with default — keeps callers that don't pass new style fields working."""
    return getattr(opts, name, default)


# ── Markdown export ───────────────────────────────────────────────────────────

def export_markdown(project: Project, opts) -> str:
    meta = _get_meta(project)
    allowed = _scene_ids_set(opts)

    fm_lines = ["---"]
    fm_lines.append(f"title: {_yaml_str(project.title)}")
    if meta.get("subtitle"):
        fm_lines.append(f"subtitle: {_yaml_str(meta['subtitle'])}")
    if meta.get("author"):
        fm_lines.append(f"author: {_yaml_str(meta['author'])}")
    if meta.get("language"):
        fm_lines.append(f"lang: {meta['language']}")
    if meta.get("publisher"):
        fm_lines.append(f"publisher: {_yaml_str(meta['publisher'])}")
    if meta.get("published_date"):
        fm_lines.append(f"date: {_yaml_str(meta['published_date'])}")
    if meta.get("isbn"):
        fm_lines.append(f"isbn: {_yaml_str(meta['isbn'])}")
    if meta.get("rights"):
        fm_lines.append(f"rights: {_yaml_str(meta['rights'])}")
    if meta.get("series"):
        fm_lines.append(f"series: {_yaml_str(meta['series'])}")
        if meta.get("series_index"):
            fm_lines.append(f"series-position: {_yaml_str(meta['series_index'])}")
    if meta.get("genre"):
        subjects = [meta["genre"]] + meta.get("subjects", [])
        fm_lines.append("subject:")
        for s in subjects:
            fm_lines.append(f"  - {_yaml_str(s)}")
    elif meta.get("subjects"):
        fm_lines.append("subject:")
        for s in meta["subjects"]:
            fm_lines.append(f"  - {_yaml_str(s)}")
    if meta.get("translator"):
        fm_lines.append(f"translator: {_yaml_str(meta['translator'])}")
    if meta.get("editor"):
        fm_lines.append(f"editor: {_yaml_str(meta['editor'])}")
    if meta.get("synopsis"):
        fm_lines.append(f"description: {_yaml_str(meta['synopsis'])}")
    fm_lines.append("---")
    fm_lines.append("")

    lines: list[str] = fm_lines + [f"# {project.title}", ""]
    if meta.get("subtitle"):
        lines += [f"*{meta['subtitle']}*", ""]
    if meta.get("author"):
        lines += [f"*{meta['author']}*", ""]
    if project.description:
        lines += [project.description, ""]

    h = ["##", "###", "####"]
    if not opts.include_act_headings:
        h = ["##", "###"]
    if not opts.include_chapter_headings:
        h = h[:1] + [h[1]]

    for act in sorted(project.acts, key=lambda a: a.order_index):
        act_written = False
        for chapter in sorted(act.chapters, key=lambda c: c.order_index):
            chap_written = False
            for scene in sorted(chapter.scenes, key=lambda s: s.order_index):
                if allowed is not None and scene.id not in allowed:
                    continue
                _html, _imgs = _extract_images(scene.content or "")
                body = _strip_html(_html)
                body = _IMG_PH_RE.sub(
                    lambda m: _img_md(*_imgs[int(m.group(1))]), body
                )
                if not body.strip():
                    continue
                if opts.include_act_headings and not act_written:
                    lines += [f"{h[0]} {act.title}", ""]
                    act_written = True
                if opts.include_chapter_headings and not chap_written:
                    idx = 1 if opts.include_act_headings else 0
                    lines += [f"{h[idx]} {chapter.title}", ""]
                    chap_written = True
                if opts.include_scene_headings and scene.title:
                    idx = (2 if opts.include_act_headings and opts.include_chapter_headings
                           else 1 if opts.include_act_headings or opts.include_chapter_headings
                           else 0)
                    lines += [f"{h[idx]} {scene.title}", ""]
                lines += [body, ""]

    return "\n".join(lines)


# ── LaTeX export (LuaLaTeX + fontspec) ────────────────────────────────────────

_LATEX_TEMPLATE = """\
% Generated by Foliantica — compile with: lualatex {{ filename }}
\\documentclass[{{ font_size }},openany]{book}

% ── Engine & fonts ────────────────────────────────────────────────────────────
\\usepackage{fontspec}
{{ font_cmd }}
{{ heading_font_cmd }}
\\usepackage{microtype}

% ── Page layout ───────────────────────────────────────────────────────────────
\\usepackage[{{ paper_size }},margin={{ pdf_margin }}]{geometry}

% ── Spacing & paragraphs ──────────────────────────────────────────────────────
\\usepackage{setspace}
{{ spacing_cmd }}
{{ para_indent_cmd }}

% ── Graphics ──────────────────────────────────────────────────────────────────
\\usepackage{graphicx}
{% if drop_caps %}
\\usepackage{lettrine}
{% endif %}

% ── Heading styles ────────────────────────────────────────────────────────────
\\usepackage{titlesec}
\\titleformat{\\chapter}[display]{\\normalfont{{ h1_size_cmd }}\\bfseries{{ h_align_cmd }}{{ h_font_ref }}}{}{0pt}{}[\\vspace{0.5em}\\titlerule]
\\titlespacing*{\\chapter}{0pt}{-20pt}{30pt}
\\titleformat{\\section}{\\normalfont{{ h2_size_cmd }}\\bfseries{{ h_align_cmd }}{{ h_font_ref }}}{}{0pt}{}
\\titleformat{\\subsection}{\\normalfont{{ h3_size_cmd }}{{ h3_style_cmd }}{{ h_align_cmd }}{{ h_font_ref }}}{}{0pt}{}

% ── Hyperlinks ────────────────────────────────────────────────────────────────
\\usepackage[hidelinks]{hyperref}

% ── Document meta ─────────────────────────────────────────────────────────────
\\title{ {{ title_block }} }
\\author{ {{ author }} }
\\date{ {{ pub_date }} }
{% if publisher or rights or isbn or series %}
\\newcommand{\\bookpublisher}{ {{ publisher }} }
{% if isbn %}\\newcommand{\\bookisbn}{ {{ isbn }} }{% endif %}
{% if rights %}\\newcommand{\\bookrights}{ {{ rights }} }{% endif %}
{% if series %}\\newcommand{\\bookseries}{ {{ series }}{% if series_index %}, \\#{{ series_index }}{% endif %} }{% endif %}
{% endif %}

{% if not page_numbers %}
\\pagestyle{empty}
{% endif %}

\\begin{document}

\\maketitle
\\newpage

{{ description_block }}
{{ body }}
\\end{document}
"""

_DESCRIPTION_BLOCK = """\
\\begin{center}
\\textit{ {{ desc }} }
\\end{center}
\\vspace{2em}
\\newpage

"""


def export_latex(project: Project, opts) -> str:
    meta = _get_meta(project)
    allowed = _scene_ids_set(opts)

    # ── Font commands ──────────────────────────────────────────────────────────
    font_cmd = (
        f"\\setmainfont{{{opts.font}}}"
        if opts.font else
        "% \\setmainfont{EB Garamond}  % uncomment and set your font"
    )

    h_font = _gv(opts, "heading_font", None)
    if h_font and h_font != opts.font:
        heading_font_cmd = f"\\newfontfamily\\headingfont{{{h_font}}}"
        h_font_ref       = "\\headingfont"
    else:
        heading_font_cmd = ""
        h_font_ref       = ""

    # ── Heading style ──────────────────────────────────────────────────────────
    h_align_cmd  = _h_latex_align(_gv(opts, "heading_align", "center"))
    h1_size_cmd  = _h_latex_size(_gv(opts, "h1_size",  "2em"))
    h2_size_cmd  = _h_latex_size(_gv(opts, "h2_size",  "1.5em"))
    h3_size_cmd  = _h_latex_size(_gv(opts, "h3_size",  "1.25em"))
    h3_style_cmd = _h3_latex_style(_gv(opts, "h3_style", "italic"))

    # ── Paragraph style ────────────────────────────────────────────────────────
    indent = _gv(opts, "paragraph_indent", "1.5em")
    if indent == "0":
        para_indent_cmd = (
            "\\setlength{\\parindent}{0pt}\n"
            "\\setlength{\\parskip}{0.8em}"
        )
    else:
        para_indent_cmd = (
            f"\\setlength{{\\parindent}}{{{indent}}}\n"
            "\\setlength{\\parskip}{0pt}"
        )

    drop_caps   = _gv(opts, "drop_caps",   False)
    page_numbers = _gv(opts, "page_numbers", True)
    pdf_margin  = _gv(opts, "pdf_margin",  "2.5cm")

    # ── Title block ────────────────────────────────────────────────────────────
    title_esc    = _escape_latex(project.title)
    subtitle_esc = _escape_latex(meta.get("subtitle", ""))
    title_block  = (
        f"{title_esc} \\\\ \\large {subtitle_esc}"
        if subtitle_esc else title_esc
    )

    # ── Body ───────────────────────────────────────────────────────────────────
    body_parts: list[str] = []

    for act in sorted(project.acts, key=lambda a: a.order_index):
        act_written = False
        for chapter in sorted(act.chapters, key=lambda c: c.order_index):
            chap_written    = False
            first_para_chap = True   # for drop caps — first ¶ after chapter heading

            for scene in sorted(chapter.scenes, key=lambda s: s.order_index):
                if allowed is not None and scene.id not in allowed:
                    continue

                _html, _imgs = _extract_images(scene.content or "")
                plain = _strip_html(_html)
                escaped = _escape_latex(plain)
                # Restore image placeholders as LaTeX
                content = _IMG_PH_RE.sub(
                    lambda m: _img_latex(*_imgs[int(m.group(1))]),
                    escaped,
                )
                if not content.strip():
                    continue

                # Lazy act heading
                if opts.include_act_headings and not act_written:
                    body_parts.append(
                        f"\\chapter*{{{_escape_latex(act.title)}}}\n"
                        f"\\addcontentsline{{toc}}{{chapter}}{{{_escape_latex(act.title)}}}\n"
                    )
                    act_written    = True
                    first_para_chap = True

                # Lazy chapter heading
                if opts.include_chapter_headings and not chap_written:
                    if opts.include_act_headings:
                        body_parts.append(f"\\section*{{{_escape_latex(chapter.title)}}}\n")
                    else:
                        body_parts.append(
                            f"\\chapter*{{{_escape_latex(chapter.title)}}}\n"
                            f"\\addcontentsline{{toc}}{{chapter}}{{{_escape_latex(chapter.title)}}}\n"
                        )
                    chap_written    = True
                    first_para_chap = True

                # Scene heading
                if opts.include_scene_headings and scene.title:
                    if opts.include_chapter_headings:
                        body_parts.append(f"\\subsection*{{{_escape_latex(scene.title)}}}\n")
                    elif opts.include_act_headings:
                        body_parts.append(f"\\section*{{{_escape_latex(scene.title)}}}\n")
                    else:
                        body_parts.append(
                            f"\\chapter*{{{_escape_latex(scene.title)}}}\n"
                            f"\\addcontentsline{{toc}}{{chapter}}{{{_escape_latex(scene.title)}}}\n"
                        )
                    first_para_chap = True

                paras = [p.strip() for p in content.split("\n\n") if p.strip()]

                # Apply drop cap to first real paragraph of each chapter
                if drop_caps and first_para_chap and paras:
                    paras[0] = _apply_dropcap_latex(paras[0])
                    first_para_chap = False

                body_parts.append("\n\n".join(paras) + "\n\n")

    safe_title = project.title.replace(" ", "_")
    desc_text  = meta.get("synopsis") or project.description or ""
    description_block = (
        _jinja.from_string(_DESCRIPTION_BLOCK).render(desc=_escape_latex(desc_text))
        if desc_text else ""
    )

    return _jinja.from_string(_LATEX_TEMPLATE).render(
        filename          = f"{safe_title}.tex",
        font_size         = _font_size_latex(opts.font_size),
        font_cmd          = font_cmd,
        heading_font_cmd  = heading_font_cmd,
        h_font_ref        = h_font_ref,
        h_align_cmd       = h_align_cmd,
        h1_size_cmd       = h1_size_cmd,
        h2_size_cmd       = h2_size_cmd,
        h3_size_cmd       = h3_size_cmd,
        h3_style_cmd      = h3_style_cmd,
        paper_size        = opts.paper_size if opts.paper_size in ("a4paper", "letterpaper") else "a4paper",
        pdf_margin        = pdf_margin,
        spacing_cmd       = _line_spacing_latex(opts.line_spacing),
        para_indent_cmd   = para_indent_cmd,
        drop_caps         = drop_caps,
        page_numbers      = page_numbers,
        title_block       = title_block,
        author            = _escape_latex(meta.get("author", "")),
        pub_date          = _escape_latex(meta.get("published_date", "")),
        publisher         = _escape_latex(meta.get("publisher", "")),
        isbn              = _escape_latex(meta.get("isbn", "")),
        rights            = _escape_latex(meta.get("rights", "")),
        series            = _escape_latex(meta.get("series", "")),
        series_index      = _escape_latex(meta.get("series_index", "")),
        description_block = description_block,
        body              = "".join(body_parts),
    )


# ── HTML export (used by pandoc service for PDF / EPUB) ──────────────────────

def export_html(project: Project, opts) -> str:
    """Build a minimal but well-structured HTML document for pandoc.
    Scene images are embedded as base64 data URIs so the self-contained HTML
    works inside the Pandoc container without filesystem access."""
    meta    = _get_meta(project)
    allowed = _scene_ids_set(opts)

    parts: list[str] = []

    for act in sorted(project.acts, key=lambda a: a.order_index):
        act_written = False
        for chapter in sorted(act.chapters, key=lambda c: c.order_index):
            chap_written = False
            for scene in sorted(chapter.scenes, key=lambda s: s.order_index):
                if allowed is not None and scene.id not in allowed:
                    continue
                scene_html, scene_imgs = _extract_images(scene.content or "")
                content = _IMG_PH_RE.sub(
                    lambda m: _img_html(*scene_imgs[int(m.group(1))]),
                    scene_html,
                ).strip()
                if not content:
                    continue

                if opts.include_act_headings and not act_written:
                    parts.append(f"<h1>{_html.escape(act.title)}</h1>")
                    act_written = True
                if opts.include_chapter_headings and not chap_written:
                    parts.append(f"<h2>{_html.escape(chapter.title)}</h2>")
                    chap_written = True
                if opts.include_scene_headings and scene.title:
                    parts.append(f"<h3>{_html.escape(scene.title)}</h3>")
                parts.append(content)

    body     = "\n".join(parts)
    lang     = meta.get("language", "en")
    title    = project.title or ""
    author   = meta.get("author", "")
    subtitle = meta.get("subtitle", "")

    title_e    = _html.escape(title)
    subtitle_e = _html.escape(subtitle)
    author_e   = _html.escape(author)

    subtitle_tag = f'<p class="subtitle">{subtitle_e}</p>' if subtitle else ""
    author_tag   = f'<p class="author">{author_e}</p>'     if author   else ""

    # Embed Google Fonts import + basic font-family rule so PDF/EPUB renderers
    # (wkhtmltopdf, WeasyPrint, headless Chrome) can actually fetch and apply the
    # font.  Use the plain family= URL — no axis specification — so display fonts
    # that lack italic/bold variants are served correctly.
    _SYSTEM_FONTS = {"Georgia", "Times New Roman", "Arial", "Helvetica", "Verdana",
                     "Courier New", "serif", "sans-serif", "monospace"}
    font_name    = getattr(opts, "font", None) or None
    heading_font = getattr(opts, "heading_font", None) or None
    gf_imports: list[str] = []
    for gf in filter(None, [font_name, heading_font]):
        if gf not in _SYSTEM_FONTS:
            encoded = gf.replace(" ", "+")
            gf_imports.append(
                f"@import url('https://fonts.googleapis.com/css2?family={encoded}&display=swap');"
            )
    font_style_block = ""
    if font_name or gf_imports:
        imports_css = "\n".join(dict.fromkeys(gf_imports))
        body_family = f'"{font_name}", serif' if font_name else "serif"
        h_family    = f'"{heading_font}", {body_family}' if heading_font else body_family
        font_style_block = f"""
<style>
{imports_css}
body {{ font-family: {body_family}; }}
h1, h2, h3, h4, h5, h6 {{ font-family: {h_family}; }}
</style>"""

    return f"""<!DOCTYPE html>
<html lang="{_html.escape(lang)}">
<head>
<meta charset="utf-8">
<title>{title_e}</title>{font_style_block}
</head>
<body>
<h1 class="title">{title_e}</h1>
{subtitle_tag}
{author_tag}
{body}
</body>
</html>"""


# ── EPUB style (CSS) export ───────────────────────────────────────────────────

_EPUB_CSS_TEMPLATE = """\
/* Foliantica EPUB stylesheet — use with Pandoc or Calibre
{meta_comment}*/

@namespace epub "http://www.idpf.org/2007/ops";

{google_font_import}

body {{
  font-family: {font_family};
  font-size: {font_size_css};
  line-height: {line_height};
  color: {text_color};
  background-color: {bg_color};
  margin: {page_margin};
  text-align: {text_align};
  hyphens: auto;
  -epub-hyphens: auto;
}}

h1, h2, h3, h4 {{
  font-family: {heading_family};
  font-weight: bold;
  text-align: {heading_align};
  margin-top: 2em;
  margin-bottom: 1em;
  page-break-after: avoid;
}}
h1 {{ font-size: {h1_size}; }}
h2 {{ font-size: {h2_size}; border-bottom: 1px solid currentColor; padding-bottom: 0.3em; }}
h3 {{ font-size: {h3_size}; {h3_style_css} }}
h4 {{ font-size: 1em; font-style: italic; }}

p {{
  margin: 0;
  text-indent: {paragraph_indent};
}}
p:first-of-type, h1 + p, h2 + p, h3 + p, h4 + p {{ text-indent: 0; }}

hr {{
  border: none;
  text-align: center;
  margin: 1.5em auto;
}}
hr::after {{
  content: "* * *";
  color: {text_color};
  font-size: 0.9em;
}}

.chapter {{ page-break-before: always; -epub-page-break-before: always; }}

em {{ font-style: italic; }}
strong {{ font-weight: bold; }}

blockquote {{
  margin: 1em 2em;
  font-style: italic;
  border-left: 3px solid {text_color};
  padding-left: 1em;
  opacity: 0.85;
}}

figure {{
  margin: 1.5em auto;
  text-align: center;
}}
figure img {{
  max-width: 100%;
  height: auto;
}}
figcaption {{
  font-size: 0.85em;
  color: {text_color};
  opacity: 0.7;
  margin-top: 0.5em;
}}
"""

_FONT_SIZE_CSS  = {"10pt": "0.9em", "11pt": "1em", "12pt": "1.1em"}
_LINE_HEIGHT_CSS = {"1": "1.4", "1.5": "1.7", "2": "2.0"}


def export_epub_style(project: Project, opts) -> str:
    meta = _get_meta(project)

    # Body font
    font_family = f'"{opts.font}", Georgia, serif' if opts.font else "Georgia, serif"

    # Heading font
    h_font = _gv(opts, "heading_font", None)
    if h_font:
        heading_family = f'"{h_font}", {font_family}'
    else:
        heading_family = font_family

    # Google Fonts @import (for EPUB readers with internet access).
    # Use the plain family= form — no axis specification — so decorative/display
    # fonts that lack italic or bold variants (e.g. Pirata One) are served correctly.
    _SYSTEM_FONTS = {"Georgia", "Times New Roman", "Arial", "Helvetica", "Verdana",
                     "Courier New", "serif", "sans-serif", "monospace"}
    gf_imports: list[str] = []
    for gf in filter(None, [opts.font, h_font]):
        if gf not in _SYSTEM_FONTS:
            encoded = gf.replace(" ", "+")
            gf_imports.append(
                f"@import url('https://fonts.googleapis.com/css2?"
                f"family={encoded}&display=swap');"
            )
    google_font_import = "\n".join(dict.fromkeys(gf_imports))  # deduplicate

    # Style vars
    heading_align = _gv(opts, "heading_align",      "center")
    h1_size       = _gv(opts, "h1_size",            "2em")
    h2_size       = _gv(opts, "h2_size",            "1.5em")
    h3_size       = _gv(opts, "h3_size",            "1.25em")
    h3_style      = _gv(opts, "h3_style",           "italic")
    p_indent      = _gv(opts, "paragraph_indent",   "1.5em")
    text_align    = _gv(opts, "text_align",         "justify")

    h3_style_css = {
        "italic": "font-style: italic;",
        "bold":   "font-weight: bold;",
        "normal": "",
    }.get(h3_style, "font-style: italic;")

    # Metadata comment block
    meta_fields = []
    for label, key in [
        ("Author",    "author"),
        ("Subtitle",  "subtitle"),
        ("Language",  "language"),
        ("Publisher", "publisher"),
        ("Date",      "published_date"),
        ("ISBN",      "isbn"),
        ("Rights",    "rights"),
    ]:
        if meta.get(key):
            meta_fields.append(f"   {label:<11}{meta[key]}")
    if meta.get("series"):
        s = meta["series"]
        if meta.get("series_index"):
            s += f" #{meta['series_index']}"
        meta_fields.append(f"   Series     {s}")
    meta_comment = ("\n" + "\n".join(meta_fields) + "\n") if meta_fields else ""

    return _EPUB_CSS_TEMPLATE.format(
        meta_comment       = meta_comment,
        google_font_import = google_font_import,
        font_family        = font_family,
        heading_family     = heading_family,
        font_size_css      = _FONT_SIZE_CSS.get(opts.font_size, "1em"),
        line_height        = _LINE_HEIGHT_CSS.get(opts.line_spacing, "1.7"),
        text_color         = opts.text_color,
        bg_color           = opts.bg_color,
        page_margin        = opts.page_margin,
        text_align         = text_align,
        heading_align      = heading_align,
        h1_size            = h1_size,
        h2_size            = h2_size,
        h3_size            = h3_size,
        h3_style_css       = h3_style_css,
        paragraph_indent   = p_indent if p_indent != "0" else "0",
    )
