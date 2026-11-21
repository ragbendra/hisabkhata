import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user, owner_only
from ..models import Shop, User

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    address: str | None = Field(default=None, max_length=300)
    phone: str | None = Field(default=None, max_length=60)
    next_bill_no: int | None = Field(default=None, ge=1)
    date_system: str | None = Field(default=None, pattern=r"^(bs|ad)$")
    track_crates: bool | None = None
    backup_email_day: int | None = Field(default=None, ge=0, le=6)  # 0 = Sunday
    backup_email_time: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


def payload(shop: Shop, user: User, db: Session) -> dict:
    data = {"name": shop.name, "address": shop.address, "phone": shop.phone, "next_bill_no": shop.next_bill_no, "date_system": shop.date_system, "track_crates": shop.track_crates, "role": user.role}
    if user.role == "owner":
        owner = db.scalar(select(User).where(User.shop_id == shop.id, User.role == "owner"))
        data |= {
            "backup_email_day": shop.backup_email_day,
            "backup_email_time": shop.backup_email_time,
            "owner_email": owner.login if owner else None,
        }
    return data


@router.get("")
def get_settings(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return payload(db.get(Shop, user.shop_id), user, db)


@router.patch("")
def patch_settings(body: SettingsPatch, owner: User = Depends(owner_only), db: Session = Depends(get_db)):
    shop = db.get(Shop, owner.shop_id)
    for field, value in body.model_dump(exclude_none=True).items():
        if field in ("address", "phone"):  # an empty box clears it
            value = value.strip() or None
        setattr(shop, field, value)
    db.commit()
    return payload(shop, owner, db)
