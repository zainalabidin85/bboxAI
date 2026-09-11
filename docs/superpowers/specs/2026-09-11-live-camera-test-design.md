# On-device live camera model test — design spec

**Date:** 2026-09-11
**Status:** approved for implementation planning

## Summary

A new bboxai-remote-only feature: let a user point their phone's camera at
the real world and see their trained model's detections overlaid live, with
inference running entirely in the phone's browser (WebAssembly/WebGPU via
`onnxruntime-web`) — no server round-trip per frame, no per-frame token
cost. This is architecturally distinct from the "live camera streaming"
feature rejected on 2026-08-20 (server-side inference over a streamed feed —
laggy, and metering tokens for it felt cheap). Here the camera frame never
leaves the phone.

## Feasibility spike (completed 2026-09-11)

Exported a YOLOv8n `.pt` to ONNX (opset 12, imgsz 320, simplified) with the
existing `ultralytics` install in `bbox-api`'s venv (needed a
`torch.load(weights_only=False)` patch — the installed torch 2.6 defaults to
`weights_only=True`, which real production code must also account for).
Deployed a throwaway static page (`onnxruntime-web` off jsdelivr, canvas
letterbox preprocessing, manual YOLO output decode + NMS in JS) to a
disposable path under `bboxai-remote.unitani.com`'s existing nginx site, and
tested on a real Android Chrome phone.

Results:
- CPU-only WASM, 640px input: **~2 FPS**
- WebGPU, 320px input, cross-origin-isolated multi-threaded WASM available
  as fallback: **~15 FPS**, comfortably above the 5–8 FPS bar set for
  "worth shipping"
- iOS Safari WebGPU support is untested here and known to be patchy —
  expect a WASM fallback there, likely slower. Not blocking for v1 (silent
  fallback, no warning — see Decisions below).

Everything from the spike was torn down after — this spec describes the
real implementation from scratch, not a promotion of the spike's code.

## Decisions made during brainstorming

- **Availability:** bboxai-remote only (web), not the desktop/self-hosted
  build, not the Flutter app. Chosen for monetization, not a technical
  necessity — the mechanism works anywhere, but this project's only two
  paid features so far (AI-assist, report unlock) are both remote-exclusive,
  and the user wants this feature paid.
- **Pricing model:** first-ever live-test unlock, on any project, for a
  given account, is **free** (one lifetime trial). Every unlock after that
  costs **50 tokens flat**, regardless of which project.
- **Unlock scope:** per training run, identically to the report-unlock
  paywall — keyed to `training_status.json`'s `finished_at`. Retraining a
  project invalidates the previous unlock; testing the new run needs a
  fresh unlock (free-trial only applies once ever, not once per run).
- **UI entry point:** a new card on `TrainPage.tsx`, placed directly after
  the existing `TestModelCard` (static-image test, already free and
  available on both builds).
- **iOS/WebGPU fallback:** silent, no upfront warning banner. Revisit if
  real user complaints come in.

## Architecture

Same split as every other bboxAI monetized feature: `bbox-api` stays
payment-unaware and free/self-hostable; all wallet/unlock logic lives in
`bbox-relay` (private repo).

```
┌─────────────┐   1. train finishes    ┌─────────────┐
│  bbox-api   │───────────────────────▶│ model.onnx  │  cached to disk,
│  trainer.py │   exports ONNX too     │  on disk    │  alongside best.pt
└─────────────┘                        └─────────────┘

┌──────────────┐  2. GET .../live-test/status   ┌─────────────┐
│ bbox-web     │───────────────────────────────▶│ bbox-relay  │
│ TrainPage    │◀───{training_done,unlocked,cost}└─────────────┘
└──────────────┘

┌──────────────┐  3. POST .../live-test/unlock  ┌─────────────┐
│ bbox-web     │───────────────────────────────▶│ bbox-relay  │
│ LiveTestCard │◀────── debits wallet ───────────└─────────────┘

┌──────────────┐  4. GET .../weights/download-onnx (proxied)
│ bbox-web     │───────────────────────────────▶ bbox-relay ──▶ bbox-api
│ LiveTestPage │◀──────────────── model.onnx bytes ─────────────┘
└──────┬───────┘
       │ 5. everything below is 100% client-side, no more network calls
       ▼
┌──────────────────────────────┐
│ onnxruntime-web (WebGPU/WASM)│
│ + phone camera (getUserMedia)│
└──────────────────────────────┘
```

