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
- The collab WS upgrade is proxied through Next.js (web/server-wrapper.js)
  to FastAPI over loopback, exactly like REST — both ports never need to be
  reachable from outside this machine even when co-work is enabled.
- Host-trust (no JWT needed) is granted via, in order: (1) a per-launch
  secret only Electron's own window can attach (main.py / this module both
  check it independently), (2) the request's peer being loopback AND its
  Origin (if any) matching the web server's own port — necessary because
  proxying the WS through Next.js means the peer is loopback for ALL
  traffic now, host and guest alike, so it alone is no longer sufficient.
  See COWORKING_NETWORK_SECURITY_SUMMARY.md for the full threat model.
- The WS endpoint reads the JWT from a query-string parameter (?token=...)
  because browser WebSocket API doesn't support custom headers for guests.
- JWT secret is persisted in config.json; guests survive API restarts.
"""

import asyncio
import hmac
import json
import os
import re
import secrets
import socket
import subprocess
import threading
import uuid
from datetime import datetime, UTC, timedelta
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from starlette.websockets import WebSocketDisconnect

import bcrypt
import jwt
from fastapi import APIRouter, HTTPException, Query, Request, WebSocket
from pydantic import BaseModel

from crypto import encrypt, decrypt

router = APIRouter(prefix="/api/collab", tags=["collab"])

# ── Module-level state ────────────────────────────────────────────────────────

_CONFIG_PATH = Path.home() / ".foliantica" / "config.json"


def _load_jwt_secret() -> str:
    """Load the JWT secret from config.json, generating and persisting one if absent."""
    cfg: dict = {}
    try:
        cfg = json.loads(_CONFIG_PATH.read_text("utf-8"))
        stored = cfg.get("cowork", {}).get("jwt_secret")
        if isinstance(stored, str) and stored:
            return stored
    except Exception:
        pass
    secret = secrets.token_hex(32)
    try:
        _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        cfg.setdefault("cowork", {})["jwt_secret"] = secret
        _CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass
    return secret


_JWT_SECRET: str = _load_jwt_secret()
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

# Valid access modes per role — controls REST write rights and scene visibility
_COAUTHOR_MODES: frozenset[str] = frozenset({"default", "appearance_only", "read_only"})
_STUDENT_MODES:  frozenset[str] = frozenset({"default", "read_only", "read_only_assigned", "assigned_visible"})

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


import atexit as _atexit


# ── Phase 6 state — Cloudflare Tunnel ────────────────────────────────────────

_cf_process: "subprocess.Popen[str] | None" = None
_cf_url:     str | None = None
_cf_active:  bool = False

# Regex that matches the trycloudflare.com URL printed by cloudflared.
# The URL always appears somewhere in a log line, e.g.:
#   INF |  https://random-words.trycloudflare.com  |
# The subdomain is captured separately so callers can require a hyphen —
# cloudflared also logs its own Cloudflare API calls (e.g. https://api.trycloudflare.com)
# which match this pattern but are not the quick-tunnel URL. Quick tunnel
# subdomains are always multiple random words joined by hyphens, so a bare
# single-word subdomain like "api" can be told apart from the real tunnel URL.
_CF_URL_RE = re.compile(r'https://([a-z0-9-]+)\.trycloudflare\.com')


def cloudflare_open() -> dict:
    """Start a Cloudflare quick tunnel pointing at the local web port.

    Spawns `cloudflared tunnel --url http://localhost:{port}` and reads its
    merged stdout/stderr until the trycloudflare.com URL appears (≤ 30 s).

    No Cloudflare account is needed — quick tunnels are free and ephemeral.
    Traffic is encrypted end-to-end with a CA-signed HTTPS certificate.

    Returns {success, url} or {success: False, error}.
    Runs synchronously; call via asyncio.to_thread() from async handlers.
    """
    global _cf_process, _cf_url, _cf_active

    web_port = int(os.environ.get("LW_WEB_PORT", "3000"))

    try:
        proc = subprocess.Popen(
            [
                "cloudflared", "tunnel",
                "--url", f"http://localhost:{web_port}",
                # Rewrite the Host header so the local Next.js server sees
                # "localhost" instead of the public *.trycloudflare.com hostname.
                # Without this, Next.js (and many other servers) reject the request
                # because the Host doesn't match any known origin → Cloudflare 1033.
                "--http-host-header", f"localhost:{web_port}",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # merge stderr into stdout
            text=True,
            bufsize=1,                 # line-buffered so we see each line ASAP
        )
    except FileNotFoundError:
        return {
            "success": False,
            "error": (
                "cloudflared is not installed. "
                "Download it from https://developers.cloudflare.com/"
                "cloudflare-one/connections/connect-apps/install-and-setup/installation/"
            ),
        }

    _cf_process = proc
    found: list[str] = []  # mutable so the thread can write to it
    ready = threading.Event()

    def _reader() -> None:
        for line in proc.stdout:  # type: ignore[union-attr]
            m = _CF_URL_RE.search(line)
            if m and "-" in m.group(1):  # skip cloudflared's own API calls (e.g. api.trycloudflare.com)
                found.append(m.group(0))
                ready.set()
                return
        ready.set()  # process exited without printing a URL

    threading.Thread(target=_reader, daemon=True).start()

    if not ready.wait(timeout=30):
        proc.terminate()
        _cf_process = None
        return {"success": False, "error": "Timed out waiting for tunnel URL (30 s)."}

    if not found:
        proc.terminate()
        _cf_process = None
        return {
            "success": False,
            "error": (
                "cloudflared exited without providing a tunnel URL. "
                "Ensure cloudflared is up to date."
            ),
        }

    _cf_url    = found[0]
    _cf_active = True
    return {"success": True, "url": _cf_url}


def cloudflare_close() -> None:
    """Terminate the cloudflared process and reset state.

    Safe to call when no tunnel is active; idempotent.
    Runs synchronously; call via asyncio.to_thread() from async handlers
    or directly from atexit.
    """
    global _cf_process, _cf_url, _cf_active

    proc        = _cf_process
    _cf_process = None
    _cf_url     = None
    _cf_active  = False

    if proc is None:
        return
    try:
        proc.terminate()
        proc.wait(timeout=5)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


_atexit.register(cloudflare_close)


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

def _issue_jwt(
    session_id: str,
    invitation_id: str,
    display_name: str,
    role: str,
    access_mode: str = "default",
    assigned_scene_ids: list[int] | None = None,
    assigned_scene_permissions: dict[int, str] | None = None,
) -> str:
    payload = {
        "session_id":                  session_id,
        "invitation_id":               invitation_id,
        "display_name":                display_name,
        "role":                        role,
        "access_mode":                 access_mode,
        "assigned_scene_ids":          assigned_scene_ids or [],
        "assigned_scene_permissions":  assigned_scene_permissions or {},
        "exp":                         datetime.now(UTC) + timedelta(hours=_JWT_EXPIRE_HOURS),
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
    access_mode: str = "default"  # see _COAUTHOR_MODES / _STUDENT_MODES

class InvitationUpdate(BaseModel):
    name:           Optional[str]        = None
    role:           Optional[str]        = None
    pin:            Optional[str]        = None  # "" = clear PIN
    max_sessions:   Optional[int]        = None
    assigned_items: Optional[list[dict]] = None
    access_mode:    Optional[str]        = None

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
    port     = int(request.url.port or 8765)
    web_port = int(os.environ.get("LW_WEB_PORT", "3000"))
    result: dict = {
        "enabled":         is_cowork_enabled(),
        "lan_ip":          lan_ip,
        "api_port":        port,
        "lan_url":         f"http://{lan_ip}:{web_port}",
        "active_sessions": len(_sessions),
    }

    # Optional: validate invitation token (used by /join page)
    token = request.query_params.get("token")
    if token:
        inv = next((i for i in _get_invitations() if _token_matches(i, token)), None)
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
    return [_safe_inv_listing(i) for i in _get_invitations()]


@router.post("/invitations", status_code=201)
def create_invitation(body: InvitationCreate):
    if body.role not in ("coauthor", "student"):
        raise HTTPException(status_code=400, detail="role must be 'coauthor' or 'student'")
    valid_modes = _COAUTHOR_MODES if body.role == "coauthor" else _STUDENT_MODES
    if body.access_mode not in valid_modes:
        raise HTTPException(
            status_code=400,
            detail=f"access_mode '{body.access_mode}' is not valid for role '{body.role}'. "
                   f"Valid modes: {sorted(valid_modes)}",
        )
    invs = _get_invitations()
    inv: dict = {
        "id":             str(uuid.uuid4()),
        "name":           body.name.strip(),
        "token":          encrypt(secrets.token_hex(32)),
        "role":           body.role,
        "pin_hash":       _hash_pin(body.pin) if body.pin else None,
        "max_sessions":   max(1, body.max_sessions),
        "assigned_items": body.assigned_items,
        "access_mode":    body.access_mode,
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
            if body.access_mode is not None:
                role = inv.get("role", "coauthor")
                valid_modes = _COAUTHOR_MODES if role == "coauthor" else _STUDENT_MODES
                if body.access_mode not in valid_modes:
                    raise HTTPException(
                        status_code=400,
                        detail=f"access_mode '{body.access_mode}' is not valid for role '{role}'.",
                    )
                inv["access_mode"] = body.access_mode
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
            lan_ip   = _get_lan_ip()
            web_port = int(os.environ.get("LW_WEB_PORT", "3000"))
            raw_token = _inv_token(inv)
            join_url = f"http://{lan_ip}:{web_port}/join?token={raw_token}"
            return {"token": raw_token, "join_url": join_url}
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
    inv = next((i for i in _get_invitations() if _token_matches(i, body.token)), None)
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
    access_mode  = inv.get("access_mode", "default")
    _sessions[session_id] = {
        "session_id":      session_id,
        "invitation_id":   inv["id"],
        "invitation_name": inv["name"],
        "display_name":    display_name,
        "role":            inv["role"],
        "access_mode":     access_mode,
        "assigned_items":  inv.get("assigned_items", []),
        "joined_at":       datetime.now(UTC).isoformat(),
        "client_ip":       client_ip,
    }

    assigned_items = inv.get("assigned_items", [])
    assigned_scene_ids = [a["id"] for a in assigned_items if a.get("type") == "scene"]
    assigned_scene_permissions = {
        a["id"]: a.get("permission", "edit")
        for a in assigned_items if a.get("type") == "scene"
    }
    token = _issue_jwt(
        session_id, inv["id"], display_name, inv["role"],
        access_mode=access_mode,
        assigned_scene_ids=assigned_scene_ids,
        assigned_scene_permissions=assigned_scene_permissions,
    )
    return {
        "jwt":          token,
        "session_id":   session_id,
        "display_name": display_name,
        "role":         inv["role"],
        "access_mode":  access_mode,
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

# Same per-launch secret main.py checks for REST — see its definition there
# and COWORKING_NETWORK_SECURITY_SUMMARY.md for the full rationale.
_HOST_SECRET = os.environ.get("FOLIANTICA_HOST_SECRET", "")


def _origin_matches_web_port(origin: str | None) -> bool:
    """True if Origin is absent, or it is a loopback origin on the web port.

    The WS upgrade is proxied through Next.js (server-wrapper.js) as a raw
    socket passthrough — the client's original Origin header reaches FastAPI
    unchanged, while ws.client.host is always 127.0.0.1 (the proxy hop).
    We therefore check BOTH the hostname (must be loopback) and the port
    (must match LW_WEB_PORT) to avoid granting host-trust to a LAN student
    whose browser sends Origin: http://192.168.x.x:3000 — port matches, but
    hostname is not loopback, so it must go through the JWT path instead.

    Browsers can't forge the Origin header, so this reliably distinguishes
    the host's own page (localhost:3000) from remote guests (lan-ip:3000 or
    Cloudflare tunnel). Non-browser clients that omit Origin are trusted only
    when no origin is present at all — the host secret check covers Electron."""
    if not origin:
        return True
    try:
        parsed = urlparse(origin)
    except ValueError:
        return False
    host = parsed.hostname or ""
    if host not in ("localhost", "127.0.0.1", "::1", ""):
        return False
    web_port = int(os.environ.get("LW_WEB_PORT", "3000"))
    origin_port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return origin_port == web_port


@router.get("/ws-url")
def get_ws_url(request: Request):
    """Tell the frontend whether it should open the collab WebSocket.

    The WS upgrade is proxied through Next.js (server-wrapper.js) to FastAPI
    over loopback, exactly like every REST call — so the client always
    connects to its own page's host:port, no separate port needed.
    """
    return {"enabled": is_cowork_enabled()}


@router.websocket("/ws/collab")
async def ws_collab(ws: WebSocket, token: str = Query(default="")):
    """
    WebSocket endpoint for real-time collaboration.

    Auth (checked in order — see COWORKING_NETWORK_SECURITY_SUMMARY.md):
      1. X-Foliantica-Host-Secret header matches FOLIANTICA_HOST_SECRET — set
         only by Electron's own window via webRequest (page JS can't set
         custom WS handshake headers at all). Trusted outright.
      2. Otherwise: the connection's peer must be loopback AND its Origin
         (if any) must match the web server's own port. Browsers can't lie
         about Origin, so this still tells our own page apart from a
         malicious tab on the same machine connecting straight to this port
         — ws.client.host alone stopped being a useful signal once the WS
         upgrade started being proxied through Next.js (server-wrapper.js),
         since that makes it loopback for ALL traffic, host and guest alike.
      3. Otherwise: a valid session JWT as ?token=<jwt> is required.
        (Browser WebSocket API doesn't support custom headers for guests
        without Electron's privileged hook, so query param it is.)

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
    provided_secret = ws.headers.get("x-foliantica-host-secret", "")
    has_valid_secret = bool(_HOST_SECRET) and hmac.compare_digest(provided_secret, _HOST_SECRET)

    # server-wrapper.js now injects X-Internal-Real-Peer for WS upgrades
    # (same as it does for REST via route.ts).  Fall back to ws.client.host
    # for dev mode where the wrapper is not active (plain `next dev`).
    raw_peer = (
        ws.headers.get("x-internal-real-peer")
        or (ws.client.host if ws.client else "127.0.0.1")
    )
    if raw_peer.startswith("::ffff:"):
        raw_peer = raw_peer[7:]
    peer_is_loopback = raw_peer in ("127.0.0.1", "::1")

    is_local = has_valid_secret or (
        peer_is_loopback and _origin_matches_web_port(ws.headers.get("origin"))
    )

    # ── Authenticate ──────────────────────────────────────────────────────────
    # Token present → always guest, regardless of IP/origin.  The host never
    # presents a JWT (Electron injects the secret instead, or the loopback +
    # origin check handles dev mode).  Treating a token-bearing connection as
    # the host was the root bug: students connecting from localhost (same
    # machine as the teacher, or dev testing) passed the is_local check and
    # shared session_id "host", collapsing all presence into one entry and
    # bypassing assignment enforcement entirely.
    #
    # Co-work-enabled is checked for all non-local paths, so disabling
    # co-work immediately revokes access even for already-issued JWTs.
    if token:
        if not is_cowork_enabled():
            await ws.close(code=1008, reason="Co-work is disabled")
            return
        try:
            payload = verify_session_jwt(token)
            session_id = payload["session_id"]
        except jwt.InvalidTokenError:
            await ws.close(code=1008, reason="Invalid or expired token")
            return
        # Restore session if wiped by a backend restart (JWT is still valid)
        if session_id not in _sessions:
            scene_ids = payload.get("assigned_scene_ids", [])
            perm_map  = payload.get("assigned_scene_permissions", {})
            _sessions[session_id] = {
                "session_id":      session_id,
                "invitation_id":   payload.get("invitation_id", ""),
                "invitation_name": payload.get("display_name", session_id),
                "display_name":    payload.get("display_name", session_id),
                "role":            payload.get("role", "coauthor"),
                "access_mode":     payload.get("access_mode", "default"),
                "assigned_items":  [
                    {
                        "type":       "scene",
                        "id":         int(sid),
                        "permission": perm_map.get(str(sid), perm_map.get(sid, "edit")),
                    }
                    for sid in scene_ids
                ],
                "joined_at": datetime.now(UTC).isoformat(),
                "client_ip": "",
            }
    elif is_local:
        session_id = "host"
    else:
        if not is_cowork_enabled():
            await ws.close(code=1008, reason="Co-work is disabled")
            return
        await ws.close(code=1008, reason="Authentication required")
        return

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

                sess = _sessions.get(session_id, {})
                denied_reason: str | None = None
                if sess.get("role") == "student":
                    if not _is_assigned(sess, item_type, item_id):
                        denied_reason = "not_assigned"
                    else:
                        perm = next(
                            (a.get("permission", "edit")
                             for a in sess.get("assigned_items", [])
                             if a.get("type") == item_type and a.get("id") == item_id),
                            "edit",
                        )
                        if perm == "read_only":
                            denied_reason = "read_only"

                if denied_reason:
                    await manager.send(session_id, {
                        "type":      "lock_denied",
                        "item_type": item_type,
                        "item_id":   item_id,
                        "holder":    None,
                        "reason":    denied_reason,
                    })
                else:
                    existing = _locks.get(key)
                    if existing and existing["session_id"] != session_id:
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


# ── Phase 6: Cloudflare Tunnel endpoints ─────────────────────────────────────

@router.get("/cloudflare/status")
def cloudflare_status_endpoint():
    """Current Cloudflare Tunnel state."""
    return {"active": _cf_active, "url": _cf_url}


@router.post("/cloudflare/open")
async def cloudflare_open_endpoint():
    """Start a Cloudflare quick tunnel.

    Blocks in a thread until cloudflared prints the tunnel URL (≤ 30 s).
    Returns the HTTPS URL that guests can use to reach this Foliantica instance.
    """
    result = await asyncio.to_thread(cloudflare_open)
    if not result.get("success"):
        raise HTTPException(status_code=503, detail=result.get("error", "Tunnel failed"))
    return result


@router.post("/cloudflare/close")
async def cloudflare_close_endpoint():
    """Terminate the Cloudflare Tunnel process."""
    await asyncio.to_thread(cloudflare_close)
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


def _inv_token(inv: dict) -> str:
    """Decrypt an invitation's stored token.

    Falls back to the raw stored value if decryption fails, so invitations
    written before this field was encrypted (plain hex) keep working —
    decrypt() returns None on any non-Fernet input rather than raising.
    """
    return decrypt(inv["token"]) or inv["token"]


def _token_matches(inv: dict, candidate: str) -> bool:
    return hmac.compare_digest(_inv_token(inv), candidate)


def _safe_inv(inv: dict) -> dict:
    """Strip pin_hash; decrypt token; add has_pin bool."""
    return {k: v for k, v in inv.items() if k != "pin_hash"} | {
        "has_pin": bool(inv.get("pin_hash")),
        "token":   _inv_token(inv),
    }


def _safe_inv_listing(inv: dict) -> dict:
    """Like _safe_inv, but also strips the token — used for the bulk listing
    endpoint so the raw token isn't handed out on every page load. Guests
    fetch it on demand via GET /invitations/{id}/token instead."""
    return {k: v for k, v in _safe_inv(inv).items() if k != "token"}
