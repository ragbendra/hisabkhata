"""Security log for the platform admin: sign-in events, and a few simple rules that raise flags.

Flags are hints for a person to look at. Nothing here ever blocks or signs anyone out.
Sign-in records are deleted after RETENTION_DAYS.
"""

from datetime import timedelta

from fastapi import Request
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .models import AuditLog, SecurityEvent, SecurityFlag, Shop, User
from .ratelimit import client_ip
from .timeutil import utcnow

RETENTION_DAYS = 90

# thresholds, in one place
FAILED_PER_LOGIN_PER_HOUR = 5
FAILED_PER_IP_PER_HOUR = 10
IPS_PER_USER_PER_DAY = 4
DEVICE_LIMIT_HITS_PER_DAY = 3
DELETES_PER_SHOP_PER_HOUR = 5
EXPORTS_PER_SHOP_PER_DAY = 2


def record(db: Session, kind: str, request: Request | None = None, *, user: User | None = None, login: str | None = None,
           shop_id=None, detail: str | None = None) -> None:
    """Adds an event to the session. The caller commits. A failure here must never break a sign-in."""
    try:
        ua = (request.headers.get("user-agent") or "")[:300] if request is not None else None
        db.add(
            SecurityEvent(
                kind=kind,
                shop_id=shop_id or (user.shop_id if user else None),
                user_id=user.id if user else None,
                login=(login or (user.login if user else None) or None),
                ip=client_ip(request)[:64] if request is not None else None,
                user_agent=ua or None,
                detail=detail[:300] if detail else None,
            )
        )
    except Exception:  # pragma: no cover
        pass


def purge(db: Session) -> None:
    db.execute(delete(SecurityEvent).where(SecurityEvent.at < utcnow() - timedelta(days=RETENTION_DAYS)))


def _flag(db: Session, key: str, kind: str, severity: str, title: str, detail: str, shop_id=None, user_id=None) -> None:
    if db.scalar(select(SecurityFlag.id).where(SecurityFlag.key == key)):
        return
    db.add(SecurityFlag(key=key, kind=kind, severity=severity, shop_id=shop_id, user_id=user_id, title=title, detail=detail[:500]))
    db.flush()


def detect(db: Session) -> None:
    """Looks at the last day, raises a flag for anything over a threshold, and deletes old sign-in records."""
    purge(db)
    now = utcnow()
    hour, day = now - timedelta(hours=1), now - timedelta(days=1)
    hkey, dkey = f"{now:%Y%m%d%H}", f"{now:%Y%m%d}"
    ev = SecurityEvent

    users_by_login = {u.login: u for u in db.scalars(select(User))}
    shop_names = {s.id: s.name for s in db.scalars(select(Shop))}

    def shop_of(login=None, user_id=None, shop_id=None):
        u = users_by_login.get(login) if login else (db.get(User, user_id) if user_id else None)
        sid = shop_id or (u.shop_id if u else None)
        return sid, (u.id if u else None), (u.login if u else login), shop_names.get(sid, "")

    # 1. many wrong passwords on one login, or from one address
    for login, n in db.execute(
        select(ev.login, func.count()).where(ev.kind == "login_failed", ev.at >= hour, ev.login.is_not(None)).group_by(ev.login)
        .having(func.count() >= FAILED_PER_LOGIN_PER_HOUR)
    ):
        sid, uid, lg, sname = shop_of(login=login)
        _flag(db, f"failed:{login}:{hkey}", "failed_logins", "high" if n >= 2 * FAILED_PER_LOGIN_PER_HOUR else "warning",
              f"{n} wrong passwords for {login} in the last hour", f"Shop: {sname or 'unknown login'}", sid, uid)
    for ip, n in db.execute(
        select(ev.ip, func.count()).where(ev.kind == "login_failed", ev.at >= hour, ev.ip.is_not(None)).group_by(ev.ip)
        .having(func.count() >= FAILED_PER_IP_PER_HOUR)
    ):
        _flag(db, f"failedip:{ip}:{hkey}", "failed_logins", "high", f"{n} wrong passwords from address {ip} in the last hour",
              "Possibly someone guessing passwords.")

    # 2. one login used from many different addresses in a day (shared login, or a stolen one)
    for uid, n in db.execute(
        select(ev.user_id, func.count(func.distinct(ev.ip))).where(ev.kind == "login_ok", ev.at >= day, ev.user_id.is_not(None))
        .group_by(ev.user_id).having(func.count(func.distinct(ev.ip)) >= IPS_PER_USER_PER_DAY)
    ):
        sid, _, lg, sname = shop_of(user_id=uid)
        _flag(db, f"ips:{uid}:{dkey}", "many_addresses", "warning", f"{lg} signed in from {n} different addresses today",
              f"Shop: {sname}. Phones change address on mobile data, so this is only a hint.", sid, uid)

    # 3. someone keeps running into the 3-device limit
    for uid, n in db.execute(
        select(ev.user_id, func.count()).where(ev.kind == "device_limit", ev.at >= day, ev.user_id.is_not(None)).group_by(ev.user_id)
        .having(func.count() >= DEVICE_LIMIT_HITS_PER_DAY)
    ):
        sid, _, lg, sname = shop_of(user_id=uid)
        _flag(db, f"limit:{uid}:{dkey}", "device_limit", "warning", f"{lg} hit the 3-device limit {n} times today",
              f"Shop: {sname}. They may be sharing the login with others.", sid, uid)

    # 4. a burst of deleted or voided entries in one shop
    for sid, n in db.execute(
        select(AuditLog.shop_id, func.count()).where(AuditLog.action.in_(("delete", "void")), AuditLog.at >= hour)
        .group_by(AuditLog.shop_id).having(func.count() >= DELETES_PER_SHOP_PER_HOUR)
    ):
        _flag(db, f"deletes:{sid}:{hkey}", "delete_burst", "high", f"{n} entries deleted or voided in the last hour",
              f"Shop: {shop_names.get(sid, '')}", sid)

    # 5. the whole khata downloaded again and again
    for sid, n in db.execute(
        select(ev.shop_id, func.count()).where(ev.kind == "export_full", ev.at >= day, ev.shop_id.is_not(None)).group_by(ev.shop_id)
        .having(func.count() >= EXPORTS_PER_SHOP_PER_DAY)
    ):
        _flag(db, f"export:{sid}:{dkey}", "export", "info", f"Full export downloaded {n} times today", f"Shop: {shop_names.get(sid, '')}", sid)

    db.commit()
