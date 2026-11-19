import re
from datetime import date
from decimal import Decimal
from difflib import SequenceMatcher
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..deps import current_user, owner_only
from ..ledger import (
    CustState,
    audit,
    bulk_state,
    history,
    money,
    payment_snapshot,
    sale_snapshot,
    state_for,
    still_owed,
)
from ..models import Customer, Opening, Payment, Sale, User
from ..timeutil import today_npl, utcnow

router = APIRouter(prefix="/customers", tags=["customers"])


def norm(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


def name_matches(q: str, c: Customer) -> bool:
    """FR-5: names that contain, or closely resemble, what was typed."""
    qn = norm(q)
    if not qn:
        return True
    for n in (norm(c.name), norm(c.other_name)):
        if not n:
            continue
        if qn in n or n in qn:
            return True
        if SequenceMatcher(None, qn, n).ratio() >= 0.8:
            return True
        # also compare against the same number of leading characters ("ram" ~ "ramesh traders")
        if len(qn) >= 3 and SequenceMatcher(None, qn, n[: len(qn)]).ratio() >= 0.85:
            return True
    return False


def row(c: Customer, st: CustState, today: date) -> dict:
    owed = still_owed(st, today)
    return {
        "id": str(c.id),
        "name": c.name,
        "other_name": c.other_name,
        "phone": c.phone,
        "address": c.address,
        "balance": money(st.balance),
        "last_activity": st.last_activity.isoformat() if st.last_activity else None,
        "days_owing": owed[0].age_days if owed else None,  # age of the oldest still-owed amount (FR-47)
        "next_collection_date": c.next_collection_date.isoformat() if c.next_collection_date else None,
        "archived": c.archived_at is not None,
        "possible_duplicate_of": str(c.possible_duplicate_of) if c.possible_duplicate_of else None,
    }


def get_customer(db: Session, user: User, customer_id: UUID) -> Customer:
    c = db.get(Customer, customer_id)
    if c is None or c.shop_id != user.shop_id:
        raise HTTPException(404, "Customer not found")
    return c


@router.get("")
def list_customers(
    q: str | None = None,
    sort: str = Query("balance", pattern="^(balance|oldest)$"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """With q: suggestions (archived customers hidden). Without q: every customer, for the Khata list."""
    today = today_npl()
    states = bulk_state(db, user.shop_id)
    rows = []
    for c in db.scalars(select(Customer).where(Customer.shop_id == user.shop_id, Customer.merged_into_id.is_(None))):
        if q:
            if c.archived_at is not None or not name_matches(q, c):
                continue
        rows.append(row(c, states.get(c.id, CustState()), today))
    if sort == "oldest":
        rows.sort(key=lambda r: (-(r["days_owing"] if r["days_owing"] is not None else -1), r["name"].lower()))
    else:
        rows.sort(key=lambda r: (-Decimal(r["balance"]), r["name"].lower()))
    return rows


@router.get("/{customer_id}")
def get_sheet(customer_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = get_customer(db, user, customer_id)
    today = today_npl()
    st = state_for(db, user.shop_id, c.id)
    data = row(c, st, today)
    opening = db.scalar(select(Opening).where(Opening.customer_id == c.id))
    data |= {
        "total_sold": money(st.sold),
        "total_received": money(st.received),
        "total_discounts": money(st.discounts),
        "payments_count": st.payments_count,
        "last_paid": st.last_paid.isoformat() if st.last_paid else None,
        "advance": st.balance < 0,
        "merged_into_id": str(c.merged_into_id) if c.merged_into_id else None,
        "old_balance": money(opening.amount) if opening else None,
        "old_balance_date": opening.as_of_date.isoformat() if opening else None,
        "still_owed": [
            {
                "kind": o.kind,
                "ref_id": str(o.ref_id),
                "bill_no": o.bill_no,
                "date": o.day.isoformat(),
                "original": money(o.original),
                "left": money(o.left),
                "age_days": o.age_days,
            }
            for o in still_owed(st, today)
        ],
        "ageing_estimated": True,
    }
    return data


@router.get("/{customer_id}/history")
def get_history(
    customer_id: UUID,
    order: str = Query("desc", pattern="^(asc|desc)$"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    c = get_customer(db, user, customer_id)
    entries = history(db, user.shop_id, c.id)
    if order == "desc":
        entries.reverse()
    return entries


class CustomerPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    other_name: str | None = None
    phone: str | None = None
    address: str | None = None
    next_collection_date: date | None = None
    old_balance: Decimal | None = Field(default=None, max_digits=14, decimal_places=2)
    old_balance_date: date | None = None


def snapshot(c: Customer, opening: Opening | None) -> dict:
    return {
        "name": c.name,
        "other_name": c.other_name,
        "phone": c.phone,
        "address": c.address,
        "next_collection_date": c.next_collection_date.isoformat() if c.next_collection_date else None,
        "old_balance": money(opening.amount) if opening else None,
        "old_balance_date": opening.as_of_date.isoformat() if opening else None,
    }


@router.patch("/{customer_id}")
def patch_customer(
    customer_id: UUID, body: CustomerPatch, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    c = get_customer(db, user, customer_id)
    fields = body.model_fields_set
    if user.role != "owner":
        raise HTTPException(403, "Owner only")  # FR-3: a helper can add entries and view, nothing more
    opening = db.scalar(select(Opening).where(Opening.customer_id == c.id))
    before = snapshot(c, opening)

    for f in ("name", "other_name", "phone", "address"):
        if f in fields:
            v = (getattr(body, f) or "").strip()
            if f == "name" and not v:
                raise HTTPException(422, "Name cannot be empty")
            setattr(c, f, v or None)
    if "next_collection_date" in fields:
        c.next_collection_date = body.next_collection_date
    if "old_balance" in fields or "old_balance_date" in fields:
        amount = body.old_balance if "old_balance" in fields else (opening.amount if opening else None)
        as_of = body.old_balance_date or (opening.as_of_date if opening else today_npl())
        if opening is not None:
            opening.amount = amount or Decimal("0")
            opening.as_of_date = as_of
        elif amount not in (None, Decimal("0")):
            opening = Opening(customer_id=c.id, amount=amount, as_of_date=as_of, created_by=user.id)
            db.add(opening)
    db.flush()
    after = snapshot(c, opening)
    if before != after:
        audit(db, user.shop_id, "customer", c.id, "edit", before, after, user.id)
    if state_for(db, user.shop_id, c.id).balance <= 0:
        c.next_collection_date = None
    db.commit()
    return get_sheet(customer_id, user, db)


class ArchiveIn(BaseModel):
    archived: bool = True


@router.post("/{customer_id}/archive")
def archive_customer(
    customer_id: UUID, body: ArchiveIn | None = None, user: User = Depends(owner_only), db: Session = Depends(get_db)
):
    body = body or ArchiveIn()
    c = get_customer(db, user, customer_id)
    before = {"archived": c.archived_at is not None}
    c.archived_at = utcnow() if body.archived else None
    audit(db, user.shop_id, "customer", c.id, "archive", before, {"archived": body.archived}, user.id)
    db.commit()
    return {"id": str(c.id), "archived": body.archived}


class MergeIn(BaseModel):
    into_id: UUID


@router.post("/{customer_id}/merge")
def merge_customer(
    customer_id: UUID, body: MergeIn, user: User = Depends(owner_only), db: Session = Depends(get_db)
):
    """FR-19: moves every entry to the other customer; nothing is deleted."""
    src = get_customer(db, user, customer_id)
    dst = get_customer(db, user, body.into_id)
    if src.id == dst.id:
        raise HTTPException(400, "Choose a different customer")
    if dst.merged_into_id is not None or src.merged_into_id is not None:
        raise HTTPException(400, "Already merged")

    moved = {
        "openings": [str(i) for i in db.scalars(select(Opening.id).where(Opening.customer_id == src.id))],
        "sales": [str(i) for i in db.scalars(select(Sale.id).where(Sale.customer_id == src.id))],
        "payments": [str(i) for i in db.scalars(select(Payment.id).where(Payment.customer_id == src.id))],
    }
    db.execute(update(Opening).where(Opening.customer_id == src.id).values(customer_id=dst.id))
    db.execute(update(Sale).where(Sale.customer_id == src.id).values(customer_id=dst.id))
    db.execute(update(Payment).where(Payment.customer_id == src.id).values(customer_id=dst.id))
    src.merged_into_id = dst.id
    src.archived_at = utcnow()
    src.next_collection_date = None
    for c in db.scalars(select(Customer).where(Customer.possible_duplicate_of.in_([src.id, dst.id]))):
        if c.id in (src.id, dst.id):
            c.possible_duplicate_of = None
    if src.possible_duplicate_of == dst.id:
        src.possible_duplicate_of = None
    db.flush()
    if state_for(db, user.shop_id, dst.id).balance <= 0:
        dst.next_collection_date = None
    audit(
        db,
        user.shop_id,
        "customer",
        src.id,
        "merge",
        {"customer": str(src.id), "name": src.name, **moved},
        {"into": str(dst.id), "name": dst.name},
        user.id,
    )
    db.commit()
    return get_sheet(dst.id, user, db)


def erase_customer(db: Session, user: User, c: Customer) -> dict:
    """Removes the customer and everything under them. A full copy goes to the audit log first.
    Does not commit: the caller does, so several customers can be removed in one transaction."""
    openings = list(db.scalars(select(Opening).where(Opening.customer_id == c.id)))
    sales = list(db.scalars(select(Sale).options(selectinload(Sale.lines)).where(Sale.customer_id == c.id)))
    pays = list(db.scalars(select(Payment).where(Payment.customer_id == c.id)))
    # customers that were merged into this one earlier are empty shells: they go with it
    shells = list(db.scalars(select(Customer).where(Customer.shop_id == user.shop_id, Customer.merged_into_id == c.id)))
    balance = state_for(db, user.shop_id, c.id).balance

    audit(
        db,
        user.shop_id,
        "customer",
        c.id,
        "delete",
        {
            **snapshot(c, openings[0] if openings else None),
            "balance": money(balance),
            "openings": [{"amount": money(o.amount), "as_of_date": o.as_of_date.isoformat()} for o in openings],
            "sales": [sale_snapshot(x) for x in sales],
            "payments": [payment_snapshot(x) for x in pays],
            "merged_shells": [x.name for x in shells],
        },
        None,
        user.id,
    )
    for x in sales + pays + openings + shells:
        db.delete(x)
    for other in db.scalars(select(Customer).where(Customer.possible_duplicate_of == c.id)):
        other.possible_duplicate_of = None
    db.flush()
    db.delete(c)
    db.flush()
    return {"deleted": str(c.id), "sales": len(sales), "payments": len(pays), "balance": money(balance)}


@router.delete("/{customer_id}")
def delete_customer(
    customer_id: UUID,
    confirm_name: str = Query(..., description="The customer's name, typed again to confirm"),
    user: User = Depends(owner_only),
    db: Session = Depends(get_db),
):
    """Deletes the customer and their whole khata."""
    c = get_customer(db, user, customer_id)
    if norm(confirm_name) != norm(c.name):
        raise HTTPException(400, "The name does not match")
    out = erase_customer(db, user, c)
    db.commit()
    return out


class BulkCustomers(BaseModel):
    ids: list[UUID] = Field(min_length=1, max_length=200)
    confirm: str  # must be the word DELETE


@router.post("/bulk-delete")
def bulk_delete_customers(body: BulkCustomers, user: User = Depends(owner_only), db: Session = Depends(get_db)):
    """Deletes several customers, with everything under them, in one go (all or none)."""
    if body.confirm.strip() != "DELETE":
        raise HTTPException(400, "Type DELETE to confirm")
    results = [erase_customer(db, user, get_customer(db, user, cid)) for cid in dict.fromkeys(body.ids)]
    db.commit()
    return {
        "customers": len(results),
        "sales": sum(r["sales"] for r in results),
        "payments": sum(r["payments"] for r in results),
        "balance": money(sum((Decimal(r["balance"]) for r in results), Decimal("0"))),
    }


@router.post("/{customer_id}/dismiss-duplicate")
def dismiss_duplicate(customer_id: UUID, user: User = Depends(owner_only), db: Session = Depends(get_db)):
    c = get_customer(db, user, customer_id)
    c.possible_duplicate_of = None
    db.commit()
    return {"ok": True}
