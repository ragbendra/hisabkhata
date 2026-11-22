"""Signed-in devices: the limit, the idle sign-out and a readable name for each device.

A device is one row in `sessions`. The numbers live here, in one place.
"""

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import UserSession
from .timeutil import aware, utcnow

MAX_DEVICES = 3  # signed-in devices per login (the owner, and each helper)
MAX_HELPERS = 3  # helper logins per shop
IDLE_DAYS = 7  # a device not used for this long is signed out
TOUCH_EVERY = timedelta(minutes=5)  # last_seen is saved at most this often, so reads stay cheap


def last_seen(s: UserSession):
    return aware(s.last_seen_at or s.created_at)


def is_live(s: UserSession, now=None) -> bool:
    now = now or utcnow()
    return aware(s.expires_at) >= now and last_seen(s) >= now - timedelta(days=IDLE_DAYS)


def live_sessions(db: Session, user_id) -> list[UserSession]:
    """The user's devices that are still signed in, most recently used first. Dead ones are removed."""
    now = utcnow()
    alive = []
    for s in db.scalars(select(UserSession).where(UserSession.user_id == user_id)):
        if is_live(s, now):
            alive.append(s)
        else:
            db.delete(s)
    alive.sort(key=last_seen, reverse=True)
    return alive


def touch(db: Session, s: UserSession, ip: str | None) -> None:
    now = utcnow()
    if s.last_seen_at is None or now - aware(s.last_seen_at) >= TOUCH_EVERY:
        s.last_seen_at = now
        if ip:
            s.ip = ip[:64]
        db.commit()


def device_label(ua: str | None) -> str:
    """'Chrome on Windows', 'Safari on iPhone'... good enough to tell three devices apart."""
    u = (ua or "").lower()
    if not u:
        return "Unknown device"
    if "iphone" in u:
        os = "iPhone"
    elif "ipad" in u:
        os = "iPad"
    elif "android" in u:
        os = "Android"
    elif "windows" in u:
        os = "Windows"
    elif "mac os" in u or "macintosh" in u:
        os = "Mac"
    elif "cros" in u:
        os = "Chromebook"
    elif "linux" in u:
        os = "Linux"
    else:
        os = "Unknown system"
    if "edg/" in u or "edga/" in u or "edgios/" in u:
        br = "Edge"
    elif "opr/" in u or "opera" in u:
        br = "Opera"
    elif "samsungbrowser" in u:
        br = "Samsung Internet"
    elif "firefox" in u or "fxios" in u:
        br = "Firefox"
    elif "chrome" in u or "crios" in u:
        br = "Chrome"
    elif "safari" in u:
        br = "Safari"
    else:
        br = "Browser"
    return f"{br} on {os}"


def device_out(s: UserSession, current_id=None) -> dict:
    return {
        "id": str(s.id),
        "label": device_label(s.user_agent),
        "last_seen_at": last_seen(s).isoformat(),
        "signed_in_at": aware(s.created_at).isoformat(),
        "current": current_id is not None and s.id == current_id,
    }
