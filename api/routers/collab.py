"""
Co-Work collaboration module — Phase 1 + 2.

Phase 1: Network foundation + auth
  - Named invitation CRUD (stored in config.json)
  - POST /api/collab/join  → JWT session
  - Rate limiter: 1 failed attempt → 300 s IP ban

Phase 2: Real-time event push + soft locks
  - GET  /api/collab/ws-url  → WebSocket URL for the client to connect to
  - WS   /ws/collab          → authenticated WebSocket endpoint
  - ConnectionManager broadcasts JSON messages to all open sockets
  - Soft lock table: scene:<id> → {session_id, display_name, expires_at}
    Locks expire after 30 s without a heartbeat; auto-released on disconnect
  - SQLAlchemy after_flush / after_commit hooks detect DB changes and
    broadcast {type:"change", tables:[...]} to all connected clients

Architecture
------------
- Auth middleware (main.py) reads X-Client-IP from the Next.js proxy and
  requires Bearer JWT for non-localhost clients.
- The WS endpoint reads the JWT from a query-string parameter (?token=...)
  because browser WebSocket API doesn't support custom headers.
- Host (127.0.0.1) is always trusted — no JWT needed for either HTTP or WS.
- JWT secret is in-process only; guests re-join after API restart.
"""

import asyncio
import json
import os
import secrets
import socket
import uuid
from datetime import datetime, UTC, timedelta
from pathlib import Path
from typing import Optional

from starlette.websockets import WebSocketDisconnect

import bcrypt
import jwt
from fastapi import APIRouter, HTTPException, Query, Request, WebSocket
from pydantic import BaseModel

router = APIRouter(prefix="/api/collab", tags=["collab"])

# ── Module-level state ────────────────────────────────────────────────────────

_CONFIG_PATH = Path.home() / ".foliantica" / "config.json"

# JWT secret — regenerated each process start; all guest sessions expire on restart.
_JWT_SECRET: str = secrets.token_hex(32)
_JWT_ALGORITHM = "HS256"
_JWT_EXPIRE_HOURS = 8

# Active sessions: session_id → session dict
_sessions: dict[str, dict] = {}

# Rate limiter: IP → ban_until (UTC datetime)
_bans: dict[str, datetime] = {}

# ── Phase 2 state ─────────────────────────────────────────────────────────────

# Soft locks: item_key ("scene:42") → lock record
_LOCK_TTL = 30  # seconds without heartbeat before lock expires
_locks: dict[str, dict] = {}

# ── Phase 3 state ─────────────────────────────────────────────────────────────

_PRESENCE_COLORS = [
    "#7c3aed",  # violet
    "#2563eb",  # blue
    "#059669",  # emerald
    "#d97706",  # amber
    "#dc2626",  # red
    "#db2777",  # pink
    "#0891b2",  # cyan
]

# Active presence: session_id → {item_type, item_id} (both nullable)
_presence: dict[str, dict] = {}


def _color_for_session(session_id: str) -> str:
    """Deterministic color per session — stable across broadcasts."""
    h = 0
    for c in session_id:
        h = (h * 31 + ord(c)) & 0x7FFFFFFF
    return _PRESENCE_COLORS[h % len(_PRESENCE_COLORS)]


def _presence_snapshot() -> list[dict]:
    return [
        {
            "session_id":   sid,
            "display_name": _display_name_for(sid),
            "color":        _color_for_session(sid),
            "item_type":    data.get("item_type"),
            "item_id":      data.get("item_id"),
        }
        for sid, data in _presence.items()
    ]


# ── Phase 5 state — UPnP internet access ─────────────────────────────────────

# Runtime state (not persisted — rebuilt from scratch on each startup)
_upnp_active:       bool       = False
_upnp_external_ip:  str | None = None
_upnp_mapped_ports: list[int]  = []

# UPnP lease duration in seconds.
# 0 = permanent until explicitly deleted.
# We also register an atexit hook and a FastAPI shutdown hook for cleanup,
# so the most likely failure scenario (clean shutdown) is covered.
# If the process is hard-killed the mapping stays until the router restarts.
_UPNP_LEASE = 0

