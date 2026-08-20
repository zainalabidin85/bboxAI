import csv
import os
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (
    HRFlowable, Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)
from reportlab.lib.utils import ImageReader

from config import PROJECTS_DIR

_W, _H = A4
_INDIGO = colors.HexColor("#3949AB")
_LIGHT  = colors.HexColor("#E8EAF6")
_GREY   = colors.HexColor("#757575")
_GREEN  = colors.HexColor("#388E3C")
_RED    = colors.HexColor("#D32F2F")

# "free" gets pages 1, 3, 4 (watermarked); "paid" gets all 4, no watermark —
# page 2 (per-epoch table, per-class breakdown, hyperparameters) only exists
# in the paid tier at all, it isn't just hidden. See routers/training.py's
# download_report and bbox-relay's report-unlock flow (private repo) for how
# a bboxai-remote user actually gets to the paid tier — self-hosted/desktop
# bbox-api always calls generate() with the default "paid" tier and has no
# concept of the paywall, per the project's payment-unaware-bbox-api rule.
_TIERS = ("free", "paid")


def _report_path(project_id: str, tier: str = "paid") -> str:
    filename = "report.pdf" if tier == "paid" else "report_free.pdf"
    return os.path.join(PROJECTS_DIR, project_id, filename)


def _run_dir(project_id: str) -> str:
    return os.path.join(PROJECTS_DIR, project_id, "runs", "train")


def _count_dir_images(path: str) -> int:
    if not os.path.isdir(path):
        return 0
    return sum(1 for f in os.listdir(path) if os.path.isfile(os.path.join(path, f)))


def _fit_image(path: str, max_w: float, max_h: float) -> Image | None:
    """Load an image scaled to fit within (max_w, max_h), preserving aspect ratio."""
    if not os.path.exists(path):
        return None
    try:
        iw, ih = ImageReader(path).getSize()
    except Exception:
        return None
    scale = min(max_w / iw, max_h / ih)
    return Image(path, width=iw * scale, height=ih * scale)


