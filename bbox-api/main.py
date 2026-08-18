import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import models  # noqa: F401 — ensures all models are registered before create_all
from config import CORS_ORIGINS, WEB_DIST_DIR
from database import Base, engine
from routers import auth, catalog, projects, training, video
from services import trainer

app = FastAPI(title="bboxAI API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create all tables on startup (idempotent)
Base.metadata.create_all(bind=engine)

trainer.reconcile_stale_running()

app.include_router(auth.router,     prefix="/auth",     tags=["auth"])
app.include_router(projects.router, prefix="/projects", tags=["projects"])
app.include_router(training.router, prefix="/projects", tags=["training"])
app.include_router(video.router,    prefix="/projects", tags=["video"])
app.include_router(catalog.router,  prefix="/models",   tags=["catalog"])


@app.get("/weights", tags=["training"])
def list_weights():
    return trainer.list_base_models()


# ── Optional built-in static serving (WEB_DIST_PATH set) ──────────────────────
# Lets bbox-api serve bbox-web's built SPA directly, e.g. on Windows where
# there's no nginx in front. Registered last so it never shadows API routes.
if WEB_DIST_DIR and os.path.isdir(WEB_DIST_DIR):
    assets_dir = os.path.join(WEB_DIST_DIR, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="web-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        candidate = os.path.join(WEB_DIST_DIR, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(WEB_DIST_DIR, "index.html"))
