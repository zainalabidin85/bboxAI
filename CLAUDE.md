# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**bboxAI** is a generic multi-class image annotation and YOLOv8 model training system. It is a flexible evolution of the `mlharum-collector` from the MLharum project — domain-agnostic, multi-class, multi-project.

Two components:
- **`bbox-app/`** — Flutter mobile app (Android-first)
- **`bbox-api/`** — FastAPI backend (Python)

Reference implementation (single-class, single-project baseline): `/home/zainal/innovation/MLharum/mlharum-collector/`

## Key Differences from mlharum-collector

| Feature | mlharum-collector | bboxAI |
|---|---|---|
| Classes | Hardcoded single class (mango) | User-defined classes per project |
| Datasets | One global dataset | Multiple named projects |
| Training config | Fixed (epochs=100, base model fixed) | Configurable: base model, epochs, imgsz |
| Image source | Camera only | Camera + phone gallery |

## Development Commands

### API (bbox-api)

```bash
cd bbox-api
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
# Swagger UI: http://localhost:8000/docs
```

### Flutter App (bbox-app)

```bash
cd bbox-app
flutter pub get
flutter run
flutter build apk --release
```

## Architecture

### App Navigation Flow

```
Settings screen  (server URL, tagger name)
  ↓
Projects screen  (list / create / delete projects)
  ↓
Project detail   (class list, image count, trigger training)
  ↓
Camera/Gallery   (capture or pick image)
  ↓
Annotation screen (draw bboxes, assign class per box)
  ↓
Upload → POST /projects/{id}/upload
  ↓
Stats/Training screen  (dataset stats + training progress, config)
```

### Project Model

A **project** has:
- `id` (slug or UUID)
- `name` (display name)
- `classes` — ordered list of `{id: int, name: str}` (maps to YOLO class indices)
- Storage isolated under `storage/projects/{project_id}/images/` and `labels/`

Classes are defined when creating a project and can be extended. Class index order must not change after images are labeled (adding new classes appends; renaming is safe).

### Bounding Box + Class Assignment

Each bbox in the annotation screen has:
- Drawn rect (normalized 0–1 top-left + size)
- **Class** — selected from the project's class list via a bottom sheet or inline picker

YOLO label format written on server: `{class_id} {cx} {cy} {w} {h}` (one line per box).

Upload payload: `POST /projects/{id}/upload` — multipart with `file`, `annotations` JSON (`[{x,y,w,h,class_id}]`), `tagger`, `notes`.

### API Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/projects` | List all projects |
| `POST` | `/projects` | Create project (name + classes JSON) |
| `GET` | `/projects/{id}` | Project detail + class list |
| `DELETE` | `/projects/{id}` | Delete project + all data |
| `POST` | `/projects/{id}/upload` | Upload annotated image |
| `GET` | `/projects/{id}/stats` | Image/label/box counts per class |
| `POST` | `/projects/{id}/train` | Start training (body: base_model, epochs, imgsz) |
| `GET` | `/projects/{id}/train/status` | Poll training state + epoch progress |
| `GET` | `/training/base-models` | List `.pt` files in `weights/` |

### Training Pipeline

Same threading pattern as mlharum `trainer.py`:
1. Validate minimum boxes
2. Build 80/20 train/val split dataset with `data.yaml` (multi-class: `nc` = project class count, `names` = class name list)
3. `YOLO(base_model).train(data=yaml, epochs=N, imgsz=S, ...)` with epoch callback
4. Deploy `best.pt` → `weights/{project_id}_deploy.pt` and hot-reload

Training config comes from the trigger request body (not hardcoded). Defaults: `epochs=100`, `imgsz=640`.

### Flutter Packages

```yaml
camera: ^0.10.5
image_picker: ^1.1.2         # gallery support
dio: ^5.4.3
shared_preferences: ^2.2.3
provider: ^6.1.2             # state management (project/class state across screens)
```

Unlike mlharum-collector (pure StatefulWidget), bboxAI uses `provider` because project + class selection must survive navigation across screens.

### Key Implementation Notes

- **Class picker in annotation**: tapping a drawn box shows a bottom sheet with the project's class list; selected class shown as coloured label badge on the box.
- **Minimum box size**: 4% of image dimensions (same as mlharum-collector) to filter tap accidents.
- **Project classes are immutable in order** — new classes only append. The API must reject any upload whose `class_id` values exceed the project's current class count.
- **Training lock per project**: each project tracks its own `training_status.json`; two projects can train concurrently but one project cannot run two jobs simultaneously.
- **Gallery images**: decoded and displayed identically to camera captures — `AnnotationScreen` receives a file path regardless of source.
