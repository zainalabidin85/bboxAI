import json
import os
import shutil

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from auth import create_access_token, get_current_user, hash_password, verify_password
from config import PROJECTS_DIR, settings
from database import get_db
from models import User

router = APIRouter()


def _write_agent_credentials(username: str, password: str) -> None:
    """Opt-in (see config.agent_credentials_path) — lets bbox-agent pick up
    a freshly-registered account automatically instead of requiring a
    separate manual "enable remote access" step with re-typed credentials.
    Best-effort: a failure here must never break registration itself."""
    path = settings.agent_credentials_path
    if not path:
        return
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump({"username": username, "password": password}, f)
        os.chmod(path, 0o600)
    except OSError:
        pass


class RegisterBody(BaseModel):
    username: str
    email: EmailStr
    password: str


@router.post("/register", status_code=201)
def register(body: RegisterBody, db: Session = Depends(get_db)):
    if len(body.username.strip()) < 3:
        raise HTTPException(status_code=422, detail="Username must be at least 3 characters.")
    if len(body.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters.")

    if db.query(User).filter(User.username == body.username.strip()).first():
        raise HTTPException(status_code=409, detail="Username already taken.")
    if db.query(User).filter(User.email == body.email.lower()).first():
        raise HTTPException(status_code=409, detail="Email already registered.")

    user = User(
        username=body.username.strip(),
        email=body.email.lower(),
        password_hash=hash_password(body.password),
    )
    db.add(user)
    db.commit()
    _write_agent_credentials(user.username, body.password)
    return {"message": "Account created. You can now log in."}


@router.post("/login")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form.username).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled.")

    token = create_access_token(user.id)
    return {"access_token": token, "token_type": "bearer", "username": user.username}


class DeleteAccountBody(BaseModel):
    password: str


@router.delete("/me", status_code=204)
def delete_account(
    body: DeleteAccountBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(body.password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect password.")

    # Wipe on-disk storage for every owned project before the DB rows go —
    # same per-project cleanup DELETE /projects/{id} does, just for all of
    # them at once. The User row's cascade="all, delete-orphan" on `projects`
    # (see models.py) handles the DB side (projects, classes, trained_models,
    # uploads) via a single delete.
    for project in current_user.projects:
        proj_dir = os.path.join(PROJECTS_DIR, project.id)
        if os.path.isdir(proj_dir):
            shutil.rmtree(proj_dir)

    db.delete(current_user)
    db.commit()
