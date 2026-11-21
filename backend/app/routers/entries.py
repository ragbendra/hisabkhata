"""POST /entries: a sale, a payment, or both. Idempotent by UUID (FR-4 to FR-14, FR-32)."""

import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..ledger import balance_for, line_amount, money, state_for
from ..models import Customer, FruitName, Opening, Payment, Sale, SaleLine, Shop, User
from ..timeutil import aware, at_npl, npl_date, utcnow

router = APIRouter(tags=["entries"])

Mode = Literal["cash", "esewa", "khalti", "bank", "other"]


def norm_name(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip()).lower()


class LineIn(BaseModel):
    fruit_name: str = Field(min_length=1, max_length=120)
    kg: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    rate: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    crates: int | None = Field(default=None, ge=0)


class NewCustomerIn(BaseModel):
    id: UUID
    name: str = Field(min_length=1, max_length=200)
    other_name: str | None = None
    phone: str | None = None
    address: str | None = None
    old_balance: Decimal | None = Field(default=None, max_digits=14, decimal_places=2)
    old_balance_date: date | None = None
    opening_id: UUID | None = None
    old_crates: int | None = Field(default=None, ge=0, le=100000)  # crates he already holds from before the app
    old_crates_id: UUID | None = None


class EntryIn(BaseModel):
    customer_id: UUID | None = None
    new_customer: NewCustomerIn | None = None

    sale_id: UUID | None = None
    lines: list[LineIn] = []
    bill_no: str | None = Field(default=None, max_length=40)
    entry_date: date | None = None  # BS date picked by the owner, sent as AD

    payment_id: UUID | None = None
    received_amount: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=2)
    mode: Mode = "cash"
    kind: Literal["payment", "discount"] = "payment"
    note: str | None = Field(default=None, max_length=300)

    crates_back: int = Field(default=0, ge=0, le=100000)  # empty crates he returns in this visit
    crates_lent: int = Field(default=0, ge=0, le=100000)  # crates handed out without a bill

    collect_by: date | None = None  # present and null = "none"
    created_at: datetime | None = None  # when the phone saved it (offline entries)

    @model_validator(mode="after")
    def check(self):
        if (self.customer_id is None) == (self.new_customer is None):
            raise ValueError("Give either customer_id or new_customer")
        crates_net = self.crates_back - self.crates_lent
        if not self.lines and self.received_amount is None and crates_net == 0:
            raise ValueError("Add at least one fruit line, a received amount or crates")
        if self.lines and self.sale_id is None:
            raise ValueError("sale_id is required when there are fruit lines")
        if (self.received_amount is not None or crates_net != 0) and self.payment_id is None:
            raise ValueError("payment_id is required when there is a received amount or crates")
        return self


def resolve_customer(db: Session, shop_id, customer_id) -> Customer:
    c = db.get(Customer, customer_id)
    hops = 0
    while c is not None and c.merged_into_id is not None and hops < 10:  # stale id after a merge
        c = db.get(Customer, c.merged_into_id)
        hops += 1
    if c is None or c.shop_id != shop_id:
        raise HTTPException(404, "Customer not found")
    return c


def remember_fruit(db: Session, shop_id, name: str, rate: Decimal, when: datetime):
    key = norm_name(name)
    for f in db.scalars(select(FruitName).where(FruitName.shop_id == shop_id)):
        if norm_name(f.name) == key:
            f.last_rate, f.last_used_at = rate, when
            return
    db.add(FruitName(shop_id=shop_id, name=name.strip(), last_rate=rate, last_used_at=when))


