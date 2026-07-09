"""
admin.py — Admin authentication & log inspection API routes.

Endpoints:
  POST /admin/login          — Validate credentials, return session token
  GET  /admin/verify         — Verify a token is still valid
  POST /admin/logout         — Invalidate the session token
  GET  /admin/logs           — Stream recent activity logs (requires auth)
  GET  /admin/stats          — Aggregate statistics (requires auth)
  DELETE /admin/logs/clear   — Clear all activity logs (requires auth)
"""

import os
import hashlib
import secrets
import time
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Header, Request
from pydantic import BaseModel
from typing import Optional

from admin_logger import write_log, read_logs, clear_logs, get_stats, EventType

# ── Configuration ─────────────────────────────────────────────────────────────
# Admin credentials (username is fixed; password can be overridden via env var)
ADMIN_USERNAME = "adminTrading"
_DEFAULT_PASSWORD_HASH = hashlib.sha256("Admin@Trading2025!".encode()).hexdigest()
ADMIN_PASSWORD_HASH = os.environ.get(
    "ADMIN_PASSWORD_HASH",
    _DEFAULT_PASSWORD_HASH
)

# In-memory token store: { token -> { "created_at": float, "last_seen": float } }
# Tokens expire after 4 hours of inactivity
_active_tokens: dict = {}
TOKEN_TTL_SECONDS = 4 * 60 * 60  # 4 hours

router = APIRouter(prefix="/admin", tags=["Admin"])


# ── Models ────────────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    username: str
    password: str


# ── Helper: token validation ──────────────────────────────────────────────────
def _validate_token(token: Optional[str]) -> bool:
    """Returns True if token exists and has not expired."""
    if not token:
        return False
    # Strip Bearer prefix if present
    token = token.replace("Bearer ", "").strip()
    session = _active_tokens.get(token)
    if not session:
        return False
    # Check TTL
    if time.time() - session["last_seen"] > TOKEN_TTL_SECONDS:
        _active_tokens.pop(token, None)
        return False
    # Refresh last-seen
    session["last_seen"] = time.time()
    return True


def _require_auth(authorization: Optional[str]):
    """Raises 401 if token is missing or invalid."""
    if not _validate_token(authorization):
        raise HTTPException(
            status_code=401,
            detail="Unauthorized. Please login as adminTrading."
        )


# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.post("/login")
def admin_login(req: LoginRequest, request: Request):
    """Authenticate with adminTrading credentials and receive a session token."""
    ip = request.client.host if request.client else "unknown"

    # Validate username
    if req.username != ADMIN_USERNAME:
        write_log(
            EventType.ADMIN_LOGIN_FAIL,
            {"reason": "Invalid username", "attempted_username": req.username},
            user=req.username,
            ip_address=ip,
            success=False
        )
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    # Validate password (compare SHA-256 hash)
    supplied_hash = hashlib.sha256(req.password.encode()).hexdigest()
    if supplied_hash != ADMIN_PASSWORD_HASH:
        write_log(
            EventType.ADMIN_LOGIN_FAIL,
            {"reason": "Invalid password", "attempted_username": req.username},
            user=req.username,
            ip_address=ip,
            success=False
        )
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    # Issue a new token
    token = secrets.token_hex(32)
    _active_tokens[token] = {
        "created_at": time.time(),
        "last_seen": time.time(),
        "username": ADMIN_USERNAME,
        "ip": ip
    }

    write_log(
        EventType.ADMIN_LOGIN,
        {"message": f"Admin '{ADMIN_USERNAME}' logged in successfully."},
        user=ADMIN_USERNAME,
        ip_address=ip,
        success=True
    )

    return {
        "success": True,
        "token": token,
        "username": ADMIN_USERNAME,
        "expires_in_seconds": TOKEN_TTL_SECONDS,
        "message": f"Welcome, {ADMIN_USERNAME}!"
    }


@router.get("/verify")
def admin_verify(authorization: Optional[str] = Header(None)):
    """Verify that the provided token is still valid."""
    if _validate_token(authorization):
        token = (authorization or "").replace("Bearer ", "").strip()
        session = _active_tokens.get(token, {})
        return {
            "valid": True,
            "username": session.get("username", ADMIN_USERNAME),
            "logged_in_since": datetime.fromtimestamp(
                session.get("created_at", time.time())
            ).strftime("%Y-%m-%d %H:%M:%S")
        }
    return {"valid": False}


@router.post("/logout")
def admin_logout(
    request: Request,
    authorization: Optional[str] = Header(None)
):
    """Invalidate the current admin session token."""
    ip = request.client.host if request.client else "unknown"
    token = (authorization or "").replace("Bearer ", "").strip()
    session = _active_tokens.pop(token, None)

    if session:
        write_log(
            EventType.ADMIN_LOGOUT,
            {"message": "Admin logged out."},
            user=session.get("username", ADMIN_USERNAME),
            ip_address=ip,
            success=True
        )

    return {"success": True, "message": "Logged out successfully."}


@router.get("/logs")
def admin_get_logs(
    limit: int = 200,
    event_type: str = "all",
    authorization: Optional[str] = Header(None)
):
    """
    Return the most recent `limit` activity log entries.
    Optionally filter by event_type prefix (e.g., 'TRAIN', 'ADMIN', 'PREDICT').
    """
    _require_auth(authorization)
    filter_val = None if event_type.lower() == 'all' else event_type
    logs = read_logs(limit=limit, event_filter=filter_val)
    return {
        "logs": logs,
        "count": len(logs),
        "filter": event_type,
        "retrieved_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }


@router.get("/stats")
def admin_get_stats(authorization: Optional[str] = Header(None)):
    """Return aggregate statistics about system activity."""
    _require_auth(authorization)
    stats = get_stats()
    return {
        "stats": stats,
        "retrieved_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }


@router.delete("/logs/clear")
def admin_clear_logs(
    request: Request,
    authorization: Optional[str] = Header(None)
):
    """Permanently delete all activity logs. This action is irreversible."""
    _require_auth(authorization)
    ip = request.client.host if request.client else "unknown"
    count = clear_logs()

    # Write a new entry after clearing so there's an audit trail
    write_log(
        EventType.LOGS_CLEARED,
        {"cleared_entries": count, "message": "All activity logs were cleared by admin."},
        user=ADMIN_USERNAME,
        ip_address=ip,
        success=True
    )

    return {
        "success": True,
        "cleared_entries": count,
        "message": f"Successfully cleared {count} log entries."
    }


@router.get("/active-sessions")
def admin_active_sessions(authorization: Optional[str] = Header(None)):
    """Return count and metadata of active admin sessions."""
    _require_auth(authorization)
    now = time.time()
    active = [
        {
            "ip": s.get("ip", "unknown"),
            "created_at": datetime.fromtimestamp(s["created_at"]).strftime("%Y-%m-%d %H:%M:%S"),
            "last_seen": datetime.fromtimestamp(s["last_seen"]).strftime("%Y-%m-%d %H:%M:%S"),
            "expires_in_minutes": round((TOKEN_TTL_SECONDS - (now - s["last_seen"])) / 60)
        }
        for s in _active_tokens.values()
        if now - s["last_seen"] <= TOKEN_TTL_SECONDS
    ]
    return {"active_sessions": active, "count": len(active)}
