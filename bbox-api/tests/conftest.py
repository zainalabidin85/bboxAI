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
