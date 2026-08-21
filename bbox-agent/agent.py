"""bboxAI desktop agent.

Keeps a persistent tunnel open to bbox-relay so a remote browser can
control the local bbox-api instance. Must stay running for remote
control to work — start it alongside `uvicorn main:app` in bbox-api.

Config is stored in ~/.bboxai/agent.json (chmod 600). On a shared or
untrusted machine, don't rely on this file for secrecy beyond OS file
permissions — this MVP trades a bit of local-secret hygiene for the
convenience of an agent that can restart unattended (e.g. on boot).
"""

import asyncio
import base64
import getpass
import json
import os
import sys
import time
from pathlib import Path

import httpx
import websockets

CONFIG_PATH = Path.home() / ".bboxai" / "agent.json"
# Opt-in (set by the bboxai-desktop installers) — a file bbox-api's
# /auth/register writes {"username","password"} to on a successful
# registration, so this agent can pick up a freshly-created account and
# self-register with the relay automatically, with no separate manual
# "enable remote access" step. See bbox-api/routers/auth.py.
CREDENTIALS_FILE = os.environ.get("BBOXAI_CREDENTIALS_FILE", "")
CREDENTIALS_POLL_SECONDS = 5
MAX_MESSAGE_BYTES = 300 * 1024 * 1024
TOKEN_REFRESH_MARGIN_SECONDS = 6 * 24 * 60 * 60  # re-login before the 7-day bboxAI JWT expires
HOP_BY_HOP = {"host", "content-length", "connection", "transfer-encoding", "keep-alive"}
RECONNECT_BACKOFFS = [2, 4, 8, 16, 30]


def load_config() -> dict:
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text())
    return {}


def save_config(cfg: dict) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2))
    os.chmod(CONFIG_PATH, 0o600)


def _read_credentials_file() -> dict | None:
    if not CREDENTIALS_FILE or not os.path.exists(CREDENTIALS_FILE):
        return None
    try:
        with open(CREDENTIALS_FILE) as f:
            data = json.load(f)
        if data.get("username") and data.get("password"):
            return data
    except (json.JSONDecodeError, OSError):
        pass
    return None


async def ensure_settings(cfg: dict) -> dict:
    cfg["api_base"] = os.environ.get("BBOXAI_API_BASE", cfg.get("api_base", "http://localhost:8000"))
    cfg["relay_url"] = os.environ.get("BBOXAI_RELAY_URL", cfg.get("relay_url", ""))

    # A credentials file always wins over whatever's cached, when present —
    # covers both a fresh install (nothing cached yet) and a deliberate
    # account switch (enable-remote.sh's manual override writes a fresh file
    # to force a *different* account; without this the old cached
    # username/password would win and the new file would never be read).
    # Consumed once, then deleted so the plaintext password isn't left
    # duplicated on disk. Clears the old relay registration too, since a
    # device_id/secret pair is tied to the username it was registered under.
    file_creds = _read_credentials_file()
    if file_creds:
        if file_creds["username"] != cfg.get("username"):
            cfg.pop("device_id", None)
            cfg.pop("device_secret", None)
            cfg.pop("desktop_token", None)
        cfg["username"], cfg["password"] = file_creds["username"], file_creds["password"]
        try:
            os.remove(CREDENTIALS_FILE)
        except OSError:
            pass
    else:
        cfg["username"] = os.environ.get("BBOXAI_USERNAME", cfg.get("username", ""))
        cfg["password"] = os.environ.get("BBOXAI_PASSWORD", cfg.get("password", ""))

    # Still nothing (fresh install, no cache, no env override, no file yet)
    # but a credentials file is configured — wait for a local account to be
    # registered rather than falling straight to an interactive prompt,
    # which would hang forever under a service with no attached TTY.
    if (not cfg["username"] or not cfg["password"]) and CREDENTIALS_FILE:
        print(f"Waiting for a local bboxAI account to be registered (watching {CREDENTIALS_FILE})...")
        while not cfg["username"] or not cfg["password"]:
            creds = _read_credentials_file()
            if creds:
                cfg["username"], cfg["password"] = creds["username"], creds["password"]
                try:
                    os.remove(CREDENTIALS_FILE)
                except OSError:
                    pass
                break
            await asyncio.sleep(CREDENTIALS_POLL_SECONDS)

    if not cfg["relay_url"]:
        cfg["relay_url"] = input("Relay URL (e.g. https://relay.example.com): ").strip()
    if not cfg["username"]:
        cfg["username"] = input("bboxAI username: ").strip()
    if not cfg["password"]:
        cfg["password"] = getpass.getpass("bboxAI password: ")

    save_config(cfg)
    return cfg


