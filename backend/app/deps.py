from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import AdminSession, PlatformAdmin, Shop, User, UserSession
from .security import hash_token
from .subscription import shop_state
from .timeutil import aware, utcnow


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(settings.cookie_name)
    if not token:
        raise HTTPException(401, "Not signed in")
    sess = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
    if sess is None or aware(sess.expires_at) < utcnow():
        raise HTTPException(401, "Session expired")
    user = db.get(User, sess.user_id)
    if user is None or user.disabled_at is not None:
        raise HTTPException(401, "Account disabled")
    state = shop_state(db.get(Shop, user.shop_id))
    if state == "suspended":
        raise HTTPException(403, "This shop is suspended. Please contact Hisab support.")
    if state == "expired" and request.method not in ("GET", "HEAD", "OPTIONS"):
        raise HTTPException(402, "The subscription has ended. You can still view and export, but not add or change entries.")
    return user


def owner_only(user: User = Depends(current_user)) -> User:
    if user.role != "owner":
        raise HTTPException(403, "Owner only")
    return user


def current_admin(request: Request, db: Session = Depends(get_db)) -> PlatformAdmin:
    token = request.cookies.get(settings.admin_cookie_name)
    if not token:
        raise HTTPException(401, "Not signed in")
    sess = db.scalar(select(AdminSession).where(AdminSession.token_hash == hash_token(token)))
    if sess is None or aware(sess.expires_at) < utcnow():
        raise HTTPException(401, "Session expired")
    admin = db.get(PlatformAdmin, sess.admin_id)
    if admin is None or admin.disabled_at is not None:
        raise HTTPException(401, "Account disabled")
    return admin