# Description string shown in the router's port-mapping table
_UPNP_DESC = "Foliantica Co-Work"


def is_upnp_disclaimer_accepted() -> bool:
    return bool(_read_config().get("cowork", {}).get("upnp_disclaimer_accepted", False))


def set_upnp_disclaimer_accepted() -> None:
    cfg = _read_config()
    cfg.setdefault("cowork", {})["upnp_disclaimer_accepted"] = True
    _write_config(cfg)


def upnp_open() -> dict:
    """Open UPnP port mappings so guests can reach Foliantica from the internet.

    Maps the Next.js port (web UI / HTTP proxy) and the FastAPI port (WebSocket).
    Runs synchronously; call via asyncio.to_thread() from async handlers.

    Returns a dict:  {success, external_ip?, external_url?, ports_mapped?, error?}
    """
    global _upnp_active, _upnp_external_ip, _upnp_mapped_ports

    try:
        import miniupnpc  # guarded import — optional dependency
    except ImportError:
        return {
            "success": False,
            "error": "miniupnpc is not installed. Run: pip install miniupnpc",
        }

    api_port  = int(os.environ.get("LW_API_PORT",  "8765"))
    web_port  = int(os.environ.get("LW_WEB_PORT",  "3000"))
    local_ip  = _get_lan_ip()
    ports     = [web_port, api_port]

    try:
        u = miniupnpc.UPnP()
        u.discoverdelay = 500          # ms to wait for IGD broadcast reply
        found = u.discover()
        if found == 0:
            return {
                "success": False,
                "error": (
                    "No UPnP gateway found on your network. "
                    "Your router may not support UPnP, or it is disabled in its settings."
                ),
            }

        u.selectigd()                  # choose the Internet Gateway Device
        external_ip = u.externalipaddress()

        mapped: list[int] = []
        errors: list[str] = []

        for port in ports:
            try:
                u.addportmapping(
                    port, "TCP",
                    local_ip, port,
                    _UPNP_DESC, _UPNP_LEASE,
                )
                mapped.append(port)
            except Exception as exc:
                errors.append(f"port {port}: {exc}")

        if not mapped:
            return {
                "success": False,
                "error": "Failed to map any ports. " + "; ".join(errors),
            }

        _upnp_active       = True
        _upnp_external_ip  = external_ip
        _upnp_mapped_ports = mapped

        return {
            "success":      True,
            "external_ip":  external_ip,
            "external_url": f"http://{external_ip}:{web_port}",
            "ports_mapped": mapped,
        }

    except Exception as exc:
        return {"success": False, "error": str(exc)}


def upnp_close() -> None:
    """Remove all UPnP port mappings created by this session.

    Safe to call even if UPnP was never opened or already closed.
    Runs synchronously; call via asyncio.to_thread() from async handlers
    or directly from atexit.
    """
    global _upnp_active, _upnp_external_ip, _upnp_mapped_ports

    ports_to_remove = list(_upnp_mapped_ports)

    # Reset state immediately so a second call is a no-op
    _upnp_active       = False
    _upnp_external_ip  = None
    _upnp_mapped_ports = []

    if not ports_to_remove:
        return

    try:
        import miniupnpc
    except ImportError:
        return  # if miniupnpc is gone we can't clean up — mapping will expire naturally

    try:
        u = miniupnpc.UPnP()
        u.discoverdelay = 500
        if u.discover() == 0:
            return  # router disappeared — nothing we can do
        u.selectigd()
        for port in ports_to_remove:
            try:
                u.deleteportmapping(port, "TCP")
            except Exception:
                pass  # best-effort; individual port failures don't stop the rest
    except Exception:
        pass  # best-effort; gateway may have gone offline


# Register atexit cleanup so the port is removed on interpreter exit even
# when the lifespan context manager isn't run (e.g. direct uvicorn invocation,
# keyboard interrupt before the ASGI app fully starts).
import atexit as _atexit
_atexit.register(upnp_close)


