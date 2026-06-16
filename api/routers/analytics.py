"""
Analytics endpoint — pacing & prose statistics for a project.
All computation is done in pure Python on the stored HTML content;
no extra dependencies beyond the stdlib.
"""
import re
from collections import Counter, defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import Session, selectinload

from database import get_db
from models import Project, Act, Chapter, Scene, CodexEntry, WritingLog
from schemas import ProjectAnalytics, SceneAnalytics, ChapterAnalytics

router = APIRouter(prefix="/api", tags=["analytics"])


# ── Text utilities ────────────────────────────────────────────────────────────

def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "")


def _count_syllables(word: str) -> int:
    """Simple vowel-cluster syllable approximation."""
    word = re.sub(r"[^a-zA-Z]", "", word).lower()
    if not word:
        return 0
    count = len(re.findall(r"[aeiouy]+", word))
    # Silence trailing 'e' (e.g. "cake" = 1 not 2)
    if word.endswith("e") and count > 1:
        count -= 1
    return max(1, count)


def _sentence_stats(plain: str) -> tuple[float, float]:
    """Return (avg_sentence_length_words, dialogue_ratio)."""
    lines = [ln.strip() for ln in plain.split("\n") if ln.strip()]
    dialogue_lines = sum(
        1 for ln in lines
        if ln.startswith('"') or ln.startswith("“") or ln.startswith("«")
    )
    dialogue_ratio = dialogue_lines / len(lines) if lines else 0.0

    sentences = [s.strip() for s in re.split(r"[.!?]+", plain) if s.strip()]
    if not sentences:
        return 0.0, dialogue_ratio
    word_counts = [len(s.split()) for s in sentences if s.split()]
    avg_sl = sum(word_counts) / len(word_counts) if word_counts else 0.0
    return round(avg_sl, 2), round(dialogue_ratio, 3)


