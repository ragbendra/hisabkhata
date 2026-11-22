from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import current_user
from ..devices import MAX_DEVICES, device_out, live_sessions
from ..emailer import send_email
from ..models import PasswordReset, Shop, User, UserSession
from ..ratelimit import client_ip, limiter, too_many
from ..subscription import shop_state, subscription_payload
from ..security import hash_password, hash_token, new_token, verify_password
from ..timeutil import aware, utcnow

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    login: str
    password: str
    # when the user is already on 3 devices: the one to sign out so this one can sign in
    replace_session_id: UUID | None = None


class ResetIn(BaseModel):
    email: str


class ResetConfirmIn(BaseModel):
    token: str
    password: str = Field(min_length=8)


def me_payload(user: User, db: Session) -> dict:
    shop = db.get(Shop, user.shop_id)
    return {
        "id": str(user.id),
        "name": user.name,
        "login": user.login,
        "role": user.role,
        "shop": {"id": str(shop.id), "name": shop.name, "date_system": shop.date_system, "track_crates": shop.track_crates},
        "subscription": subscription_payload(shop),
    }


def _check_login(body: LoginIn, request: Request, db: Session) -> User:
    """Right password, account on, shop not suspended. Wrong guesses are rate limited per address and login."""
    key = f"login:{client_ip(request)}:{body.login.strip().lower()}"
    if limiter.blocked(key, 8, 900):
        raise too_many("Too many wrong attempts. Wait 15 minutes.")
    user = db.scalar(select(User).where(User.login == body.login.strip().lower()))
    if user is None or user.disabled_at is not None or not verify_password(user.password_hash, body.password):
        limiter.add(key, 900)
        raise HTTPException(401, "Wrong login or password")
    limiter.clear(key)
    if shop_state(db.get(Shop, user.shop_id)) == "suspended":
        raise HTTPException(403, "This shop is suspended. Please contact Hisab support.")
    return user


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    user = _check_login(body, request, db)
    live = live_sessions(db, user.id)
    # signing in again on a browser that already has a session of this user does not use a second slot
    token_now = request.cookies.get(settings.cookie_name)
    mine = next((s for s in live if token_now and s.token_hash == hash_token(token_now)), None)
    others = [s for s in live if s is not mine]
    pick = None
    if len(others) >= MAX_DEVICES:
        pick = next((s for s in others if s.id == body.replace_session_id), None) if body.replace_session_id else None
        if pick is None:
            db.commit()  # only the expired ones were removed
            raise HTTPException(409, f"You are signed in on {MAX_DEVICES} devices. Sign out one to continue.")
    if mine:
        db.delete(mine)
    if pick:
        db.delete(pick)
    token = new_token()
    now = utcnow()
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=now + timedelta(days=settings.session_days),
            last_seen_at=now,
            user_agent=(request.headers.get("user-agent") or "")[:300] or None,
            ip=client_ip(request)[:64],
        )
    )
    db.commit()
    response.set_cookie(
        settings.cookie_name,
        token,
        max_age=settings.session_days * 86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return me_payload(user, db)


@router.post("/login/devices")
def login_devices(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    """Shown after a sign-in was refused because of 3 devices. Needs the right password, so it is safe to list them."""
    user = _check_login(body, request, db)
    out = [device_out(s) for s in live_sessions(db, user.id)]
    db.commit()
    return out


@router.get("/devices")
def my_devices(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    here = getattr(request.state, "session_id", None)
    out = [device_out(s, here) for s in live_sessions(db, user.id)]
    db.commit()
    return out


@router.delete("/devices/{session_id}")
def sign_out_device(session_id: UUID, request: Request, response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(UserSession, session_id)
    if s is None or s.user_id != user.id:
        raise HTTPException(404, "Not found")
    if s.id == getattr(request.state, "session_id", None):
        response.delete_cookie(settings.cookie_name, path="/")
    db.delete(s)
    db.commit()
    return {"ok": True}


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(settings.cookie_name)
    if token:
        sess = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
        if sess:
            db.delete(sess)
            db.commit()
    response.delete_cookie(settings.cookie_name, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return me_payload(user, db)


@router.post("/reset")
def request_reset(body: ResetIn, db: Session = Depends(get_db)):
    """Emails a reset link to the owner. Always answers ok, so it does not reveal which emails exist."""
    user = db.scalar(select(User).where(User.login == body.email.strip().lower(), User.role == "owner"))
    if user and user.disabled_at is None:
        token = new_token()
        db.add(
            PasswordReset(
                user_id=user.id,
                token_hash=hash_token(token),
                expires_at=utcnow() + timedelta(minutes=settings.reset_minutes),
            )
        )
        db.commit()
        link = f"{settings.app_base_url}/reset?token={token}"
        send_email(
            user.login,
            "Hisab password reset",
            f"Open this link to choose a new password (valid {settings.reset_minutes} minutes):\n\n{link}\n",
        )
    return {"ok": True}


@router.post("/reset/confirm")
def confirm_reset(body: ResetConfirmIn, db: Session = Depends(get_db)):
    pr = db.scalar(select(PasswordReset).where(PasswordReset.token_hash == hash_token(body.token)))
    if pr is None or pr.used_at is not None or aware(pr.expires_at) < utcnow():
        raise HTTPException(400, "This reset link is not valid any more")
    user = db.get(User, pr.user_id)
    user.password_hash = hash_password(body.password)
    pr.used_at = utcnow()
    # sign out everywhere
    for s in db.scalars(select(UserSession).where(UserSession.user_id == user.id)):
        db.delete(s)
    db.commit()
    return {"ok": True}
