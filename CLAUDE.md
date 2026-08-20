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

`bbox-relay` exposes its own small surface: `POST /agent/register`, `POST /login`, `WS /agent/ws` (desktop agent tunnel), `GET /wallet`, `POST /wallet/topup`, `POST /wallet/topup/webhook` (Billplz callback, no bearer auth), `POST /ai-assist`, `GET /projects/{id}/report` + `GET .../report/status` + `POST .../report/unlock` (paid-report gating, registered ahead of the catch-all so they intercept those exact paths — see "Detailed Report Paywall" below), and a catch-all `/{full_path}` proxy that forwards any other method/path to the paired desktop's `bbox-api` using a relay session bearer token. See "AI-Assist Tokens" and "Detailed Report Paywall" below.

### Training Pipeline

Threading pattern in `services/trainer.py` (same shape as mlharum `trainer.py`, extended):
1. `start_training` takes a per-project `threading.Lock` so one project can't run two jobs at once (different projects train concurrently); validates a minimum of `MIN_BOXES = 10` labeled boxes and that the requested base model file exists in `weights/`.
2. Builds an 80/20 train/val split under `storage/projects/{id}/dataset/` with a `data.yaml` (multi-class: `nc` = project class count, `names` = ordered class name list).
3. `YOLO(base_model).train(data=yaml, epochs=N, imgsz=S, batch=8, ...)` in a daemon thread, with an `on_train_epoch_end` callback updating `training_status.json` (`epochs_done`) for polling.
4. On success: copies `best.pt` → `storage/projects/{id}/weights/best.pt` (previous deploy kept as `best_prev.pt`), records final metrics (`map50`, `map50_95`, `precision`, `recall`) into `training_status.json` **and** a `TrainedModel` DB row (used by the `/models` catalog), then generates **both** report tiers (`services/report.py`, ReportLab) — `storage/projects/{id}/report.pdf` (full) and `report_free.pdf` (watermarked, fewer pages) — see "Detailed Report Paywall" below for what differs between them. Report/DB-write failures are swallowed so they can never crash the training thread.
5. On failure: status is set to `failed` with the exception message; a report is still generated reflecting the failure.

Training config comes from the trigger request body (not hardcoded). Defaults: `epochs=100`, `imgsz=640`.

### Remote Access (bbox-relay + bbox-agent)

Lets a `bbox-web` client reach a `bbox-api` running on someone's desktop (e.g. behind NAT, no public IP) without exposing it directly:

1. `bbox-agent` runs next to a local `bbox-api`, logs into it with normal bboxAI credentials (stores the resulting JWT, refreshed ~6 days before its 7-day expiry). In the `bboxai-desktop` installers (added 2026-08-20, fixing a real UX gap — see `bboxai-desktop/packaging/*/README.md`), it doesn't need those credentials supplied up front: it starts immediately on install and waits, polling a local `agent-credentials.json` that `bbox-api`'s `POST /auth/register` writes on a successful registration (`config.agent_credentials_path`, opt-in/unset for a plain self-hosted `bbox-api`) — so remote access activates the first time a user registers locally, no separate "enable remote" step or re-typed password. A newer credentials file always wins over cached settings, so the installers' `enable-remote.sh`/`.ps1`/`bboxai-enable-remote` still exist as a manual override to force a *different* local account to become the remote-enabled one.
2. On first run it registers with `bbox-relay` (`POST /agent/register`, body `{"username"}`) to get a `device_id`/`device_secret`; the relay stores the username against that device row.
3. The web user logs into `bboxai-remote.unitani.com` (`LoginPage.tsx`, same component the local build uses) with their normal bboxAI username/password. `bbox-relay`'s `POST /login` looks up the device registered for that username, forwards a `POST /auth/login` to it through the live tunnel (`tunnel.forward`, the same mechanism the catch-all proxy route uses), and — only if that verifies — mints a relay session JWT (`auth.create_session_token`). An in-memory per-username rate limit (5 failures / 15 min) guards this endpoint since it's now internet-facing password verification, not a possession-based pairing code.
4. `bbox-agent` holds a persistent WebSocket (`/agent/ws`) to `bbox-relay`. Any HTTP request to `bbox-relay`'s catch-all proxy route (authenticated with the relay session token) is serialized (method/path/headers/base64 body), sent down that socket, executed locally against `bbox-api` by the agent, and the response is shipped back the same way (`bbox-relay/tunnel.py` correlates requests via `req_id` futures).
5. Reconnects with backoff (`2,4,8,16,30s`) if the tunnel drops; the relay marks the device offline and fails in-flight requests immediately (`DeviceOffline`) rather than hanging.

