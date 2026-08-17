import json
import os
import random
import shutil
import threading
from datetime import datetime

from config import PROJECTS_DIR, WEIGHTS_DIR

MIN_BOXES = 10

_locks: dict[str, threading.Lock] = {}
_locks_mutex = threading.Lock()


def _get_lock(project_id: str) -> threading.Lock:
    with _locks_mutex:
        if project_id not in _locks:
            _locks[project_id] = threading.Lock()
        return _locks[project_id]


def _proj(*parts: str) -> str:
    return os.path.join(PROJECTS_DIR, *parts)


def _status_file(project_id: str) -> str:
    return _proj(project_id, "training_status.json")


def _default_status() -> dict:
    return {
        "state": "idle",
        "started_at": None,
        "finished_at": None,
        "total_images": 0,
        "total_boxes": 0,
        "epochs_done": 0,
        "total_epochs": 0,
        "base_model": None,
        "model_deployed": False,
        "error": None,
    }


def get_status(project_id: str) -> dict:
    path = _status_file(project_id)
    if not os.path.exists(path):
        return _default_status()
    with open(path) as f:
        return json.load(f)


def _write_status(project_id: str, data: dict):
    with open(_status_file(project_id), "w") as f:
        json.dump(data, f, indent=2)


def _count_boxes(project_id: str) -> int:
    labels_dir = _proj(project_id, "labels")
    if not os.path.isdir(labels_dir):
        return 0
    total = 0
    for lf in os.listdir(labels_dir):
        path = os.path.join(labels_dir, lf)
        if os.path.isfile(path):
            with open(path) as f:
                total += sum(1 for line in f if line.strip())
    return total


def _count_images(project_id: str) -> int:
    images_dir = _proj(project_id, "images")
    if not os.path.isdir(images_dir):
        return 0
    return sum(1 for f in os.listdir(images_dir) if os.path.isfile(os.path.join(images_dir, f)))


def _prepare_dataset(project_id: str, class_names: list[str]) -> str:
    images_dir = _proj(project_id, "images")
    labels_dir = _proj(project_id, "labels")
    dataset_dir = _proj(project_id, "dataset")

    label_stems = {
        os.path.splitext(f)[0]
        for f in os.listdir(labels_dir)
        if os.path.isfile(os.path.join(labels_dir, f))
    }
    image_map = {
        os.path.splitext(f)[0]: f
        for f in os.listdir(images_dir)
        if os.path.splitext(f)[0] in label_stems
    }

    samples = list(image_map.items())
    random.shuffle(samples)

    split = max(1, int(len(samples) * 0.8))
    train_samples = samples[:split]
    val_samples = samples[split:] if len(samples) > 1 else samples[:1]

    if os.path.exists(dataset_dir):
        shutil.rmtree(dataset_dir)

    for subset, items in [("train", train_samples), ("val", val_samples)]:
        os.makedirs(os.path.join(dataset_dir, subset, "images"), exist_ok=True)
        os.makedirs(os.path.join(dataset_dir, subset, "labels"), exist_ok=True)
        for stem, img_file in items:
            shutil.copy(
                os.path.join(images_dir, img_file),
                os.path.join(dataset_dir, subset, "images", img_file),
            )
            shutil.copy(
                os.path.join(labels_dir, f"{stem}.txt"),
                os.path.join(dataset_dir, subset, "labels", f"{stem}.txt"),
            )

    names_str = "[" + ", ".join(f"'{n}'" for n in class_names) + "]"
    yaml_path = os.path.join(dataset_dir, "data.yaml")
    with open(yaml_path, "w") as f:
        f.write(f"path: {os.path.abspath(dataset_dir)}\n")
        f.write("train: train/images\n")
        f.write("val: val/images\n")
        f.write(f"nc: {len(class_names)}\n")
        f.write(f"names: {names_str}\n")

    return yaml_path


