"""GET /khata: the home screen in one call (FR-21 to FR-25, FR-44 to FR-50)."""

from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..ledger import BUCKETS, CustState, age_bucket, bulk_state, money, still_owed
from ..models import Customer, Payment, Sale, User
from ..routers.customers import row
from ..timeutil import day_range_utc, npl_date, today_npl

router = APIRouter(tags=["khata"])

MODES = ["cash", "esewa", "khalti", "bank", "other"]
ZERO = Decimal("0")


def _today_entries(db: Session, user: User, today):
    start, end = day_range_utc(today)
    sq = select(Sale).where(
        Sale.shop_id == user.shop_id, Sale.voided_at.is_(None), Sale.created_at >= start, Sale.created_at < end
    )
    pq = select(Payment).where(
        Payment.shop_id == user.shop_id, Payment.voided_at.is_(None), Payment.created_at >= start, Payment.created_at < end
    )
    if user.role != "owner":  # a helper sees only their own entries
        sq = sq.where(Sale.created_by == user.id)
        pq = pq.where(Payment.created_by == user.id)
    return list(db.scalars(sq)), list(db.scalars(pq))


def today_card(db: Session, user: User, today) -> dict:
    sales, pays = _today_entries(db, user, today)
    real = [p for p in pays if p.kind == "payment"]
    discounts = [p for p in pays if p.kind == "discount"]
    by_mode = {m: ZERO for m in MODES}
    for p in real:
        by_mode[p.mode] = by_mode.get(p.mode, ZERO) + p.amount

    names = {u.id: u.name for u in db.scalars(select(User).where(User.shop_id == user.shop_id))}
    people: dict = defaultdict(lambda: {"entries": 0, "sales": ZERO, "received": ZERO})
    for s in sales:
        people[s.created_by]["entries"] += 1
        people[s.created_by]["sales"] += s.total
    for p in pays:
        people[p.created_by]["entries"] += 1
        if p.kind == "payment":
            people[p.created_by]["received"] += p.amount

    return {
        "date": today.isoformat(),
        "bills": len(sales),
        "total_sales": money(sum((s.total for s in sales), ZERO)),
        "total_received": money(sum((p.amount for p in real), ZERO)),
        "received_by_mode": {m: money(v) for m, v in by_mode.items()},
        "discounts": money(sum((p.amount for p in discounts), ZERO)),
        "people": [
            {
                "user_id": str(uid),
                "name": names.get(uid, "?"),
                "entries": v["entries"],
                "sales": money(v["sales"]),
                "received": money(v["received"]),
            }
            for uid, v in people.items()
        ],
    }