def _flesch(plain: str) -> tuple[float, float]:
    """Return (Flesch Reading Ease score, Flesch-Kincaid Grade Level)."""
    words = plain.split()
    if not words:
        return 0.0, 0.0
    sentences = [s.strip() for s in re.split(r"[.!?]+", plain) if s.strip()]
    if not sentences:
        return 0.0, 0.0

    n_words = len(words)
    n_sents = len(sentences)
    n_sylls = sum(_count_syllables(w) for w in words)

    asl = n_words / n_sents        # avg sentence length
    asw = n_sylls / n_words        # avg syllables per word

    ease  = max(0.0, min(100.0, round(206.835 - 1.015 * asl - 84.6 * asw, 1)))
    grade = max(0.0, round(0.39 * asl + 11.8 * asw - 15.59, 1))
    return ease, grade


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/analytics", response_model=ProjectAnalytics)
def get_analytics(project_id: int, db: Session = Depends(get_db)):
    project = (
        db.query(Project)
        .options(selectinload(Project.acts).selectinload(Act.chapters).selectinload(Chapter.scenes))
        .filter(Project.id == project_id)
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    scene_rows: list[SceneAnalytics] = []
    chapter_rows: list[ChapterAnalytics] = []
    total_words = 0
    global_type_dist: Counter = Counter()

    for act in sorted(project.acts, key=lambda a: a.order_index):
        for chapter in sorted(act.chapters, key=lambda c: c.order_index):
            ch_words = 0
            ch_type_dist: Counter = Counter()
            ch_plain_parts: list[str] = []

            for scene in sorted(chapter.scenes, key=lambda s: s.order_index):
                plain = _strip_html(scene.content or "")
                avg_sl, dial_ratio = _sentence_stats(plain)
                ch_plain_parts.append(plain)
                ch_words += scene.word_count or 0

                if scene.scene_type:
                    ch_type_dist[scene.scene_type] += 1
                    global_type_dist[scene.scene_type] += 1

                scene_rows.append(SceneAnalytics(
                    scene_id=scene.id,
                    scene_title=scene.title,
                    chapter_id=chapter.id,
                    chapter_title=chapter.title,
                    act_id=act.id,
                    act_title=act.title,
                    order_index=scene.order_index,
                    word_count=scene.word_count or 0,
                    scene_type=scene.scene_type,
                    avg_sentence_length=avg_sl,
                    dialogue_ratio=dial_ratio,
                ))

            # Chapter-level Flesch: concatenate all scene text
            ch_full_plain = " ".join(ch_plain_parts)
            flesch, grade = _flesch(ch_full_plain)
            total_words += ch_words

            chapter_rows.append(ChapterAnalytics(
                chapter_id=chapter.id,
                chapter_title=chapter.title,
                act_id=act.id,
                act_title=act.title,
                word_count=ch_words,
                scene_count=len(chapter.scenes),
                flesch_score=flesch,
                grade_level=grade,
                scene_type_dist=dict(ch_type_dist),
            ))

    return ProjectAnalytics(
        scenes=scene_rows,
        chapters=chapter_rows,
        total_word_count=total_words,
        scene_type_dist=dict(global_type_dist),
    )


@router.get("/stats/totals")
def get_stats_totals(db: Session = Depends(get_db)):
    def _wc(content: str) -> int:
        return len(re.sub(r"<[^>]+>", "", content or "").split())

    # ── Total words ──────────────────────────────────────────────────────────────
    try:
        total_wc = db.execute(text(
            "SELECT COALESCE(SUM(word_count), 0) FROM scenes"
        )).scalar() or 0
        if total_wc == 0:
            rows = db.execute(text(
                "SELECT content FROM scenes WHERE content IS NOT NULL AND content != ''"
            )).fetchall()
            total_wc = sum(_wc(r[0]) for r in rows)
    except Exception as exc:
        print(f"[stats/totals] total_wc: {exc}")
        total_wc = 0

    # ── Per-project word counts ──────────────────────────────────────────────────
    try:
        proj_rows = db.execute(text("""
            SELECT p.id, p.title, COALESCE(SUM(s.word_count), 0) AS wc
            FROM projects p
            JOIN acts     a ON a.project_id  = p.id
            JOIN chapters c ON c.act_id      = a.id
            JOIN scenes   s ON s.chapter_id  = c.id
            GROUP BY p.id, p.title
        """)).fetchall()
        project_words = [{"id": r[0], "title": r[1], "words": r[2] or 0} for r in proj_rows]

        if project_words and all(p["words"] == 0 for p in project_words):
            content_rows = db.execute(text("""
                SELECT p.id, p.title, s.content
                FROM projects p
                JOIN acts     a ON a.project_id  = p.id
                JOIN chapters c ON c.act_id      = a.id
                JOIN scenes   s ON s.chapter_id  = c.id
                WHERE s.content IS NOT NULL AND s.content != ''
            """)).fetchall()
            proj_map: dict[int, dict] = {}
            for pid, ptitle, content in content_rows:
                if pid not in proj_map:
                    proj_map[pid] = {"id": pid, "title": ptitle, "words": 0}
                proj_map[pid]["words"] += _wc(content)
            project_words = list(proj_map.values())
    except Exception as exc:
        print(f"[stats/totals] project_words: {exc}")
        project_words = []

    # ── POV character word counts ────────────────────────────────────────────────
    try:
        pov_rows = db.execute(text("""
            SELECT ce.name, COALESCE(SUM(s.word_count), 0) AS wc
            FROM codex_entries ce
            JOIN scenes s ON s.pov_character_id = ce.id
            GROUP BY ce.id, ce.name
            ORDER BY wc DESC
            LIMIT 8
        """)).fetchall()
        pov_words = [{"name": r[0], "words": r[1] or 0} for r in pov_rows if (r[1] or 0) > 0]
    except Exception as exc:
        print(f"[stats/totals] pov_words: {exc}")
        pov_words = []

    # ── Day-of-week productivity (from writing_log) ──────────────────────────────
    try:
        from datetime import date as _date
        DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        # Fetch (date, words) and compute DOW in Python — avoids strftime('%w')
        # which is SQLite-specific (PostgreSQL uses EXTRACT/TO_CHAR).
        log_rows = db.execute(text(
            "SELECT date, SUM(words_added) AS total FROM writing_log GROUP BY date"
        )).fetchall()
        dow_map: dict[int, int] = {}
        for date_str, total in log_rows:
            # Python weekday(): Mon=0…Sun=6 → convert to Sun=0, Mon=1…Sat=6
            dow = (_date.fromisoformat(str(date_str)).weekday() + 1) % 7
            dow_map[dow] = dow_map.get(dow, 0) + int(total or 0)
        day_of_week = [{"day": DOW[i], "words": dow_map.get(i, 0)} for i in range(7)]
    except Exception as exc:
        print(f"[stats/totals] day_of_week: {exc}")
        day_of_week = [{"day": d, "words": 0} for d in ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]]

    # ── Scene length distribution (histogram buckets) ────────────────────────────
    try:
        bucket_rows = db.execute(text("""
            SELECT
                CASE
                    WHEN word_count < 100  THEN '< 100'
                    WHEN word_count < 300  THEN '100-299'
                    WHEN word_count < 600  THEN '300-599'
                    WHEN word_count < 1000 THEN '600-999'
                    WHEN word_count < 2000 THEN '1k-1.9k'
                    ELSE '2k+'
                END AS bucket,
                COUNT(*) AS cnt
            FROM scenes WHERE word_count > 0
            GROUP BY 1 ORDER BY MIN(word_count)
        """)).fetchall()
        scene_length_buckets = [{"range": r[0], "count": r[1]} for r in bucket_rows]
    except Exception as exc:
        print(f"[stats/totals] scene_length: {exc}")
        scene_length_buckets = []

    return {
        "total_words":          total_wc,
        "project_words":        project_words,
        "pov_words":            pov_words,
        "day_of_week":          day_of_week,
        "scene_length_buckets": scene_length_buckets,
    }


@router.post("/stats/ping")
def ping_stats_view(db: Session = Depends(get_db)):
    """Increment the stats-page view counter (used for achievement tracking)."""
    try:
        db.execute(text("UPDATE user_settings SET stats_views = COALESCE(stats_views, 0) + 1"))
        db.commit()
    except Exception:
        pass
    return {"ok": True}
