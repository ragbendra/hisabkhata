from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..devices import MAX_HELPERS
from ..deps import owner_only
from ..models import PasswordReset, User, UserSession
from ..security import hash_password
from ..timeutil import utcnow

router = APIRouter(prefix="/users", tags=["users"])


class HelperIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    login: str = Field(min_length=2, max_length=60)
    password: str = Field(min_length=6)


class UserPatch(BaseModel):
    disabled: bool | None = None
    password: str | None = Field(default=None, min_length=6)
    name: str | None = None


def out(u: User) -> dict:
    return {
        "id": str(u.id),
        "name": u.name,
        "login": u.login,
        "role": u.role,
        "disabled": u.disabled_at is not None,
    }


@router.get("")
def list_users(owner: User = Depends(owner_only), db: Session = Depends(get_db)):
    users = db.scalars(select(User).where(User.shop_id == owner.shop_id).order_by(User.role.desc(), User.name))
    return [out(u) for u in users]


@router.post("", status_code=201)
def create_helper(body: HelperIn, owner: User = Depends(owner_only), db: Session = Depends(get_db)):
    login = body.login.strip().lower()
    helpers = db.scalar(select(func.count()).select_from(User).where(User.shop_id == owner.shop_id, User.role == "helper"))
    if helpers >= MAX_HELPERS:
        raise HTTPException(400, f"You can have at most {MAX_HELPERS} helper logins. Delete one first.")
    if db.scalar(select(User).where(User.login == login)):
        raise HTTPException(409, "That login is already taken")
    u = User(
        shop_id=owner.shop_id,
        name=body.name.strip(),
        login=login,
        password_hash=hash_password(body.password),
        role="helper",
    )
    db.add(u)
    db.commit()
    return out(u)


@router.patch("/{user_id}")
def patch_user(user_id: UUID, body: UserPatch, owner: User = Depends(owner_only), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None or u.shop_id != owner.shop_id:
        raise HTTPException(404, "Not found")
    if u.role == "owner" and body.disabled:
        raise HTTPException(400, "The owner login cannot be disabled")
    if body.name:
        u.name = body.name.strip()
    if body.password:
        u.password_hash = hash_password(body.password)
        for s in db.scalars(select(UserSession).where(UserSession.user_id == u.id)):
            db.delete(s)
    if body.disabled is not None:
        u.disabled_at = utcnow() if body.disabled else None
        if body.disabled:
            for s in db.scalars(select(UserSession).where(UserSession.user_id == u.id)):
                db.delete(s)
    db.commit()
    return out(u)


@router.delete("/{user_id}")
def delete_helper(user_id: UUID, owner: User = Depends(owner_only), db: Session = Depends(get_db)):
    """Removes a helper login for good. Bills and payments they entered stay; they just lose the name."""
    u = db.get(User, user_id)
    if u is None or u.shop_id != owner.shop_id:
        raise HTTPException(404, "Not found")
    if u.role == "owner":
        raise HTTPException(400, "The owner login cannot be deleted")
    for model in (UserSession, PasswordReset):
        for row in db.scalars(select(model).where(model.user_id == u.id)):
            db.delete(row)
    db.delete(u)
    db.commit()
    return {"deleted": str(user_id)}