class ConnectionManager:
    """Tracks all open WebSocket connections and broadcasts messages to them."""

    def __init__(self) -> None:
        # session_id → WebSocket  (host uses session_id "host")
        self._connections: dict[str, WebSocket] = {}

    async def connect(self, ws: WebSocket, session_id: str) -> None:
        await ws.accept()
        self._connections[session_id] = ws

    def disconnect(self, session_id: str) -> None:
        self._connections.pop(session_id, None)

    @property
    def connected_count(self) -> int:
        return len(self._connections)

    async def send(self, session_id: str, message: dict) -> None:
        ws = self._connections.get(session_id)
        if ws:
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect(session_id)

    async def broadcast(self, message: dict, exclude: str | None = None) -> None:
        dead: list[str] = []
        for sid, ws in list(self._connections.items()):
            if sid == exclude:
                continue
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(sid)
        for sid in dead:
            self.disconnect(sid)


manager = ConnectionManager()


# ── Config helpers ────────────────────────────────────────────────────────────

def _read_config() -> dict:
    try:
        return json.loads(_CONFIG_PATH.read_text("utf-8"))
    except Exception:
        return {}


def _write_config(cfg: dict) -> None:
    _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    _CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")


def _get_invitations() -> list[dict]:
    return _read_config().get("cowork", {}).get("invitations", [])


def _save_invitations(invitations: list[dict]) -> None:
    cfg = _read_config()
    cfg.setdefault("cowork", {})["invitations"] = invitations
    _write_config(cfg)


def is_cowork_enabled() -> bool:
    return bool(_read_config().get("cowork", {}).get("enabled", False))


def set_cowork_enabled(enabled: bool) -> None:
    cfg = _read_config()
    cfg.setdefault("cowork", {})["enabled"] = enabled
    _write_config(cfg)


# ── JWT helpers ───────────────────────────────────────────────────────────────

def _issue_jwt(session_id: str, invitation_id: str, display_name: str, role: str) -> str:
    payload = {
        "session_id":    session_id,
        "invitation_id": invitation_id,
        "display_name":  display_name,
        "role":          role,
        "exp":           datetime.now(UTC) + timedelta(hours=_JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALGORITHM)


def verify_session_jwt(token: str) -> dict:
    """Decode and return JWT payload. Raises jwt.InvalidTokenError on failure."""
    return jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALGORITHM])


# ── Rate limiter ──────────────────────────────────────────────────────────────

def _is_banned(ip: str) -> bool:
    until = _bans.get(ip)
    if until is None:
        return False
    if datetime.now(UTC) < until:
        return True
    del _bans[ip]
    return False


def _record_failure(ip: str) -> None:
    """Ban IP for 300 s on the first wrong attempt."""
    _bans[ip] = datetime.now(UTC) + timedelta(seconds=300)


def seconds_until_unban(ip: str) -> int:
    until = _bans.get(ip)
    if until is None:
        return 0
    remaining = (until - datetime.now(UTC)).total_seconds()
    return max(0, int(remaining))


# ── Soft lock helpers ─────────────────────────────────────────────────────────

def _lock_key(item_type: str, item_id: int) -> str:
    return f"{item_type}:{item_id}"


def _prune_expired_locks() -> list[str]:
    """Remove expired locks, return list of pruned keys."""
    now = datetime.now(UTC)
    expired = [k for k, v in _locks.items() if now > v["expires_at"]]
    for k in expired:
        del _locks[k]
    return expired


def _lock_snapshot() -> list[dict]:
    _prune_expired_locks()
    return [
        {k: v for k, v in rec.items() if k != "expires_at"}
        for rec in _locks.values()
    ]


def _display_name_for(session_id: str) -> str:
    if session_id == "host":
        return "Host"
    s = _sessions.get(session_id)
    return s["display_name"] if s else session_id


def _is_assigned(session: dict, item_type: str, item_id: int) -> bool:
    """Return True if a student session has the given item in its assignment.
    An empty assigned_items list means no access to anything."""
    assigned = session.get("assigned_items", [])
    if not assigned:
        return False
    return any(
        a.get("type") == item_type and a.get("id") == item_id
        for a in assigned
    )


# ── Broadcast scheduler (sync → async bridge) ─────────────────────────────────

