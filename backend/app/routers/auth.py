from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import current_user
from ..emailer import send_email
from ..models import PasswordReset, Shop, User, UserSession
from ..security import hash_password, hash_token, new_token, verify_password
from ..timeutil import aware, utcnow

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    login: str
    password: str


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
        "shop": {"id": str(shop.id), "name": shop.name},
    }


@router.post("/login")
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.login == body.login.strip().lower()))
    if user is None or user.disabled_at is not None or not verify_password(user.password_hash, body.password):
        raise HTTPException(401, "Wrong login or password")
    token = new_token()
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=utcnow() + timedelta(days=settings.session_days),
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
