# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**bboxAI** is a generic multi-class image/video annotation and YOLOv8 model training system. It is a flexible evolution of the `mlharum-collector` from the MLharum project — domain-agnostic, multi-class, multi-project, multi-user.

Four components in this repo, plus one private companion service:
- **`bbox-app/`** — Flutter mobile app (Android-first)
- **`bbox-web/`** — React + TypeScript + Vite web client (login, projects, annotate, train, pairing)
- **`bbox-api/`** — FastAPI backend (Python) — the source of truth: auth, projects, annotation storage, training, reporting
- **`bbox-agent/`** — Python desktop agent that pairs with `bbox-relay` and forwards proxied requests to a local `bbox-api`
- **`bbox-relay`** — FastAPI relay/tunnel server that lets `bbox-web` reach a `bbox-api` instance running on someone's desktop behind NAT. Lives in a **separate private repo** (`zainalabidin85/bbox-relay`, split out 2026-08-18 ahead of monetizing the hosted relay) — not checked out here. `bbox-agent` is its public client, so the protocol it speaks is documented below even though the relay's own source isn't in this checkout.

Reference implementation (single-class, single-project baseline): `/home/zainal/innovation/MLharum/mlharum-collector/`

## Key Differences from mlharum-collector

| Feature | mlharum-collector | bboxAI |
|---|---|---|
| Classes | Hardcoded single class (mango) | User-defined classes per project |
| Datasets | One global dataset | Multiple named projects, owned by users |
| Auth | None | Username/password + JWT (`bbox-api`), separate device pairing (`bbox-relay`) |
| Training config | Fixed (epochs=100, base model fixed) | Configurable: base model, epochs, imgsz |
| Image source | Camera only | Camera + phone gallery + video frame extraction |
| Clients | Flutter app only | Flutter app + React web app, both talking to the same API |
| Remote access | N/A | Optional relay/agent tunnel so the web app can reach a desktop-hosted API |

## Development Commands

### API (bbox-api)

```bash
cd bbox-api
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
# Swagger UI: http://localhost:8000/docs
```

### Desktop agent (bbox-agent) — optional, pairs a local bbox-api with bbox-relay

```bash
cd bbox-agent
pip install -r requirements.txt
python agent.py
# Prompts for relay URL + bboxAI username/password on first run,
# stores config in ~/.bboxai/agent.json (chmod 600), prints a pairing code.
```

### Web app (bbox-web)

```bash
cd bbox-web
npm install
cp .env.example .env
npm run dev       # vite dev server
npm run build      # tsc -b && vite build
```

### Flutter App (bbox-app)

```bash
cd bbox-app
flutter pub get
flutter run
flutter build apk --release
```

## Architecture

### Auth

`bbox-api` has its own user system — `POST /auth/register`, `POST /auth/login` (OAuth2 password flow, JWT bearer, 7-day expiry, bcrypt password hashes). Every project is owned by a `User`; almost every endpoint requires `Depends(get_current_user)` and ownership is checked with `_require_owner` in `routers/projects.py`. Projects can be marked `is_public` to appear in the cross-user model catalog (`/models` — see Catalog below) and to allow read access (`GET /projects/{id}`) to non-owners.

`bbox-relay` has a **separate** auth system for desktop devices, unrelated to bboxAI project ownership: a device registers (`POST /agent/register`, providing the bboxAI username it represents) and gets a `device_id`/`device_secret`; a web client logs in with that same bboxAI username/password via `POST /login`, which the relay verifies by forwarding the login through the live tunnel to that device's own `bbox-api` (not by storing a copy of the password) before minting a relay session token. This is purely about authorizing the tunnel — the desktop agent still logs into `bbox-api` separately with a normal bboxAI username/password to get its own JWT for calls it forwards.

### App Navigation Flow (mobile & web, same shape)

