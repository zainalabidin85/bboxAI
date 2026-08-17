# bboxAI

A multi-class image/video annotation and YOLOv8 training system. Define your own classes, create multiple projects, capture or upload images/video, draw bounding boxes, and train a YOLOv8 model — all through a web UI or a mobile app talking to the same API.

## Components

| Component | What it is |
|---|---|
| `bbox-api/` | FastAPI backend — auth, projects, annotation storage, training, reporting. The source of truth. |
| `bbox-web/` | React + TypeScript + Vite web client (login, projects, annotate, train). |
| `bbox-app/` | Flutter mobile app (Android). |
| `bbox-agent/` | Desktop agent that pairs a local `bbox-api` with `bbox-relay` for remote access. |
| `bbox-relay/` | Relay/tunnel server that lets a browser reach a `bbox-api` running on someone's desktop behind NAT. |
| `bboxai-desktop/` | Install scripts that set up `bbox-api` + `bbox-web` + `bbox-agent` as a local install with systemd services. |

## Quickstart: install bboxai-desktop

The intended way to run bboxAI is a per-user local install on Linux — not a shared server. From a checkout of this repo:

```bash
./bboxai-desktop/install.sh
```

This provisions Postgres, sets up `bbox-api` as a systemd service (`127.0.0.1:8000`), builds `bbox-web` and serves it via nginx on `http://localhost:8080`. Register an account through that local UI, then optionally enable remote (away-from-home) access:

```bash
./bboxai-desktop/enable-remote.sh
```

This sets up `bbox-agent` as a systemd service, tunneling to a shared `bbox-relay` so you can log into a paired "remote" web build with the same account from anywhere.

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

### `bbox-relay` (optional, for remote/tunneled access)

```bash
cd bbox-relay
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

### `bbox-agent` (optional, pairs a local `bbox-api` with `bbox-relay`)

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

See [`CLAUDE.md`](./CLAUDE.md) for the full architecture writeup — auth model, project/class data model, video ingestion, training pipeline, and the remote-access (`bbox-relay` + `bbox-agent`) design.
