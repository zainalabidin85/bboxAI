import os
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (
    HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

from config import PROJECTS_DIR

_W, _H = A4
_INDIGO = colors.HexColor("#3949AB")
_LIGHT  = colors.HexColor("#E8EAF6")
_GREY   = colors.HexColor("#757575")
_GREEN  = colors.HexColor("#388E3C")
_RED    = colors.HexColor("#D32F2F")


def _report_path(project_id: str) -> str:
    return os.path.join(PROJECTS_DIR, project_id, "report.pdf")


def generate(project: dict, stats: dict, training_status: dict) -> str:
    """Generate a PDF training report. Returns the file path."""
    path = _report_path(project["id"])
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "Title", parent=styles["Normal"],
        fontSize=22, textColor=_INDIGO, spaceAfter=4, fontName="Helvetica-Bold",
    )
    subtitle_style = ParagraphStyle(
        "Subtitle", parent=styles["Normal"],
        fontSize=11, textColor=_GREY, spaceAfter=16,
    )
    section_style = ParagraphStyle(
        "Section", parent=styles["Normal"],
        fontSize=13, textColor=_INDIGO, spaceBefore=18, spaceAfter=8,
        fontName="Helvetica-Bold",
    )
    body_style = ParagraphStyle(
        "Body", parent=styles["Normal"],
        fontSize=10, textColor=colors.black, spaceAfter=4,
    )

    doc = SimpleDocTemplate(
        path,
        pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=2*cm, bottomMargin=2*cm,
    )

    story = []
    usable_w = _W - 4*cm

    # ── Header ────────────────────────────────────────────────────────────────
    story.append(Paragraph("bboxAI", title_style))
    story.append(Paragraph("Training Report", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=2, color=_INDIGO))
    story.append(Spacer(1, 12))

    # ── Project info ──────────────────────────────────────────────────────────
    story.append(Paragraph("Project", section_style))

    finished_at = training_status.get("finished_at") or ""
    try:
        finished_dt = datetime.fromisoformat(finished_at).strftime("%Y-%m-%d %H:%M UTC")
    except Exception:
        finished_dt = finished_at or "—"

    started_at = training_status.get("started_at") or ""
    try:
        started_dt  = datetime.fromisoformat(started_at).strftime("%Y-%m-%d %H:%M UTC")
        finished_ts = datetime.fromisoformat(finished_at) if finished_at else None
        started_ts  = datetime.fromisoformat(started_at)
        duration    = str(finished_ts - started_ts).split(".")[0] if finished_ts else "—"
    except Exception:
        started_dt = started_at or "—"
        duration   = "—"

    proj_data = [
        ["Project name", project["name"]],
        ["Project ID",   project["id"]],
        ["Classes",      ", ".join(c["name"] for c in project["classes"])],
        ["Started",      started_dt],
        ["Finished",     finished_dt],
        ["Duration",     duration],
        ["Base model",   training_status.get("base_model") or "—"],
        ["Epochs",       str(training_status.get("total_epochs") or "—")],
        ["Image size",   str(training_status.get("imgsz") or "640")],
    ]
    proj_table = Table(proj_data, colWidths=[4*cm, usable_w - 4*cm])
    proj_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), _LIGHT),
        ("FONTNAME",   (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE",   (0, 0), (-1, -1), 10),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#F5F5F5")]),
        ("GRID",       (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
        ("PADDING",    (0, 0), (-1, -1), 6),
    ]))
    story.append(proj_table)

    # ── Dataset stats ─────────────────────────────────────────────────────────
    story.append(Paragraph("Dataset Statistics", section_style))

    total      = stats.get("total", 0)
    labeled    = stats.get("labeled", 0)
    total_boxes = stats.get("total_boxes", 0)
    per_class  = stats.get("per_class", [])

    summary_data = [
        ["Total images", "Labeled images", "Total boxes"],
        [str(total), str(labeled), str(total_boxes)],
    ]
    col_w = usable_w / 3
    summary_table = Table(summary_data, colWidths=[col_w]*3)
    summary_table.setStyle(TableStyle([
        ("BACKGROUND",  (0, 0), (-1, 0), _INDIGO),
        ("TEXTCOLOR",   (0, 0), (-1, 0), colors.white),
        ("FONTNAME",    (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME",    (0, 1), (-1, 1), "Helvetica-Bold"),
        ("FONTSIZE",    (0, 0), (-1, -1), 11),
        ("ALIGN",       (0, 0), (-1, -1), "CENTER"),
        ("VALIGN",      (0, 0), (-1, -1), "MIDDLE"),
        ("ROWHEIGHTS",  (0, 0), (-1, -1), 28),
        ("GRID",        (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 10))

    # Per-class table
    if per_class:
        story.append(Paragraph("Boxes per class", body_style))
        class_data = [["Class ID", "Class Name", "Box Count", "% of Total"]]
        for c in per_class:
            pct = f"{c['count'] / total_boxes * 100:.1f}%" if total_boxes else "0%"
            class_data.append([str(c["id"]), c["name"], str(c["count"]), pct])

        class_table = Table(class_data, colWidths=[2*cm, usable_w - 7*cm, 2.5*cm, 2.5*cm])
        class_table.setStyle(TableStyle([
            ("BACKGROUND",     (0, 0), (-1, 0), _LIGHT),
            ("FONTNAME",       (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE",       (0, 0), (-1, -1), 10),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F5F5")]),
            ("GRID",           (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
            ("ALIGN",          (0, 0), (0, -1), "CENTER"),
            ("ALIGN",          (2, 0), (-1, -1), "CENTER"),
            ("PADDING",        (0, 0), (-1, -1), 6),
        ]))
        story.append(class_table)

    # ── Model performance ─────────────────────────────────────────────────────
    story.append(Paragraph("Model Performance", section_style))

    def _pct(key: str) -> str:
        v = training_status.get(key)
        return f"{float(v) * 100:.1f}%" if v is not None else "—"

    state = training_status.get("state", "idle")
    if state == "done":
        metrics_data = [
            ["Metric", "Value"],
            ["mAP@50",          _pct("map50")],
            ["mAP@50-95",       _pct("map50_95")],
            ["Precision",       _pct("precision")],
            ["Recall",          _pct("recall")],
        ]
        metrics_table = Table(metrics_data, colWidths=[usable_w * 0.6, usable_w * 0.4])
        metrics_table.setStyle(TableStyle([
            ("BACKGROUND",     (0, 0), (-1, 0), _INDIGO),
            ("TEXTCOLOR",      (0, 0), (-1, 0), colors.white),
            ("FONTNAME",       (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE",       (0, 0), (-1, -1), 11),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F5F5")]),
            ("GRID",           (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
            ("ALIGN",          (1, 0), (1, -1), "CENTER"),
            ("FONTNAME",       (1, 1), (1, -1), "Helvetica-Bold"),
            ("PADDING",        (0, 0), (-1, -1), 7),
        ]))
        story.append(metrics_table)
    elif state == "failed":
        story.append(Paragraph(
            f"Training failed: {training_status.get('error', 'Unknown error')}",
            ParagraphStyle("err", parent=body_style, textColor=_RED),
        ))
    else:
        story.append(Paragraph("Training not yet completed.", body_style))

    # ── Footer ────────────────────────────────────────────────────────────────
    story.append(Spacer(1, 24))
    story.append(HRFlowable(width="100%", thickness=0.5, color=_GREY))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        f"Generated by bboxAI on {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}",
        ParagraphStyle("footer", parent=body_style, textColor=_GREY, fontSize=9),
    ))

    doc.build(story)
    return path


def report_exists(project_id: str) -> bool:
    return os.path.exists(_report_path(project_id))


def get_report_path(project_id: str) -> str:
    return _report_path(project_id)
