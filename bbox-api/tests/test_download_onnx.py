import os

from config import PROJECTS_DIR


def _create_project(client, token):
    resp = client.post(
        "/projects",
        json={"name": "Onnx Test Project", "classes": ["thing"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201, resp.text
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
