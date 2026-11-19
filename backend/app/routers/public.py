"""Pages anyone can reach: asking for access, and opening an invite. Neither creates anything by itself:
a request only adds a row for the admin to read, and an invite works once, for a person the admin chose."""

import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..emailer import send_email
from ..models import AccessRequest, Invite, Shop, User, UserSession
from ..ratelimit import client_ip, limiter, too_many
from ..security import hash_password, hash_token, new_token
from ..subscription import all_settings
from ..timeutil import aware, utcnow
from .auth import me_payload

log = logging.getLogger("hisab.public")
router = APIRouter(prefix="/public", tags=["public"])

MAX_OPEN_REQUESTS = 300  # a flood cannot grow the table without limit


class RequestIn(BaseModel):
    shop_name: str = Field(min_length=2, max_length=200)
    owner_name: str = Field(min_length=2, max_length=120)
    contact: str = Field(min_length=5, max_length=200)  # phone or email
    city: str | None = Field(default=None, max_length=120)
    message: str | None = Field(default=None, max_length=500)
    website: str = ""  # honeypot: real people never see or fill this field


class AcceptIn(BaseModel):
    shop_name: str = Field(min_length=2, max_length=200)
    owner_name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=200)
    password: str = Field(min_length=8, max_length=200)
    address: str = Field(min_length=2, max_length=300)  # printed on bills and statements
    phone: str = Field(min_length=5, max_length=60)


@router.get("/status")
def status(db: Session = Depends(get_db)):
    """Lets the sign-in page decide whether to show the 'request access' link."""
    return {"requests_open": all_settings(db)["requests_open"]}


@router.post("/request-access", status_code=201)
def request_access(body: RequestIn, request: Request, db: Session = Depends(get_db)):
    if not all_settings(db)["requests_open"]:
        raise HTTPException(403, "Requests are closed right now")
    ip = client_ip(request)
    if limiter.blocked(f"req:{ip}", 5, 3600):
        raise too_many("Too many requests from this connection. Please try again in an hour.")
    limiter.add(f"req:{ip}", 3600)
    if body.website.strip():  # a bot filled the hidden field: pretend it worked, store nothing
        return {"ok": True}
    open_count = db.scalar(select(func.count()).select_from(AccessRequest).where(AccessRequest.status == "new"))
    if open_count >= MAX_OPEN_REQUESTS:
        raise HTTPException(503, "Requests are paused for now. Please try again later.")
    db.add(
        AccessRequest(
            shop_name=body.shop_name.strip(),
            owner_name=body.owner_name.strip(),
            contact=body.contact.strip(),
            city=(body.city or "").strip() or None,
            message=(body.message or "").strip() or None,
        )
    )
    db.commit()
    if settings.admin_notify_email:
        try:
            send_email(
                settings.admin_notify_email,
                "Hisab: new access request",
                f"{body.owner_name} ({body.shop_name}) asked for access.\nContact: {body.contact}\n\n"
                f"Open {settings.app_base_url}/admin to approve it.\n",
            )
        except Exception:  # the request is saved; a mail problem must not fail the form
            log.exception("could not email the access-request notice")
    return {"ok": True}


def _open_invite(db: Session, token: str) -> Invite:
    inv = db.scalar(select(Invite).where(Invite.token_hash == hash_token(token)))
    if inv is None or inv.used_at is not None or inv.revoked_at is not None or aware(inv.expires_at) < utcnow():
        raise HTTPException(404, "This invite link is not valid any more")
    return inv


@router.get("/invite/{token}")
def invite_info(token: str, db: Session = Depends(get_db)):
    inv = _open_invite(db, token)
    return {"shop_name": inv.shop_name, "owner_name": inv.owner_name, "email": inv.email, "trial_days": inv.trial_days}


@router.post("/invite/{token}/accept", status_code=201)
def accept_invite(token: str, body: AcceptIn, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = client_ip(request)
    if limiter.blocked(f"inv:{ip}", 20, 3600):
        raise too_many()
    limiter.add(f"inv:{ip}", 3600)
    inv = _open_invite(db, token)
    email = (inv.email or body.email).strip().lower()  # an invite made for an email keeps that email
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(422, "Enter a valid email address")
    if db.scalar(select(User).where(User.login == email)):
        raise HTTPException(409, "That email already has a login")
    now = utcnow()
    shop = Shop(
        name=body.shop_name.strip(),
        address=body.address.strip(),
        phone=body.phone.strip(),
        status="trial",
        access_until=now + timedelta(days=inv.trial_days),
        created_at=now,
    )
    db.add(shop)
    db.flush()
    user = User(
        shop_id=shop.id,
        name=body.owner_name.strip(),
        login=email,
        password_hash=hash_password(body.password),
        role="owner",
    )
    db.add(user)
    db.flush()
    inv.used_at = now
    inv.shop_id = shop.id
    token_value = new_token()
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(token_value),
            expires_at=now + timedelta(days=settings.session_days),
        )
    )
    db.commit()
    response.set_cookie(
        settings.cookie_name,
        token_value,
        max_age=settings.session_days * 86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return me_payload(user, db)