def _schedule_broadcast(message: dict) -> None:
    """Schedule a WebSocket broadcast from a synchronous context.

    Called from SQLAlchemy event hooks which fire synchronously inside async
    FastAPI request handlers — but always in the event loop's thread, so
    create_task() is safe as long as a loop is running.
    """
    if not manager.connected_count:
        return  # nobody to notify — skip the overhead
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(manager.broadcast(message))
    except RuntimeError:
        pass  # no running loop (startup / test context)


def broadcast_change(tables: list[str]) -> None:
    """Public entry-point called by the SQLAlchemy after_commit hook in main.py."""
    _schedule_broadcast({"type": "change", "tables": tables})


# ── LAN IP detection ──────────────────────────────────────────────────────────

def _get_lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class CoworkToggle(BaseModel):
    enabled: bool

class InvitationCreate(BaseModel):
    name: str
    role: str = "coauthor"        # coauthor | student
    pin: Optional[str] = None     # plain text; stored as bcrypt hash
    max_sessions: int = 1
    assigned_items: list[dict] = []

class InvitationUpdate(BaseModel):
    name:           Optional[str]       = None
    role:           Optional[str]       = None
    pin:            Optional[str]       = None  # "" = clear PIN
    max_sessions:   Optional[int]       = None
    assigned_items: Optional[list[dict]] = None

class JoinRequest(BaseModel):
    token:        str
    display_name: str
    pin:          Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/info")
def get_info(request: Request):
    """Network info + status. Also validates an invitation token if provided,
    so the /join page can show the invitation name and whether a PIN is needed."""
    lan_ip = _get_lan_ip()
    port   = int(request.url.port or 8765)
    web_port = port  # same port exposed to the outside (Next.js sits in front)

    result: dict = {
        "enabled":         is_cowork_enabled(),
        "lan_ip":          lan_ip,
        "api_port":        port,
        "lan_url":         f"http://{lan_ip}:3000",
        "active_sessions": len(_sessions),
    }

    # Optional: validate invitation token (used by /join page)
    token = request.query_params.get("token")
    if token:
        inv = next((i for i in _get_invitations() if i["token"] == token), None)
        if inv:
            result["invitation"] = {
                "name":      inv["name"],
                "role":      inv["role"],
                "has_pin":   bool(inv.get("pin_hash")),
            }
        else:
            result["invitation"] = None

    return result


# ── Invitation CRUD ───────────────────────────────────────────────────────────

@router.get("/invitations")
def list_invitations():
    return [_safe_inv(i) for i in _get_invitations()]


@router.post("/invitations", status_code=201)
def create_invitation(body: InvitationCreate):
    if body.role not in ("coauthor", "student"):
        raise HTTPException(status_code=400, detail="role must be 'coauthor' or 'student'")
    invs = _get_invitations()
    inv: dict = {
        "id":             str(uuid.uuid4()),
        "name":           body.name.strip(),
        "token":          secrets.token_hex(32),
        "role":           body.role,
        "pin_hash":       _hash_pin(body.pin) if body.pin else None,
        "max_sessions":   max(1, body.max_sessions),
        "assigned_items": body.assigned_items,
    }
    invs.append(inv)
    _save_invitations(invs)
    return _safe_inv(inv)


@router.patch("/invitations/{inv_id}")
def update_invitation(inv_id: str, body: InvitationUpdate):
    invs = _get_invitations()
    for inv in invs:
        if inv["id"] == inv_id:
            if body.name is not None:
                inv["name"] = body.name.strip()
            if body.role is not None:
                inv["role"] = body.role
            if body.pin is not None:
                # empty string = clear PIN
                inv["pin_hash"] = _hash_pin(body.pin) if body.pin else None
            if body.max_sessions is not None:
                inv["max_sessions"] = max(1, body.max_sessions)
            if body.assigned_items is not None:
                inv["assigned_items"] = body.assigned_items
            _save_invitations(invs)
            return _safe_inv(inv)
    raise HTTPException(status_code=404, detail="Invitation not found")