```
Login / Register           (bbox-api auth)
  ↓
Settings screen  (server URL, tagger name)          [Flutter only — bbox-web is same-origin]
  ↓
Projects screen  (list / create / delete projects)
  ↓
Project detail   (class list, image count, trigger training, visibility toggle)
  ↓
Camera/Gallery/Video  (capture, pick image, or upload video → extract frames)
  ↓
Annotation screen (draw bboxes, assign class per box)
  ↓
Upload → POST /projects/{id}/upload  (or the video commit/skip flow)
  ↓
Stats/Training screen  (dataset stats + training progress/metrics chart + PDF report + weights download)
```

`bbox-web`'s `VITE_REMOTE=true` build reuses the normal `LoginPage.tsx` — `client.ts`'s `login()` branches at build time to hit `bbox-relay`'s `POST /login` instead of `bbox-api`'s `POST /auth/login` — so remote users log in with their normal bboxAI credentials to reach a desktop-hosted `bbox-api`. There's also a public **model Catalog** view sourced from `GET /models`.

### Project Model

A **project** (`models.Project` in `bbox-api`) has:
- `id` — random 12-char hex slug
- `name` — display name
- `owner_id` — FK to `User`
- `is_public` — bool; gates catalog listing and read-only cross-user access
- `classes` — ordered `BboxClass` rows `{class_index: int, name: str}` (maps to YOLO class indices, ordered by `class_index`)
- Storage isolated under `storage/projects/{project_id}/{images,labels,dataset,runs,pending,weights}/`

Classes are defined when creating a project and can only be **appended** — `PATCH /projects/{id}/classes` assigns new indices starting after the current max; there is no rename/reorder/delete endpoint, since renumbering would invalidate existing YOLO labels. The API rejects any upload whose `class_id` exceeds the project's current class count (`services/annotations.validate_annotations`).

### Bounding Box + Class Assignment

Each bbox in the annotation screen has:
- Drawn rect (normalized 0–1 top-left + size: `x, y, w, h`)
- **Class** — selected from the project's class list via a bottom sheet (Flutter) or `ClassPicker` component (web)

YOLO label format written on server (`services/annotations.save_yolo_labels`): `{class_id} {cx} {cy} {w} {h}` (one line per box, center-based per YOLO convention — the API converts from the top-left `x,y,w,h` it receives).

Upload payload: `POST /projects/{id}/upload` — multipart with `file`, `annotations` JSON (`[{x,y,w,h,class_id}]`), `tagger`, `notes`.

### Video Ingestion (`routers/video.py`, `services/video.py`)

Not in the original design — added since. Flow:
1. `POST /projects/{id}/videos/upload` (multipart video + `target_fps`) — OpenCV (`cv2`) decodes the video and writes sampled frames as JPEGs to `storage/projects/{id}/pending/{batch_id}/`, returns `{batch_id, frame_count, frames}`.
2. Client iterates frames, fetching each with `GET /projects/{id}/videos/{batch_id}/{frame_id}/image`.
3. For each frame: `POST .../commit` (same annotation shape as image upload — moves the pending frame into `images/`+`labels/` via `commit_annotated_image`) or `POST .../skip` (discards it).
4. `DELETE /projects/{id}/videos/{batch_id}` removes a whole pending batch.

Frame/batch ids are validated against path traversal (`frame_path` rejects `/` and `..`).

