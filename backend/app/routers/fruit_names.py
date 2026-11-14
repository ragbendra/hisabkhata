import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user, owner_only
from ..ledger import audit, money
from ..models import FruitName, Sale, SaleLine, User

router = APIRouter(prefix="/fruit-names", tags=["fruit-names"])


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip()).lower()


@router.get("")
def list_fruit_names(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(FruitName).where(FruitName.shop_id == user.shop_id).order_by(FruitName.name))
    return [
        {
            "id": str(f.id),
            "name": f.name,
            "last_rate": money(f.last_rate),
            "last_used_at": f.last_used_at.isoformat() if f.last_used_at else None,
        }
        for f in rows
    ]


class MergeIn(BaseModel):
    from_name: str = Field(min_length=1)
    into_name: str = Field(min_length=1)


@router.post("/merge")
def merge_fruit_names(body: MergeIn, user: User = Depends(owner_only), db: Session = Depends(get_db)):
    """FR-30: rename or merge fruit names so Sales totals are not split. Also works as a rename."""
    src, dst = norm(body.from_name), body.into_name.strip()
    if not dst:
        raise HTTPException(422, "New name is empty")
    if src == norm(dst) and body.from_name.strip() == dst:
        return {"changed_lines": 0}

    lines = db.scalars(
        select(SaleLine).join(Sale, Sale.id == SaleLine.sale_id).where(Sale.shop_id == user.shop_id)
    ).all()
    changed = 0
    for ln in lines:
        if norm(ln.fruit_name) == src:
            ln.fruit_name = dst
            changed += 1

    names = db.scalars(select(FruitName).where(FruitName.shop_id == user.shop_id)).all()
    src_row = next((f for f in names if norm(f.name) == src), None)
    dst_row = next((f for f in names if norm(f.name) == norm(dst) and f is not src_row), None)
    if src_row and dst_row:
        if src_row.last_used_at and (dst_row.last_used_at is None or src_row.last_used_at > dst_row.last_used_at):
            dst_row.last_rate, dst_row.last_used_at = src_row.last_rate, src_row.last_used_at
        db.delete(src_row)
    elif src_row:
        src_row.name = dst
    audit(
        db, user.shop_id, "fruit_name", (src_row or dst_row).id if (src_row or dst_row) else user.shop_id,
        "merge", {"from": body.from_name}, {"into": dst, "lines": changed}, user.id,
    )
    db.commit()
    return {"changed_lines": changed}