@router.get("/khata")
def khata(user: User = Depends(current_user), db: Session = Depends(get_db)):
    today = today_npl()
    states = bulk_state(db, user.shop_id)
    customers = list(
        db.scalars(select(Customer).where(Customer.shop_id == user.shop_id, Customer.merged_into_id.is_(None)))
    )
    by_id = {c.id: c for c in customers}
    rows = {c.id: row(c, states.get(c.id, CustState()), today) for c in customers}

    # Archived customers are hidden from the Khata list, so what they owe is not part of "total to collect".
    # It is reported on its own so it can be reviewed or deleted from the Archived screen.
    owing = [c for c in customers if c.archived_at is None and states.get(c.id, CustState()).balance > 0]
    total = sum((states[c.id].balance for c in owing), ZERO)
    archived_all = [c for c in customers if c.archived_at is not None]
    archived_owing = sum((max(states.get(c.id, CustState()).balance, ZERO) for c in archived_all), ZERO)

    def brief(c: Customer) -> dict:
        r = rows[c.id]
        return {
            "id": r["id"],
            "name": r["name"],
            "balance": r["balance"],
            "next_collection_date": r["next_collection_date"],
            "last_activity": r["last_activity"],
        }

    collect_now = []
    for c in owing:
        d = c.next_collection_date
        if d is not None and d <= today:
            b = brief(c)
            b["overdue_days"] = (today - d).days  # 0 = "Due today"
            collect_now.append(b)
    collect_now.sort(key=lambda b: b["next_collection_date"])

    horizon = today + timedelta(days=7)
    coming_up = sorted(
        (brief(c) for c in owing if c.next_collection_date and today < c.next_collection_date <= horizon),
        key=lambda b: b["next_collection_date"],
    )
    no_date = sorted(
        (brief(c) for c in owing if c.next_collection_date is None),
        key=lambda b: (b["last_activity"] or "0000-00-00", b["name"].lower()),
    )

    owing_for = {b: {"bucket": b, "total": ZERO, "customers": []} for b in BUCKETS}
    for c in owing:
        per_bucket: dict[str, Decimal] = defaultdict(lambda: ZERO)
        for o in still_owed(states[c.id], today):
            per_bucket[age_bucket(o.age_days)] += o.left
        for b, amt in per_bucket.items():
            owing_for[b]["total"] += amt
            owing_for[b]["customers"].append({"id": str(c.id), "name": c.name, "amount": money(amt)})
    owing_for_out = []
    for b in BUCKETS:
        g = owing_for[b]
        g["customers"].sort(key=lambda x: -Decimal(x["amount"]))
        owing_for_out.append(
            {
                "bucket": b,
                "total": money(g["total"]),
                "count": len(g["customers"]),
                "customers": g["customers"],
                "estimated": True,
            }
        )

    data = {
        "today": today.isoformat(),
        "total_to_collect": money(total),
        "owing_count": len(owing),
        # crates out in the market: what customers still hold (archived customers are hidden, so not counted)
        "crates_out": sum(max(states.get(c.id, CustState()).crates, 0) for c in customers if c.archived_at is None),
        "crates_holders": sum(1 for c in customers if c.archived_at is None and states.get(c.id, CustState()).crates > 0),
        "archived": {"count": len(archived_all), "owing": money(archived_owing)},
        "today_card": today_card(db, user, today),
        "collect_now": collect_now,
        "coming_up": coming_up,
        "no_date": no_date,
        "owing_for": owing_for_out,
        "customers": sorted(rows.values(), key=lambda r: (-Decimal(r["balance"]), r["name"].lower())),
    }
    if user.role == "owner":
        data["possible_duplicates"] = [
            {
                "id": str(c.id),
                "name": c.name,
                "twin_id": str(c.possible_duplicate_of),
                "twin_name": by_id[c.possible_duplicate_of].name if c.possible_duplicate_of in by_id else None,
            }
            for c in customers
            if c.possible_duplicate_of is not None
        ]
    return data


@router.get("/khata/today-entries")
def today_entries(
    kind: str = Query(pattern="^(sales|received|discounts|mode|person)$"),
    value: str | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """FR-45: the entries behind a line of the Today card."""
    today = today_npl()
    sales, pays = _today_entries(db, user, today)
    names = {c.id: c.name for c in db.scalars(select(Customer).where(Customer.shop_id == user.shop_id))}
    users = {u.id: u.name for u in db.scalars(select(User).where(User.shop_id == user.shop_id))}

    out = []
    if kind in ("sales", "person"):
        for s in sales:
            if kind == "person" and str(s.created_by) != value:
                continue
            out.append(
                {
                    "type": "sale", "id": str(s.id), "customer_id": str(s.customer_id),
                    "customer_name": names.get(s.customer_id), "amount": money(s.total), "bill_no": s.bill_no,
                    "at": s.created_at.isoformat(), "entered_by": users.get(s.created_by),
                }
            )
    if kind in ("received", "discounts", "mode", "person"):
        for p in pays:
            if kind == "received" and p.kind != "payment":
                continue
            if kind == "discounts" and p.kind != "discount":
                continue
            if kind == "mode" and not (p.kind == "payment" and p.mode == value):
                continue
            if kind == "person" and str(p.created_by) != value:
                continue
            out.append(
                {
                    "type": p.kind, "id": str(p.id), "customer_id": str(p.customer_id),
                    "customer_name": names.get(p.customer_id), "amount": money(p.amount), "mode": p.mode,
                    "at": p.paid_at.isoformat(), "entered_by": users.get(p.created_by),
                }
            )
    out.sort(key=lambda e: e["at"], reverse=True)
    return out
