"""GET /reports/sales: the Sales list grouped by day, week, BS month or a date range (FR-26, FR-27)."""

import re
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..bs import bs_month_bounds, bs_month_key, bs_month_label
from ..db import get_db
from ..deps import current_user
from ..ledger import money
from ..models import Customer, Payment, Sale, User
from ..timeutil import day_start_utc, npl_date

router = APIRouter(tags=["reports"])
ZERO = Decimal("0")


def norm(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


def period(group: str, d: date, range_from: date | None, range_to: date | None):
    """(key, label, start, end) of the period that contains day d."""
    if group == "day":
        return d.isoformat(), d.isoformat(), d, d
    if group == "week":  # calendar week, Sunday to Saturday
        start = d - timedelta(days=(d.weekday() + 1) % 7)
        end = start + timedelta(days=6)
        return start.isoformat(), f"{start.isoformat()} – {end.isoformat()}", start, end
    if group == "month":
        key = bs_month_key(d)
        start, end = bs_month_bounds(key)
        return key, bs_month_label(key), start, end
    return "range", f"{range_from} – {range_to}", range_from, range_to


@router.get("/reports/sales")
def sales_report(
    group: Literal["day", "week", "month", "range"] = "day",
    from_: date | None = Query(default=None, alias="from"),
    to: date | None = None,
    customer: str | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if group == "range" and (from_ is None or to is None):
        raise HTTPException(422, "A range needs from and to")
    if from_ and to and from_ > to:
        raise HTTPException(422, "from is after to")

    customers = {c.id: c for c in db.scalars(select(Customer).where(Customer.shop_id == user.shop_id))}
    q = norm(customer)

    def wanted(cid) -> bool:
        if not q:
            return True
        c = customers.get(cid)
        return c is not None and (q in norm(c.name) or q in norm(c.other_name))

    sq = select(Sale).options(selectinload(Sale.lines)).where(Sale.shop_id == user.shop_id, Sale.voided_at.is_(None))
    pq = select(Payment).where(Payment.shop_id == user.shop_id, Payment.voided_at.is_(None), Payment.kind == "payment")
    if from_:
        sq = sq.where(Sale.bill_date >= from_)
        pq = pq.where(Payment.paid_at >= day_start_utc(from_))
    if to:
        sq = sq.where(Sale.bill_date <= to)
        pq = pq.where(Payment.paid_at < day_start_utc(to + timedelta(days=1)))

    groups: dict[str, dict] = {}

    def grp(d: date) -> dict:
        key, label, start, end = period(group, d, from_, to)
        if key not in groups:
            groups[key] = {
                "key": key, "label": label, "start": start.isoformat(), "end": end.isoformat(),
                "bills": 0, "total_kg": ZERO, "total_sales": ZERO, "received": ZERO,
                "_fruits": {}, "bill_list": [],
            }
        return groups[key]

    for s in db.scalars(sq):
        if not wanted(s.customer_id):
            continue
        g = grp(s.bill_date)
        g["bills"] += 1
        g["total_sales"] += s.total
        c = customers.get(s.customer_id)
        for ln in s.lines:
            g["total_kg"] += ln.kg
            f = g["_fruits"].setdefault(
                norm(ln.fruit_name), {"fruit": ln.fruit_name, "kg": ZERO, "amount": ZERO, "_c": {}}
            )
            f["kg"] += ln.kg
            f["amount"] += ln.amount
            cc = f["_c"].setdefault(s.customer_id, {"customer_id": str(s.customer_id), "name": c.name if c else "?", "kg": ZERO})
            cc["kg"] += ln.kg
        g["bill_list"].append(
            {
                "sale_id": str(s.id), "customer_id": str(s.customer_id), "customer_name": c.name if c else "?",
                "bill_no": s.bill_no, "date": s.bill_date.isoformat(), "total": money(s.total),
                "at": s.created_at.isoformat(),
            }
        )

    for p in db.scalars(pq):
        if wanted(p.customer_id):
            grp(npl_date(p.paid_at))["received"] += p.amount

    out = []
    for key in sorted(groups, reverse=True):
        g = groups[key]
        fruits = []
        for f in sorted(g.pop("_fruits").values(), key=lambda f: -f["amount"]):
            fruits.append(
                {
                    "fruit": f["fruit"], "kg": str(f["kg"]), "amount": money(f["amount"]),
                    "customers": [
                        {**c, "kg": str(c["kg"])} for c in sorted(f["_c"].values(), key=lambda c: -c["kg"])
                    ],
                }
            )
        g["fruits"] = fruits
        g["bill_list"].sort(key=lambda b: (b["date"], b["at"]), reverse=True)
        g["total_kg"] = str(g["total_kg"])
        g["total_sales"] = money(g["total_sales"])
        g["received"] = money(g["received"])
        out.append(g)
    return {"group": group, "groups": out}