async def local_login(cfg: dict) -> None:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{cfg['api_base']}/auth/login",
            data={"username": cfg["username"], "password": cfg["password"]},
        )
        resp.raise_for_status()
        cfg["desktop_token"] = resp.json()["access_token"]
        cfg["desktop_token_obtained_at"] = time.time()
    save_config(cfg)
    print("Logged in to local bbox-api.")


async def ensure_local_token(cfg: dict) -> None:
    obtained_at = cfg.get("desktop_token_obtained_at", 0)
    if not cfg.get("desktop_token") or (time.time() - obtained_at) > TOKEN_REFRESH_MARGIN_SECONDS:
        await local_login(cfg)


async def register_with_relay(cfg: dict) -> None:
    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{cfg['relay_url']}/agent/register", json={"username": cfg["username"]})
        resp.raise_for_status()
        data = resp.json()
    cfg["device_id"] = data["device_id"]
    cfg["device_secret"] = data["device_secret"]
    save_config(cfg)

    print("=" * 50)
    print("Registered with the relay for remote access.")
    print(f"Log in at your bboxai-remote URL with account '{cfg['username']}' to connect.")
    print("=" * 50)


async def handle_tunnel_request(cfg: dict, message: dict) -> dict:
    headers = {
        k: v for k, v in message.get("headers", {}).items()
        if k.lower() not in HOP_BY_HOP and k.lower() != "authorization"
    }
    headers["Authorization"] = f"Bearer {cfg['desktop_token']}"
    body = base64.b64decode(message.get("body_b64", ""))

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.request(
            message["method"],
            f"{cfg['api_base']}{message['path']}",
            headers=headers,
            content=body,
        )

    resp_headers = {k: v for k, v in resp.headers.items() if k.lower() not in HOP_BY_HOP}
    return {
        "req_id": message["req_id"],
        "status": resp.status_code,
        "headers": resp_headers,
        "body_b64": base64.b64encode(resp.content).decode(),
    }


async def run_tunnel(cfg: dict) -> None:
    ws_url = cfg["relay_url"].replace("https://", "wss://").replace("http://", "ws://") + "/agent/ws"

    async with websockets.connect(ws_url, max_size=MAX_MESSAGE_BYTES) as ws:
        await ws.send(json.dumps({"device_id": cfg["device_id"], "device_secret": cfg["device_secret"]}))
        ack = json.loads(await ws.recv())
        if not ack.get("ok"):
            raise RuntimeError(f"Relay rejected this device: {ack.get('error')}")

        print("Tunnel connected. Waiting for remote requests...")
        async for raw in ws:
            message = json.loads(raw)
            await ensure_local_token(cfg)
            try:
                reply = await handle_tunnel_request(cfg, message)
            except Exception as exc:  # keep the tunnel alive even if one request fails
                reply = {
                    "req_id": message["req_id"],
                    "status": 502,
                    "headers": {"content-type": "text/plain"},
                    "body_b64": base64.b64encode(str(exc).encode()).decode(),
                }
            await ws.send(json.dumps(reply))


async def main() -> None:
    cfg = await ensure_settings(load_config())
    await ensure_local_token(cfg)

    if not cfg.get("device_id"):
        await register_with_relay(cfg)

    attempt = 0
    while True:
        try:
            await run_tunnel(cfg)
            attempt = 0
        except (websockets.exceptions.ConnectionClosed, OSError, RuntimeError) as exc:
            delay = RECONNECT_BACKOFFS[min(attempt, len(RECONNECT_BACKOFFS) - 1)]
            print(f"Tunnel disconnected ({exc}); reconnecting in {delay}s...")
            attempt += 1
            await asyncio.sleep(delay)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
