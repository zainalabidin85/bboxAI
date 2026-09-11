import os
import uuid
from database import SessionLocal
from models import User
from auth import hash_password, create_access_token

from config import PROJECTS_DIR


def _create_test_user(client):
    """Create a unique test user (works around fixture counter reset issue)."""
    # Generate unique username to avoid conflicts across test runs
    unique_id = uuid.uuid4().hex[:8]
    username = f"testuser_{unique_id}"
    email = f"{username}@example.com"

    # Create user directly in DB
    db = SessionLocal()
    try:
        user = User(
            username=username,
            email=email,
            password_hash=hash_password("testpw"),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        token = create_access_token(user.id)
        return token
    finally:
        db.close()


def _create_project(client, token):
    resp = client.post(
        "/projects",
        json={"name": "Onnx Test Project", "classes": ["thing"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_download_onnx_returns_404_before_export_exists(client):
    token = _create_test_user(client)
    project_id = _create_project(client, token)

    resp = client.get(
        f"/projects/{project_id}/weights/download-onnx",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


def test_download_onnx_returns_file_for_owner(client):
    token = _create_test_user(client)
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


def test_download_onnx_forbidden_for_non_owner(client):
    owner_token = _create_test_user(client)
    project_id = _create_project(client, owner_token)

    onnx_path = os.path.join(PROJECTS_DIR, project_id, "weights", "model.onnx")
    os.makedirs(os.path.dirname(onnx_path), exist_ok=True)
    with open(onnx_path, "wb") as f:
        f.write(b"fake-onnx-bytes")

    other_token = _create_test_user(client)
    resp = client.get(
        f"/projects/{project_id}/weights/download-onnx",
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert resp.status_code == 403