### API Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/register` | Create a bboxAI user |
| `POST` | `/auth/login` | OAuth2 password login → JWT |
| `GET` | `/projects` | List current user's projects |
| `POST` | `/projects` | Create project (name + classes list) |
| `GET` | `/projects/{id}` | Project detail + class list (owner, or any user if `is_public`) |
| `DELETE` | `/projects/{id}` | Delete project + all data (owner only) |
| `PATCH` | `/projects/{id}/classes` | Append new classes (owner only) |
| `PATCH` | `/projects/{id}/visibility` | Toggle `is_public` (owner only) |
| `POST` | `/projects/{id}/upload` | Upload annotated image |
| `GET` | `/projects/{id}/stats` | Image/label/box counts per class |
| `GET` | `/projects/{id}/images` | List committed images + boxes (read from disk, owner only) |
| `GET` | `/projects/{id}/images/{image_id}/file` | Fetch one committed image's raw bytes (owner only) |
| `POST` | `/projects/{id}/videos/upload` | Upload video, extract frames to a pending batch |
| `GET` | `/projects/{id}/videos/{batch_id}/{frame_id}/image` | Fetch one pending frame |
| `POST` | `/projects/{id}/videos/{batch_id}/{frame_id}/commit` | Annotate + commit a pending frame |
| `POST` | `/projects/{id}/videos/{batch_id}/{frame_id}/skip` | Discard a pending frame |
| `DELETE` | `/projects/{id}/videos/{batch_id}` | Delete a whole pending batch |
| `POST` | `/projects/{id}/train` | Start training (body: `base_model`, `epochs`, `imgsz`) |
| `GET` | `/projects/{id}/train/status` | Poll training state + epoch progress |
| `GET` | `/projects/{id}/train/metrics` | Per-epoch metrics rows parsed from Ultralytics' `results.csv` |
| `GET` | `/projects/{id}/report` | Download generated PDF training report |
| `GET` | `/projects/{id}/weights/download` | Download `best.pt` for the project |
| `GET` | `/weights` | List `.pt` files in `weights/` (base models available for training) |
| `GET` | `/models` | Public catalog — all public projects with a completed trained model |
| `GET` | `/models/search?classes=a,b` | Search public catalog by class name |

`bbox-relay` exposes its own small surface: `POST /agent/register`, `POST /login`, `WS /agent/ws` (desktop agent tunnel), `GET /wallet`, `POST /wallet/topup`, `POST /wallet/topup/webhook` (Billplz callback, no bearer auth), `POST /ai-assist`, and a catch-all `/{full_path}` proxy that forwards any other method/path to the paired desktop's `bbox-api` using a relay session bearer token. See "AI-Assist Tokens" below.

### Training Pipeline

Threading pattern in `services/trainer.py` (same shape as mlharum `trainer.py`, extended):
1. `start_training` takes a per-project `threading.Lock` so one project can't run two jobs at once (different projects train concurrently); validates a minimum of `MIN_BOXES = 10` labeled boxes and that the requested base model file exists in `weights/`.
2. Builds an 80/20 train/val split under `storage/projects/{id}/dataset/` with a `data.yaml` (multi-class: `nc` = project class count, `names` = ordered class name list).
3. `YOLO(base_model).train(data=yaml, epochs=N, imgsz=S, batch=8, ...)` in a daemon thread, with an `on_train_epoch_end` callback updating `training_status.json` (`epochs_done`) for polling.
4. On success: copies `best.pt` → `storage/projects/{id}/weights/best.pt` (previous deploy kept as `best_prev.pt`), records final metrics (`map50`, `map50_95`, `precision`, `recall`) into `training_status.json` **and** a `TrainedModel` DB row (used by the `/models` catalog), then generates a PDF report (`services/report.py`, ReportLab) at `storage/projects/{id}/report.pdf`. Report/DB-write failures are swallowed so they can never crash the training thread.
5. On failure: status is set to `failed` with the exception message; a report is still generated reflecting the failure.

Training config comes from the trigger request body (not hardcoded). Defaults: `epochs=100`, `imgsz=640`.

### Remote Access (bbox-relay + bbox-agent)

Lets a `bbox-web` client reach a `bbox-api` running on someone's desktop (e.g. behind NAT, no public IP) without exposing it directly:

1. `bbox-agent` runs next to a local `bbox-api`, logs into it with normal bboxAI credentials (stores the resulting JWT, refreshed ~6 days before its 7-day expiry).
2. On first run it registers with `bbox-relay` (`POST /agent/register`, body `{"username"}`) to get a `device_id`/`device_secret`; the relay stores the username against that device row.
3. The web user logs into `bboxai-remote.unitani.com` (`LoginPage.tsx`, same component the local build uses) with their normal bboxAI username/password. `bbox-relay`'s `POST /login` looks up the device registered for that username, forwards a `POST /auth/login` to it through the live tunnel (`tunnel.forward`, the same mechanism the catch-all proxy route uses), and — only if that verifies — mints a relay session JWT (`auth.create_session_token`). An in-memory per-username rate limit (5 failures / 15 min) guards this endpoint since it's now internet-facing password verification, not a possession-based pairing code.
4. `bbox-agent` holds a persistent WebSocket (`/agent/ws`) to `bbox-relay`. Any HTTP request to `bbox-relay`'s catch-all proxy route (authenticated with the relay session token) is serialized (method/path/headers/base64 body), sent down that socket, executed locally against `bbox-api` by the agent, and the response is shipped back the same way (`bbox-relay/tunnel.py` correlates requests via `req_id` futures).
5. Reconnects with backoff (`2,4,8,16,30s`) if the tunnel drops; the relay marks the device offline and fails in-flight requests immediately (`DeviceOffline`) rather than hanging.

