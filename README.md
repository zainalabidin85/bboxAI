# bboxAI

A multi-class image/video annotation and YOLOv8 training system. Define your own classes, create multiple projects, capture or upload images/video, draw bounding boxes, and train a YOLOv8 model — all through a web UI or a mobile app talking to the same API.

## Components

| Component | What it is |
|---|---|
| `bbox-api/` | FastAPI backend — auth, projects, annotation storage, training, reporting. The source of truth. |
| `bbox-web/` | React + TypeScript + Vite web client (login, projects, annotate, train). |
| `bbox-app/` | Flutter mobile app (Android). |
| `bbox-agent/` | Desktop agent that pairs a local `bbox-api` with the hosted relay for remote access. |
| `bboxai-desktop/` | Install scripts that set up `bbox-api` + `bbox-web` + `bbox-agent` as a local install with systemd services. |

`bbox-relay` (the relay/tunnel server that lets a browser reach a `bbox-api` running on someone's desktop behind NAT) is a separately maintained, privately hosted service — `bbox-agent` is the public client for it, so you don't need its source to run bboxAI yourself.

## Quickstart: install bboxai-desktop

The intended way to run bboxAI is a per-user local install — not a shared server. Three install paths, same end result (local UI at `http://bboxai:8321`, register an account, remote access via `bboxai-remote.unitani.com` activates automatically the first time you do — no separate step):

- **Linux (from a checkout of this repo):**
  ```bash
  ./bboxai-desktop/install.sh
  ```
  Provisions PostgreSQL, sets up `bbox-api` as a systemd service, builds `bbox-web` and serves it via nginx.
- **Linux (prebuilt `.deb`, no checkout needed):** download `bboxai-desktop_<version>_all.deb` from [GitHub Releases](https://github.com/zainalabidin85/bboxAI/releases) and `sudo apt install ./bboxai-desktop_<version>_all.deb`. Same PostgreSQL/nginx architecture as `install.sh` — see [`bboxai-desktop/packaging/deb/README.md`](./bboxai-desktop/packaging/deb/README.md).
- **Windows (prebuilt `.exe`):** download `bboxai-desktop-setup-<version>.exe` from [GitHub Releases](https://github.com/zainalabidin85/bboxAI/releases) and run it. Simpler single-process architecture (SQLite, no nginx, NSSM services) — see [`bboxai-desktop/packaging/windows/README.md`](./bboxai-desktop/packaging/windows/README.md).

On Linux, remote access can also be force-switched to a different local account manually:

```bash
./bboxai-desktop/enable-remote.sh
```

This sets up `bbox-agent` as a systemd service, tunneling to the hosted relay so you can log into a "remote" web build with the same account from anywhere.

## Development

Each component can also be run individually for development:

### `bbox-api`

```bash
cd bbox-api
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
# Swagger UI: http://localhost:8000/docs
```

### `bbox-web`

```bash
cd bbox-web
npm install
cp .env.example .env
npm run dev
```

### `bbox-agent` (optional, pairs a local `bbox-api` with the hosted relay)

```bash
cd bbox-agent
pip install -r requirements.txt
python agent.py
```

### `bbox-app`

```bash
cd bbox-app
flutter pub get
flutter run
```

## Architecture

See [`CLAUDE.md`](./CLAUDE.md) for the full architecture writeup — auth model, project/class data model, video ingestion, training pipeline, and the remote-access (`bbox-agent` + hosted relay) design.
