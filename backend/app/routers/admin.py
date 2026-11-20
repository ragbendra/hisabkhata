"""Platform admin: the person who runs Hisab. Separate sign-in, separate cookie, separate tables.

The admin sees shops, trials, payments and invites. There is deliberately no screen for reading a shop's
customers or ledger: shop-level numbers only. Every change is written to the audit log.
"""

from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import totp
from ..config import settings
from ..db import get_db
from ..deps import current_admin
from ..emailer import send_email
from ..ledger import audit, bulk_state
from ..models import (
    AccessRequest,
    AdminSession,
    Feedback,
    Customer,
    Invite,
    PasswordReset,
    PlatformAdmin,
    Sale,
    Shop,
    SubscriptionPayment,
    User,
    UserSession,
)
from ..ratelimit import client_ip, limiter, too_many
from ..security import hash_password, hash_token, new_token, verify_password
from ..subscription import (
    all_settings,
    end_of_day,
    extend,
    last_activity,
    set_setting,
    shop_state,
    subscription_payload,
)
from ..timeutil import aware, utcnow

router = APIRouter(prefix="/admin", tags=["admin"])

MODES = {"cash", "esewa", "khalti", "bank", "other"}


# ---------------------------------------------------------------- sign in


class AdminLogin(BaseModel):
    email: str
    password: str
    code: str | None = None


def _admin_out(a: PlatformAdmin) -> dict:
    return {"id": str(a.id), "email": a.email, "name": a.name, "two_step": a.totp_secret is not None}