@router.delete("/invitations/{inv_id}", status_code=204)
def delete_invitation(inv_id: str):
    invs = _get_invitations()
    new_invs = [i for i in invs if i["id"] != inv_id]
    if len(new_invs) == len(invs):
        raise HTTPException(status_code=404, detail="Invitation not found")
    _save_invitations(new_invs)
    # Evict active sessions for this invitation
    for sid in [s for s, d in _sessions.items() if d["invitation_id"] == inv_id]:
        _sessions.pop(sid, None)


@router.get("/invitations/{inv_id}/token")
def get_invitation_token(inv_id: str, request: Request):
    """Return the raw invitation token for the 'Copy link' button.
    Includes a ready-to-share join URL using the detected LAN IP."""
    for inv in _get_invitations():
        if inv["id"] == inv_id:
            lan_ip  = _get_lan_ip()
            port    = int(request.url.port or 8765)
            join_url = f"http://{lan_ip}:3000/join?token={inv['token']}"
            return {"token": inv["token"], "join_url": join_url}
    raise HTTPException(status_code=404, detail="Invitation not found")


# ── Join / auth ───────────────────────────────────────────────────────────────

@router.post("/join")
def join(body: JoinRequest, request: Request):
    """
    Guest authentication endpoint.
    Validates invitation token + optional PIN → issues a JWT session.
    Enforces: 1 wrong attempt → 300 s IP ban per client IP.
    """
    # Real client IP is forwarded by the Next.js proxy as X-Client-IP.
    # Fall back to direct connection IP if header is absent.
    client_ip = (
        request.headers.get("X-Client-IP")
        or (request.client.host if request.client else "0.0.0.0")
    )

    if _is_banned(client_ip):
        remaining = seconds_until_unban(client_ip)
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed attempts. Try again in {remaining} seconds.",
        )

    # Locate invitation
    inv = next((i for i in _get_invitations() if i["token"] == body.token), None)
    if inv is None:
        _record_failure(client_ip)
        raise HTTPException(status_code=401, detail="Invalid invitation token.")

    # Verify PIN
    if inv.get("pin_hash"):
        if not body.pin:
            raise HTTPException(status_code=401, detail="A PIN is required for this invitation.")
        if not bcrypt.checkpw(body.pin.encode(), inv["pin_hash"].encode()):
            _record_failure(client_ip)
            raise HTTPException(status_code=401, detail="Incorrect PIN.")

    # Enforce max concurrent sessions
    active = [s for s in _sessions.values() if s["invitation_id"] == inv["id"]]
    if len(active) >= inv.get("max_sessions", 1):
        raise HTTPException(
            status_code=409,
            detail=f"This invitation already has {inv['max_sessions']} active session(s). "
                   "Ask the host to increase the limit or revoke an existing session.",
        )

    display_name = body.display_name.strip() or inv["name"]
    session_id   = str(uuid.uuid4())
    _sessions[session_id] = {
        "session_id":      session_id,
        "invitation_id":   inv["id"],
        "invitation_name": inv["name"],
        "display_name":    display_name,
        "role":            inv["role"],
        "assigned_items":  inv.get("assigned_items", []),
        "joined_at":       datetime.now(UTC).isoformat(),
        "client_ip":       client_ip,
    }

    token = _issue_jwt(session_id, inv["id"], display_name, inv["role"])
    return {
        "jwt":          token,
        "session_id":   session_id,
        "display_name": display_name,
        "role":         inv["role"],
        "expires_in":   _JWT_EXPIRE_HOURS * 3600,
    }


# ── Session management (host view) ────────────────────────────────────────────

@router.get("/sessions")
def list_sessions():
    """All active guest sessions — visible to the host."""
    return list(_sessions.values())


@router.post("/kick/{session_id}", status_code=204)
def kick_session(session_id: str):
    """Forcibly end a guest session (host action)."""
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    _sessions.pop(session_id)


# ── Phase 2: WebSocket ───────────────────────────────────────────────────────