## Component 1: `bbox-api` — ONNX export

**What it does:** produces a browser-runnable copy of a project's trained
model, once per training run, cached to disk.

**Changes:**
- `requirements.txt`: add `onnx`, `onnxslim` (matches what the export step
  needs; `onnxruntime` itself is not needed server-side, only the exporter).
- `services/trainer.py`: in the existing post-training success path (where
  `best.pt` is copied and both report tiers are generated), add one more
  step — `YOLO(best_pt_path).export(format="onnx", opset=12, imgsz=320,
  simplify=True)`, then move the resulting file to
  `storage/projects/{id}/weights/model.onnx`. Wrapped in the same
  try/except-and-swallow pattern already used for report generation, so an
  export failure can never crash the training thread. `imgsz=320` is fixed
  (not the user's training `imgsz`) — that's what the spike measured, and
  bigger inputs are the direct cost driver for phone FPS.
- `routers/training.py`: new endpoint `GET /projects/{id}/weights/download-onnx`,
  directly modeled on the existing `GET /projects/{id}/weights/download`
  (owner-only via `_require_owner`, `FileResponse`, 404 if `model.onnx`
  doesn't exist yet for this project).

**What it does *not* do:** no tiering, no auth beyond ownership, no
awareness of tokens or unlocks — same boundary every other bbox-api
endpoint respects.

## Component 2: `bbox-relay` — unlock gating (private repo, described here for the record)

**New model**, `models.py`:
```
LiveTestUnlock(username, project_id, run_key, unlocked_at, was_free_trial)
```
Directly parallel to `ReportUnlock`, with one added field to record whether
a given unlock consumed the lifetime free trial (for support/debugging
visibility — the cost calculation itself is derived, not stored, by
querying for any prior row).

**New routes**, registered ahead of the catch-all proxy (same reason the
report routes are — so they intercept these specific paths instead of
falling through to the generic tunnel forward):

- `GET /projects/{id}/live-test/status` → fetches the current run's
  `finished_at` from `bbox-api` through the tunnel (`training_status.json`,
  same call pattern as report status), checks for a matching
  `LiveTestUnlock` row, and computes `cost`: `0` if this username has zero
  `LiveTestUnlock` rows total (free trial still available), else `50`.
  Returns `{training_done, unlocked, cost}`.
- `POST /projects/{id}/live-test/unlock` → re-checks balance ≥ `cost`
  (skipped entirely when `cost == 0`), debits (skipped when `cost == 0`),
  records the `LiveTestUnlock` row (`was_free_trial = cost == 0`). Idempotent
  per run like report unlock — a second call for an already-unlocked run
  returns `already_unlocked: true`, no charge.
- `GET /projects/{id}/weights/download-onnx` → checks unlock status for the
  current run; if unlocked, proxies to `bbox-api`'s new endpoint via
  `tunnel.forward`; if not, 402.

**Config:** no new settings needed — reuses the existing tunnel/auth
plumbing. `report_unlock_cost_tokens` becomes the pattern for a new
`live_test_unlock_cost_tokens = 50` constant.

## Component 3: `bbox-web` — UI (remote build only)

**`TrainPage.tsx`:** add a `<LiveTestCard projectId={id} />` render,
positioned directly after the existing `<TestModelCard projectId={id} />`,
gated the same way the report-unlock UI already is (`IS_REMOTE && id &&
status?.state === "done"`). Fetches `live-test/status` on mount (same
`useEffect` shape as `reportStatus`).

**New `components/LiveTestCard.tsx`:** small card matching the visual
pattern of the report-unlock button block in `TrainPage.tsx` — shows "Try
live test free" when `cost === 0`, "Unlock live test (50 tokens)" when
`cost === 50` and not yet unlocked, or "Open live test" (a `Link` to the new
route) once `unlocked === true`. Calling unlock follows the exact shape of
the existing `onUnlockReport` handler: call the API, update the nav wallet
balance from the response, flip local unlocked state, surface errors
without charging on failure.

**New route** `/projects/:id/live-test` → `pages/LiveTestPage.tsx`, added to
`App.tsx` inside the existing `ProtectedRoute` tree, remote-only (`IS_REMOTE
&& <Route .../>` like the other remote-only routes).

**`pages/LiveTestPage.tsx`:** full-screen camera view, structurally similar
to the existing camera capture flow (`getUserMedia`, `<video>` +
overlay `<canvas>`). On mount: fetches the project's class list (existing
`GET /projects/{id}` call, already used elsewhere — no new endpoint needed
for this), downloads `model.onnx` via the relay-proxied endpoint (one-time
per page visit — no client-side caching across visits in v1, YAGNI), then
starts the detection loop. Shows a simple status line while loading
("Requesting camera…" / "Loading model…") and lets the user navigate back
at any time (standard back button/link, no special teardown beyond
releasing the camera stream, same as the existing camera flow already does
elsewhere in the app).

**New `utils/liveInference.ts`:** isolated, testable-in-isolation module —
no React, no DOM assumptions beyond an `HTMLVideoElement` and canvas
contexts passed in. Exposes roughly:
- `loadSession(onnxBytes): Promise<Session>` — tries `webgpu`, falls back to
  `wasm` silently, returns which EP was used (for an optional debug HUD,
  not user-facing copy).
- `detectFrame(session, videoEl, classNames): Detection[]` — one call per
  animation frame: letterbox-preprocess into a 320×320 offscreen canvas,
  run the session, decode the YOLO output tensor, run NMS, return boxes in
  video-pixel coordinates. Ported directly from the spike's proven
  implementation (letterbox math, output decode, NMS) rather than
  redesigned — that code was measured working at 15 FPS.

Drawing the boxes onto the overlay canvas is the page's own concern (reuses
existing box-drawing conventions from `BBoxCanvas.tsx`'s class-color
palette, `classColor()`), not part of the inference module — keeps
`liveInference.ts` free of any rendering/styling decisions.