This is independent of bboxAI's own auth in the sense that `bbox-relay` has its own device/session model — but unlike the old pairing-code design, the *login* on `bboxai-remote.unitani.com` now checks a real bboxAI account password (verified against the paired device's own `bbox-api`, not duplicated on the relay).

### AI-Assist Tokens (monetization, bboxai-remote only)

The only paid feature in bboxAI: on the annotation screen, a **remote-build-only** "AI Assist" button (`AnnotatePage.tsx`, gated on `VITE_REMOTE`) sends Claude Haiku 4.5's vision API a few of the project's already-annotated images as few-shot examples plus the new target image, and gets back suggested bounding boxes for the user to review/edit before committing — same commit path as manually-drawn boxes, nothing new there. `bbox-api` stays free/self-hostable and payment-unaware; all wallet/AI logic lives in `bbox-relay` (private repo), consistent with it already being the hosted-product-only component.

- **Vision provider: Claude Haiku 4.5, not a bigger Claude model, and not DeepSeek.** DeepSeek was tried first (2026-08-19, same day) since that's the API key on hand — their API turned out to be text-only (confirmed live: `image` content blocks are rejected with `unknown variant image_url, expected text`, and there's no vision guide anywhere in their docs, despite third-party blog posts claiming otherwise). Anthropic's own vision-capable models were then compared on cost: at ~1,050 tokens/image (Anthropic's `(width×height)/750` estimate) × ~4 images per call, Sonnet 5 (~RM0.057/call) would run **above** the RM0.05 charged per AI-assist call — a losing margin — while Haiku 4.5 (~RM0.035/call) leaves roughly 30% margin and is plenty capable for a "return JSON boxes" structured task. **How to apply**: if the vision provider ever changes again, re-run this cost-vs-price comparison before picking a model — it isn't just an accuracy tradeoff.
- **Sourcing examples**: `bbox-web` calls `GET /projects/{id}/images` (transparently proxied through the relay's existing catch-all, unchanged) to list up to 5 already-annotated images with their boxes, fetches each via `GET /projects/{id}/images/{image_id}/file`, downscales everything client-side to ~1024px long side (`utils/image.ts`), then `POST`s target + examples directly to `bbox-relay`'s `/ai-assist` — **not** proxied to `bbox-api`, since the payment/AI logic is relay-side.
- **Wallet**: `bbox-relay/models.py`'s `TokenLedger` is an append-only ledger (`username, delta, reason, billplz_bill_id`) — balance is `SUM(delta)`, no separate mutable balance row to drift out of sync. `wallet.py` has the balance/credit/debit helpers; `wallet.TOKEN_PACKAGES` defines the purchasable tiers (100/300/1000 tokens for RM5/15/50 — 1 token = 1 AI-assist call = RM0.05, matching the stated 10 tokens = RM0.50 rate).
- **Welcome bonus**: `wallet.ensure_welcome_bonus` grants `WELCOME_BONUS_TOKENS` (default 20) the first time a username's wallet is ever touched — not tied to bboxAI account registration or relay device pairing (bbox-relay doesn't directly observe either event), just lazily fired from `main.py`'s `_current_username` helper, so it works no matter whether the user's first touch is the Wallet page, the nav balance badge, or hitting AI Assist directly. Idempotent (checks for any existing `TokenLedger` row for that username first). `GET /wallet` additionally returns `welcome_bonus_granted: bool` for *that specific call* so `WalletPage.tsx` can show a one-time "Welcome!" banner — it's `true` only on the call that actually granted it, `false` on every call after.
- **Billplz top-up**: `POST /wallet/topup` (`billplz.py`) creates a Billplz bill and a pending `BillplzOrder` row; `POST /wallet/topup/webhook` verifies Billplz's `X-Signature` (sorted-key HMAC-SHA256, see `billplz.verify_signature`) with no bearer auth (it's a server-to-server callback), then credits the ledger — idempotent via `wallet.already_credited` checking `billplz_bill_id` before crediting, since Billplz may call the webhook more than once for the same bill.
- **`POST /ai-assist`**: bearer-auth like the catch-all proxy (`_current_username`, extracted from the same device-id-decode pattern), checks balance ≥ `AI_ASSIST_COST_TOKENS` (default 1), calls Claude via `ai_assist.suggest_boxes` (one Messages API call, interleaved example image/box-JSON pairs + the target image, asking for a strict JSON box array back), debits **only on success** so a failed call never costs a token, and returns the parsed boxes. A per-username in-memory rate limit (20 calls / 10 min, mirrors the `/login` failure limiter) guards against runaway spend from a client bug.
- **Config** (`bbox-relay/.env`): `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-haiku-4-5`), `BILLPLZ_API_KEY`, `BILLPLZ_COLLECTION_ID`, `BILLPLZ_X_SIGNATURE_KEY`, `BILLPLZ_BASE_URL` (sandbox vs production), `WEB_APP_URL` (used to build Billplz's `redirect_url` back into `bbox-web`'s `/wallet` page).
- **Known gap, `Upload` DB model is unused**: `bbox-api`'s `list_images`/`get_image_file` read committed images straight off disk (`images/{id}{ext}` + `labels/{id}.txt`) rather than querying the `Upload` table, because nothing in `bbox-api` ever actually inserts `Upload` rows (the model exists in `models.py` but is dead code) — discovered while building this feature. Not fixed as part of this feature (out of scope), just worked around; worth cleaning up (either wire up `Upload` inserts, or remove the unused model) next time this area is touched.

