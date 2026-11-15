"""Derived ledger state. Balances, history and ageing are always computed from the records (section 5)."""

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .models import AuditLog, Customer, Opening, Payment, Sale, User
from .timeutil import NPT, aware, npl_date

ZERO = Decimal("0")
TWO = Decimal("0.01")


def money(x: Decimal | None) -> str | None:
    if x is None:
        return None
    return str(Decimal(x).quantize(TWO))


def line_amount(kg: Decimal, rate: Decimal) -> Decimal:
    """kg x rate rounded half-up to whole rupees (section 5)."""
    return (Decimal(kg) * Decimal(rate)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def audit(db: Session, shop_id, entity: str, entity_id, action: str, before, after, user_id):
    db.add(
        AuditLog(
            shop_id=shop_id,
            entity=entity,
            entity_id=entity_id,
            action=action,
            before_json=before,
            after_json=after,
            user_id=user_id,
        )
    )


# ---------------------------------------------------------------- serialisation


def sale_snapshot(s: Sale) -> dict:
    return {
        "id": str(s.id),
        "customer_id": str(s.customer_id),
        "bill_no": s.bill_no,
        "bill_date": s.bill_date.isoformat(),
        "total": money(s.total),
        "voided": s.voided_at is not None,
        "lines": [
            {
                "fruit_name": ln.fruit_name,
                "kg": str(ln.kg),
                "rate": money(ln.rate),
                "crates": ln.crates,
                "amount": money(ln.amount),
            }
            for ln in s.lines
        ],
    }


def payment_snapshot(p: Payment) -> dict:
    return {
        "id": str(p.id),
        "customer_id": str(p.customer_id),
        "kind": p.kind,
        "amount": money(p.amount),
        "mode": p.mode,
        "paid_at": aware(p.paid_at).isoformat(),
        "note": p.note,
        "voided": p.voided_at is not None,
    }


# ---------------------------------------------------------------- bulk state


@dataclass
class Item:
    day: date
    sort: datetime
    amount: Decimal
    kind: str  # opening | sale
    ref_id: uuid.UUID
    bill_no: str | None = None


@dataclass
class CustState:
    opening: Decimal = ZERO
    sold: Decimal = ZERO
    received: Decimal = ZERO  # payments only
    discounts: Decimal = ZERO
    payments_count: int = 0
    last_paid: datetime | None = None
    last_activity: date | None = None
    items: list[Item] = field(default_factory=list)
    credits: Decimal = ZERO  # payments + discounts + negative openings

    @property
    def balance(self) -> Decimal:
        return self.opening + self.sold - self.received - self.discounts


def _midnight(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=NPT)


def _touch(st: CustState, d: date):
    if st.last_activity is None or d > st.last_activity:
        st.last_activity = d


def bulk_state(db: Session, shop_id, customer_id: uuid.UUID | None = None) -> dict[uuid.UUID, CustState]:
    """Ledger state for every customer of the shop, or for one customer (voided entries excluded)."""
    states: dict[uuid.UUID, CustState] = {}

    def st(cid) -> CustState:
        if cid not in states:
            states[cid] = CustState()
        return states[cid]

    rows = db.execute(
        select(Opening.id, Opening.customer_id, Opening.amount, Opening.as_of_date, Opening.created_at)
        .join(Customer, Customer.id == Opening.customer_id)
        .where(Customer.shop_id == shop_id, *([Opening.customer_id == customer_id] if customer_id else []))
    )
    for oid, cid, amount, as_of, created in rows:
        s = st(cid)
        s.opening += amount
        _touch(s, as_of)
        if amount > 0:
            s.items.append(Item(as_of, _midnight(as_of), amount, "opening", oid))
        else:
            s.credits += -amount

    rows = db.execute(
        select(Sale.id, Sale.customer_id, Sale.bill_date, Sale.total, Sale.bill_no, Sale.created_at).where(
            Sale.shop_id == shop_id, Sale.voided_at.is_(None), *([Sale.customer_id == customer_id] if customer_id else [])
        )
    )
    for sid, cid, bdate, total, bill_no, created in rows:
        s = st(cid)
        s.sold += total
        _touch(s, bdate)
        s.items.append(Item(bdate, aware(created), total, "sale", sid, bill_no))

    rows = db.execute(
        select(Payment.customer_id, Payment.kind, Payment.amount, Payment.paid_at).where(
            Payment.shop_id == shop_id, Payment.voided_at.is_(None), *([Payment.customer_id == customer_id] if customer_id else [])
        )
    )
    for cid, kind, amount, paid_at in rows:
        s = st(cid)
        s.credits += amount
        _touch(s, npl_date(paid_at))
        if kind == "discount":
            s.discounts += amount
        else:
            s.received += amount
            s.payments_count += 1
            if s.last_paid is None or aware(paid_at) > s.last_paid:
                s.last_paid = aware(paid_at)
    return states


def state_for(db: Session, shop_id, customer_id) -> CustState:
    # one customer only: a customer page must not read every sale and payment of the shop
    return bulk_state(db, shop_id, customer_id).get(customer_id, CustState())


def balance_for(db: Session, shop_id, customer_id) -> Decimal:
    return state_for(db, shop_id, customer_id).balance


# ---------------------------------------------------------------- ageing (FR-46..FR-50)


@dataclass
class StillOwed:
    kind: str
    ref_id: uuid.UUID
    bill_no: str | None
    day: date
    original: Decimal
    left: Decimal
    age_days: int


def still_owed(state: CustState, today: date) -> list[StillOwed]:
    """Apply payments and discounts to the oldest amounts first. Derived on demand, never stored."""
    if state.balance <= 0:
        return []
    credit = state.credits
    out: list[StillOwed] = []
    for it in sorted(state.items, key=lambda i: (i.day, aware(i.sort))):
        cover = min(credit, it.amount)
        credit -= cover
        left = it.amount - cover
        if left > 0:
            out.append(
                StillOwed(it.kind, it.ref_id, it.bill_no, it.day, it.amount, left, max(0, (today - it.day).days))
            )
    return out


def age_bucket(days: int) -> str:
    """Groups match a 1-2 week payment cycle: normal credit, getting late, late, stuck."""
    if days <= 7:
        return "0-7"
    if days <= 14:
        return "8-14"
    if days <= 30:
        return "15-30"
    return "30+"


BUCKETS = ["0-7", "8-14", "15-30", "30+"]


# ---------------------------------------------------------------- history (FR-16, FR-17)

_ORDER = {"opening": 0, "sale": 1, "payment": 2, "discount": 2}


def history(db: Session, shop_id, customer_id) -> list[dict]:
    """Every entry for a customer, oldest first, each with the balance before and after it."""
    users = {u.id: u.name for u in db.scalars(select(User).where(User.shop_id == shop_id))}
    entries: list[dict] = []

    for o in db.scalars(select(Opening).where(Opening.customer_id == customer_id)):
        entries.append(
            {
                "type": "opening",
                "id": str(o.id),
                "date": o.as_of_date.isoformat(),
                "at": _midnight(o.as_of_date).isoformat(),
                "amount": money(o.amount),
                "voided": False,
                "entered_by": users.get(o.created_by),
                "entered_at": aware(o.created_at).isoformat(),
                "_delta": o.amount,
                "_key": (o.as_of_date, _midnight(o.as_of_date), 0),
            }
        )

    sales = db.scalars(
        select(Sale).options(selectinload(Sale.lines)).where(Sale.shop_id == shop_id, Sale.customer_id == customer_id)
    )
    for s in sales:
        snap = sale_snapshot(s)
        entries.append(
            {
                "type": "sale",
                "id": str(s.id),
                "date": s.bill_date.isoformat(),
                "at": aware(s.created_at).isoformat(),
                "amount": money(s.total),
                "bill_no": s.bill_no,
                "lines": snap["lines"],
                "voided": s.voided_at is not None,
                "void_reason": s.void_reason,
                "entered_by": users.get(s.created_by),
                "entered_by_id": str(s.created_by),
                "entered_at": aware(s.created_at).isoformat(),
                "received_at_server": aware(s.server_received_at).isoformat(),
                "_delta": s.total if s.voided_at is None else ZERO,
                "_key": (s.bill_date, aware(s.created_at), 1),
            }
        )

    pays = db.scalars(select(Payment).where(Payment.shop_id == shop_id, Payment.customer_id == customer_id))
    for p in pays:
        entries.append(
            {
                "type": p.kind,  # payment | discount
                "id": str(p.id),
                "date": npl_date(p.paid_at).isoformat(),
                "at": aware(p.paid_at).isoformat(),
                "amount": money(p.amount),
                "mode": p.mode,
                "note": p.note,
                "voided": p.voided_at is not None,
                "void_reason": p.void_reason,
                "entered_by": users.get(p.created_by),
                "entered_by_id": str(p.created_by),
                "entered_at": aware(p.created_at).isoformat(),
                "received_at_server": aware(p.server_received_at).isoformat(),
                "_delta": -p.amount if p.voided_at is None else ZERO,
                "_key": (npl_date(p.paid_at), aware(p.paid_at), 2),
            }
        )

    entries.sort(key=lambda e: e["_key"])
    running = ZERO
    for e in entries:
        e["balance_before"] = money(running)
        running += e.pop("_delta")
        e["balance_after"] = money(running)
        e.pop("_key")

    # A bill and the money received with it are saved in one go (same person, same moment).
    # Link them, so the ledger can show "bill 10,000, paid 3,000 now" as a single line.
    sale_at = {(e["entered_by_id"], e["entered_at"]): e for e in entries if e["type"] == "sale"}
    for e in entries:
        if e["type"] != "payment":
            continue
        s = sale_at.get((e["entered_by_id"], e["entered_at"]))
        if s is not None and "paid_with" not in s:
            s["paid_with"] = {"id": e["id"], "amount": e["amount"], "mode": e["mode"], "voided": e["voided"]}
            e["with_sale"] = s["id"]
    return entries
