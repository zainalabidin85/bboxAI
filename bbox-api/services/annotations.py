import csv
import os
from datetime import datetime

from config import PROJECTS_DIR

_CSV_HEADER = ["id", "filename", "box_count", "tagger", "notes", "uploaded_at"]


def images_dir(project_id: str) -> str:
    return os.path.join(PROJECTS_DIR, project_id, "images")


def labels_dir(project_id: str) -> str:
    return os.path.join(PROJECTS_DIR, project_id, "labels")


def log_path(project_id: str) -> str:
    return os.path.join(PROJECTS_DIR, project_id, "uploads.csv")


def validate_annotations(annotations: list[dict], max_class_id: int) -> None:
    if not isinstance(annotations, list) or len(annotations) == 0:
        raise ValueError("At least one annotation is required.")
    for ann in annotations:
        if not all(k in ann for k in ("x", "y", "w", "h", "class_id")):
            raise ValueError("Each annotation needs x, y, w, h, class_id.")
        if int(ann["class_id"]) > max_class_id:
            raise ValueError(
                f"class_id {ann['class_id']} exceeds project class count ({max_class_id + 1} classes)."
            )


def append_log(project_id: str, row: dict) -> None:
    path = log_path(project_id)
    write_header = not os.path.exists(path)
    with open(path, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=_CSV_HEADER)
        if write_header:
            writer.writeheader()
        writer.writerow(row)


def save_yolo_labels(project_id: str, image_id: str, annotations: list[dict]) -> None:
    label_path = os.path.join(labels_dir(project_id), f"{image_id}.txt")
    lines = []
    for ann in annotations:
        class_id = int(ann["class_id"])
        cx = float(ann["x"]) + float(ann["w"]) / 2
        cy = float(ann["y"]) + float(ann["h"]) / 2
        w = float(ann["w"])
        h = float(ann["h"])
        lines.append(f"{class_id} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
    with open(label_path, "w") as f:
        f.write("\n".join(lines))


def commit_annotated_image(
    project_id: str,
    image_id: str,
    ext: str,
    src_path: str,
    annotations: list[dict],
    tagger: str,
    notes: str,
) -> dict:
    """Move an on-disk image into images/, write its YOLO label, and log it."""
    filename = f"{image_id}{ext}"
    dest_path = os.path.join(images_dir(project_id), filename)
    os.replace(src_path, dest_path)

    save_yolo_labels(project_id, image_id, annotations)

    append_log(project_id, {
        "id": image_id,
        "filename": f"images/{filename}",
        "box_count": len(annotations),
        "tagger": tagger.strip(),
        "notes": notes.strip(),
        "uploaded_at": datetime.utcnow().isoformat(),
    })

    return {
        "id": image_id,
        "filename": f"images/{filename}",
        "label_file": f"labels/{image_id}.txt",
        "box_count": len(annotations),
    }
