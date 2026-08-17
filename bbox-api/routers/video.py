import json
import os
import shutil
import tempfile
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Project, User
from routers.projects import _load_project, _require_owner
from services import annotations as ann_svc
from services import video as video_svc

router = APIRouter()


def _owned_project(project_id: str, db: Session, current_user: User) -> dict:
    project = _load_project(project_id, db)
    _require_owner(db.query(Project).filter(Project.id == project_id).first(), current_user)
    return project


# ── Upload video → extract frames ──────────────────────────────────────────────

@router.post("/{project_id}/videos/upload")
async def upload_video(
    project_id: str,
    file: UploadFile = File(...),
    target_fps: float = Form(1.0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _owned_project(project_id, db, current_user)

    content_type = file.content_type or ""
    if not content_type.startswith("video/"):
        raise HTTPException(status_code=422, detail="File must be a video.")

    data = await file.read()
    if len(data) == 0:
        raise HTTPException(status_code=422, detail="Empty file received.")

    ext = os.path.splitext(file.filename or "video.mp4")[1] or ".mp4"
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        result = video_svc.extract_frames(project_id, tmp_path, target_fps)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    finally:
        os.unlink(tmp_path)

    return result


@router.get("/{project_id}/videos/{batch_id}/{frame_id}/image")
def get_pending_frame(
    project_id: str,
    batch_id: str,
    frame_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _owned_project(project_id, db, current_user)
    try:
        path = video_svc.frame_path(project_id, batch_id, frame_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Frame not found.")
    return FileResponse(path, media_type="image/jpeg")


class CommitBody(BaseModel):
    annotations: list[dict]
    tagger: str = "anonymous"
    notes: str = ""


@router.post("/{project_id}/videos/{batch_id}/{frame_id}/commit")
def commit_frame(
    project_id: str,
    batch_id: str,
    frame_id: str,
    body: CommitBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = _owned_project(project_id, db, current_user)
    max_class_id = len(project["classes"]) - 1

    try:
        src_path = video_svc.frame_path(project_id, batch_id, frame_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not os.path.exists(src_path):
        raise HTTPException(status_code=404, detail="Frame not found.")

    try:
        ann_svc.validate_annotations(body.annotations, max_class_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    image_id = uuid.uuid4().hex
    result = ann_svc.commit_annotated_image(
        project_id, image_id, ".jpg", src_path, body.annotations, body.tagger, body.notes
    )
    result["message"] = "Committed successfully."
    return result


@router.post("/{project_id}/videos/{batch_id}/{frame_id}/skip")
def skip_frame(
    project_id: str,
    batch_id: str,
    frame_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _owned_project(project_id, db, current_user)
    try:
        path = video_svc.frame_path(project_id, batch_id, frame_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if os.path.exists(path):
        os.remove(path)
    return {"message": "Skipped."}


@router.delete("/{project_id}/videos/{batch_id}")
def delete_batch(
    project_id: str,
    batch_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _owned_project(project_id, db, current_user)
    if "/" in batch_id or ".." in batch_id:
        raise HTTPException(status_code=422, detail="Invalid batch id.")
    batch_dir = video_svc.pending_dir(project_id, batch_id)
    if os.path.isdir(batch_dir):
        shutil.rmtree(batch_dir)
    return {"message": "Batch deleted."}
