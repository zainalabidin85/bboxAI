import asyncio
import base64
import uuid


class DeviceOffline(Exception):
    pass


class Tunnel:
    """Holds live agent WebSocket connections and correlates proxied
    HTTP requests with their responses over each connection."""

    def __init__(self) -> None:
        self._connections: dict[str, "WebSocketLike"] = {}
        self._pending: dict[str, asyncio.Future] = {}

    def register(self, device_id: str, ws) -> None:
        self._connections[device_id] = ws

    def unregister(self, device_id: str) -> None:
        self._connections.pop(device_id, None)
        stale = [req_id for req_id, fut in self._pending.items() if req_id.startswith(f"{device_id}:")]
        for req_id in stale:
            fut = self._pending.pop(req_id, None)
            if fut and not fut.done():
                fut.set_exception(DeviceOffline())

    def is_online(self, device_id: str) -> bool:
        return device_id in self._connections

    def resolve(self, req_id: str, status: int, headers: dict, body_b64: str) -> None:
        fut = self._pending.pop(req_id, None)
        if fut and not fut.done():
            fut.set_result((status, headers, base64.b64decode(body_b64)))

    async def forward(
        self, device_id: str, method: str, path: str, headers: dict, body: bytes, timeout: float
    ) -> tuple[int, dict, bytes]:
        ws = self._connections.get(device_id)
        if ws is None:
            raise DeviceOffline()

        req_id = f"{device_id}:{uuid.uuid4().hex}"
        loop = asyncio.get_event_loop()
        fut: asyncio.Future = loop.create_future()
        self._pending[req_id] = fut

        message = {
            "req_id": req_id,
            "method": method,
            "path": path,
            "headers": headers,
            "body_b64": base64.b64encode(body).decode(),
        }
        try:
            await ws.send_json(message)
            return await asyncio.wait_for(fut, timeout=timeout)
        finally:
            self._pending.pop(req_id, None)


tunnel = Tunnel()
