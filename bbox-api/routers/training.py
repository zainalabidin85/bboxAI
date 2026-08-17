import json
import os
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from config import PROJECTS_DIR
from database import get_db
from models import User
from routers.projects import _load_project, _require_owner
from models import Project
from services import annotations as ann_svc
from services import report as rpt
from services import trainer

router = APIRouter()


# ── Helpers (kept for other modules importing these names) ────────────────────

def _proj_images_dir(project_id: str) -> str:
    return ann_svc.images_dir(project_id)


def _proj_labels_dir(project_id: str) -> str:
    return ann_svc.labels_dir(project_id)


# ── Upload ────────────────────────────────────────────────────────────────────

@router.post("/{project_id}/upload")
async def upload_image(
    project_id: str,
    file: UploadFile = File(...),
    annotations: str = Form(...),
    tagger: str = Form("anonymous"),
    notes: str = Form(""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = _load_project(project_id, db)
    _require_owner(db.query(Project).filter(Project.id == project_id).first(), current_user)
    max_class_id = len(project["classes"]) - 1

    content_type = file.content_type or ""
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=422, detail="File must be an image.")

    try:
        parsed = json.loads(annotations)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="Invalid annotations JSON.")

    try:
        ann_svc.validate_annotations(parsed, max_class_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    data = await file.read()
    if len(data) == 0:
        raise HTTPException(status_code=422, detail="Empty file received.")

    ext = os.path.splitext(file.filename or "img.jpg")[1] or ".jpg"
    image_id = uuid.uuid4().hex
    tmp_path = os.path.join(ann_svc.images_dir(project_id), f"{image_id}.tmp")

    with open(tmp_path, "wb") as f:
        f.write(data)

    result = ann_svc.commit_annotated_image(
        project_id, image_id, ext, tmp_path, parsed, tagger, notes
    )
    result["message"] = "Uploaded successfully."
    return result


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/{project_id}/stats")
def get_stats(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = _load_project(project_id, db)
    images_dir = _proj_images_dir(project_id)
    labels_dir = _proj_labels_dir(project_id)

    total = sum(
        1 for f in os.listdir(images_dir)
        if os.path.isfile(os.path.join(images_dir, f))
    ) if os.path.isdir(images_dir) else 0

    labeled = 0
    total_boxes = 0
    per_class: dict[int, int] = {c["id"]: 0 for c in project["classes"]}

    if os.path.isdir(labels_dir):
        for lf in os.listdir(labels_dir):
            lf_path = os.path.join(labels_dir, lf)
            if not os.path.isfile(lf_path):
                continue
            with open(lf_path) as f:
                lines = [l.strip() for l in f if l.strip()]
            if lines:
                labeled += 1
                total_boxes += len(lines)
                for line in lines:
                    parts = line.split()
                    if parts:
                        cid = int(parts[0])
                        per_class[cid] = per_class.get(cid, 0) + 1

    return {
        "total": total,
        "labeled": labeled,
        "total_boxes": total_boxes,
        "per_class": [
            {"id": c["id"], "name": c["name"], "count": per_class.get(c["id"], 0)}
            for c in project["classes"]
        ],
    }


# ── Train ─────────────────────────────────────────────────────────────────────

class TrainRequest(BaseModel):
    base_model: str
    epochs: int = 100
    imgsz: int = 640


@router.post("/{project_id}/train")
def trigger_training(
    project_id: str,
    body: TrainRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project_row = db.query(Project).filter(Project.id == project_id).first()
    if not project_row:
        raise HTTPException(status_code=404, detail="Project not found.")
    _require_owner(project_row, current_user)
    result = trainer.start_training(project_id, body.base_model, body.epochs, body.imgsz)
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["reason"])
    return {"message": result["reason"]}


@router.get("/{project_id}/train/status")
def training_status(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _load_project(project_id, db)
    return trainer.get_status(project_id)


@router.get("/{project_id}/train/metrics")
def training_metrics(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _load_project(project_id, db)
    csv_path = os.path.join(PROJECTS_DIR, project_id, "runs", "train", "results.csv")
    if not os.path.exists(csv_path):
        return []

    import csv as csv_mod

    def _num(row: dict, key: str):
        val = row.get(key)
        try:
            return float(val)
        except (TypeError, ValueError):
            return None

    rows = []
    with open(csv_path, newline="") as f:
        for row in csv_mod.DictReader(f):
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


@router.get("/{project_id}/report")
def download_report(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = _load_project(project_id, db)
    if not rpt.report_exists(project_id):
        raise HTTPException(status_code=404, detail="Report not yet generated. Complete training first.")
    filename = f"bboxai_{project['name'].replace(' ', '_')}_report.pdf"
    return FileResponse(rpt.get_report_path(project_id), media_type="application/pdf", filename=filename)


@router.get("/{project_id}/weights/download")
def download_model(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = _load_project(project_id, db)
    model_path = os.path.join(PROJECTS_DIR, project_id, "weights", "best.pt")
    if not os.path.exists(model_path):
        raise HTTPException(status_code=404, detail="Model not available. Complete training first.")
    filename = f"bboxai_{project['name'].replace(' ', '_')}_best.pt"
    return FileResponse(model_path, media_type="application/octet-stream", filename=filename)
