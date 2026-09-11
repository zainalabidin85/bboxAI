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