@router.get("/ws-url")
def get_ws_url(request: Request):
    """Return the port the FastAPI server is listening on so the frontend can
    build the WebSocket URL: ws://<host>:<port>/ws/collab

    The Next.js proxy cannot tunnel WebSocket upgrades, so the client connects
    directly to FastAPI.  Both ports are accessible on the same host IP.
    """
    if not is_cowork_enabled():
        return {"enabled": False, "ws_port": None}
    port = int(os.environ.get("LW_API_PORT", "8765"))
    return {"enabled": True, "ws_port": port}


@router.websocket("/ws/collab")
async def ws_collab(ws: WebSocket, token: str = Query(default="")):
    """
    WebSocket endpoint for real-time collaboration.

    Auth:
      - Connections from 127.0.0.1/::1 are treated as the host — no token needed.
      - External connections must supply a valid session JWT as ?token=<jwt>.
        (Browser WebSocket API doesn't support custom headers, so query param it is.)

    Protocol (JSON messages):
      Client → Server:
        {type:"lock",      item_type, item_id}  acquire exclusive edit lock
        {type:"unlock",    item_type, item_id}  release lock
        {type:"heartbeat", item_type, item_id}  extend lock TTL by 30 s
        {type:"ping"}                           keepalive

      Server → Client:
        {type:"state",   locks:[...], sessions:[...]}  initial snapshot on connect
        {type:"change",  tables:[...]}                  DB rows changed
        {type:"locks",   locks:[...]}                   lock table updated
        {type:"lock_denied", item_type, item_id, holder}  lock request refused
    """
    client_host = ws.client.host if ws.client else "127.0.0.1"
    is_local = client_host in ("127.0.0.1", "::1")

    # ── Authenticate ──────────────────────────────────────────────────────────
    if is_cowork_enabled() and not is_local:
        if not token:
            await ws.close(code=1008, reason="Authentication required")
            return
        try:
            payload = verify_session_jwt(token)
            session_id = payload["session_id"]
        except jwt.InvalidTokenError:
            await ws.close(code=1008, reason="Invalid or expired token")
            return
    else:
        session_id = "host"

    # ── Connect ───────────────────────────────────────────────────────────────
    await manager.connect(ws, session_id)
    _presence[session_id] = {"item_type": None, "item_id": None}
    try:
        # Send initial state snapshot (my_session_id lets client know its own id)
        await ws.send_json({
            "type":          "state",
            "my_session_id": session_id,
            "locks":         _lock_snapshot(),
            "sessions":      list(_sessions.values()),
            "presence":      _presence_snapshot(),
        })
        # Notify other clients of the new joiner
        await manager.broadcast(
            {"type": "presence", "sessions": _presence_snapshot()},
            exclude=session_id,
        )

        # ── Message loop ──────────────────────────────────────────────────────
        while True:
            try:
                data = await ws.receive_json()
            except WebSocketDisconnect:
                break
            except Exception:
                break

            msg_type = data.get("type")

            if msg_type == "lock":
                item_type = data.get("item_type", "scene")
                item_id   = int(data.get("item_id", 0))
                key       = _lock_key(item_type, item_id)
                _prune_expired_locks()

                # Students may only lock items explicitly in their assignment
                sess = _sessions.get(session_id, {})
                if sess.get("role") == "student" and not _is_assigned(sess, item_type, item_id):
                    await manager.send(session_id, {
                        "type":      "lock_denied",
                        "item_type": item_type,
                        "item_id":   item_id,
                        "holder":    None,
                        "reason":    "not_assigned",
                    })
                else:
                    existing = _locks.get(key)
                    if existing and existing["session_id"] != session_id:
                        # Denied — locked by someone else
                        await manager.send(session_id, {
                            "type":      "lock_denied",
                            "item_type": item_type,
                            "item_id":   item_id,
                            "holder":    existing["display_name"],
                            "reason":    "locked",
                        })
                    else:
                        _locks[key] = {
                            "session_id":   session_id,
                            "display_name": _display_name_for(session_id),
                            "item_type":    item_type,
                            "item_id":      item_id,
                            "expires_at":   datetime.now(UTC) + timedelta(seconds=_LOCK_TTL),
                        }
                        await manager.broadcast({"type": "locks", "locks": _lock_snapshot()})

            elif msg_type == "unlock":
                key = _lock_key(data.get("item_type", "scene"), int(data.get("item_id", 0)))
                if key in _locks and _locks[key]["session_id"] == session_id:
                    del _locks[key]
                await manager.broadcast({"type": "locks", "locks": _lock_snapshot()})

            elif msg_type == "heartbeat":
                key = _lock_key(data.get("item_type", "scene"), int(data.get("item_id", 0)))
                if key in _locks and _locks[key]["session_id"] == session_id:
                    _locks[key]["expires_at"] = (
                        datetime.now(UTC) + timedelta(seconds=_LOCK_TTL)
                    )

            elif msg_type == "presence":
                item_type = data.get("item_type")   # str or None
                item_id   = data.get("item_id")     # int or None
                _presence[session_id] = {
                    "item_type": item_type,
                    "item_id":   int(item_id) if item_id is not None else None,
                }
                await manager.broadcast({"type": "presence", "sessions": _presence_snapshot()})

            elif msg_type == "ping":
                await manager.send(session_id, {"type": "pong"})

    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(session_id)
        # Release every lock this session held and notify others
        held = [k for k, v in list(_locks.items()) if v["session_id"] == session_id]
        for k in held:
            del _locks[k]
        if held:
            await manager.broadcast({"type": "locks", "locks": _lock_snapshot()})
        # Clear presence and notify remaining clients
        _presence.pop(session_id, None)
        if manager.connected_count:
            await manager.broadcast({"type": "presence", "sessions": _presence_snapshot()})