def _run_training(project_id: str, status: dict, base_model: str, epochs: int, imgsz: int):
    try:
        from ultralytics import YOLO

        from database import SessionLocal
        from models import Project as ProjectModel
        _db = SessionLocal()
        try:
            proj_row = _db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
            class_names = [c.name for c in sorted(proj_row.classes, key=lambda x: x.class_index)]
        finally:
            _db.close()

        yaml_path = _prepare_dataset(project_id, class_names)

        def _on_epoch_end(trainer):
            status["epochs_done"] = trainer.epoch + 1
            _write_status(project_id, status)

        runs_dir = _proj(project_id, "runs")
        model = YOLO(base_model)
        model.add_callback("on_train_epoch_end", _on_epoch_end)

        results = model.train(
            data=yaml_path,
            epochs=epochs,
            imgsz=imgsz,
            batch=8,
            project=runs_dir,
            name="train",
            exist_ok=True,
            verbose=False,
        )

        best_pt = os.path.join(runs_dir, "train", "weights", "best.pt")
        if not os.path.exists(best_pt):
            raise FileNotFoundError(f"best.pt not found at {best_pt}")

        deploy_dir = _proj(project_id, "weights")
        os.makedirs(deploy_dir, exist_ok=True)
        deploy_path = os.path.join(deploy_dir, "best.pt")

        if os.path.exists(deploy_path):
            shutil.copy(deploy_path, deploy_path.replace(".pt", "_prev.pt"))
        shutil.copy(best_pt, deploy_path)

        metrics = getattr(results, "results_dict", {}) or {}
        status.update({
            "state": "done",
            "finished_at": datetime.utcnow().isoformat(),
            "model_deployed": True,
            "epochs_done": epochs,
            "imgsz": imgsz,
            "map50":      round(float(metrics.get("metrics/mAP50(B)",     0)), 4),
            "map50_95":   round(float(metrics.get("metrics/mAP50-95(B)",  0)), 4),
            "precision":  round(float(metrics.get("metrics/precision(B)", 0)), 4),
            "recall":     round(float(metrics.get("metrics/recall(B)",    0)), 4),
        })

    except Exception as exc:
        status.update({
            "state": "failed",
            "finished_at": datetime.utcnow().isoformat(),
            "error": str(exc),
        })

    finally:
        _write_status(project_id, status)
        _generate_report(project_id, status)
        _record_trained_model(project_id, status)


def _record_trained_model(project_id: str, status: dict):
    if status.get("state") != "done":
        return
    try:
        from database import SessionLocal
        from models import TrainedModel
        db = SessionLocal()
        try:
            record = TrainedModel(
                project_id=project_id,
                base_model=status.get("base_model"),
                epochs=status.get("total_epochs"),
                imgsz=status.get("imgsz"),
                map50=status.get("map50"),
                map50_95=status.get("map50_95"),
                precision=status.get("precision"),
                recall=status.get("recall"),
            )
            db.add(record)
            db.commit()
        finally:
            db.close()
    except Exception:
        pass  # DB write failure must never crash the training thread


def _generate_report(project_id: str, status: dict):
    try:
        from database import SessionLocal
        from models import Project as ProjectModel
        from services import report as rpt

        db = SessionLocal()
        try:
            proj_row = db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
            if not proj_row:
                return
            project = {
                "id": proj_row.id,
                "name": proj_row.name,
                "classes": [{"id": c.class_index, "name": c.name} for c in proj_row.classes],
            }
        finally:
            db.close()

        labels_dir = _proj(project_id, "labels")
        images_dir = _proj(project_id, "images")
        total = sum(1 for f in os.listdir(images_dir) if os.path.isfile(os.path.join(images_dir, f))) if os.path.isdir(images_dir) else 0
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

        stats = {
            "total": total,
            "labeled": labeled,
            "total_boxes": total_boxes,
            "per_class": [
                {"id": c["id"], "name": c["name"], "count": per_class.get(c["id"], 0)}
                for c in project["classes"]
            ],
        }
        rpt.generate(project, stats, status)
    except Exception:
        pass  # report generation failure must never crash the training thread


# ── Public API ────────────────────────────────────────────────────────────────

def list_base_models() -> list[dict]:
    if not os.path.isdir(WEIGHTS_DIR):
        return []
    return [{"filename": f} for f in sorted(os.listdir(WEIGHTS_DIR)) if f.endswith(".pt")]


def start_training(project_id: str, base_model_filename: str, epochs: int, imgsz: int) -> dict:
    lock = _get_lock(project_id)
    with lock:
        if get_status(project_id)["state"] == "running":
            return {"ok": False, "reason": "Training is already running for this project."}

        boxes = _count_boxes(project_id)
        if boxes < MIN_BOXES:
            return {"ok": False, "reason": f"Need at least {MIN_BOXES} labeled boxes. Currently have {boxes}."}

        base_model_path = os.path.join(WEIGHTS_DIR, base_model_filename)
        if not os.path.exists(base_model_path):
            return {"ok": False, "reason": f"Base model not found: {base_model_filename}. Place it in weights/ first."}

        status = {
            "state": "running",
            "started_at": datetime.utcnow().isoformat(),
            "finished_at": None,
            "total_images": _count_images(project_id),
            "total_boxes": boxes,
            "epochs_done": 0,
            "total_epochs": epochs,
            "base_model": base_model_filename,
            "model_deployed": False,
            "error": None,
        }
        _write_status(project_id, status)

        threading.Thread(
            target=_run_training,
            args=(project_id, status, base_model_path, epochs, imgsz),
            daemon=True,
        ).start()

        return {"ok": True, "reason": f"Training started using {base_model_filename}."}
