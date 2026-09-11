# On-Device Live Camera Model Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a bboxai-remote user point their phone's camera at the real world and see their trained model detect objects live, entirely on-device (no per-frame server calls, no per-frame tokens), gated behind a one-time-free-then-50-token-per-training-run unlock.

**Architecture:** `bbox-api` gains a one-time-per-training-run ONNX export (cached to disk, same pattern as the existing PDF report) and a plain owner-gated download endpoint for it — payment-unaware, like every other bbox-api endpoint. All wallet/unlock logic lives in `bbox-relay` (private repo, not in this checkout — described here as a handoff task list, not code). `bbox-web` gets a new unlock card on `TrainPage.tsx` and a new full-screen camera page that runs `onnxruntime-web` (WebGPU, falling back to WASM) against the phone camera feed client-side.

**Tech Stack:** Python/FastAPI/SQLAlchemy/ultralytics (bbox-api), React/TypeScript/Vite/axios (bbox-web), onnxruntime-web (new bbox-web dependency), pytest + FastAPI TestClient (new bbox-api test infra — none existed before this plan).

**Spec:** `docs/superpowers/specs/2026-09-11-live-camera-test-design.md`

## Global Constraints

- ONNX export is fixed at `imgsz=320`, `opset=12`, `simplify=True` — this is what the feasibility spike measured (15 FPS on Android Chrome/WebGPU); do not use the project's own training `imgsz`.
- bbox-api stays fully payment-unaware. No tokens, no unlock checks, no `bbox-relay` awareness anywhere in `bbox-api` code.
- The live-test feature is remote-build-only (`IS_REMOTE`) in `bbox-web` — no route, card, or nav entry should be reachable on the desktop/self-hosted build.
- Pricing/unlock semantics (defined in `bbox-relay`, described not implemented here): first-ever unlock for an account, on any project, is free; every unlock after that costs 50 tokens; unlock is scoped to a training run's `finished_at`, so retraining invalidates a prior unlock — all identical in shape to the existing `ReportUnlock` mechanism.
- No frontend test framework exists in this repo (`bbox-web/package.json` has no vitest/jest/testing-library) — frontend tasks are verified via `npm run build` (the existing `tsc -b && vite build` script) plus manual browser/phone checks, not fabricated unit tests. `bbox-api` has no test suite either; Task 1 introduces a minimal pytest + FastAPI TestClient setup, reused by Task 2.

---

## Task 1: bbox-api — pytest infra + ONNX export step in `trainer.py`

**Files:**
- Create: `bbox-api/requirements-dev.txt`
- Create: `bbox-api/pytest.ini`
- Create: `bbox-api/tests/__init__.py` (empty)
- Create: `bbox-api/tests/conftest.py`
- Create: `bbox-api/tests/test_trainer_onnx_export.py`
- Modify: `bbox-api/requirements.txt`
- Modify: `bbox-api/services/trainer.py`

**Interfaces:**
- Produces: `services.trainer._export_onnx(project_id: str, status: dict) -> None` — reads `status["state"]`, does nothing unless `"done"`; loads `weights/best.pt` for the project, exports to ONNX, writes the result to `weights/model.onnx` in the project's storage dir. Never raises (matches `_generate_report`/`_record_trained_model`'s swallow-on-failure convention already in this file). Called from `_run_training`'s `finally` block.
- Produces (test infra, reused by Task 2): `tests/conftest.py` fixtures `client` (a `fastapi.testclient.TestClient` wrapping the real `main.app`, pointed at a temp SQLite DB and temp storage/weights dirs via env vars set before any `bbox-api` module import) and `make_user_and_token()` (a fixture factory returning `(User, token: str)` — call it once per test user needed, since a test may need two users to check ownership).

- [ ] **Step 1: Add test dependencies**

Create `bbox-api/requirements-dev.txt`:

```
pytest==8.3.3
httpx==0.27.2
```

(`httpx` is required by Starlette's `TestClient` — FastAPI 0.111 doesn't vendor it.)

- [ ] **Step 2: Add ONNX export dependencies to the real requirements**

