"""PDF exports: one bill, and a customer's statement (the ledger page). English only."""

import re
from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..billpdf import build_bill, build_statement, mode_text
from ..config import settings
from ..db import get_db
from ..deps import current_user
from ..ledger import history
from ..models import Customer, Sale, Shop, User
from ..timeutil import today_npl

router = APIRouter(tags=["pdf"])


def _slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-")[:40] or "customer"


def _pdf(data: bytes, filename: str) -> Response:
    return Response(
        data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )


def _customer(db: Session, user: User, customer_id: UUID) -> Customer:
    c = db.get(Customer, customer_id)
    if c is None or c.shop_id != user.shop_id:
        raise HTTPException(404, "Customer not found")
    return c


def _info(c: Customer) -> dict:
    return {"name": c.name, "phone": c.phone, "address": c.address}


@router.get("/sales/{sale_id}/pdf")
def bill_pdf(sale_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(Sale, sale_id)
    if s is None or s.shop_id != user.shop_id:
        raise HTTPException(404, "Bill not found")
    if s.voided_at is not None:
        raise HTTPException(404, "This bill was cancelled")
    c = db.get(Customer, s.customer_id)
    shop = db.get(Shop, user.shop_id)
    entries = history(db, user.shop_id, c.id)
    by_id = {e["id"]: e for e in entries}
    e = by_id[str(s.id)]

    paid, paid_mode = Decimal("0"), None
    before, after = Decimal(e["balance_before"]), Decimal(e["balance_after"])
    pw = e.get("paid_with")
    if pw and not pw["voided"]:
        paid, paid_mode = Decimal(pw["amount"]), pw["mode"]
        pe = by_id[pw["id"]]
        # the bill and the money received with it are one line: show the balance around both
        if pe["balance_after"] == e["balance_before"]:
            before = Decimal(pe["balance_before"])
        if pe["balance_before"] == e["balance_after"]:
            after = Decimal(pe["balance_after"])

    data = build_bill(
        shop_name=shop.name,
        address=shop.address or settings.bill_address,
        phone=shop.phone,
        customer=_info(c),
        printed_on=today_npl(),
        bill_no=s.bill_no,
        bill_date=s.bill_date,
        lines=e["lines"],
        total=s.total,
        paid=paid,
        paid_mode=paid_mode,
        balance_before=before,
        balance_after=after,
    )
    return _pdf(data, f"Bill-{s.bill_no or 'sale'}-{_slug(c.name)}.pdf")


def _statement_rows(entries: list[dict], keys: set[str] | None = None) -> list[dict]:
    """Ledger lines for the PDF. With `keys` (like "sale:<id>", "payment:<id>", "opening:<id>") only those entries.
    A bill and the money taken with it are one line; they are picked together."""
    by_id = {e["id"]: e for e in entries}

    def kind(e: dict) -> str:
        return "payment" if e["type"] == "discount" else e["type"]

    def picked(e: dict) -> bool:
        return keys is None or f"{kind(e)}:{e['id']}" in keys

    rows = []
    for e in entries:
        if e["type"] == "payment" and e.get("with_sale") in by_id and picked(by_id[e["with_sale"]]):
            continue  # shown on its bill's line
        if not picked(e):
            continue
        row = {"date": date.fromisoformat(e["date"]), "head": "", "tag": None, "items": "", "debit": Decimal(0), "credit": Decimal(0), "balance": Decimal(e["balance_after"])}
        amount = Decimal(e["amount"])
        if e["type"] == "sale":
            pw = e.get("paid_with")
            paid = Decimal(pw["amount"]) if pw and not pw["voided"] else Decimal(0)
            row["head"] = f"Bill {e['bill_no']}" if e.get("bill_no") else "Sale"
            row["tag"] = mode_text(pw["mode"]) if paid else "On credit"
            row["items"] = ", ".join(f"{ln['fruit_name']} {Decimal(ln['kg']).normalize():f} kg" for ln in e["lines"])
            row["debit"], row["credit"] = max(amount - paid, Decimal(0)), paid
            if paid:
                pe = by_id[pw["id"]]
                if pe["balance_before"] == e["balance_after"]:
                    row["balance"] = Decimal(pe["balance_after"])
        elif e["type"] == "payment":
            row["head"], row["tag"], row["items"], row["credit"] = "Payment received", mode_text(e["mode"]), e.get("note") or "", amount
        elif e["type"] == "discount":
            row["head"], row["items"], row["credit"] = "Discount", e.get("note") or "", amount
        else:
            row["head"] = "Old balance"
            row["debit" if amount >= 0 else "credit"] = abs(amount)
        rows.append(row)
    return rows


def _statement(db: Session, user: User, customer_id: UUID, keys: set[str] | None) -> Response:
    c = _customer(db, user, customer_id)
    shop = db.get(Shop, user.shop_id)
    entries = [e for e in history(db, user.shop_id, c.id) if not e["voided"]]
    rows = _statement_rows(entries, keys)
    if keys is not None and not rows:
        raise HTTPException(422, "None of the selected entries were found")
    closing = Decimal(entries[-1]["balance_after"]) if entries else Decimal(0)
    selection = (len(rows), len(_statement_rows(entries))) if keys is not None else None
    data = build_statement(
        shop_name=shop.name,
        address=shop.address or settings.bill_address,
        phone=shop.phone,
        customer=_info(c),
        rows=rows,
        closing=closing,
        printed_on=today_npl(),
        selection=selection,
    )
    return _pdf(data, f"Statement-{_slug(c.name)}{'-selected' if keys is not None else ''}.pdf")


@router.get("/customers/{customer_id}/statement.pdf")
def statement_pdf(customer_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The whole ledger of one customer."""
    return _statement(db, user, customer_id, None)


class SelectedIn(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=2000)  # "sale:<id>", "payment:<id>", "opening:<id>"


@router.post("/customers/{customer_id}/statement.pdf")
def selected_statement_pdf(
    customer_id: UUID, body: SelectedIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    """Only the chosen entries, for example the payments of one month."""
    return _statement(db, user, customer_id, set(body.keys))