## Error handling

| Case | Behavior |
|---|---|
| Camera permission denied | Inline error message on `LiveTestPage`, no crash, link back to project |
| Model download fails (network) | Error message with a retry button; no charge already happened (unlock and download are separate steps) |
| Unlock call fails (insufficient balance / transient error) | Same pattern as `onUnlockReport` — error shown, wallet balance untouched, card stays in "locked" state |
| Training not done | Card doesn't render at all — same gate as `TestModelCard`'s implicit dependency on a finished run |
| `model.onnx` missing server-side (export failed silently during training) | `download-onnx` 404s; `LiveTestPage` shows a clear error rather than hanging, distinct from the network-failure message |
| Project retrained after a previous unlock | `live-test/status` naturally reports `unlocked: false` for the new `run_key` — same mechanic as reports, no special-casing needed |

## Testing

- `bbox-api`: unit test for the new export step (mock/small training run
  asserts `model.onnx` appears alongside `best.pt`) and for
  `weights/download-onnx` (owner-only 200, non-owner 403, missing-file 404),
  following existing test patterns in that suite.
- `bbox-relay`: not in this checkout to write tests against directly. The
  new routes and `LiveTestUnlock` model should mirror `ReportUnlock`'s
  already-tested shape closely enough to reuse its test structure when
  implemented in that repo. Real verification happens live on VM202 (and
  the Jetson/Windows `bbox-api` instances, since the export step needs
  deploying to all of them, not just the relay — remember the AI-assist
  rollout's "forgot to deploy everywhere" bug from
  `[[project_ai_assist_tokens]]`).
- `bbox-web`: manual verification on a real Android Chrome phone against
  VM202 (repeat the spike's FPS measurement against the real feature, not
  just the throwaway page) and ideally one iOS device to see the actual
  WASM-fallback numbers, even though no UI change is planned in response.

## Out of scope (v1)

- Client-side caching of the downloaded ONNX model across page visits
  (IndexedDB) — re-download each time is acceptable for v1; a few MB, one
  time per session.
- Any UI difference for iOS/non-WebGPU devices beyond the fallback itself.
- Flutter app support.
- Desktop/self-hosted build support (mechanism works there too, but gated
  off for monetization reasons per the brainstorming decision).