This is independent of bboxAI's own auth in the sense that `bbox-relay` has its own device/session model — but unlike the old pairing-code design, the *login* on `bboxai-remote.unitani.com` now checks a real bboxAI account password (verified against the paired device's own `bbox-api`, not duplicated on the relay).

### AI-Assist Tokens (monetization, bboxai-remote only)

The only paid feature in bboxAI: on the annotation screen, a **remote-build-only** "AI Assist" button (`AnnotatePage.tsx`, gated on `VITE_REMOTE`) sends Claude Haiku 4.5's vision API a few of the project's already-annotated images as few-shot examples plus the new target image, and gets back suggested bounding boxes for the user to review/edit before committing — same commit path as manually-drawn boxes, nothing new there. `bbox-api` stays free/self-hostable and payment-unaware; all wallet/AI logic lives in `bbox-relay` (private repo), consistent with it already being the hosted-product-only component.

- **Vision provider: Claude Haiku 4.5, not a bigger Claude model, and not DeepSeek.** DeepSeek was tried first (2026-08-19, same day) since that's the API key on hand — their API turned out to be text-only (confirmed live: `image` content blocks are rejected with `unknown variant image_url, expected text`, and there's no vision guide anywhere in their docs, despite third-party blog posts claiming otherwise). Anthropic's own vision-capable models were then compared on cost: at ~1,050 tokens/image (Anthropic's `(width×height)/750` estimate) × ~4 images per call, Sonnet 5 (~RM0.057/call) would run above the effective per-call revenue at the token pricing live at the time — a losing margin — while Haiku 4.5 (~RM0.035/call) stays comfortably under it and is plenty capable for a "return JSON boxes" structured task. Still true under the current pricing (see below): even the cheapest per-token rate (Bulk, RM0.089/token) makes a single Claude call worth ≥RM0.267 in revenue, well above Haiku's cost. **How to apply**: if the vision provider ever changes again, re-run this cost-vs-price comparison against the *lowest* per-token package rate, not the average — it isn't just an accuracy tradeoff.
- **Sourcing examples**: `bbox-web` calls `GET /projects/{id}/images` (transparently proxied through the relay's existing catch-all, unchanged) to list up to 5 already-annotated images with their boxes, fetches each via `GET /projects/{id}/images/{image_id}/file`, downscales everything client-side to ~1024px long side (`utils/image.ts`), then `POST`s target + examples directly to `bbox-relay`'s `/ai-assist` — **not** proxied to `bbox-api`, since the payment/AI logic is relay-side.
- **Wallet**: `bbox-relay/models.py`'s `TokenLedger` is an append-only ledger (`username, delta, reason, payment_ref_id`) — balance is `SUM(delta)`, no separate mutable balance row to drift out of sync. `wallet.py` has the balance/credit/debit helpers; `wallet.TOKEN_PACKAGES` defines the purchasable tiers — **repriced 2026-08-20 to 5 tiers: 100/200/300/500/1000 tokens for RM15/19/29/49/89.** `AI_ASSIST_COST_TOKENS` (3) is the cost of a single Claude call, unchanged since 2026-08-19 — but a from-scratch **"AI Assist" click now costs 6 tokens** (2 chained calls: suggest, then auto-refine — see "Dot-offset refine" below) while a manual **"Improve suggestion" click stays 3 tokens** (1 call). No sub-RM15 tier — see the margin math below.
- **Welcome bonus**: `wallet.ensure_welcome_bonus` grants `WELCOME_BONUS_TOKENS` (default **5**, reduced 2026-08-19 from an initial 20 once the payment-fee margin math below was done — 20 free tokens cost ~RM0.70/signup pure customer-acquisition cost with no revenue, too much once margins got tighter) the first time a username's wallet is ever touched — not tied to bboxAI account registration or relay device pairing (bbox-relay doesn't directly observe either event), just lazily fired from `main.py`'s `_current_username` helper, so it works no matter whether the user's first touch is the Wallet page, the nav balance badge, or hitting AI Assist directly. Idempotent (checks for any existing `TokenLedger` row for that username first). `GET /wallet` additionally returns `welcome_bonus_granted: bool` for *that specific call* so `WalletPage.tsx` can show a one-time "Welcome!" banner — it's `true` only on the call that actually granted it, `false` on every call after.
- **Payment provider: Stripe now, Billplz planned later.** `settings.payment_provider` (`"stripe"` currently) is the single switch `main.py`'s `POST /wallet/topup` and `POST /wallet/topup/webhook` dispatch on. Stripe was chosen as the *starting* provider purely because the Billplz merchant account is still mid-setup, not on cost — Billplz's flat per-transaction fee is cheaper than Stripe's 3%+RM1 at these package sizes (see the margin math below), so **the plan is to switch `PAYMENT_PROVIDER=billplz` once that account is ready**, not stay on Stripe long-term. `models.PaymentOrder` (`provider`, `provider_ref_id`) and `TokenLedger.payment_ref_id` were deliberately named provider-agnostic (not `billplz_*`) from the start so that switch is just flipping the setting plus re-verifying `billplz.py` (already written and tested, currently dormant) — not a schema migration. `stripe_provider.py` mirrors `billplz.py`'s shape (`create_checkout_session`/`create_bill`, `verify_webhook`/`verify_signature`) on purpose.
  - **Stripe implementation**: `stripe_provider.create_checkout_session` uses `stripe.checkout.Session.create_async` (mode=`payment`, one-time — not a subscription) with a dynamically priced line item (`price_data`, no pre-created Stripe Price object, since packages are defined in `wallet.TOKEN_PACKAGES` not Stripe's dashboard) and `metadata={"username", "tokens"}`; `verify_webhook` uses `stripe.Webhook.construct_event` (HMAC-SHA256 over `t=<timestamp>.<payload>`, per Stripe's own scheme, using `STRIPE_WEBHOOK_SECRET`). Payment method types limited to `card` for now (FPX/DuitNow/etc. need a Malaysia-specific Stripe account setup not yet done).
  - **Margin math, why Stripe is a stopgap not the destination**: Stripe MY charges **3% + RM1.00** per transaction; Billplz charges a **flat** ~RM0.75–1.25 regardless of amount. At the 100-token tier (RM15), Stripe's cut is ~RM1.45 (9.7%) vs Billplz's ~RM0.75–1.25 (5–8%); at the 1000-token tier (RM89) it's ~RM3.67 (4.1%) vs ~RM0.75–1.25 (0.8–1.4%) — Billplz wins clearly at every tier. Stripe is only in place because it's available *today* and Billplz isn't yet.