In `bbox-api/requirements.txt`, add two lines (after `ultralytics==8.3.253`, since they're only needed for the export path that `ultralytics` also uses):

```
onnx==1.17.0
onnxslim==0.1.34
```

- [ ] **Step 3: Add pytest config so `bbox-api`'s bare module imports work under pytest**

Create `bbox-api/pytest.ini`:

```ini
[pytest]
pythonpath = .
testpaths = tests
```

(`bbox-api`'s modules use bare imports like `from config import settings`, not package-relative ones — `uvicorn main:app` works because it's run from inside `bbox-api/`; `pythonpath = .` makes pytest resolve the same way when run from that directory.)

- [ ] **Step 4: Write the test fixtures**

Create `bbox-api/tests/__init__.py` (empty file — makes `tests` an importable package, harmless either way with the `pythonpath` setting above but keeps `pytest.ini`'s `testpaths` unambiguous).

Create `bbox-api/tests/conftest.py`:

```python
import os
import tempfile

_TEST_DIR = tempfile.mkdtemp(prefix="bboxai-test-")
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DIR}/test.db"
os.environ["STORAGE_PATH"] = os.path.join(_TEST_DIR, "storage")
os.environ["WEIGHTS_PATH"] = os.path.join(_TEST_DIR, "weights")

import pytest
from fastapi.testclient import TestClient

import main  # noqa: E402 — must import after the env vars above are set
from auth import create_access_token, hash_password
from database import SessionLocal
from models import User


@pytest.fixture()
def client():
    return TestClient(main.app)


@pytest.fixture()
def make_user_and_token():
    counter = {"n": 0}

    def _make():
        counter["n"] += 1
        db = SessionLocal()
        try:
            user = User(
                username=f"tester{counter['n']}",
                email=f"tester{counter['n']}@example.com",
                password_hash=hash_password("pw"),
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            token = create_access_token(user.id)
            return user, token
        finally:
            db.close()

    return _make
```

- [ ] **Step 5: Write the failing test for `_export_onnx`**

Create `bbox-api/tests/test_trainer_onnx_export.py`:

```python
import os
from unittest.mock import MagicMock, patch

from services import trainer


def _write(path: str, content: bytes = b"fake-weights"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(content)


def test_export_onnx_moves_exported_file_into_weights_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(trainer, "PROJECTS_DIR", str(tmp_path))

    project_id = "proj123"
    best_pt = os.path.join(tmp_path, project_id, "weights", "best.pt")
    _write(best_pt)

    # ultralytics writes its export next to best.pt by default; simulate that.
    fake_export_path = os.path.join(tmp_path, project_id, "weights", "best.onnx")
    _write(fake_export_path, b"fake-onnx-bytes")

    mock_model = MagicMock()
    mock_model.export.return_value = fake_export_path

    with patch("ultralytics.YOLO", return_value=mock_model) as mock_yolo_cls:
        trainer._export_onnx(project_id, {"state": "done"})

    mock_yolo_cls.assert_called_once_with(best_pt)
    mock_model.export.assert_called_once_with(format="onnx", opset=12, imgsz=320, simplify=True)

    dest = os.path.join(tmp_path, project_id, "weights", "model.onnx")
    assert os.path.exists(dest)
    with open(dest, "rb") as f:
        assert f.read() == b"fake-onnx-bytes"
    assert not os.path.exists(fake_export_path)  # moved, not copied


def test_export_onnx_does_nothing_when_training_did_not_succeed(tmp_path, monkeypatch):
    monkeypatch.setattr(trainer, "PROJECTS_DIR", str(tmp_path))
    project_id = "proj456"
    _write(os.path.join(tmp_path, project_id, "weights", "best.pt"))

    with patch("ultralytics.YOLO") as mock_yolo_cls:
        trainer._export_onnx(project_id, {"state": "failed"})

    mock_yolo_cls.assert_not_called()
    dest = os.path.join(tmp_path, project_id, "weights", "model.onnx")
    assert not os.path.exists(dest)


def test_export_onnx_swallows_export_errors(tmp_path, monkeypatch):
    monkeypatch.setattr(trainer, "PROJECTS_DIR", str(tmp_path))
    project_id = "proj789"
    _write(os.path.join(tmp_path, project_id, "weights", "best.pt"))

    mock_model = MagicMock()
    mock_model.export.side_effect = RuntimeError("export blew up")

    with patch("ultralytics.YOLO", return_value=mock_model):
        trainer._export_onnx(project_id, {"state": "done"})  # must not raise
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `cd bbox-api && pip install -r requirements-dev.txt && python -m pytest tests/test_trainer_onnx_export.py -v`
Expected: `AttributeError: module 'services.trainer' has no attribute '_export_onnx'` (or similar) on all three tests.

- [ ] **Step 7: Implement `_export_onnx` in `trainer.py`**

In `bbox-api/services/trainer.py`, add this function after `_record_trained_model` (which it mirrors) and before `_generate_report`:

```python
def _export_onnx(project_id: str, status: dict):
    # Runs once per successful training run, right after best.pt is
    # deployed — produces a browser-runnable copy of the model for the
    # on-device "test on live camera" feature (bboxai-remote only; the
    # paywall around it lives entirely in bbox-relay, not here). Fixed
    # imgsz=320 regardless of the project's own training imgsz — that's
    # the size the feasibility spike measured working at usable FPS on a
    # phone. Failure here must never crash the training thread, same
    # convention as _generate_report/_record_trained_model below.
    if status.get("state") != "done":
        return
    try:
        from ultralytics import YOLO

        deploy_dir = _proj(project_id, "weights")
        best_pt = os.path.join(deploy_dir, "best.pt")
        if not os.path.exists(best_pt):
            return

        model = YOLO(best_pt)
        exported_path = model.export(format="onnx", opset=12, imgsz=320, simplify=True)

        dest = os.path.join(deploy_dir, "model.onnx")
        if exported_path and os.path.abspath(exported_path) != os.path.abspath(dest):
            shutil.move(exported_path, dest)
    except Exception:
        pass  # ONNX export failure must never crash the training thread
```

Then wire it into `_run_training`'s `finally` block (currently calls `_generate_report` then `_record_trained_model`) — add the new call between them:

```python
    finally:
        with _cancel_mutex:
            _cancel_flags.discard(project_id)
        _write_status(project_id, status)
        _generate_report(project_id, status)
        _export_onnx(project_id, status)
        _record_trained_model(project_id, status)
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd bbox-api && python -m pytest tests/test_trainer_onnx_export.py -v`
Expected: all 3 tests PASS.

- [ ] **Step 9: Commit**

```bash
cd bbox-api
git add requirements.txt requirements-dev.txt pytest.ini tests/ services/trainer.py
git commit -m "bbox-api: export trained model to ONNX after training

Adds a per-training-run ONNX export (imgsz=320, opset=12, simplified)
cached to weights/model.onnx alongside best.pt, following the same
generate-once-after-training pattern as the PDF report. Feeds the new
on-device live-camera-test feature (bboxai-remote only) — bbox-api
itself stays payment-unaware, same as every other endpoint here.

Also introduces bbox-api's first pytest setup (TestClient + temp
SQLite, reused by the next commit's endpoint test).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Gv1siJTsvVPmUxgaVWdCew"
```

---

## Task 2: bbox-api — `GET /projects/{id}/weights/download-onnx` endpoint

**Files:**
- Modify: `bbox-api/routers/training.py`
- Create: `bbox-api/tests/test_download_onnx.py`

**Interfaces:**
- Consumes: `tests/conftest.py`'s `client` and `make_user_and_token` fixtures (Task 1). `config.PROJECTS_DIR` (already imported in `training.py`). `routers.projects._require_owner(project: Project, user: User)` (already imported in `training.py`).
- Produces: `GET /projects/{project_id}/weights/download-onnx` — 200 with the ONNX file bytes for the project owner when `weights/model.onnx` exists, 403 for a non-owner, 404 when the file doesn't exist yet (mirrors the existing `weights/download` endpoint's 404 behavior for a missing `best.pt`).

- [ ] **Step 1: Write the failing tests**

Create `bbox-api/tests/test_download_onnx.py`:

```python
import os

from config import PROJECTS_DIR


def _create_project(client, token):
    resp = client.post(
        "/projects",
        json={"name": "Onnx Test Project", "classes": ["thing"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def test_download_onnx_returns_404_before_export_exists(client, make_user_and_token):
    _, token = make_user_and_token()
    project_id = _create_project(client, token)

    resp = client.get(
        f"/projects/{project_id}/weights/download-onnx",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


def test_download_onnx_returns_file_for_owner(client, make_user_and_token):
    _, token = make_user_and_token()
    project_id = _create_project(client, token)

    onnx_path = os.path.join(PROJECTS_DIR, project_id, "weights", "model.onnx")
    os.makedirs(os.path.dirname(onnx_path), exist_ok=True)
    with open(onnx_path, "wb") as f:
        f.write(b"fake-onnx-bytes")

    resp = client.get(
        f"/projects/{project_id}/weights/download-onnx",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.content == b"fake-onnx-bytes"


def test_download_onnx_forbidden_for_non_owner(client, make_user_and_token):
    _, owner_token = make_user_and_token()
    project_id = _create_project(client, owner_token)

    onnx_path = os.path.join(PROJECTS_DIR, project_id, "weights", "model.onnx")
    os.makedirs(os.path.dirname(onnx_path), exist_ok=True)
    with open(onnx_path, "wb") as f:
        f.write(b"fake-onnx-bytes")

    _, other_token = make_user_and_token()
    resp = client.get(
        f"/projects/{project_id}/weights/download-onnx",
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert resp.status_code == 403
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd bbox-api && python -m pytest tests/test_download_onnx.py -v`
Expected: all 3 FAIL with 404 (route doesn't exist yet).

- [ ] **Step 3: Implement the endpoint**

In `bbox-api/routers/training.py`, add this directly after the existing `download_model` function (around line 335, right after its `return FileResponse(...)` line):

```python
@router.get("/{project_id}/weights/download-onnx")
def download_model_onnx(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project_row = db.query(Project).filter(Project.id == project_id).first()
    if not project_row:
        raise HTTPException(status_code=404, detail="Project not found.")
    _require_owner(project_row, current_user)

    model_path = os.path.join(PROJECTS_DIR, project_id, "weights", "model.onnx")
    if not os.path.exists(model_path):
        raise HTTPException(status_code=404, detail="ONNX model not available. Complete training first.")
    filename = f"bboxai_{project_row.name.replace(' ', '_')}_model.onnx"
    return FileResponse(model_path, media_type="application/octet-stream", filename=filename)
```

(Unlike the existing `download_model` right above it — which only calls `_load_project` and has no owner check, an existing gap in that older endpoint — this new one correctly enforces `_require_owner`, matching most other project-scoped endpoints such as `delete_project`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd bbox-api && python -m pytest tests/ -v`
Expected: all tests in the suite PASS (Task 1's 3 + this task's 3 = 6 total).

- [ ] **Step 5: Commit**

```bash
cd bbox-api
git add routers/training.py tests/test_download_onnx.py
git commit -m "bbox-api: add GET /projects/{id}/weights/download-onnx

Owner-gated download of the ONNX export produced by the previous
commit's training step, mirroring the existing weights/download (.pt)
endpoint's shape. Unlike that one, this correctly enforces
_require_owner rather than leaving the project readable by anyone
with the id.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Gv1siJTsvVPmUxgaVWdCew"
```

---

## Task 3: bbox-relay — handoff task list (private repo, not in this checkout)

This repo (`zainalabidin85/bbox-relay`) isn't checked out here, so this task is a specification to implement there, not a diff. It mirrors the already-shipped `ReportUnlock` feature's shape as closely as possible — read `bbox-relay/models.py`'s `ReportUnlock` and `main.py`'s three report routes as the reference implementation before writing this.

**Deliverables in `bbox-relay`:**

- [ ] **New model** in `models.py`: `LiveTestUnlock(username: str, project_id: str, run_key: str, unlocked_at: datetime, was_free_trial: bool)`. `run_key` is `training_status.json`'s `finished_at` for the project's current run, fetched live through the tunnel exactly like `ReportUnlock` does for reports (not cached relay-side).

- [ ] **New constant** alongside `report_unlock_cost_tokens`: `live_test_unlock_cost_tokens = 50`.

- [ ] **`GET /projects/{id}/live-test/status`** (registered ahead of the catch-all proxy, same reason the report routes are): fetches the current run's `finished_at` via `tunnel.forward`, checks for a matching `LiveTestUnlock` row for `(username, project_id, run_key)`, and computes `cost` — `0` if this username has **zero** `LiveTestUnlock` rows in the table at all (across every project — the lifetime free trial), else `50`. Returns `{"training_done": bool, "unlocked": bool, "cost": int}`.

- [ ] **`POST /projects/{id}/live-test/unlock`**: recomputes `cost` the same way as `/status` (never trust a client-supplied cost). If `cost == 0`: skip the balance check and the debit entirely, just record the `LiveTestUnlock` row with `was_free_trial=True`. If `cost == 50`: check balance ≥ 50, debit, record the row with `was_free_trial=False`. Idempotent per run like report unlock — a second call for an already-unlocked `(username, project_id, run_key)` returns `{"unlocked": true, "already_unlocked": true, "tokens_remaining": <current balance, unchanged>}` with no charge. Returns `{"unlocked": bool, "already_unlocked": bool, "tokens_remaining": int}`.

- [ ] **`GET /projects/{id}/weights/download-onnx`**: registered ahead of the catch-all so it intercepts this exact path instead of falling through to the generic proxy. Checks unlock status for the current run (same lookup as `/status`); if unlocked, proxies to `bbox-api`'s `GET /projects/{id}/weights/download-onnx` (Task 2) via `tunnel.forward` and streams the response back; if not unlocked, returns 402 with a clear error body (`{"detail": "Live test not unlocked for this training run."}`) — `bbox-web`'s `LiveTestCard` (Task 6) should never let a user reach this without unlocking first, but the server-side check must not trust that.

- [ ] **Tests**: mirror whatever test file already covers `ReportUnlock`'s three routes — same structure, same fixtures, adapted for `LiveTestUnlock`'s free-trial branch (which `ReportUnlock` doesn't have — that's the one genuinely new case to cover: first unlock ever for a username is free, second unlock for a *different* project by the same username costs 50).

- [ ] **Deploy** to all three `bbox-api` instances that need the matching Task 1+2 code deployed first (VM202, the Jetson, the Windows box — per `[[project_ai_assist_tokens]]`'s note that the AI-assist rollout once forgot to deploy to all three and shipped a "button stays grey" bug on the ones it missed), then deploy `bbox-relay` itself.

---

## Task 4: bbox-web — types and API client functions

**Files:**
- Modify: `bbox-web/src/api/types.ts`
- Modify: `bbox-web/src/api/client.ts`

**Interfaces:**
- Produces: `LiveTestUnlockStatus { training_done: boolean; unlocked: boolean; cost: number }`, `LiveTestUnlockResult { unlocked: boolean; already_unlocked: boolean; tokens_remaining: number }` (types.ts). `api.getLiveTestStatus(projectId: string): Promise<LiveTestUnlockStatus>`, `api.unlockLiveTest(projectId: string): Promise<LiveTestUnlockResult>`, `api.fetchLiveTestModel(projectId: string): Promise<ArrayBuffer>` (client.ts) — consumed by Task 6 (`LiveTestCard`) and Task 7 (`LiveTestPage`).

- [ ] **Step 1: Add the types**

In `bbox-web/src/api/types.ts`, add after the existing `ReportUnlockResult` interface:

```typescript
// ── Live camera test (bboxai-remote only) ───────────────────────────────────

export interface LiveTestUnlockStatus {
  training_done: boolean;
  unlocked: boolean;
  cost: number;
}

export interface LiveTestUnlockResult {
  unlocked: boolean;
  already_unlocked: boolean;
  tokens_remaining: number;
}
```

- [ ] **Step 2: Add the client functions**

In `bbox-web/src/api/client.ts`, add `LiveTestUnlockResult` and `LiveTestUnlockStatus` to the existing `import type { ... } from "./types"` block, then add these functions directly after `unlockReport` (around line 172):

```typescript
// Live camera test paywall — remote build only, mirrors the report-unlock
// shape exactly (see unlockReport above). getLiveTestStatus/unlockLiveTest
// only exist as routes on bbox-relay, not bbox-api directly — the local
// build never calls them (gated by IS_REMOTE at the call site).
export async function getLiveTestStatus(projectId: string): Promise<LiveTestUnlockStatus> {
  const { data } = await client.get(`/projects/${projectId}/live-test/status`);
  return data;
}

export async function unlockLiveTest(projectId: string): Promise<LiveTestUnlockResult> {
  const { data } = await client.post(`/projects/${projectId}/live-test/unlock`);
  return data;
}

// Fetches the ONNX model bytes for client-side inference (not a browser
// file download like downloadModel() above — this stays in memory and
// feeds onnxruntime-web directly). bbox-api serves this endpoint always;
// on the remote build it's transparently gated by bbox-relay based on
// live-test unlock status before it ever reaches bbox-api.
export async function fetchLiveTestModel(projectId: string): Promise<ArrayBuffer> {
  const { data } = await client.get(`/projects/${projectId}/weights/download-onnx`, {
    responseType: "arraybuffer",
  });
  return data as ArrayBuffer;
}
```

- [ ] **Step 3: Verify the build**

Run: `cd bbox-web && npm run build`
Expected: succeeds with no TypeScript errors (this compiles the whole app, including the two files just touched — there's no isolated typecheck-only script in `package.json`, so the full build is the available verification).

- [ ] **Step 4: Commit**

```bash
cd bbox-web
git add src/api/types.ts src/api/client.ts
git commit -m "bbox-web: add live-test unlock types and API client functions

Mirrors the existing report-unlock client shape. These call
bbox-relay-only routes (not implemented on bbox-api directly) — safe
to add now since nothing calls them until the IS_REMOTE-gated UI
lands in a later commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Gv1siJTsvVPmUxgaVWdCew"
```

---

## Task 5: bbox-web — `utils/liveInference.ts` (onnxruntime-web wrapper)

Ported directly from the feasibility spike's proven implementation (measured 15 FPS on Android Chrome/WebGPU) — the letterbox math, output decode, and NMS below are not a redesign, they're the same logic that was already tested working.

**Files:**
- Modify: `bbox-web/package.json`
- Create: `bbox-web/src/utils/liveInference.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `IMG_SIZE = 320`, `CONF_THRES = 0.35`, `IOU_THRES = 0.45` (exported constants). `type ExecutionProvider = "webgpu" | "wasm"`. `interface Detection { box: [number, number, number, number]; score: number; classId: number }` (box is `[x1, y1, x2, y2]` in source-video pixel coordinates). `async function loadSession(modelBytes: ArrayBuffer): Promise<{ session: ort.InferenceSession; ep: ExecutionProvider }>`. `async function detectFrame(session: ort.InferenceSession, video: HTMLVideoElement, offCanvas: HTMLCanvasElement): Promise<Detection[]>` — consumed by Task 7 (`LiveTestPage.tsx`).

- [ ] **Step 1: Add the dependency**

In `bbox-web/package.json`, add to `"dependencies"`:

```json
    "onnxruntime-web": "^1.19.2",
```

Run: `cd bbox-web && npm install`

- [ ] **Step 2: Write the module**

Create `bbox-web/src/utils/liveInference.ts`:

```typescript
import * as ort from "onnxruntime-web";

// Fixed at export time (see bbox-api's services/trainer.py _export_onnx) —
// the model this loads was always exported at 320x320, opset 12.
export const IMG_SIZE = 320;
export const CONF_THRES = 0.35;
export const IOU_THRES = 0.45;

export type ExecutionProvider = "webgpu" | "wasm";

export interface Detection {
  box: [number, number, number, number]; // x1, y1, x2, y2 in source-video pixel coords
  score: number;
  classId: number;
}

// Tries WebGPU first (measured ~15 FPS on Android Chrome in the feasibility
// spike), falls back to WASM silently on any device/browser where WebGPU
// isn't available (notably most iOS Safari versions) — no user-facing
// warning by design, see the design spec's "iOS handling" decision.
export async function loadSession(
  modelBytes: ArrayBuffer
): Promise<{ session: ort.InferenceSession; ep: ExecutionProvider }> {
  ort.env.wasm.numThreads = navigator.hardwareConcurrency
    ? Math.min(4, navigator.hardwareConcurrency)
    : 1;
  ort.env.wasm.simd = true;

  try {
    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ["webgpu"],
    });
    return { session, ep: "webgpu" };
  } catch {
    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ["wasm"],
    });
    return { session, ep: "wasm" };
  }
}

function iou(a: [number, number, number, number], b: [number, number, number, number]): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter + 1e-6);
}

function nms(dets: Detection[], thres: number): Detection[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const keep: Detection[] = [];
  for (const d of sorted) {
    const suppressed = keep.some((k) => k.classId === d.classId && iou(k.box, d.box) > thres);
    if (!suppressed) keep.push(d);
  }
  return keep;
}

// One call per animation frame. `offCanvas` is caller-owned scratch space
// (IMG_SIZE x IMG_SIZE) reused across calls to avoid allocating a new
// canvas every frame.
export async function detectFrame(
  session: ort.InferenceSession,
  video: HTMLVideoElement,
  offCanvas: HTMLCanvasElement
): Promise<Detection[]> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  offCanvas.width = IMG_SIZE;
  offCanvas.height = IMG_SIZE;
  const offCtx = offCanvas.getContext("2d")!;

  // Letterbox: scale to fit inside IMG_SIZE x IMG_SIZE, pad with grey.
  const scale = Math.min(IMG_SIZE / vw, IMG_SIZE / vh);
  const nw = Math.round(vw * scale);
  const nh = Math.round(vh * scale);
  const padX = (IMG_SIZE - nw) / 2;
  const padY = (IMG_SIZE - nh) / 2;
  offCtx.fillStyle = "#727272";
  offCtx.fillRect(0, 0, IMG_SIZE, IMG_SIZE);
  offCtx.drawImage(video, 0, 0, vw, vh, padX, padY, nw, nh);

  const imgData = offCtx.getImageData(0, 0, IMG_SIZE, IMG_SIZE).data;
  const plane = IMG_SIZE * IMG_SIZE;
  const chw = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    chw[i] = imgData[i * 4] / 255;
    chw[plane + i] = imgData[i * 4 + 1] / 255;
    chw[2 * plane + i] = imgData[i * 4 + 2] / 255;
  }
  const tensor = new ort.Tensor("float32", chw, [1, 3, IMG_SIZE, IMG_SIZE]);

  const outputs = await session.run({ images: tensor });
  const outputKey = Object.keys(outputs)[0];
  const output = outputs[outputKey];
  const data = output.data as Float32Array;
  const numBoxes = output.dims[2] as number;
  const numAttrs = output.dims[1] as number;
  const numClasses = numAttrs - 4;

  const dets: Detection[] = [];
  for (let i = 0; i < numBoxes; i++) {
    let bestClass = -1;
    let bestScore = 0;
    for (let c = 0; c < numClasses; c++) {
      const s = data[(4 + c) * numBoxes + i];
      if (s > bestScore) {
        bestScore = s;
        bestClass = c;
      }
    }
    if (bestScore < CONF_THRES) continue;

    const cx = data[0 * numBoxes + i];
    const cy = data[1 * numBoxes + i];
    const w = data[2 * numBoxes + i];
    const h = data[3 * numBoxes + i];
    const x1 = (cx - w / 2 - padX) / scale;
    const y1 = (cy - h / 2 - padY) / scale;
    const x2 = (cx + w / 2 - padX) / scale;
    const y2 = (cy + h / 2 - padY) / scale;
    dets.push({ box: [x1, y1, x2, y2], score: bestScore, classId: bestClass });
  }

  return nms(dets, IOU_THRES);
}
```

- [ ] **Step 3: Verify the build**

Run: `cd bbox-web && npm run build`
Expected: succeeds with no TypeScript errors. (No frontend test framework exists in this repo — see Global Constraints — so this module's real correctness is verified end-to-end in Task 7's manual phone test, which is exactly how the feasibility spike itself was validated.)

- [ ] **Step 4: Commit**

```bash
cd bbox-web
git add package.json package-lock.json src/utils/liveInference.ts
git commit -m "bbox-web: add onnxruntime-web inference module for live camera test

Ports the feasibility spike's proven implementation (letterbox
preprocessing, YOLO output decode, NMS) into a real module — ~15 FPS
measured on Android Chrome/WebGPU, silent fallback to WASM elsewhere.
Not yet wired into any page.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Gv1siJTsvVPmUxgaVWdCew"
```

---

## Task 6: bbox-web — `LiveTestCard` on `TrainPage`

**Files:**
- Create: `bbox-web/src/components/LiveTestCard.tsx`
- Modify: `bbox-web/src/pages/TrainPage.tsx`

**Interfaces:**
- Consumes: `api.getLiveTestStatus`, `api.unlockLiveTest` (Task 4), `useWallet()` (existing, `contexts/WalletContext.tsx`).
- Produces: `<LiveTestCard projectId={string} />` — a `.card`-styled component matching `TestModelCard`'s visual shape, rendered by `TrainPage.tsx` directly after `<TestModelCard />`. Links to `/projects/{projectId}/live-test` (Task 7's route) once unlocked.

- [ ] **Step 1: Write the component**

Create `bbox-web/src/components/LiveTestCard.tsx`:

```tsx
import { useEffect, useState } from "react";
import { AlertCircle, Camera, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import * as api from "../api/client";
import type { LiveTestUnlockStatus } from "../api/types";
import { useWallet } from "../contexts/WalletContext";

interface Props {
  projectId: string;
}

// bboxai-remote only — never rendered on the desktop/self-hosted build (see
// the IS_REMOTE gate at the TrainPage.tsx call site). Mirrors the
// report-unlock button pattern in TrainPage.tsx: fetch status on mount,
// unlock on click, reflect the new wallet balance from the response.
export function LiveTestCard({ projectId }: Props) {
  const [status, setStatus] = useState<LiveTestUnlockStatus | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setBalance: setNavBalance } = useWallet();

  useEffect(() => {
    api.getLiveTestStatus(projectId).then(setStatus).catch(() => setStatus(null));
  }, [projectId]);

  async function onUnlock() {
    setUnlocking(true);
    setError(null);
    try {
      const result = await api.unlockLiveTest(projectId);
      setNavBalance(result.tokens_remaining);
      setStatus((prev) => (prev ? { ...prev, unlocked: true } : prev));
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Failed to unlock live test.");
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <div className="card">
      <h3>
        <Camera size={18} />
        Test on live camera
      </h3>
      <p className="muted">
        Point your phone's camera at real objects and see the model detect them live — runs
        entirely on your phone, nothing uploaded per frame.
      </p>

      {error && (
        <p className="error">
          <AlertCircle />
          {error}
        </p>
      )}

      {status?.unlocked ? (
        <Link to={`/projects/${projectId}/live-test`} className="btn-primary">
          <Camera size={16} />
          Open live test
        </Link>
      ) : (
        <button className="btn-primary" onClick={onUnlock} disabled={unlocking || !status}>
          {unlocking ? <Loader2 size={16} className="spin" /> : <Camera size={16} />}
          {unlocking
            ? "Unlocking…"
            : status?.cost === 0
            ? "Try live test free"
            : `Unlock live test (${status?.cost ?? 50} tokens)`}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `TrainPage.tsx`**

In `bbox-web/src/pages/TrainPage.tsx`, add the import near the existing `TestModelCard` import (around line 18):

```typescript
import { LiveTestCard } from "../components/LiveTestCard";
```

Then, directly after the existing `<TestModelCard />` line (around line 313), add:

```tsx
      {status?.state === "done" && id && <TestModelCard projectId={id} />}
      {status?.state === "done" && IS_REMOTE && id && <LiveTestCard projectId={id} />}
```

- [ ] **Step 3: Verify the build**

Run: `cd bbox-web && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Manual check**

Run: `cd bbox-web && npm run dev -- --mode remote` (or however this repo's remote-mode dev server is normally started — check `bbox-web/.env.remote` / `package.json` if unsure) against a `bbox-api`/`bbox-relay` pair where Tasks 1–3 are deployed, log in, open a project with `status.state === "done"`, confirm the "Test on live camera" card renders after "Test the model" and shows the free-trial or token-cost button correctly. Clicking "Open live test" (once unlocked) should navigate to `/projects/{id}/live-test` — a blank/404 page there is expected until Task 7 lands.

- [ ] **Step 5: Commit**

```bash
cd bbox-web
git add src/components/LiveTestCard.tsx src/pages/TrainPage.tsx
git commit -m "bbox-web: add LiveTestCard to TrainPage (remote build only)

Unlock UI for the live camera test feature, placed directly after
TestModelCard per the design spec. Links to /projects/:id/live-test,
which doesn't exist until the next commit — expected to 404 until
then.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Gv1siJTsvVPmUxgaVWdCew"
```

---

## Task 7: bbox-web — `LiveTestPage` (the camera screen itself)

**Files:**
- Create: `bbox-web/src/pages/LiveTestPage.tsx`
- Modify: `bbox-web/src/App.tsx`
- Modify: `bbox-web/src/index.css`

**Interfaces:**
- Consumes: `api.getProject`, `api.fetchLiveTestModel` (Task 4), `loadSession`, `detectFrame`, `ExecutionProvider` (Task 5's `utils/liveInference.ts`), `classColor` (existing, exported from `components/BBoxCanvas.tsx`).
- Produces: the `/projects/:id/live-test` route (remote-only).

- [ ] **Step 1: Write the page**

Create `bbox-web/src/pages/LiveTestPage.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import * as api from "../api/client";
import { classColor } from "../components/BBoxCanvas";
import { detectFrame, loadSession } from "../utils/liveInference";
import type { Detection } from "../utils/liveInference";

// Full-screen camera view — the model, camera feed, and every detection
// this page draws stay entirely on the phone; no per-frame network call.
// See docs/superpowers/specs/2026-09-11-live-camera-test-design.md.
export function LiveTestPage() {
  const { id } = useParams<{ id: string }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<Awaited<ReturnType<typeof loadSession>>["session"] | null>(null);
  const classNamesRef = useRef<string[]>([]);
  const rafRef = useRef<number | null>(null);
  const [statusText, setStatusText] = useState("Requesting camera…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let stream: MediaStream | null = null;
    let cancelled = false;

    function drawDetections(dets: Detection[]) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 3;
      ctx.font = "16px sans-serif";
      for (const d of dets) {
        const color = classColor(d.classId);
        const [x1, y1, x2, y2] = d.box;
        ctx.strokeStyle = color;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        const label = `${classNamesRef.current[d.classId] ?? d.classId} ${(d.score * 100).toFixed(0)}%`;
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = color;
        ctx.fillRect(x1, Math.max(0, y1 - 20), textWidth + 8, 20);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, x1 + 4, Math.max(14, y1 - 5));
      }
    }

    async function loop() {
      const session = sessionRef.current;
      const video = videoRef.current;
      const offCanvas = offCanvasRef.current;
      if (cancelled || !session || !video || !offCanvas) return;
      const dets = await detectFrame(session, video, offCanvas);
      if (cancelled) return;
      drawDetections(dets);
      rafRef.current = requestAnimationFrame(loop);
    }

    async function start() {
      try {
        const project = await api.getProject(id!);
        classNamesRef.current = project.classes.map((c) => c.name);

        setStatusText("Requesting camera…");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) return;

        const video = videoRef.current!;
        video.srcObject = stream;
        await new Promise<void>((resolve) => {
          video.onloadedmetadata = () => resolve();
        });
        if (cancelled) return;

        const canvas = canvasRef.current!;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        offCanvasRef.current = document.createElement("canvas");

        setStatusText("Loading model…");
        const modelBytes = await api.fetchLiveTestModel(id!);
        if (cancelled) return;

        const { session } = await loadSession(modelBytes);
        if (cancelled) return;
        sessionRef.current = session;
        setStatusText("");

        loop();
      } catch (err: any) {
        if (!cancelled) {
          setError(
            err?.name === "NotAllowedError"
              ? "Camera permission was denied. Allow camera access and reload this page."
              : err?.message ?? "Failed to start the live test."
          );
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [id]);

  return (
    <div className="live-test-page">
      <Link to={`/projects/${id}/train`} className="live-test-back">
        <ChevronLeft size={16} />
        Back
      </Link>
      <video ref={videoRef} autoPlay playsInline muted className="live-test-video" />
      <canvas ref={canvasRef} className="live-test-canvas" />
      {statusText && <p className="live-test-status">{statusText}</p>}
      {error && (
        <p className="error live-test-error">
          <AlertCircle />
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the route**

In `bbox-web/src/App.tsx`, add a lazy import near the existing `TrainPage`/`WalletPage` lazy imports:

```typescript
const LiveTestPage = lazy(() =>
  import("./pages/LiveTestPage").then((m) => ({ default: m.LiveTestPage }))
);
```

Then add the route inside the `<ProtectedRoute />` block, next to the existing `IS_REMOTE && <Route path="/wallet" .../>` line:

```tsx
              {IS_REMOTE && <Route path="/projects/:id/live-test" element={<LiveTestPage />} />}
```

- [ ] **Step 3: Add the page's CSS**

In `bbox-web/src/index.css`, add at the end of the file:

```css
/* Live camera test (bboxai-remote only) — full-screen camera + detection
   overlay. See pages/LiveTestPage.tsx. */
.live-test-page {
  position: relative;
  width: 100vw;
  height: 100vh;
  background: #000;
  overflow: hidden;
}

.live-test-video,
.live-test-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.live-test-back {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  border-radius: 8px;
  text-decoration: none;
  font-size: 14px;
}

.live-test-status {
  position: absolute;
  bottom: 16px;
  left: 12px;
  right: 12px;
  z-index: 10;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  padding: 8px 12px;
  border-radius: 8px;
  text-align: center;
}

.live-test-error {
  position: absolute;
  bottom: 16px;
  left: 12px;
  right: 12px;
  z-index: 10;
}
```

- [ ] **Step 4: Verify the build**

Run: `cd bbox-web && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Manual phone verification (the real test for this task)**

With Tasks 1–6 deployed (bbox-api export + endpoint, bbox-relay unlock routes, bbox-web build deployed to `bboxai-remote`): on a real Android Chrome phone, open a trained project's `TrainPage`, use the free trial or unlock, tap "Open live test", grant camera permission, and confirm:
- The camera feed appears full-screen with a working back link
- Detections draw with class-colored boxes and labels matching the project's real classes
- FPS is in the same range the feasibility spike measured (~15 FPS on WebGPU) — there's no on-screen FPS counter in the shipped UI (that was spike-only debug output), so judge by eye: smooth-ish live tracking, not a slideshow

Also spot-check on one iOS device if available, to see the real WASM-fallback experience (expected slower, per the design spec's accepted trade-off — no code change expected in response, just confirms nothing crashes).

- [ ] **Step 6: Commit**

```bash
cd bbox-web
git add src/pages/LiveTestPage.tsx src/App.tsx src/index.css
git commit -m "bbox-web: add LiveTestPage — the live camera test screen

Full-screen camera view running onnxruntime-web client-side against
the project's exported ONNX model. Completes the on-device live
camera test feature end to end (remote build only).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Gv1siJTsvVPmUxgaVWdCew"
```

---

## Self-review notes

- **Spec coverage:** ONNX export (Task 1), download endpoint (Task 2), bbox-relay unlock model/routes (Task 3), types/client (Task 4), inference module (Task 5), unlock UI (Task 6), camera page + route + styling (Task 7) — every component the spec named has a task. Error-handling table rows are covered: camera-permission-denied and model-download-failure in Task 7's `try`/`catch`, unlock-failure in Task 6's `onUnlock`, training-not-done via the existing `status?.state === "done"` gate reused from `TestModelCard`, missing-`model.onnx`-server-side via Task 2's 404 test, retrained-project via `bbox-relay`'s `run_key` mechanism (Task 3, inherited from `ReportUnlock`'s already-working behavior).
- **Placeholder scan:** no TBDs; the one inherently non-concrete task (Task 3) is explicitly framed as a handoff checklist for a repo not in this checkout, per the request, not a placeholder for work that belongs here.
- **Type consistency:** `LiveTestUnlockStatus`/`LiveTestUnlockResult` (Task 4) are used identically in Task 6. `Detection`, `ExecutionProvider`, `loadSession`, `detectFrame`, `IMG_SIZE`/`CONF_THRES`/`IOU_THRES` (Task 5) match their usage in Task 7. `fetchLiveTestModel` (Task 4) returns `ArrayBuffer`, matching `loadSession`'s parameter type (Task 5) and its call site in Task 7.
