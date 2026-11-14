"""Edit and void sales and payments (FR-12, FR-28, FR-29). Voided rows stay in the database."""

from datetime import date, timedelta
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..deps import current_user, owner_only
from ..ledger import audit, line_amount, money, payment_snapshot, sale_snapshot, state_for
from ..models import Customer, Payment, Sale, SaleLine, User
from ..routers.entries import LineIn, Mode, remember_fruit
from ..timeutil import at_npl, aware, utcnow

router = APIRouter(tags=["corrections"])

UNDO_WINDOW = timedelta(minutes=10)


class VoidIn(BaseModel):
    reason: str | None = Field(default=None, max_length=300)
    undo: bool = False


def _load_sale(db: Session, user: User, sale_id: UUID) -> Sale:
    s = db.scalar(select(Sale).options(selectinload(Sale.lines)).where(Sale.id == sale_id))
    if s is None or s.shop_id != user.shop_id:
        raise HTTPException(404, "Sale not found")
    return s


def _load_payment(db: Session, user: User, payment_id: UUID) -> Payment:
    p = db.get(Payment, payment_id)
    if p is None or p.shop_id != user.shop_id:
        raise HTTPException(404, "Payment not found")
    return p


def _can_void(user: User, obj) -> bool:
    if user.role == "owner":
        return True
    # FR-12: the person who made the entry may undo it for 10 minutes
    return obj.created_by == user.id and utcnow() - aware(obj.server_received_at) <= UNDO_WINDOW


def _after_change(db: Session, user: User, customer_id) -> str:
    db.flush()
    bal = state_for(db, user.shop_id, customer_id).balance
    cust = db.get(Customer, customer_id)
    if bal <= 0:
        cust.next_collection_date = None
    return money(bal)


class SalePatch(BaseModel):
    bill_no: str | None = Field(default=None, max_length=40)
    bill_date: date | None = None
    lines: list[LineIn] | None = None


@router.patch("/sales/{sale_id}")
def edit_sale(sale_id: UUID, body: SalePatch, user: User = Depends(owner_only), db: Session = Depends(get_db)):
    s = _load_sale(db, user, sale_id)
    if s.voided_at is not None:
        raise HTTPException(400, "A voided sale cannot be edited")
    before = sale_snapshot(s)
    fields = body.model_fields_set
    if "bill_no" in fields:
        s.bill_no = (body.bill_no or "").strip() or None
    if body.bill_date:
        s.bill_date = body.bill_date
    if body.lines is not None:
        if not body.lines:
            raise HTTPException(422, "A sale needs at least one fruit line (void it instead)")
        new_lines = []
        for i, ln in enumerate(body.lines):
            new_lines.append(
                SaleLine(
                    position=i,
                    fruit_name=ln.fruit_name.strip(),
                    kg=ln.kg,
                    rate=ln.rate,
                    crates=ln.crates,
                    amount=line_amount(ln.kg, ln.rate),
                )
            )
            remember_fruit(db, user.shop_id, ln.fruit_name, ln.rate, utcnow())
        s.lines = new_lines
        s.total = sum((ln.amount for ln in new_lines), Decimal("0"))  # FR-29: recalculated from the lines
    db.flush()
    audit(db, user.shop_id, "sale", s.id, "edit", before, sale_snapshot(s), user.id)
    balance = _after_change(db, user, s.customer_id)
    db.commit()
    return {"sale": sale_snapshot(s), "customer_balance": balance}


@router.post("/sales/{sale_id}/void")
def void_sale(sale_id: UUID, body: VoidIn | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    body = body or VoidIn()
    s = _load_sale(db, user, sale_id)
    if not _can_void(user, s):
        raise HTTPException(403, "Only the owner can void this entry")
    if s.voided_at is None:
        before = sale_snapshot(s)
        s.voided_at = utcnow()
        s.void_reason = body.reason
        audit(db, user.shop_id, "sale", s.id, "undo" if body.undo else "void", before, sale_snapshot(s), user.id)
    balance = _after_change(db, user, s.customer_id)
    db.commit()
    return {"sale": sale_snapshot(s), "customer_balance": balance}


class PaymentPatch(BaseModel):
    amount: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=2)
    mode: Mode | None = None
    kind: Literal["payment", "discount"] | None = None
    note: str | None = Field(default=None, max_length=300)
    paid_date: date | None = None


@router.patch("/payments/{payment_id}")
def edit_payment(
    payment_id: UUID, body: PaymentPatch, user: User = Depends(owner_only), db: Session = Depends(get_db)
):
    p = _load_payment(db, user, payment_id)
    if p.voided_at is not None:
        raise HTTPException(400, "A voided payment cannot be edited")
    before = payment_snapshot(p)
    fields = body.model_fields_set
    if body.amount is not None:
        p.amount = body.amount
    if body.mode:
        p.mode = body.mode
    if body.kind:
        p.kind = body.kind
    if "note" in fields:
        p.note = (body.note or "").strip() or None
    if body.paid_date:
        p.paid_at = at_npl(body.paid_date, p.paid_at)
    db.flush()
    audit(db, user.shop_id, "payment", p.id, "edit", before, payment_snapshot(p), user.id)
    balance = _after_change(db, user, p.customer_id)
    db.commit()
    return {"payment": payment_snapshot(p), "customer_balance": balance}


@router.post("/payments/{payment_id}/void")
def void_payment(
    payment_id: UUID, body: VoidIn | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    body = body or VoidIn()
    p = _load_payment(db, user, payment_id)
    if not _can_void(user, p):
        raise HTTPException(403, "Only the owner can void this entry")
    if p.voided_at is None:
        before = payment_snapshot(p)
        p.voided_at = utcnow()
        p.void_reason = body.reason
        audit(db, user.shop_id, "payment", p.id, "undo" if body.undo else "void", before, payment_snapshot(p), user.id)
    balance = _after_change(db, user, p.customer_id)
    db.commit()
    return {"payment": payment_snapshot(p), "customer_balance": balance}