# ── Phase 5: UPnP endpoints ──────────────────────────────────────────────────

@router.get("/upnp/status")
def upnp_status():
    """Current UPnP state and whether the user has accepted the disclaimer."""
    web_port = int(os.environ.get("LW_WEB_PORT", "3000"))
    return {
        "active":               _upnp_active,
        "disclaimer_accepted":  is_upnp_disclaimer_accepted(),
        "external_ip":          _upnp_external_ip,
        "external_url": (
            f"http://{_upnp_external_ip}:{web_port}" if _upnp_external_ip else None
        ),
        "ports_mapped": _upnp_mapped_ports,
    }


@router.post("/upnp/accept-disclaimer", status_code=200)
def upnp_accept_disclaimer():
    """Persist the user's acknowledgement of the UPnP risk disclaimer."""
    set_upnp_disclaimer_accepted()
    return {"disclaimer_accepted": True}


@router.post("/upnp/open")
async def upnp_open_endpoint():
    """Discover the UPnP gateway and open port mappings.
    Runs in a thread pool because miniupnpc discovery is a blocking network call.
    """
    result = await asyncio.to_thread(upnp_open)
    if not result.get("success"):
        raise HTTPException(status_code=503, detail=result.get("error", "UPnP failed"))
    return result


@router.post("/upnp/close")
async def upnp_close_endpoint():
    """Remove all UPnP port mappings opened by this session."""
    await asyncio.to_thread(upnp_close)
    return {"active": False}


# ── Teacher view ─────────────────────────────────────────────────────────────

@router.get("/teacher-view")
def teacher_view():
    """Active sessions merged with their current presence location.
    Used by the host to monitor students without a live WebSocket connection."""
    result = []
    for sid, sess in _sessions.items():
        loc = _presence.get(sid, {})
        result.append({
            **{k: v for k, v in sess.items()},
            "color":     _color_for_session(sid),
            "item_type": loc.get("item_type"),
            "item_id":   loc.get("item_id"),
        })
    return result


# ── Co-work toggle ────────────────────────────────────────────────────────────

@router.post("/toggle")
def toggle_cowork(body: CoworkToggle):
    """Enable or disable co-work mode. Requires an app restart to take effect
    (changes the bind address from 127.0.0.1 → 0.0.0.0)."""
    set_cowork_enabled(body.enabled)
    return {"enabled": body.enabled, "restart_required": True}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode(), bcrypt.gensalt()).decode()


def _safe_inv(inv: dict) -> dict:
    """Strip pin_hash; add has_pin bool."""
    return {k: v for k, v in inv.items() if k != "pin_hash"} | {
        "has_pin": bool(inv.get("pin_hash"))
    }
