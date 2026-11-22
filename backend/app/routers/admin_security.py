"""Platform admin: dashboard numbers and graphs, users and their devices, sign-in history, flags, action log.

Shop-level numbers and who/when only. No customer names, bills or balances are ever returned here.
Every change the admin makes is written to the audit log with the admin's email (action starts with "admin_").
"""

from collections import Counter, defaultdict
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_admin
from ..devices import device_label, is_live, last_seen
from ..ledger import audit
from ..models import (
    AuditLog,
    Payment,
    PlatformAdmin,
    Sale,
    SecurityEvent,
    SecurityFlag,
    Shop,
    SubscriptionPayment,
    User,
    UserSession,
)
from ..security import hash_password
from ..security_log import detect
from ..subscription import shop_state
from ..timeutil import NPT, aware, day_start_utc, today_npl, utcnow

router = APIRouter(prefix="/admin", tags=["admin-security"])


def _iso(dt):
    return aware(dt).isoformat() if dt else None


def _log(db: Session, admin: PlatformAdmin, user: User, action: str, extra: dict | None = None):
    audit(db, user.shop_id, "user", user.id, action, {}, {"login": user.login, "by_admin": admin.email, **(extra or {})}, None)


# ---------------------------------------------------------------- dashboard


def _days(n: int) -> list[date]:
    today = today_npl()
    return [today - timedelta(days=n - 1 - i) for i in range(n)]


@router.get("/dashboard")
def dashboard(days: int = 30, _: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    days = max(7, min(days, 90))
    detect(db)
    labels = _days(days)
    since = day_start_utc(labels[0])
    today = labels[-1]

    # entries: one row per bill and per payment that was entered, by Nepal day and hour
    per_day: Counter = Counter()
    shops_day: dict[date, set] = defaultdict(set)
    by_hour: Counter = Counter()
    for model in (Sale, Payment):
        for at, shop_id in db.execute(select(model.server_received_at, model.shop_id).where(model.server_received_at >= since)):
            local = aware(at).astimezone(NPT)
            per_day[local.date()] += 1
            shops_day[local.date()].add(shop_id)
            by_hour[local.hour] += 1

    signin_ok: Counter = Counter()
    signin_bad: Counter = Counter()
    for at, kind in db.execute(select(SecurityEvent.at, SecurityEvent.kind).where(SecurityEvent.at >= since, SecurityEvent.kind.in_(("login_ok", "login_failed")))):
        (signin_ok if kind == "login_ok" else signin_bad)[aware(at).astimezone(NPT).date()] += 1

    shops = list(db.scalars(select(Shop)))
    states = Counter(shop_state(s) for s in shops)
    paid_shops = set(db.scalars(select(SubscriptionPayment.shop_id).distinct()))
    funnel = {
        "created": len(shops),
        "paying": sum(1 for s in shops if s.id in paid_shops),
        "on_trial": sum(1 for s in shops if shop_state(s) == "trial"),
        "expired_unpaid": sum(1 for s in shops if shop_state(s) == "expired" and s.id not in paid_shops),
    }

    # money collected per month, last 12 months (calendar months, AD)
    months = []
    y, m = today.year, today.month
    for _i in range(12):
        months.append((y, m))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    months.reverse()
    first = date(months[0][0], months[0][1], 1)
    money: Counter = Counter()
    for paid_on, amount in db.execute(select(SubscriptionPayment.paid_on, SubscriptionPayment.amount).where(SubscriptionPayment.paid_on >= first)):
        money[(paid_on.year, paid_on.month)] += Decimal(amount)

    now = utcnow()
    seen = lambda delta: db.scalar(  # noqa: E731
        select(func.count(func.distinct(UserSession.user_id))).where(UserSession.last_seen_at >= now - delta)
    ) or 0

    open_flags = db.scalar(select(func.count()).select_from(SecurityFlag).where(SecurityFlag.reviewed_at.is_(None))) or 0
    return {
        "numbers": {
            "shops": dict(states),
            "users_today": seen(timedelta(days=1)),
            "users_7d": seen(timedelta(days=7)),
            "entries_today": per_day[today],
            "open_flags": open_flags,
        },
        "days": [d.isoformat() for d in labels],
        "entries": [per_day[d] for d in labels],
        "active_shops": [len(shops_day[d]) for d in labels],
        "signins_ok": [signin_ok[d] for d in labels],
        "signins_failed": [signin_bad[d] for d in labels],
        "by_hour": [by_hour[h] for h in range(24)],
        "funnel": funnel,
        "money": [{"month": f"{y}-{m:02d}", "amount": float(money[(y, m)])} for y, m in months],
    }


# ---------------------------------------------------------------- users and their devices


def _devices(db: Session, user_ids: list) -> dict:
    out: dict = defaultdict(list)
    if not user_ids:
        return out
    now = utcnow()
    for s in db.scalars(select(UserSession).where(UserSession.user_id.in_(user_ids))):
        if is_live(s, now):
            out[s.user_id].append(
                {
                    "id": str(s.id),
                    "label": device_label(s.user_agent),
                    "ip": s.ip,
                    "signed_in_at": _iso(s.created_at),
                    "last_seen_at": _iso(last_seen(s)),
                }
            )
    for v in out.values():
        v.sort(key=lambda d: d["last_seen_at"], reverse=True)
    return out


def _user_row(u: User, shop: Shop | None, devices: list) -> dict:
    return {
        "id": str(u.id),
        "name": u.name,
        "login": u.login,
        "role": u.role,
        "disabled": u.disabled_at is not None,
        "shop": {"id": str(shop.id), "name": shop.name, "state": shop_state(shop)} if shop else None,
        "devices": devices,
        "last_seen_at": devices[0]["last_seen_at"] if devices else None,
    }


@router.get("/users")
def list_users(q: str = "", shop_id: UUID | None = None, limit: int = 100, _: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    stmt = select(User, Shop).join(Shop, Shop.id == User.shop_id)
    if shop_id:
        stmt = stmt.where(User.shop_id == shop_id)
    if q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(User.name).like(like), func.lower(User.login).like(like), func.lower(Shop.name).like(like)))
    rows = db.execute(stmt.order_by(Shop.name, User.role.desc(), User.name).limit(max(1, min(limit, 300)))).all()
    devs = _devices(db, [u.id for u, _ in rows])
    return [_user_row(u, s, devs.get(u.id, [])) for u, s in rows]


