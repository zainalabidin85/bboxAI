import os
import uuid

import cv2

from config import PROJECTS_DIR


def pending_dir(project_id: str, batch_id: str | None = None) -> str:
    parts = [PROJECTS_DIR, project_id, "pending"]
    if batch_id:
        parts.append(batch_id)
    return os.path.join(*parts)


def extract_frames(project_id: str, video_path: str, target_fps: float) -> dict:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError("Could not open video file.")

    try:
        video_fps = cap.get(cv2.CAP_PROP_FPS) or target_fps
        frame_interval = max(1, round(video_fps / max(target_fps, 0.1)))

        batch_id = uuid.uuid4().hex[:12]
        batch_dir = pending_dir(project_id, batch_id)
        os.makedirs(batch_dir, exist_ok=True)

        frames = []
        frame_index = 0
        saved_index = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if frame_index % frame_interval == 0:
                frame_id = f"{saved_index:05d}"
                frame_path = os.path.join(batch_dir, f"{frame_id}.jpg")
                cv2.imwrite(frame_path, frame)
                frames.append({"frame_id": frame_id, "index": saved_index})
                saved_index += 1
            frame_index += 1

        if not frames:
            os.rmdir(batch_dir)
            raise ValueError("No frames could be extracted from this video.")

        return {"batch_id": batch_id, "frame_count": len(frames), "frames": frames}
    finally:
        cap.release()


def list_batches(project_id: str) -> list[dict]:
    """List pending video batches still on disk, with their remaining (not yet
    committed/skipped) frames. Lets any session discover and resume a batch,
    not just the tab that originally uploaded the video."""
    root = pending_dir(project_id)
    if not os.path.isdir(root):
        return []

    batches = []
    for batch_id in sorted(os.listdir(root)):
        batch_dir = os.path.join(root, batch_id)
        if not os.path.isdir(batch_dir):
            continue
        frame_files = sorted(f for f in os.listdir(batch_dir) if f.endswith(".jpg"))
        if not frame_files:
            os.rmdir(batch_dir)
            continue
        frames = [
            {"frame_id": os.path.splitext(f)[0], "index": i}
            for i, f in enumerate(frame_files)
        ]
        batches.append({"batch_id": batch_id, "frame_count": len(frames), "frames": frames})
    return batches


def frame_path(project_id: str, batch_id: str, frame_id: str) -> str:
    if "/" in frame_id or ".." in frame_id or "/" in batch_id or ".." in batch_id:
        raise ValueError("Invalid frame or batch id.")
    return os.path.join(pending_dir(project_id, batch_id), f"{frame_id}.jpg")
