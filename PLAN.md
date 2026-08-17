# bboxAI — Implementation Plan

## Context

bboxAI is a domain-agnostic image annotation and YOLOv8 training system, and a **public platform** for sharing trained custom object detection models worldwide. Users register, collect data, train models, and optionally publish them to a global catalog so others can discover and download them.

The reference implementation (mlharum-collector + mlharum-api) was single-class, single-project, no-auth. bboxAI extends this to: multiple named projects per user, user-defined classes, configurable training, JWT auth, PostgreSQL, and a public model catalog.

---

## Repository Structure

```
bboxAI/
├── bbox-api/           # FastAPI backend
├── bbox-app/           # Flutter Android app
└── CLAUDE.md
```

---

## Phase 1 — bbox-api

### 1.1 Project scaffold

```
bbox-api/
├── main.py
├── config.py
├── requirements.txt
├── .env.example
├── database.py         # SQLAlchemy engine + session + get_db
├── models.py           # ORM: User, Project, BboxClass, Upload, TrainedModel
├── auth.py             # bcrypt + JWT create/verify + get_current_user dependency
├── routers/
│   ├── auth.py         # POST /auth/register, POST /auth/login
│   ├── projects.py     # CRUD projects (DB-backed, auth-protected)
│   ├── training.py     # upload, stats, train, status, report, model download
│   └── catalog.py      # GET /models, GET /models/search
└── services/
    ├── trainer.py      # background training thread (writes TrainedModel to DB)
    └── report.py       # PDF report generation (reportlab)
```

Hybrid storage: metadata + auth in PostgreSQL, images/labels/weights on filesystem.

### 1.2 Config (config.py)

Pydantic BaseSettings:
```
STORAGE_PATH=./storage                        # root for all project data
WEIGHTS_PATH=./weights                        # base .pt models
DATABASE_URL=postgresql://user:pw@host/db     # PostgreSQL connection string
SECRET_KEY=<random string>                    # JWT signing key
ACCESS_TOKEN_EXPIRE_MINUTES=10080             # 7 days
```

### 1.3 Storage layout

```
storage/
  projects/
    {project_id}/
      project.json          # {id, name, classes: [{id, name}], created_at}
      images/               # uploaded images
      labels/               # YOLO .txt label files
      dataset/              # generated train/val split
      runs/                 # ultralytics output
      training_status.json  # {state, epochs_done, total_epochs, metrics, ...}
      uploads.csv
      weights/
        best.pt             # deployed model after training
        best_prev.pt        # previous model (backup)
      report.pdf            # auto-generated after each training run
weights/
  yolov8n.pt
  yolov8s.pt
```

### 1.4 API endpoints

