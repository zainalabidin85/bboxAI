from datetime import datetime, timedelta

from fastapi import Body, Depends, FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

import auth
import models
from config import settings
from database import Base, engine, get_db
from tunnel import DeviceOffline, tunnel

app = FastAPI(title="bboxAI Relay", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)

# Headers that must not be blindly forwarded across the proxy boundary.
_HOP_BY_HOP = {"host", "content-length", "connection", "transfer-encoding", "keep-alive"}


@app.post("/agent/register", status_code=201)
def register_agent(db: Session = Depends(get_db)):
    device_id = auth.new_device_id()
    device_secret = auth.new_device_secret()
    pairing_code = auth.new_pairing_code()

    device = models.Device(
        id=device_id,
        secret_hash=auth.hash_secret(device_secret),
        pairing_code=pairing_code,
        pairing_code_expires_at=datetime.utcnow() + timedelta(minutes=settings.pairing_code_expire_minutes),
    )
    db.add(device)
    db.commit()

    return {"device_id": device_id, "device_secret": device_secret, "pairing_code": pairing_code}


@app.post("/pair")
def pair(body: dict = Body(...), db: Session = Depends(get_db)):
    code = str(body.get("pairing_code", "")).strip()
    if not code:
        raise HTTPException(status_code=422, detail="pairing_code is required.")

    device = (
        db.query(models.Device)
        .filter(models.Device.pairing_code == code)
        .first()
    )
    if not device or not device.pairing_code_expires_at or device.pairing_code_expires_at < datetime.utcnow():
        raise HTTPException(status_code=404, detail="Invalid or expired pairing code.")

    device.pairing_code = None
    device.pairing_code_expires_at = None
    db.commit()

    token = auth.create_session_token(device.id)
    return {"access_token": token, "device_id": device.id}


@app.websocket("/agent/ws")
async def agent_ws(websocket: WebSocket, db: Session = Depends(get_db)):
    await websocket.accept()

    try:
        handshake = await websocket.receive_json()
    except Exception:
        await websocket.close(code=4000)
        return

    device_id = handshake.get("device_id")
    device_secret = handshake.get("device_secret")
    device = db.query(models.Device).filter(models.Device.id == device_id).first()

    if not device or not device_secret or not auth.verify_secret(device_secret, device.secret_hash):
        await websocket.send_json({"ok": False, "error": "Invalid device credentials."})
        await websocket.close(code=4001)
        return

    await websocket.send_json({"ok": True})
    tunnel.register(device_id, websocket)

    try:
        while True:
            message = await websocket.receive_json()
            tunnel.resolve(
                message["req_id"],
                message["status"],
                message.get("headers", {}),
                message.get("body_b64", ""),
            )
    except WebSocketDisconnect:
        pass
    finally:
        tunnel.unregister(device_id)


@app.api_route(
    "/{full_path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
)
async def proxy(full_path: str, request: Request):
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer session token.")

    try:
        device_id = auth.decode_session_token(auth_header[7:])
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc))

    if not tunnel.is_online(device_id):
        raise HTTPException(status_code=503, detail="Desktop device is offline.")

    body = await request.body()
    path = f"/{full_path}"
    if request.url.query:
        path += f"?{request.url.query}"
    headers = {k: v for k, v in request.headers.items() if k.lower() not in _HOP_BY_HOP}

    try:
        status, resp_headers, resp_body = await tunnel.forward(
            device_id, request.method, path, headers, body, timeout=settings.request_timeout_seconds
        )
    except DeviceOffline:
        raise HTTPException(status_code=503, detail="Desktop device is offline.")
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Desktop device timed out.")

    resp_headers = {k: v for k, v in resp_headers.items() if k.lower() not in _HOP_BY_HOP}
    return Response(content=resp_body, status_code=status, headers=resp_headers)
