import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from jose import JWTError, jwt

from config import settings

ALGORITHM = "HS256"


def new_device_id() -> str:
    return secrets.token_hex(6)


def new_device_secret() -> str:
    return secrets.token_urlsafe(32)


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def verify_secret(secret: str, secret_hash: str) -> bool:
    return hmac.compare_digest(hash_secret(secret), secret_hash)


def create_session_token(device_id: str) -> str:
    expire = datetime.utcnow() + timedelta(days=settings.session_token_expire_days)
    payload = {"device_id": device_id, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_session_token(token: str) -> str:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except JWTError:
        raise ValueError("Invalid or expired session token.")
    device_id = payload.get("device_id")
    if not device_id:
        raise ValueError("Invalid session token.")
    return device_id