def process(db: Session, user: User, body: EntryIn) -> dict:
    now = utcnow()
    created_at = aware(body.created_at) if body.created_at else now
    if created_at > now + timedelta(minutes=5):  # a phone clock running fast must not push entries into the future
        created_at = now
    entry_day = npl_date(created_at)
    helper = user.role == "helper"
    if body.entry_date and body.entry_date > entry_day:
        raise HTTPException(422, "The date cannot be in the future")

    if helper:
        if body.kind == "discount":
            raise HTTPException(403, "Helpers cannot record a discount or round-off")
        if body.new_customer and body.new_customer.old_balance not in (None, Decimal("0")):
            raise HTTPException(403, "Helpers cannot set an old balance")
        if body.new_customer and body.new_customer.old_crates:
            raise HTTPException(403, "Helpers cannot set old crates")
        if body.entry_date and body.entry_date != entry_day:
            raise HTTPException(403, "Helpers cannot backdate an entry")
    bill_date = entry_day if helper else (body.entry_date or entry_day)

    # ---- customer (get or create)
    if body.customer_id:
        cust = resolve_customer(db, user.shop_id, body.customer_id)
    else:
        nc = body.new_customer
        cust = db.get(Customer, nc.id)
        if cust is not None:
            if cust.shop_id != user.shop_id:
                raise HTTPException(409, "Id already used")
        else:
            cust = Customer(
                id=nc.id,
                shop_id=user.shop_id,
                name=nc.name.strip(),
                other_name=(nc.other_name or "").strip() or None,
                phone=(nc.phone or "").strip() or None,
                address=(nc.address or "").strip() or None,
                created_at=created_at,
            )
            twin = None
            for other in db.scalars(
                select(Customer).where(
                    Customer.shop_id == user.shop_id, Customer.merged_into_id.is_(None), Customer.id != nc.id
                )
            ):
                if norm_name(other.name) == norm_name(nc.name):
                    twin = other
                    break
            if twin is not None:
                cust.possible_duplicate_of = twin.id  # FR-20: flag, never merge by itself
            db.add(cust)
            db.flush()
            if nc.old_balance not in (None, Decimal("0")):
                opening = Opening(
                    customer_id=cust.id,
                    amount=nc.old_balance,
                    as_of_date=nc.old_balance_date or entry_day,
                    created_at=created_at,
                    created_by=user.id,
                )
                if nc.opening_id:
                    opening.id = nc.opening_id
                db.add(opening)
            if nc.old_crates:
                old_day = nc.old_balance_date or entry_day
                brought = Payment(
                    shop_id=user.shop_id,
                    customer_id=cust.id,
                    kind="crates",
                    amount=Decimal("0"),
                    mode="cash",
                    paid_at=at_npl(old_day, created_at - timedelta(seconds=1)),  # sorts before the first bill of that day
                    note="Crates brought forward",
                    crates_in=-nc.old_crates,
                    created_at=created_at - timedelta(seconds=1),  # not paired with the first bill
                    created_by=user.id,
                    server_received_at=now,
                )
                if nc.old_crates_id:
                    brought.id = nc.old_crates_id
                db.add(brought)

    created_any = False
    sale_out = payment_out = None

    # ---- sale
    if body.lines:
        sale = db.get(Sale, body.sale_id)
        if sale is not None:
            if sale.shop_id != user.shop_id:
                raise HTTPException(409, "Id already used")
        else:
            lines = []
            for i, ln in enumerate(body.lines):
                lines.append(
                    SaleLine(
                        position=i,
                        fruit_name=ln.fruit_name.strip(),
                        kg=ln.kg,
                        rate=ln.rate,
                        crates=ln.crates,
                        amount=line_amount(ln.kg, ln.rate),
                    )
                )
                remember_fruit(db, user.shop_id, ln.fruit_name, ln.rate, created_at)
            bill_no = (body.bill_no or "").strip() or None
            sale = Sale(
                id=body.sale_id,
                shop_id=user.shop_id,
                customer_id=cust.id,
                bill_no=bill_no,
                bill_date=bill_date,
                total=sum((ln.amount for ln in lines), Decimal("0")),
                created_at=created_at,
                created_by=user.id,
                server_received_at=now,
                lines=lines,
            )
            db.add(sale)
            created_any = True
            if bill_no and bill_no.isdigit():
                shop = db.get(Shop, user.shop_id)
                shop.next_bill_no = max(shop.next_bill_no, int(bill_no) + 1)
        sale_out = {"id": str(sale.id), "total": money(sale.total), "bill_no": sale.bill_no}

    # ---- payment, and/or crates handed back (one row holds both)
    crates_net = body.crates_back - body.crates_lent
    if body.received_amount is not None or crates_net != 0:
        pay = db.get(Payment, body.payment_id)
        if pay is not None:
            if pay.shop_id != user.shop_id:
                raise HTTPException(409, "Id already used")
        else:
            paid_at = created_at if bill_date == entry_day else at_npl(bill_date, created_at)
            pay = Payment(
                id=body.payment_id,
                shop_id=user.shop_id,
                customer_id=cust.id,
                kind=body.kind if body.received_amount is not None else "crates",
                amount=body.received_amount if body.received_amount is not None else Decimal("0"),
                crates_in=crates_net,
                mode=body.mode,
                paid_at=paid_at,
                note=(body.note or "").strip() or None,
                created_at=created_at,
                created_by=user.id,
                server_received_at=now,
            )
            db.add(pay)
            created_any = True
        payment_out = {"id": str(pay.id), "amount": money(pay.amount), "kind": pay.kind, "crates_in": pay.crates_in}

    db.flush()
    balance = balance_for(db, user.shop_id, cust.id)
    crates = state_for(db, user.shop_id, cust.id).crates

    # ---- collection date (FR-11)
    if created_any:
        if balance <= 0:
            cust.next_collection_date = None
        elif "collect_by" in body.model_fields_set:
            cust.next_collection_date = body.collect_by

    db.commit()
    return {
        "customer": {
            "id": str(cust.id),
            "name": cust.name,
            "balance": money(balance),
            "crates": crates,
            "next_collection_date": cust.next_collection_date.isoformat() if cust.next_collection_date else None,
        },
        "sale": sale_out,
        "payment": payment_out,
        "duplicate": not created_any,
    }


@router.post("/entries")
def create_entry(body: EntryIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    try:
        return process(db, user, body)
    except IntegrityError:
        # Two sends of the same entry raced each other. The second attempt sees the first one's rows.
        db.rollback()
        return process(db, user, body)


@router.get("/bills/check")
def check_bill(bill_no: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """FR-10: warn when a bill number is already used (saving is still allowed)."""
    sale = db.scalar(
        select(Sale).where(Sale.shop_id == user.shop_id, Sale.bill_no == bill_no.strip(), Sale.voided_at.is_(None))
    )
    if sale is None:
        return {"exists": False}
    cust = db.get(Customer, sale.customer_id)
    return {"exists": True, "customer": cust.name if cust else None, "sale_id": str(sale.id)}
