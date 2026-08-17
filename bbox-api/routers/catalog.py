from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from config import PROJECTS_DIR
from database import get_db
from models import BboxClass, Project, TrainedModel
import os

router = APIRouter()


def _model_entry(project: Project, model: TrainedModel) -> dict:
    return {
        "project_id":   project.id,
        "project_name": project.name,
        "owner":        project.owner.username,
        "classes":      [{"id": c.class_index, "name": c.name} for c in project.classes],
        "base_model":   model.base_model,
        "epochs":       model.epochs,
        "imgsz":        model.imgsz,
        "map50":        model.map50,
        "map50_95":     model.map50_95,
        "precision":    model.precision,
        "recall":       model.recall,
        "trained_at":   model.trained_at.isoformat(),
        "download_url": f"/projects/{project.id}/weights/download",
        "report_url":   f"/projects/{project.id}/report",
    }


@router.get("")
def catalog(db: Session = Depends(get_db)):
    """All public projects that have a completed trained model."""
    models = (
        db.query(TrainedModel)
        .join(Project)
        .filter(Project.is_public == True)
        .order_by(TrainedModel.trained_at.desc())
        .all()
    )
    return [_model_entry(m.project, m) for m in models]


@router.get("/search")
def search(
    classes: str = Query(..., description="Comma-separated class names to search for"),
    db: Session = Depends(get_db),
):
    """Find public trained models whose projects contain any of the given class names."""
    names = [n.strip().lower() for n in classes.split(",") if n.strip()]
    if not names:
        return []

    matched_project_ids = (
        db.query(BboxClass.project_id)
        .join(Project)
        .filter(
            Project.is_public == True,
            BboxClass.name.in_(names),
        )
        .distinct()
        .all()
    )
    pids = [row[0] for row in matched_project_ids]
    if not pids:
        return []

    models = (
        db.query(TrainedModel)
        .join(Project)
        .filter(
            Project.is_public == True,
            TrainedModel.project_id.in_(pids),
        )
        .order_by(TrainedModel.trained_at.desc())
        .all()
    )
    return [_model_entry(m.project, m) for m in models]