def _get_user(db: Session, user_id: UUID) -> User:
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(404, "User not found")
    return u


def _event_out(e: SecurityEvent, names: dict) -> dict:
    return {
        "id": str(e.id),
        "at": _iso(e.at),
        "kind": e.kind,
        "login": e.login,
        "shop": names.get(e.shop_id),
        "shop_id": str(e.shop_id) if e.shop_id else None,
        "ip": e.ip,
        "device": device_label(e.user_agent) if e.user_agent else None,
        "detail": e.detail,
    }


@router.get("/users/{user_id}/events")
def user_events(user_id: UUID, _: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    u = _get_user(db, user_id)
    names = {u.shop_id: db.get(Shop, u.shop_id).name}
    rows = db.scalars(
        select(SecurityEvent).where(or_(SecurityEvent.user_id == u.id, SecurityEvent.login == u.login)).order_by(SecurityEvent.at.desc()).limit(40)
    )
    return [_event_out(e, names) for e in rows]


@router.delete("/sessions/{session_id}")
def sign_out_device(session_id: UUID, admin: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    """Signs one device out. This also frees a slot for someone who is locked out by the 3-device limit."""
    s = db.get(UserSession, session_id)
    if s is None:
        raise HTTPException(404, "Device not found")
    u = db.get(User, s.user_id)
    _log(db, admin, u, "admin_signout_device", {"device": device_label(s.user_agent)})
    db.delete(s)
    db.commit()
    return {"ok": True}


@router.post("/users/{user_id}/signout-all")
def sign_out_all(user_id: UUID, admin: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    u = _get_user(db, user_id)
    n = 0
    for s in db.scalars(select(UserSession).where(UserSession.user_id == u.id)):
        db.delete(s)
        n += 1
    _log(db, admin, u, "admin_signout_all", {"devices": n})
    db.commit()
    return {"signed_out": n}


class DisableIn(BaseModel):
    disabled: bool


@router.post("/users/{user_id}/disabled")
def set_disabled(user_id: UUID, body: DisableIn, admin: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    u = _get_user(db, user_id)
    u.disabled_at = utcnow() if body.disabled else None
    if body.disabled:
        for s in db.scalars(select(UserSession).where(UserSession.user_id == u.id)):
            db.delete(s)
    _log(db, admin, u, "admin_disable_user" if body.disabled else "admin_enable_user")
    db.commit()
    return {"disabled": body.disabled}


class PasswordSetIn(BaseModel):
    password: str = Field(min_length=8, max_length=100)


@router.post("/users/{user_id}/password")
def set_password(user_id: UUID, body: PasswordSetIn, admin: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    """Sets a new password and signs the user out everywhere. Tell them to change it after signing in."""
    u = _get_user(db, user_id)
    u.password_hash = hash_password(body.password)
    for s in db.scalars(select(UserSession).where(UserSession.user_id == u.id)):
        db.delete(s)
    _log(db, admin, u, "admin_set_password")
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- one shop: week numbers and a timeline


AUDIT_WORDS = {
    ("sale", "delete"): "Bill deleted",
    ("sale", "edit"): "Bill edited",
    ("payment", "delete"): "Payment deleted",
    ("payment", "edit"): "Payment edited",
    ("opening", "delete"): "Opening balance deleted",
    ("customer", "archive"): "Customer archived or restored",
    ("customer", "edit"): "Customer details edited",
    ("customer", "delete"): "Customer deleted",
    ("customer", "merge"): "Customers merged",
}
EVENT_WORDS = {
    "login_ok": "Signed in",
    "login_failed": "Failed sign-in",
    "device_limit": "Refused: 3 devices already",
    "device_signout": "Signed a device out",
    "export_full": "Downloaded the full export",
}


@router.get("/shops/{shop_id}/activity")
def shop_activity(shop_id: UUID, _: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    shop = db.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(404, "Shop not found")
    now = utcnow()
    week = now - timedelta(days=7)
    users = list(db.scalars(select(User).where(User.shop_id == shop.id).order_by(User.role.desc(), User.name)))
    devs = _devices(db, [u.id for u in users])
    names = {u.id: u.name for u in users}

    def count(model, col_shop, col_time):
        return db.scalar(select(func.count()).select_from(model).where(col_shop == shop.id, col_time >= week)) or 0

    audits = list(db.scalars(select(AuditLog).where(AuditLog.shop_id == shop.id, AuditLog.at >= week).order_by(AuditLog.at.desc()).limit(300)))
    events = list(db.scalars(select(SecurityEvent).where(SecurityEvent.shop_id == shop.id, SecurityEvent.at >= week).order_by(SecurityEvent.at.desc()).limit(300)))
    ev_count = Counter(e.kind for e in events)

    timeline = []
    for e in events:
        timeline.append({"at": _iso(e.at), "what": EVENT_WORDS.get(e.kind, e.kind), "who": e.login, "where": e.ip, "detail": e.detail})
    for a in audits:
        if a.action.startswith("admin_"):
            what, who = "Admin: " + a.action[6:].replace("_", " "), (a.after_json or {}).get("by_admin")
        else:
            what, who = AUDIT_WORDS.get((a.entity, a.action)), names.get(a.user_id)
        if what:
            timeline.append({"at": _iso(a.at), "what": what, "who": who, "where": None, "detail": None})
    timeline.sort(key=lambda t: t["at"], reverse=True)

    per_day: Counter = Counter()
    since = day_start_utc(_days(14)[0])
    for model in (Sale, Payment):
        for (at,) in db.execute(select(model.server_received_at).where(model.shop_id == shop.id, model.server_received_at >= since)):
            per_day[aware(at).astimezone(NPT).date()] += 1
    labels = _days(14)

    return {
        "shop": {"id": str(shop.id), "name": shop.name, "state": shop_state(shop)},
        "users": [_user_row(u, shop, devs.get(u.id, [])) for u in users],
        "week": {
            "bills": count(Sale, Sale.shop_id, Sale.server_received_at),
            "payments": count(Payment, Payment.shop_id, Payment.server_received_at),
            "deleted_or_voided": sum(1 for a in audits if a.action in ("delete", "void")),
            "exports": ev_count["export_full"],
            "sign_ins": ev_count["login_ok"],
            "failed_sign_ins": ev_count["login_failed"],
        },
        "days": [d.isoformat() for d in labels],
        "entries": [per_day[d] for d in labels],
        "timeline": timeline[:80],
    }


# ---------------------------------------------------------------- sign-in history, flags, admin action log


@router.get("/security/events")
def security_events(
    q: str = "", kind: str = "", shop_id: UUID | None = None, limit: int = 150,
    _: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db),
):
    stmt = select(SecurityEvent)
    if kind:
        stmt = stmt.where(SecurityEvent.kind == kind)
    if shop_id:
        stmt = stmt.where(SecurityEvent.shop_id == shop_id)
    if q.strip():
        like = f"%{q.strip().lower()}%"
        shop_ids = list(db.scalars(select(Shop.id).where(func.lower(Shop.name).like(like))))
        stmt = stmt.where(or_(func.lower(SecurityEvent.login).like(like), SecurityEvent.ip.like(f"%{q.strip()}%"), SecurityEvent.shop_id.in_(shop_ids)))
    rows = list(db.scalars(stmt.order_by(SecurityEvent.at.desc()).limit(max(1, min(limit, 500)))))
    names = {s.id: s.name for s in db.scalars(select(Shop).where(Shop.id.in_({r.shop_id for r in rows if r.shop_id})))}
    return [_event_out(e, names) for e in rows]


@router.get("/security/flags")
def security_flags(status: str = "new", _: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    detect(db)
    stmt = select(SecurityFlag)
    if status == "new":
        stmt = stmt.where(SecurityFlag.reviewed_at.is_(None))
    rows = list(db.scalars(stmt.order_by(SecurityFlag.created_at.desc()).limit(200)))
    names = {s.id: s.name for s in db.scalars(select(Shop).where(Shop.id.in_({r.shop_id for r in rows if r.shop_id})))}
    return [
        {
            "id": str(f.id),
            "kind": f.kind,
            "severity": f.severity,
            "title": f.title,
            "detail": f.detail,
            "shop": {"id": str(f.shop_id), "name": names.get(f.shop_id)} if f.shop_id else None,
            "user_id": str(f.user_id) if f.user_id else None,
            "at": _iso(f.created_at),
            "reviewed": f.reviewed_at is not None,
        }
        for f in rows
    ]


@router.post("/security/flags/{flag_id}/review")
def review_flag(flag_id: UUID, reviewed: bool = True, _: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    f = db.get(SecurityFlag, flag_id)
    if f is None:
        raise HTTPException(404, "Not found")
    f.reviewed_at = utcnow() if reviewed else None
    db.commit()
    return {"reviewed": reviewed}


@router.get("/log")
def admin_log(limit: int = 150, _: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    """Everything an admin changed: shops, trials, payments, users, devices."""
    rows = list(db.scalars(select(AuditLog).where(AuditLog.action.like("admin\\_%", escape="\\")).order_by(AuditLog.at.desc()).limit(max(1, min(limit, 500)))))
    names = {s.id: s.name for s in db.scalars(select(Shop).where(Shop.id.in_({r.shop_id for r in rows})))}
    return [
        {
            "at": _iso(a.at),
            "what": a.action[6:].replace("_", " "),
            "by": (a.after_json or {}).get("by_admin"),
            "shop": names.get(a.shop_id),
            "shop_id": str(a.shop_id),
            "target": (a.after_json or {}).get("login") or (a.after_json or {}).get("owner"),
            "detail": (a.after_json or {}).get("device") or (a.after_json or {}).get("amount"),
        }
        for a in rows
    ]