- **Margin math, why there's no sub-RM15 package**: even under Billplz's cheaper flat per-transaction fee (~RM0.75–1.25 depending on account tier), a since-dropped 100-token/RM5 "Starter" tier only netted RM0.25–0.75 margin (5–15%) after that fee and full Claude cost if all 100 tokens got used at the original 1-token-per-call rate (100 calls × ~RM0.035 ≈ RM3.50) — fragile enough that a slightly-larger-than-estimated image or a USD/MYR move could flip it negative. The fix (2026-08-19) was raising `AI_ASSIST_COST_TOKENS` from 1 to 3, which cuts calls-per-package to a third and widened margin comfortably.
  - **Current pricing (repriced 2026-08-20, user's numbers) — 5 tiers, all in a healthy 79–83% margin band under Stripe fees**: `AI_ASSIST_COST_TOKENS` (3) × ~RM0.01167/token in Claude cost (Haiku ≈RM0.035/call ÷ 3 tokens) gives the cost side; Stripe fee is 3%+RM1 per transaction.

    | Tokens | Price | Stripe fee | Claude cost | Margin | RM/token |
    |---|---|---|---|---|---|
    | 100 | RM15 | RM1.45 | RM1.17 | RM12.38 (82.6%) | RM0.150 |
    | 200 | RM19 | RM1.57 | RM2.33 | RM15.10 (79.5%) | RM0.095 |
    | 300 | RM29 | RM1.87 | RM3.50 | RM23.63 (81.5%) | RM0.097 |
    | 500 | RM49 | RM2.47 | RM5.83 | RM40.70 (83.1%) | RM0.098 |
    | 1000 | RM89 | RM3.67 | RM11.67 | RM73.66 (82.8%) | RM0.089 |

    Not a strict volume-discount curve (200 tok is marginally cheaper per-token than 300 or 500 — RM0.095 vs RM0.097/0.098) but margin is healthy and consistent everywhere, so this wasn't corrected. **How to apply**: if a new package tier is ever added, or `AI_ASSIST_COST_TOKENS` changes again, redo this same three-way check (revenue − payment fee of whichever provider is active − full Claude cost of `tokens / AI_ASSIST_COST_TOKENS` calls) before shipping it, especially for anything below ~RM15. Remember the "AI Assist" *click* is 2 calls (6 tokens) — check margin per click, not just per token, if the auto-chain behavior ever changes.
- **Validation loop (2026-08-19)**: `bbox-web`'s `AnnotatePage.tsx` tags each AI-suggested box with a client-only `_aiId` at suggestion time and keeps a snapshot of its original `{x,y,w,h,class_id}` (`aiSnapshotRef`, keyed by `_aiId`) separate from the live `boxes` state — needed because a deleted box just disappears from `boxes`, so only the snapshot still knows it existed. On commit, each snapshot id is classified against the final saved boxes: **accepted** (still present, unchanged within a small epsilon), **edited** (still present, coordinates/class differ), or **deleted** (id no longer present) — then posted as aggregate counts (not per-box, no coordinates) to `bbox-relay`'s `POST /ai-assist/feedback`, best-effort and non-blocking. `GET /ai-assist/feedback/summary` (optionally filtered by `project_id`) returns the caller's aggregate accept rate. This is deliberately the coarse half of a two-loop design the user proposed — a **correction loop** (capturing the actual before/after diff to curate or rank few-shot examples) is scoped but not built; validation was built first since it's useful standalone (an accuracy trend metric) even without changing how examples are selected. **How to apply**: if the correction loop is ever built, it needs real per-box diff data, not just these aggregate counts — extend `AiAssistFeedback` rather than repurposing it, since the aggregate rows here don't carry enough to reconstruct individual corrections.
- **In-session refine, "Improve suggestion" (2026-08-19, mechanism replaced 2026-08-20)**: the same AI Assist button does double duty — with no boxes yet on the frame it starts/restarts the per-frame batch-suggest flow; once the frame has boxes (AI-suggested and/or hand-edited), clicking it again re-runs `POST /ai-assist` for just that frame with the current boxes attached as `current_boxes`, relabelled "Improve suggestion". The button is no longer disabled while `aiBatchActive` (that gate exists to stop double-firing the *auto* per-frame suggestion, not to block this manual re-click). Each refine replaces `aiSnapshotRef` wholesale with the new suggestion's snapshot, so the validation loop above always grades the *latest* suggestion shown.
- **Dot-offset refine, replacing grid+absolute-coordinates (2026-08-20)**: three separate attempts at improving absolute-coordinate accuracy for refine — denser/interior-labeled grid lines, a chain-of-thought reasoning pass before the JSON, and drawing the current boxes as rectangles on the grid-overlaid image — were each shipped, deployed, and tested live, and all three failed the same way on a dense multi-well tray (~50 near-identical circular wells): boxes landed roughly one cell off, consistently. Root cause understood as a general VLM limitation, not a prompting depth problem — confirmed when the chain-of-thought change produced a *pixel-identical* result to before it, on a real re-test. The fix: stop asking for absolute coordinates in refine at all. `ai_assist.py`'s `refine_with_dots()` (replacing the old grid+`refine_note` logic inside `suggest_boxes`) sends the target image with **no grid**, just a small numbered dot at each current box's center (`image.ts`'s `drawDotsOverlay`/`DotOverlay`, replacing the old `drawBoxesOverlay`/`BoxOverlay`), and asks Claude for a **relative** judgment per dot only — direction and rough distance as a *fraction of that box's own width/height* (e.g. `dx=-0.5` = half a box-width left), or `{"remove": true}` for a spurious box — never a fresh absolute coordinate. The arithmetic (`new_x = old_x + dx*old_w`) happens in `_apply_dot_offsets()`, not the model. `suggest_boxes()` keeps the grid+chain-of-thought technique for finding boxes **from scratch** only (no `current_boxes` param anymore) — that's still the right job for absolute coordinates, since there's nothing to anchor a relative judgment to yet. Verified live: re-tested on the exact tray frame that beat all three prior attempts — every box landed tightly and precisely on its real well, first try. **General lesson, worth defaulting to next time**: VLMs are far more reliable at relative spatial judgments ("which way, how far, relative to X") than absolute coordinate regression, especially on dense/repetitive scenes.
- **"AI Assist" now auto-chains one refine pass (2026-08-20)**: a from-scratch suggestion no longer shows the user raw first-pass boxes — `AnnotatePage.tsx`'s `runAiAssist` immediately (no extra click) sends the result through one `refine_with_dots` pass before rendering anything, covering the added wait with an extra `AI_PROGRESS_STAGES` message. If the correction call fails (balance, transient API error), it falls back to the uncorrected first-pass boxes rather than losing the suggestion or erroring the whole click. This is why a single "AI Assist" click costs 6 tokens (2 calls) while "Improve suggestion" stays 3 tokens (1 call) — see the margin math above; no new pricing tier was needed since it's just 2 standard debits back to back.
- **`POST /ai-assist`**: bearer-auth like the catch-all proxy (`_current_username`, extracted from the same device-id-decode pattern), checks balance ≥ `AI_ASSIST_COST_TOKENS` (3), then routes to `ai_assist.suggest_boxes` (no `current_boxes` in the request — from-scratch, grid-based) or `ai_assist.refine_with_dots` (`current_boxes` present — dot-offset correction), debits **only on success** so a failed call never costs tokens, and returns the parsed boxes. A per-username in-memory rate limit (150 calls / 10 min, raised from 20 once batch mode's real per-frame call volume was observed) guards against runaway spend from a client bug.
- **Config** (`bbox-relay/.env`): `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-haiku-4-5`), `PAYMENT_PROVIDER` (`stripe`|`billplz`), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BILLPLZ_API_KEY`, `BILLPLZ_COLLECTION_ID`, `BILLPLZ_X_SIGNATURE_KEY`, `BILLPLZ_BASE_URL` (kept configured but unused while `PAYMENT_PROVIDER=stripe`), `WEB_APP_URL` (used to build the active provider's redirect/success/cancel URLs back into `bbox-web`'s `/wallet` page).
- **Known gap, `Upload` DB model is unused**: `bbox-api`'s `list_images`/`get_image_file` read committed images straight off disk (`images/{id}{ext}` + `labels/{id}.txt`) rather than querying the `Upload` table, because nothing in `bbox-api` ever actually inserts `Upload` rows (the model exists in `models.py` but is dead code) — discovered while building this feature. Not fixed as part of this feature (out of scope), just worked around; worth cleaning up (either wire up `Upload` inserts, or remove the unused model) next time this area is touched.

### Detailed Report Paywall (monetization #2, bboxai-remote only, added 2026-08-20)

The second paid feature: the training report (`services/report.py`) always existed as one free download; this adds a **paid detailed tier** on top, one-time-unlockable per training run. Same architecture split as AI-Assist Tokens — `bbox-api` stays payment-unaware and defaults to the free/brief tier for any caller that doesn't explicitly ask otherwise, so self-hosted/desktop users only ever get the free tier; the full detailed report is exclusive to `bboxai-remote`'s paid unlock, which lives entirely in `bbox-relay`. (Corrected 2026-08-20, later the same day this shipped — it briefly defaulted to serving the full report free on desktop too, which defeated the point of the paywall; a desktop user could just get everything for free locally.)

- **Report is now 4 explicit pages, not one continuous flow.** The pre-2026-08-20 report had no `PageBreak()`s at all — ReportLab just flowed content wherever it landed. `generate(project, stats, training_status, tier="free"|"paid")` now builds: **page 1** (project info + dataset statistics), **page 2 — paid tier only, doesn't exist in the free tier at all** (per-epoch metrics table from `results.csv`, per-class precision/recall/AP@50, training hyperparameters/config), **page 3** (headline metrics table + training-curve chart + confusion matrix), **page 4** (validation sample images, ground truth vs. predictions). Free tier gets a diagonal "bboxAI — FREE REPORT" watermark stamped on every page via a ReportLab `onPage` canvas callback; paid has none.
- **Per-class metrics didn't exist anywhere and had to be computed on demand.** `trainer.py` only ever saved dataset-wide aggregate metrics (`metrics/mAP50(B)` etc., the last row of `results.csv`) — no per-class breakdown was captured during training. `report.py`'s `_per_class_metrics()` re-runs `YOLO(best.pt).val(data=..., plots=False)` fresh at report-generation time instead (`val.box.p`/`.r`/`.ap50`/`.ap_class_index`, the real Ultralytics `DetMetrics`/`Metric` API, confirmed by inspecting the installed package directly rather than guessing) — a few seconds of extra inference, not a retrain, and it works retroactively on any already-trained run since nothing needs to have been captured in advance.
- **Both tiers are pre-generated once, right after training, and cached to disk** (`report.pdf` + `report_free.pdf`, `trainer.py`'s `_generate_report` calls `rpt.generate()` twice) rather than rendered per download request — the per-class re-validation pass is the expensive part, and it only needs to run once per training run, not once per download.
- **Pricing has no cost floor, unlike AI-assist tokens.** This is pure local PDF generation — zero external API cost, so margin is ~100% minus payment fees at any price; it's a value call, not cost-anchored. Settled on **20 tokens, flat, one-time per training run** (not per download, not a repeated per-click meter like AI Assist).
- **Unlock is keyed to the training run's identity, not the project.** A project can be retrained, which overwrites `report.pdf`/`report_free.pdf` in place (single fixed path per project) — so paying to unlock run A must not silently also cover a later run B on the same project. `bbox-relay/models.py`'s `ReportUnlock(username, project_id, run_key, unlocked_at)` — `run_key` is the training run's `finished_at` timestamp from `bbox-api`'s `training_status.json`, fetched live through the existing tunnel (`tunnel.forward`) each time unlock status is checked, not cached relay-side.
- **Three new `bbox-relay` routes**, registered ahead of the catch-all proxy so they intercept `GET /projects/{id}/report` instead of it falling through to the generic tunnel forward: `GET .../report/status` (returns `{training_done, unlocked, cost}` for the *current* run), `POST .../report/unlock` (checks balance ≥ `report_unlock_cost_tokens` (20), debits, records the unlock — idempotent, a second call for an already-unlocked run just returns `already_unlocked: true` with no charge), and `GET .../report` itself (decides `tier=free` or `tier=paid` based on unlock status for the current run, then proxies to `bbox-api` accordingly).
- **`bbox-api`'s own default is `tier=free`**: `GET /projects/{id}/report` defaults to the brief/watermarked tier — a local/desktop caller that never passes `tier` gets the free report, period, matching the free tier's original always-available report. Only `bbox-relay`'s report-unlock flow ever explicitly requests `tier=paid`, and only after confirming a real unlock for the current run. `bbox-web`'s local (non-remote) build only ever calls this endpoint with `tier=free` explicitly — there is no "download full report" affordance on desktop at all, by design.
- **`bbox-web`**: `TrainPage.tsx`, remote build only (`IS_REMOTE` gate) — "Download free report" always shown; next to it, either "Unlock detailed report (N tokens)" or (once `GET .../report/status` reports `unlocked: true`) "Download detailed report", fetched once `status.state === "done"`.

Verified fully live on a real training run (`ZainalArsat`'s Jetson-backed "soil" project, retrained to regenerate both tiers since the pre-existing report predated this feature): free download 200s, unlock debits exactly 20 tokens (595→575 balance), button switches to the no-charge re-download state post-unlock, re-download doesn't re-charge. Deployed to VM202 (`bbox-relay` + rebuilt `bboxai-remote`), the Jetson's `bbox-api`, and the Windows box's `bbox-api` (all three `bbox-api` instances — the AI-assist rollout once forgot this and shipped a "button stays grey" bug, avoided this time by deploying to all three up front).

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