def _watermark(tier: str):
    """Returns a SimpleDocTemplate onPage callback that stamps a diagonal
    watermark on every page — used for the free tier only. None (no
    callback) for paid, which never needs to say "this isn't the real
    version" on itself."""
    if tier != "free":
        return None

    def _draw(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica-Bold", 46)
        canvas.setFillColor(colors.Color(0.6, 0.6, 0.6, alpha=0.28))
        canvas.translate(_W / 2, _H / 2)
        canvas.rotate(38)
        canvas.drawCentredString(0, 0, "bboxAI — FREE REPORT")
        canvas.restoreState()

    return _draw


def _epoch_rows(run_dir: str) -> list[dict]:
    csv_path = os.path.join(run_dir, "results.csv")
    if not os.path.exists(csv_path):
        return []

    def _num(row: dict, key: str):
        try:
            return float(row.get(key))
        except (TypeError, ValueError):
            return None

    rows = []
    with open(csv_path, newline="") as f:
        for row in csv.DictReader(f):
            row = {k.strip(): v for k, v in row.items()}
            rows.append({
                "epoch": int(_num(row, "epoch") or 0),
                "box_loss": _num(row, "train/box_loss"),
                "cls_loss": _num(row, "train/cls_loss"),
                "dfl_loss": _num(row, "train/dfl_loss"),
                "precision": _num(row, "metrics/precision(B)"),
                "recall": _num(row, "metrics/recall(B)"),
                "map50": _num(row, "metrics/mAP50(B)"),
                "map50_95": _num(row, "metrics/mAP50-95(B)"),
            })
    return rows


def _per_class_metrics(project_id: str, classes: list[dict]) -> list[dict] | None:
    """Re-runs validation against the run's own best.pt + val split to get a
    per-class precision/recall/AP50 breakdown — not something Ultralytics'
    training callback saves anywhere on its own (only dataset-wide aggregate
    metrics land in results.csv/training_status.json). A fresh, small
    inference pass over the val set, not a retrain — seconds, not minutes,
    for a typical project. Returns None (never crashes report generation) if
    the run's artifacts aren't where expected or the pass fails for any
    reason."""
    try:
        from ultralytics import YOLO

        run_dir = _run_dir(project_id)
        best_pt = os.path.join(run_dir, "weights", "best.pt")
        yaml_path = os.path.join(PROJECTS_DIR, project_id, "dataset", "data.yaml")
        if not os.path.exists(best_pt) or not os.path.exists(yaml_path):
            return None

        model = YOLO(best_pt)
        val = model.val(data=yaml_path, verbose=False, plots=False)
        box = val.box

        class_names = {c["id"]: c["name"] for c in classes}
        rows = []
        for i, cid in enumerate(box.ap_class_index):
            cid = int(cid)
            rows.append({
                "id": cid,
                "name": class_names.get(cid, f"class {cid}"),
                "precision": float(box.p[i]) if i < len(box.p) else None,
                "recall": float(box.r[i]) if i < len(box.r) else None,
                "ap50": float(box.ap50[i]) if i < len(box.ap50) else None,
            })
        return rows
    except Exception:
        return None


def generate(project: dict, stats: dict, training_status: dict, tier: str = "paid") -> str:
    """Generate a PDF training report. Returns the file path. tier="free"
    produces pages 1/3/4 only, watermarked; tier="paid" produces all 4,
    unwatermarked, with page 2's per-epoch/per-class/hyperparameter detail."""
    if tier not in _TIERS:
        raise ValueError(f"Unknown report tier {tier!r}")

    path = _report_path(project["id"], tier)
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "Title", parent=styles["Normal"],
        fontSize=22, leading=26, textColor=_INDIGO, spaceAfter=4, fontName="Helvetica-Bold",
    )
    subtitle_style = ParagraphStyle(
        "Subtitle", parent=styles["Normal"],
        fontSize=11, leading=14, textColor=_GREY, spaceAfter=16,
    )
    section_style = ParagraphStyle(
        "Section", parent=styles["Normal"],
        fontSize=13, leading=16, textColor=_INDIGO, spaceBefore=18, spaceAfter=8,
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

    # ── Page 1: Header + Project info + Dataset Statistics ──────────────────────
    story.append(Paragraph("bboxAI", title_style))
    story.append(Paragraph("Training Report" if tier == "paid" else "Training Report (Free)", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=2, color=_INDIGO))
    story.append(Spacer(1, 12))

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

    story.append(Paragraph("Dataset Statistics", section_style))

    total       = stats.get("total", 0)
    labeled     = stats.get("labeled", 0)
    total_boxes = stats.get("total_boxes", 0)
    per_class   = stats.get("per_class", [])

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

    train_n = _count_dir_images(os.path.join(PROJECTS_DIR, project["id"], "dataset", "train", "images"))
    val_n   = _count_dir_images(os.path.join(PROJECTS_DIR, project["id"], "dataset", "val", "images"))
    if train_n or val_n:
        story.append(Paragraph("Train / validation split", body_style))
        split_data = [["Training images", "Validation images"], [str(train_n), str(val_n)]]
        split_table = Table(split_data, colWidths=[usable_w/2]*2)
        split_table.setStyle(TableStyle([
            ("BACKGROUND",     (0, 0), (-1, 0), _LIGHT),
            ("FONTNAME",       (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME",       (0, 1), (-1, 1), "Helvetica-Bold"),
            ("FONTSIZE",       (0, 0), (-1, -1), 10),
            ("ALIGN",          (0, 0), (-1, -1), "CENTER"),
            ("GRID",           (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
            ("PADDING",        (0, 0), (-1, -1), 6),
        ]))
        story.append(split_table)
        story.append(Spacer(1, 10))

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

    state = training_status.get("state", "idle")

    if state == "done":
        run_dir = _run_dir(project["id"])

        # ── Page 2 (paid only): per-epoch table, per-class breakdown, config ────
        if tier == "paid":
            story.append(PageBreak())
            story.append(Paragraph("Detailed Results", section_style))
            story.append(Paragraph(
                "Reproducibility details and per-class/per-epoch breakdowns not "
                "included in the free report.",
                body_style,
            ))

            story.append(Paragraph("Training configuration", section_style))
            config_data = [
                ["Base model", training_status.get("base_model") or "—"],
                ["Epochs",     str(training_status.get("total_epochs") or "—")],
                ["Image size", str(training_status.get("imgsz") or "640")],
                ["Batch size", "8"],
                ["Train/val split", "80% / 20%, random"],
            ]
            config_table = Table(config_data, colWidths=[5*cm, usable_w - 5*cm])
            config_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (0, -1), _LIGHT),
                ("FONTNAME",   (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTSIZE",   (0, 0), (-1, -1), 10),
                ("GRID",       (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
                ("PADDING",    (0, 0), (-1, -1), 6),
            ]))
            story.append(config_table)
            story.append(Spacer(1, 10))

            per_class_metrics = _per_class_metrics(project["id"], project["classes"])
            if per_class_metrics:
                story.append(Paragraph("Per-class performance", section_style))
                pc_data = [["Class", "Precision", "Recall", "AP@50"]]
                for row in per_class_metrics:
                    pc_data.append([
                        row["name"],
                        f"{row['precision']*100:.1f}%" if row["precision"] is not None else "—",
                        f"{row['recall']*100:.1f}%" if row["recall"] is not None else "—",
                        f"{row['ap50']*100:.1f}%" if row["ap50"] is not None else "—",
                    ])
                pc_table = Table(pc_data, colWidths=[usable_w*0.4, usable_w*0.2, usable_w*0.2, usable_w*0.2])
                pc_table.setStyle(TableStyle([
                    ("BACKGROUND",     (0, 0), (-1, 0), _INDIGO),
                    ("TEXTCOLOR",      (0, 0), (-1, 0), colors.white),
                    ("FONTNAME",       (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE",       (0, 0), (-1, -1), 10),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F5F5")]),
                    ("GRID",           (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
                    ("ALIGN",          (1, 0), (-1, -1), "CENTER"),
                    ("PADDING",        (0, 0), (-1, -1), 6),
                ]))
                story.append(pc_table)
                story.append(Spacer(1, 10))

            epoch_rows = _epoch_rows(run_dir)
            if epoch_rows:
                story.append(Paragraph("Per-epoch metrics", section_style))
                epoch_data = [["Epoch", "Box loss", "Cls loss", "DFL loss", "Precision", "Recall", "mAP50", "mAP50-95"]]

                def _f(v):
                    return f"{v:.3f}" if v is not None else "—"

                for r in epoch_rows:
                    epoch_data.append([
                        str(r["epoch"]), _f(r["box_loss"]), _f(r["cls_loss"]), _f(r["dfl_loss"]),
                        _f(r["precision"]), _f(r["recall"]), _f(r["map50"]), _f(r["map50_95"]),
                    ])
                epoch_table = Table(epoch_data, colWidths=[usable_w/8]*8, repeatRows=1)
                epoch_table.setStyle(TableStyle([
                    ("BACKGROUND",     (0, 0), (-1, 0), _INDIGO),
                    ("TEXTCOLOR",      (0, 0), (-1, 0), colors.white),
                    ("FONTNAME",       (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE",       (0, 0), (-1, -1), 8),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F5F5")]),
                    ("GRID",           (0, 0), (-1, -1), 0.4, colors.HexColor("#DDDDDD")),
                    ("ALIGN",          (0, 0), (-1, -1), "CENTER"),
                    ("PADDING",        (0, 0), (-1, -1), 4),
                ]))
                story.append(epoch_table)

        # ── Page 3: headline metrics + training curves + confusion matrix ───────
        story.append(PageBreak())
        story.append(Paragraph("Model Performance", section_style))

        def _pct(key: str) -> str:
            v = training_status.get(key)
            return f"{float(v) * 100:.1f}%" if v is not None else "—"

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

        results_img = _fit_image(os.path.join(run_dir, "results.png"), usable_w, 9*cm)
        if results_img:
            story.append(KeepTogether([Paragraph("Training Curves", section_style), results_img]))

        cm_img = _fit_image(os.path.join(run_dir, "confusion_matrix.png"), usable_w, 12*cm)
        if cm_img:
            story.append(KeepTogether([Paragraph("Confusion Matrix", section_style), cm_img]))

        # ── Page 4: validation samples (ground truth vs. predictions) ───────────
        labels_img = _fit_image(os.path.join(run_dir, "val_batch0_labels.jpg"), usable_w, 14*cm)
        pred_img   = _fit_image(os.path.join(run_dir, "val_batch0_pred.jpg"),   usable_w, 14*cm)
        if labels_img or pred_img:
            story.append(PageBreak())
            story.append(Paragraph("Validation Samples", section_style))
            if labels_img:
                story.append(KeepTogether([Paragraph("Ground truth", body_style), labels_img]))
            if pred_img:
                story.append(Spacer(1, 8))
                story.append(KeepTogether([Paragraph("Model predictions", body_style), pred_img]))

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

    watermark_cb = _watermark(tier)
    doc.build(story, onFirstPage=watermark_cb or (lambda c, d: None), onLaterPages=watermark_cb or (lambda c, d: None))
    return path


def report_exists(project_id: str, tier: str = "paid") -> bool:
    return os.path.exists(_report_path(project_id, tier))


def get_report_path(project_id: str, tier: str = "paid") -> str:
    return _report_path(project_id, tier)