### Flutter Packages

```yaml
camera: ^0.10.5
image_picker: ^1.1.2         # gallery support
dio: ^5.4.3
shared_preferences: ^2.2.3
provider: ^6.1.2             # state management (project/class state across screens)
url_launcher: ^6.3.0
```

Unlike mlharum-collector (pure StatefulWidget), bboxAI uses `provider` because project + class selection must survive navigation across screens.

### Web Packages (bbox-web)

```json
react, react-dom, react-router-dom, axios, recharts
```

`recharts` backs `MetricsChart.tsx` (per-epoch training curves from `/projects/{id}/train/metrics`). `AuthContext.tsx` + `ProtectedRoute.tsx` mirror the mobile app's login-gated navigation.

### Key Implementation Notes

- **Class picker in annotation**: tapping a drawn box shows a bottom sheet (Flutter) / `ClassPicker` (web) with the project's class list; selected class shown as coloured label badge on the box.
- **Minimum box size**: 4% of image dimensions (same as mlharum-collector) to filter tap accidents — enforced client-side.
- **Project classes are immutable in order** — new classes only append (`PATCH /projects/{id}/classes`). The API rejects any upload whose `class_id` values exceed the project's current class count.
- **Training lock per project**: each project tracks its own `training_status.json`; two projects can train concurrently but one project cannot run two jobs simultaneously (`services/trainer._get_lock`).
- **Gallery/video images are decoded and displayed identically to camera captures** — the annotation UI receives a file path or fetched frame regardless of source.
- **`bbox-api` ownership boundary**: nearly every project-scoped endpoint calls `_require_owner`; the only owner-agnostic reads are `GET /projects/{id}` and the `/models` catalog, both gated by `is_public`.
- **Path-traversal guards**: video `batch_id`/`frame_id` and relay proxy paths are validated against `/` and `..` before touching the filesystem.
