from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import models  # noqa: F401 — ensures all models are registered before create_all
from config import CORS_ORIGINS
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