**Auth (public)**

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/register` | Body: `{username, email, password}` — self-registration, returns 201 |
| POST | `/auth/login` | OAuth2 form: `username + password` — returns `{access_token, token_type, username}` |

**Projects (auth required — owner only)**

| Method | Path | Purpose |
|---|---|---|
| GET | `/projects` | List caller's own projects |
| POST | `/projects` | Create project — body: `{name, classes: ["cat","dog",...]}` |
| GET | `/projects/{id}` | Project detail + class list |
| DELETE | `/projects/{id}` | Delete project + all data (owner only) |
| PATCH | `/projects/{id}/classes` | Append new classes (never reorder) |
| PATCH | `/projects/{id}/visibility` | Body: `{is_public: bool}` — publish/unpublish to catalog |
| POST | `/projects/{id}/upload` | Multipart: file + annotations JSON + tagger + notes |
| GET | `/projects/{id}/stats` | `{total, labeled, total_boxes, per_class: [{id,name,count}]}` |
| POST | `/projects/{id}/train` | Body: `{base_model, epochs, imgsz}` |
| GET | `/projects/{id}/train/status` | Poll training state + epoch progress |
| GET | `/projects/{id}/report` | Download PDF training report |
| GET | `/projects/{id}/weights/download` | Download trained `best.pt` model |
| GET | `/weights` | List `.pt` files in weights/ dir |

**Public catalog (no auth)**

| Method | Path | Purpose |
|---|---|---|
| GET | `/models` | All public projects with a trained model, ordered by trained_at desc |
| GET | `/models/search?classes=cat,dog` | OR-match on class names, public only |

### 1.5 Upload + label writing

Upload annotation format from app:
```json
[{"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4, "class_id": 0}, ...]
```

YOLO label written to `labels/{uuid}.txt`:
```
0 0.25 0.40 0.30 0.40
1 0.60 0.55 0.20 0.30
```
(class_id cx cy w h — same conversion as mlharum: cx = x + w/2)

Validation: reject any `class_id` ≥ project class count.

### 1.6 Trainer service (adapted from mlharum services/trainer.py)

Key changes vs mlharum:
- Scoped per project (`project_id` arg, paths under `storage/projects/{id}/`)
- `data.yaml` uses `nc` = project class count, `names` = class name list
- Training params come from request (`epochs`, `imgsz`, `batch=8`)
- Deploy path: `storage/projects/{id}/weights/best.pt` (no global hot-reload — bboxAI has no inference endpoint)
- `MIN_BOXES = 10` (lower than mlharum's 50 — generic tool, smaller datasets)
- `imgsz` stored in training_status.json for report generation

Thread safety: one `threading.Lock` per project (dict keyed by project_id).

### 1.8 Authentication (auth.py)

- Password hashing: `passlib[bcrypt]`
- Token: JWT via `python-jose[cryptography]`, signed with `SECRET_KEY`, 7-day expiry
- `get_current_user()` FastAPI dependency — decodes Bearer token, returns `User` ORM object or raises 401
- Self-registration open to everyone; no admin invite required
- `POST /auth/register` validates: username ≥ 3 chars, password ≥ 8 chars, unique username + email

### 1.9 Public Model Catalog (routers/catalog.py)

- No auth required on both endpoints
- Only projects with `is_public=True` AND at least one `TrainedModel` record appear
- Owner must explicitly toggle `PATCH /projects/{id}/visibility` to publish
- Search is OR-match: any project whose class names contain any of the queried terms
- Response includes: project_name, owner (username), classes list, latest model metrics, download_url, report_url

### 1.7 PDF Report (services/report.py)

Auto-generated at the end of every training run (success or failure). Saved to `storage/projects/{id}/report.pdf`.

Contents:
- Project info: name, ID, classes, start/finish time, duration, base model, epochs, imgsz
- Dataset statistics: total images, labeled images, total boxes
- Per-class breakdown table: class ID, name, box count, % of total
- Model performance table: mAP@50, mAP@50-95, Precision, Recall
- Footer: generation timestamp

Library: `reportlab==4.2.5`

---

## Phase 2 — bbox-app

### 2.1 Project scaffold

```
bbox-app/
├── pubspec.yaml
└── lib/
    ├── main.dart
    ├── models/
    │   └── project.dart        # Project + BboxClass data classes
    ├── providers/
    │   └── project_provider.dart  # currentProject state
    ├── screens/
    │   ├── settings_screen.dart
    │   ├── login_screen.dart       # JWT login form
    │   ├── register_screen.dart    # self-registration form
    │   ├── projects_screen.dart
    │   ├── project_detail_screen.dart
    │   ├── camera_screen.dart
    │   ├── annotation_screen.dart
    │   ├── stats_screen.dart
    │   └── catalog_screen.dart     # public model catalog + search
    └── services/
        └── api_service.dart    # all HTTP calls (replaces upload_service.dart)
```

### 2.2 pubspec.yaml dependencies

```yaml
camera: ^0.10.5
image_picker: ^1.1.2        # gallery support
dio: ^5.4.3
shared_preferences: ^2.2.3
provider: ^6.1.2
url_launcher: ^6.3.0        # open report PDF + model download in browser
```

### 2.3 Navigation flow

```
App start
  → no server URL         → SettingsScreen
  → URL, no token         → LoginScreen
  → URL + valid token     → ProjectsScreen (home)

LoginScreen  ──→  RegisterScreen (link)
     ↓
ProjectsScreen  ──→  CatalogScreen (explore icon, no auth needed)
     ↓ tap project
ProjectDetailScreen  →  CameraScreen  →  AnnotationScreen
     ↓ tap "Train"                            ↓ upload done
StatsScreen (training config bottom sheet)  back to ProjectDetail
```

### 2.4 Screen details

**SettingsScreen** — reuse mlharum-collector settings_screen.dart pattern exactly (server URL + tagger name, SharedPreferences)

**ProjectsScreen** — list of project cards (name, class count, image count); FAB to create new project with name + comma-separated class names input

**ProjectDetailScreen** — shows classes as chips, image/box stats, two buttons: "Capture / Pick Image" and "Train Model"

**CameraScreen** — two source buttons: camera (existing mlharum-collector camera_screen.dart pattern) + gallery (image_picker). Both resolve to a file path → push to AnnotationScreen

**AnnotationScreen** — adapted from mlharum-collector annotation_screen.dart:
- Same drag-to-draw canvas (CustomPaint + GestureDetector + normalized coords)
- After each box is drawn → bottom sheet appears with class selector (list of project classes)
- Each box badge shows class name (not box number) + color coded by class_id
- Undo removes last box
- Upload sends `[{x,y,w,h,class_id}]` to `POST /projects/{id}/upload`

**LoginScreen** — username + password fields, sign in button, link to /register, link to /settings (change server URL)

**RegisterScreen** — username, email, password, confirm password; success → navigate to /login

**CatalogScreen** — search bar (class name OR query), list of `_ModelCard` widgets (project name, owner, class chips, metrics, Report + Model download buttons); no auth required

**StatsScreen** — per-class breakdown table + training config bottom sheet (base model picker from GET /weights, epochs slider 50–300, imgsz selector 320/640/1280) + progress card (reuse mlharum _TrainingProgressCard + _TrainingResultCard patterns) + **Download Report** and **Download Model** buttons shown after training completes (open server URLs via url_launcher)

### 2.5 State management

`ProjectProvider` (ChangeNotifier via provider):
- `currentProject`: `Project` — id, name, classes list
- Set when user taps a project on ProjectsScreen
- Read in AnnotationScreen to populate class selector and build upload payload

### 2.6 ApiService

Replaces UploadService. Token stored in SharedPreferences, loaded at app start.

**Auth**
- `register(username, email, password)` — POST /auth/register
- `login(username, password)` — POST /auth/login, saves token
- `logout()` — clears token from memory + SharedPreferences
- `isLoggedIn` → bool; `loadToken()` → called on startup

**Projects (auth header attached automatically)**
- `getProjects()`, `createProject(name, classes)`, `deleteProject(id)`, `addClasses(id, classes)`
- `updateVisibility(id, isPublic)` — PATCH /projects/{id}/visibility
- `uploadAnnotated(projectId, imagePath, annotations, tagger)`
- `getStats(projectId)`, `startTraining(projectId, baseModel, epochs, imgsz)`
- `getTrainingStatus(projectId)`, `getWeights()`
- `reportUrl(projectId)` → URL string for PDF report download
- `modelDownloadUrl(projectId)` → URL string for model download

**Catalog (no auth)**
- `getCatalog()` — GET /models
- `searchModels(query)` — GET /models/search?classes=query

---

## Build Order (implementation phases)

1. ✅ **bbox-api scaffold** — main.py, config.py, requirements.txt, .env.example
2. ✅ **Projects CRUD router** — filesystem JSON, list/create/get/delete/patch-classes
3. ✅ **Upload + stats router** — multipart receive, YOLO label writer, CSV log, stats endpoint
4. ✅ **Trainer service + train endpoints** — adapted trainer.py (multi-class, configurable params), lock per project
5. ✅ **bbox-app scaffold** — pubspec.yaml, main.dart, provider setup, models
6. ✅ **Settings + Projects screens** — SettingsScreen (reuse pattern), ProjectsScreen + create dialog
7. ✅ **Camera + Gallery screen** — CameraScreen with both source buttons + ProjectDetailScreen
8. ✅ **Annotation screen** — multi-class bbox drawing with class selector bottom sheet
9. ✅ **Stats + Training screen** — StatsScreen with training config bottom sheet + progress polling
10. ✅ **PDF report** — auto-generated after training, served via GET /projects/{id}/report
11. ✅ **Model download** — trained best.pt served via GET /projects/{id}/weights/download
12. ✅ **Download buttons in app** — Download Report + Download Model buttons on StatsScreen (url_launcher)
13. ✅ **PostgreSQL + SQLAlchemy** — database.py, models.py (User, Project, BboxClass, Upload, TrainedModel), auto create_all on startup
14. ✅ **JWT auth backend** — auth.py (bcrypt + JWT), routers/auth.py (register + login), projects.py rewritten to DB-backed with ownership checks
15. ✅ **Public catalog** — routers/catalog.py (GET /models, GET /models/search), trainer.py records TrainedModel to DB after run
16. ✅ **Flutter auth + catalog** — LoginScreen, RegisterScreen, CatalogScreen, ApiService auth methods, main.dart 3-way routing, projects_screen.dart logout + explore button

**Status: ALL STEPS COMPLETE — 2026-06-05**

---

## Verification (pending — run on server with GPU + PostgreSQL)

**PostgreSQL setup**
```sql
CREATE USER bboxai WITH PASSWORD 'password';
CREATE DATABASE bboxai OWNER bboxai;
```

**API**
- [ ] Copy `.env.example` → `.env`, fill DATABASE_URL, SECRET_KEY
- [ ] `cd bbox-api && pip install -r requirements.txt`
- [ ] `uvicorn main:app --host 0.0.0.0 --port 8000 --reload` — tables created automatically on first run
- [ ] Test via Swagger at `http://<server>:8000/docs`
- [ ] Register user → login → create project → upload image → trigger training

**Auth flow**
- [ ] `POST /auth/register` → 201 with user id
- [ ] `POST /auth/login` → 200 with access_token
- [ ] `GET /projects` without token → 401
- [ ] `GET /projects` with token → 200 (empty list for new user)

**Catalog flow**
- [ ] Train a project → toggle `PATCH /projects/{id}/visibility` with `{is_public: true}`
- [ ] `GET /models` → project appears without auth
- [ ] `GET /models/search?classes=<classname>` → project appears

**App**
- [ ] Build APK: `cd bbox-app && flutter build apk --release`
- [ ] Install on Android device, set server URL → lands on LoginScreen
- [ ] Register → login → create project → capture/annotate → upload → train → download report + model
- [ ] Explore catalog without logging out
- [ ] Logout → redirected to LoginScreen
