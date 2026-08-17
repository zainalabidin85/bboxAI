import os
import shutil
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from config import PROJECTS_DIR
from database import get_db
from models import BboxClass, Project, User

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _project_dir(project_id: str) -> str:
    return os.path.join(PROJECTS_DIR, project_id)


def _load_project(project_id: str, db: Session) -> dict:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    return _to_dict(project)


def _to_dict(project: Project) -> dict:
    return {
        "id": project.id,
        "name": project.name,
        "owner_id": project.owner_id,
        "is_public": project.is_public,
        "created_at": project.created_at.isoformat(),
        "classes": [
            {"id": c.class_index, "name": c.name}
            for c in sorted(project.classes, key=lambda c: c.class_index)
        ],
        "image_count": _image_count(project.id),
    }


def _image_count(project_id: str) -> int:
    img_dir = os.path.join(_project_dir(project_id), "images")
    if not os.path.isdir(img_dir):
        return 0
    return sum(1 for f in os.listdir(img_dir) if os.path.isfile(os.path.join(img_dir, f)))


def _require_owner(project: Project, user: User):
    if project.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Not your project.")


# ── Schemas ───────────────────────────────────────────────────────────────────

class CreateProjectBody(BaseModel):
    name: str
    classes: list[str]


class AddClassesBody(BaseModel):
    classes: list[str]


class VisibilityBody(BaseModel):
    is_public: bool


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
def list_projects(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    projects = db.query(Project).filter(Project.owner_id == current_user.id).all()
    return [_to_dict(p) for p in projects]


@router.post("", status_code=201)
def create_project(
    body: CreateProjectBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Project name cannot be empty.")
    clean_classes = [n.strip() for n in body.classes if n.strip()]
    if not clean_classes:
        raise HTTPException(status_code=422, detail="At least one class is required.")

    project_id = uuid.uuid4().hex[:12]
    project = Project(id=project_id, name=body.name.strip(), owner_id=current_user.id)
    db.add(project)
    db.flush()

    for i, name in enumerate(clean_classes):
        db.add(BboxClass(project_id=project_id, name=name, class_index=i))

    proj_dir = _project_dir(project_id)
    for sub in ("images", "labels", "dataset", "runs", "pending"):
        os.makedirs(os.path.join(proj_dir, sub), exist_ok=True)

    db.commit()
    db.refresh(project)
    return _to_dict(project)


@router.get("/{project_id}")
def get_project(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    if project.owner_id != current_user.id and not project.is_public:
        raise HTTPException(status_code=403, detail="Not your project.")
    return _to_dict(project)


@router.delete("/{project_id}", status_code=204)
def delete_project(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    _require_owner(project, current_user)

    proj_dir = _project_dir(project_id)
    if os.path.isdir(proj_dir):
        shutil.rmtree(proj_dir)

    db.delete(project)
    db.commit()


@router.patch("/{project_id}/classes")
def add_classes(
    project_id: str,
    body: AddClassesBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    _require_owner(project, current_user)

    next_index = max((c.class_index for c in project.classes), default=-1) + 1
    added = []
    for name in body.classes:
        name = name.strip()
        if not name:
            continue
        new_class = BboxClass(project_id=project_id, name=name, class_index=next_index)
        db.add(new_class)
        added.append({"id": next_index, "name": name})
        next_index += 1

    if not added:
        raise HTTPException(status_code=422, detail="No valid class names provided.")

    db.commit()
    db.refresh(project)
    return {
        "added": added,
        "classes": [{"id": c.class_index, "name": c.name} for c in project.classes],
    }


@router.patch("/{project_id}/visibility")
def update_visibility(
    project_id: str,
    body: VisibilityBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    _require_owner(project, current_user)
    project.is_public = body.is_public
    db.commit()
    return {"id": project_id, "is_public": project.is_public}