@router.post("/login")
def login(body: AdminLogin, request: Request, response: Response, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    key = f"admin:{client_ip(request)}:{email}"
    if limiter.blocked(key, 5, 900):
        raise too_many("Too many wrong attempts. Wait 15 minutes.")
    admin = db.scalar(select(PlatformAdmin).where(PlatformAdmin.email == email))
    ok = admin is not None and admin.disabled_at is None and verify_password(admin.password_hash, body.password)
    if ok and admin.totp_secret:
        if not body.code:
            return {"need_code": True}  # password was right; ask for the authenticator code
        ok = totp.verify(admin.totp_secret, body.code)
    if not ok:
        limiter.add(key, 900)
        raise HTTPException(401, "Wrong email, password or code")
    limiter.clear(key)
    token = new_token()
    db.add(
        AdminSession(
            admin_id=admin.id,
            token_hash=hash_token(token),
            expires_at=utcnow() + timedelta(hours=settings.admin_session_hours),
        )
    )
    db.commit()
    response.set_cookie(
        settings.admin_cookie_name,
        token,
        max_age=settings.admin_session_hours * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
    )
    return _admin_out(admin)


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(settings.admin_cookie_name)
    if token:
        sess = db.scalar(select(AdminSession).where(AdminSession.token_hash == hash_token(token)))
        if sess:
            db.delete(sess)
            db.commit()
    response.delete_cookie(settings.admin_cookie_name, path="/")
    return {"ok": True}


@router.get("/me")
def me(admin: PlatformAdmin = Depends(current_admin)):
    return _admin_out(admin)


# ---------------------------------------------------------------- two-step sign-in (authenticator app)


class CodeIn(BaseModel):
    code: str


class PasswordIn(BaseModel):
    password: str


@router.post("/two-step/start")
def two_step_start(admin: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    if admin.totp_secret:
        raise HTTPException(409, "Two-step sign-in is already on")
    admin.totp_pending = totp.new_secret()
    db.commit()
    return {"secret": admin.totp_pending, "uri": totp.uri(admin.totp_pending, admin.email)}


@router.post("/two-step/confirm")
def two_step_confirm(body: CodeIn, admin: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    if not admin.totp_pending or not totp.verify(admin.totp_pending, body.code):
        raise HTTPException(400, "That code is not right. Check the time on your phone and try again.")
    admin.totp_secret, admin.totp_pending = admin.totp_pending, None
    db.commit()
    return _admin_out(admin)


@router.post("/two-step/off")
def two_step_off(body: PasswordIn, admin: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    if not verify_password(admin.password_hash, body.password):
        raise HTTPException(403, "Wrong password")
    admin.totp_secret = admin.totp_pending = None
    db.commit()
    return _admin_out(admin)


# ---------------------------------------------------------------- shops


def _owner(db: Session, shop_id) -> User | None:
    return db.scalar(select(User).where(User.shop_id == shop_id, User.role == "owner").order_by(User.name))


def _shop_row(db: Session, s: Shop, counts: dict) -> dict:
    owner = _owner(db, s.id)
    la = last_activity(db, s.id)
    return {
        "id": str(s.id),
        "name": s.name,
        "owner_name": owner.name if owner else None,
        "owner_email": owner.login if owner else None,
        "status": s.status,
        "created_at": aware(s.created_at).isoformat() if s.created_at else None,
        "last_activity": la.isoformat() if la else None,
        "customers": counts["customers"].get(s.id, 0),
        "bills": counts["bills"].get(s.id, 0),
        "users": counts["users"].get(s.id, 0),
        "admin_notes": s.admin_notes,
        **subscription_payload(s),
    }


def _counts(db: Session) -> dict:
    def grouped(col, table, *where):
        q = select(col, func.count()).select_from(table).group_by(col)
        for w in where:
            q = q.where(w)
        return dict(db.execute(q).all())

    return {
        "customers": grouped(Customer.shop_id, Customer, Customer.merged_into_id.is_(None)),
        "bills": grouped(Sale.shop_id, Sale),
        "users": grouped(User.shop_id, User, User.disabled_at.is_(None)),
    }


@router.get("/shops")
def list_shops(_: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    counts = _counts(db)
    rows = [_shop_row(db, s, counts) for s in db.scalars(select(Shop))]
    order = {"expired": 0, "trial": 1, "active": 2, "suspended": 3}
    rows.sort(key=lambda r: (order.get(r["state"], 9), r["access_until"] or "9999", r["name"].lower()))
    summary = {k: sum(1 for r in rows if r["state"] == k) for k in ("trial", "active", "expired", "suspended")}
    month_start = date.today().replace(day=1)
    paid = db.scalar(
        select(func.coalesce(func.sum(SubscriptionPayment.amount), 0)).where(SubscriptionPayment.paid_on >= month_start)
    )
    summary["received_this_month"] = str(Decimal(paid).quantize(Decimal("0.01")))
    return {"summary": summary, "shops": rows}


def _get_shop(db: Session, shop_id: UUID) -> Shop:
    s = db.get(Shop, shop_id)
    if s is None:
        raise HTTPException(404, "Shop not found")
    return s


@router.get("/shops/{shop_id}")
def shop_detail(shop_id: UUID, _: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    s = _get_shop(db, shop_id)
    row = _shop_row(db, s, _counts(db))
    row["users_list"] = [
        {"id": str(u.id), "name": u.name, "login": u.login, "role": u.role, "disabled": u.disabled_at is not None}
        for u in db.scalars(select(User).where(User.shop_id == s.id).order_by(User.role.desc(), User.name))
    ]
    row["payments"] = [
        {
            "id": str(p.id),
            "amount": str(p.amount),
            "mode": p.mode,
            "paid_on": p.paid_on.isoformat(),
            "extended_to": aware(p.extended_to).isoformat() if p.extended_to else None,
            "note": p.note,
        }
        for p in db.scalars(
            select(SubscriptionPayment).where(SubscriptionPayment.shop_id == s.id).order_by(SubscriptionPayment.paid_on.desc())
        )
    ]
    states = bulk_state(db, s.id)
    row["total_to_collect"] = str(sum((st.balance for st in states.values() if st.balance > 0), Decimal("0")))
    return row


class ShopPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    status: str | None = Field(default=None, pattern="^(active|trial|suspended)$")
    access_until: date | None = None  # send null to remove the end date
    admin_notes: str | None = Field(default=None, max_length=1000)


def _log(db: Session, admin: PlatformAdmin, shop: Shop, action: str, before: dict, after: dict):
    audit(db, shop.id, "shop", shop.id, action, before, {**after, "by_admin": admin.email}, None)


def _snap(s: Shop) -> dict:
    return {
        "name": s.name,
        "status": s.status,
        "access_until": aware(s.access_until).isoformat() if s.access_until else None,
        "admin_notes": s.admin_notes,
    }


@router.patch("/shops/{shop_id}")
def patch_shop(
    shop_id: UUID, body: ShopPatch, admin: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)
):
    s = _get_shop(db, shop_id)
    before = _snap(s)
    sent = body.model_fields_set
    if "name" in sent and body.name:
        s.name = body.name.strip()
    if "status" in sent and body.status:
        s.status = body.status
    if "access_until" in sent:
        s.access_until = end_of_day(body.access_until) if body.access_until else None
    if "admin_notes" in sent:
        s.admin_notes = (body.admin_notes or "").strip() or None
    if s.status == "suspended":  # sign everyone out of a suspended shop
        for sess in db.scalars(select(UserSession).join(User, User.id == UserSession.user_id).where(User.shop_id == s.id)):
            db.delete(sess)
    _log(db, admin, s, "admin_edit", before, _snap(s))
    db.commit()
    return _shop_row(db, s, _counts(db))


class ExtendIn(BaseModel):
    days: int = Field(ge=1, le=3660)


@router.post("/shops/{shop_id}/extend")
def extend_shop(
    shop_id: UUID, body: ExtendIn, admin: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)
):
    s = _get_shop(db, shop_id)
    before = _snap(s)
    extend(s, body.days)
    _log(db, admin, s, "admin_extend", before, _snap(s))
    db.commit()
    return _shop_row(db, s, _counts(db))


class PaymentIn(BaseModel):
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    mode: str = "esewa"
    paid_on: date | None = None
    extend_days: int = Field(default=30, ge=0, le=3660)
    note: str | None = Field(default=None, max_length=300)


@router.post("/shops/{shop_id}/payments", status_code=201)
def record_payment(
    shop_id: UUID, body: PaymentIn, admin: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)
):
    if body.mode not in MODES:
        raise HTTPException(422, "Unknown payment mode")
    s = _get_shop(db, shop_id)
    before = _snap(s)
    if body.extend_days:
        extend(s, body.extend_days)
    if s.status == "trial":
        s.status = "active"  # a paying shop is no longer a trial
    db.add(
        SubscriptionPayment(
            shop_id=s.id,
            amount=body.amount,
            mode=body.mode,
            paid_on=body.paid_on or utcnow().date(),
            extended_to=s.access_until,
            note=(body.note or "").strip() or None,
        )
    )
    _log(db, admin, s, "admin_payment", before, {**_snap(s), "amount": str(body.amount), "mode": body.mode})
    db.commit()
    return _shop_row(db, s, _counts(db))


@router.post("/shops/{shop_id}/reset-owner-password")
def reset_owner_password(shop_id: UUID, admin: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    """Creates a reset link for the owner. It is emailed, and also returned so it can be sent by WhatsApp."""
    s = _get_shop(db, shop_id)
    owner = _owner(db, s.id)
    if owner is None:
        raise HTTPException(404, "This shop has no owner")
    token = new_token()
    db.add(
        PasswordReset(
            user_id=owner.id, token_hash=hash_token(token), expires_at=utcnow() + timedelta(minutes=settings.reset_minutes)
        )
    )
    _log(db, admin, s, "admin_reset_password", {}, {"owner": owner.login})
    db.commit()
    link = f"{settings.app_base_url}/reset?token={token}"
    emailed = False
    if "@" in owner.login:
        try:
            send_email(
                owner.login,
                "Hisab password reset",
                f"Open this link to choose a new password (valid {settings.reset_minutes} minutes):\n\n{link}\n",
            )
            emailed = bool(settings.smtp_host)
        except Exception:
            emailed = False
    return {"link": link, "emailed": emailed, "valid_minutes": settings.reset_minutes}


# ---------------------------------------------------------------- access requests and invites


def _request_out(r: AccessRequest) -> dict:
    return {
        "id": str(r.id),
        "shop_name": r.shop_name,
        "owner_name": r.owner_name,
        "contact": r.contact,
        "city": r.city,
        "message": r.message,
        "status": r.status,
        "created_at": aware(r.created_at).isoformat(),
    }


def _invite_out(i: Invite) -> dict:
    now = utcnow()
    if i.used_at:
        st = "used"
    elif i.revoked_at:
        st = "revoked"
    elif aware(i.expires_at) < now:
        st = "expired"
    else:
        st = "open"
    return {
        "id": str(i.id),
        "email": i.email,
        "shop_name": i.shop_name,
        "owner_name": i.owner_name,
        "trial_days": i.trial_days,
        "status": st,
        "created_at": aware(i.created_at).isoformat(),
        "expires_at": aware(i.expires_at).isoformat(),
    }


@router.get("/requests")
def list_requests(
    status: str = "new", _: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)
):
    q = select(AccessRequest).order_by(AccessRequest.created_at.desc()).limit(200)
    if status != "all":
        q = q.where(AccessRequest.status == status)
    return [_request_out(r) for r in db.scalars(q)]


@router.get("/feedback")
def list_feedback(status: str = "new", _: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    q = select(Feedback).order_by(Feedback.created_at.desc()).limit(200)
    if status != "all":
        q = q.where(Feedback.status == status)
    out = []
    for f in db.scalars(q):
        shop, user = db.get(Shop, f.shop_id), db.get(User, f.user_id)
        out.append(
            {
                "id": str(f.id),
                "kind": f.kind,
                "message": f.message,
                "contact": f.contact,
                "status": f.status,
                "created_at": f.created_at.isoformat(),
                "shop_name": shop.name if shop else "?",
                "user_name": user.name if user else "?",
                "user_login": user.login if user else None,
            }
        )
    return out


@router.post("/feedback/{feedback_id}/done")
def feedback_done(feedback_id: UUID, done: bool = True, admin: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    f = db.get(Feedback, feedback_id)
    if f is None:
        raise HTTPException(404, "Not found")
    f.status = "done" if done else "new"
    f.handled_at = utcnow() if done else None
    db.commit()
    return {"id": str(f.id), "status": f.status}


class InviteIn(BaseModel):
    email: str | None = Field(default=None, max_length=200)
    shop_name: str | None = Field(default=None, max_length=200)
    owner_name: str | None = Field(default=None, max_length=120)
    trial_days: int | None = Field(default=None, ge=0, le=365)
    send_email: bool = True


def _make_invite(db: Session, body: InviteIn, request_id=None) -> tuple[Invite, str]:
    conf = all_settings(db)
    email = (body.email or "").strip().lower() or None
    if email and db.scalar(select(User).where(User.login == email)):
        raise HTTPException(409, "That email already has a login")
    token = new_token()
    inv = Invite(
        token_hash=hash_token(token),
        email=email,
        shop_name=(body.shop_name or "").strip() or None,
        owner_name=(body.owner_name or "").strip() or None,
        trial_days=body.trial_days if body.trial_days is not None else conf["trial_days"],
        request_id=request_id,
        expires_at=utcnow() + timedelta(days=conf["invite_days"]),
    )
    db.add(inv)
    return inv, f"{settings.app_base_url}/join?token={token}"


def _mail_invite(inv: Invite, link: str, conf: dict) -> bool:
    if not inv.email:
        return False
    try:
        send_email(
            inv.email,
            "Your Hisab invitation",
            f"Hello {inv.owner_name or ''},\n\nYou are invited to try Hisab, a digital khata for traders. "
            f"You get {inv.trial_days} days free.\n\nOpen this link to create your account "
            f"(valid {conf['invite_days']} days, works once):\n\n{link}\n",
        )
        return bool(settings.smtp_host)
    except Exception:
        return False


@router.post("/invites", status_code=201)
def create_invite(body: InviteIn, _: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    inv, link = _make_invite(db, body)
    db.commit()
    emailed = _mail_invite(inv, link, all_settings(db)) if body.send_email else False
    return {**_invite_out(inv), "link": link, "emailed": emailed}


@router.get("/invites")
def list_invites(_: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    return [_invite_out(i) for i in db.scalars(select(Invite).order_by(Invite.created_at.desc()).limit(200))]


@router.delete("/invites/{invite_id}")
def revoke_invite(invite_id: UUID, _: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    inv = db.get(Invite, invite_id)
    if inv is None:
        raise HTTPException(404, "Invite not found")
    if inv.used_at is None:
        inv.revoked_at = utcnow()
        db.commit()
    return _invite_out(inv)


class ApproveIn(BaseModel):
    email: str | None = Field(default=None, max_length=200)
    trial_days: int | None = Field(default=None, ge=0, le=365)
    send_email: bool = True


@router.post("/requests/{request_id}/approve", status_code=201)
def approve_request(
    request_id: UUID, body: ApproveIn, _: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)
):
    r = db.get(AccessRequest, request_id)
    if r is None:
        raise HTTPException(404, "Request not found")
    if r.status != "new":
        raise HTTPException(409, "This request was already handled")
    email = body.email or (r.contact if "@" in r.contact else None)
    inv, link = _make_invite(
        db, InviteIn(email=email, shop_name=r.shop_name, owner_name=r.owner_name, trial_days=body.trial_days), r.id
    )
    r.status = "approved"
    r.handled_at = utcnow()
    db.commit()
    emailed = _mail_invite(inv, link, all_settings(db)) if body.send_email else False
    return {**_invite_out(inv), "link": link, "emailed": emailed, "contact": r.contact}


@router.post("/requests/{request_id}/reject")
def reject_request(request_id: UUID, _: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    r = db.get(AccessRequest, request_id)
    if r is None:
        raise HTTPException(404, "Request not found")
    if r.status == "new":
        r.status = "rejected"
        r.handled_at = utcnow()
        db.commit()
    return _request_out(r)


# ---------------------------------------------------------------- settings


class SettingsIn(BaseModel):
    trial_days: int | None = Field(default=None, ge=0, le=365)
    invite_days: int | None = Field(default=None, ge=1, le=60)
    requests_open: bool | None = None


@router.get("/settings")
def get_settings(_: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    return all_settings(db)


@router.put("/settings")
def put_settings(body: SettingsIn, _: PlatformAdmin = Depends(current_admin), db: Session = Depends(get_db)):
    if body.trial_days is not None:
        set_setting(db, "trial_days", str(body.trial_days))
    if body.invite_days is not None:
        set_setting(db, "invite_days", str(body.invite_days))
    if body.requests_open is not None:
        set_setting(db, "requests_open", "1" if body.requests_open else "0")
    db.commit()
    return all_settings(db)
