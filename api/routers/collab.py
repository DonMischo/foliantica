"""
Co-Work collaboration module — Phase 1: Network foundation + auth.

Manages named invitations, guest authentication (token + optional PIN),
JWT session issuance, active session tracking, and LAN IP discovery.

Architecture
------------
- Invitations stored in ~/.foliantica/config.json under "cowork.invitations".
- Active sessions tracked in-memory (_sessions dict).
- Auth middleware lives in main.py; it reads X-Client-IP forwarded by the
  Next.js proxy and requires a Bearer JWT for non-localhost clients.
- Host (127.0.0.1) is always trusted by the middleware — no JWT needed.
- JWT secret is kept in-process (generated once per startup); guests must
  re-join after the host restarts the API.
- Rate limiter: 1 failed /join attempt → 300 s IP ban.
"""

import json
import secrets
import socket
import uuid
from datetime import datetime, UTC, timedelta
from pathlib import Path
from typing import Optional

import bcrypt
import jwt
from fastapi import APIRouter, HTTPException, Request
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
