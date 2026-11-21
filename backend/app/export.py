"""Excel export (FR-37 to FR-39). Each file is a complete snapshot."""

import io
from datetime import date

from openpyxl import Workbook
from openpyxl.styles import Font
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .bs import bs_str
from .ledger import bulk_state
from .models import Customer, Payment, Sale, Shop
from .timeutil import NPT, aware, npl_date, utcnow


def _bs_ad(d: date | None) -> tuple[str, str]:
    return (bs_str(d), d.isoformat()) if d else ("", "")


def build_workbook(db: Session, shop_id) -> tuple[str, bytes]:
    shop = db.get(Shop, shop_id)
    now = utcnow().astimezone(NPT)
    today = now.date()
    customers = {c.id: c for c in db.scalars(select(Customer).where(Customer.shop_id == shop_id))}
    states = bulk_state(db, shop_id)
    crates = bool(shop.track_crates)

    wb = Workbook()
    ws = wb.active
    ws.title = "Balances"
    ws.append(["Balances as of", f"{now:%Y-%m-%d %H:%M} (Nepal time)", f"BS {bs_str(today)}"])
    ws.append([shop.name])
    ws.append([])
    ws.append(
        [
            "Customer", "Phone", "Balance", "Old balance carried over", "Last payment (BS)", "Last payment (AD)",
            "Collection date (BS)", "Collection date (AD)",
            *(["Crates with him"] if crates else []),
        ]
    )
    for cell in ws[4]:
        cell.font = Font(bold=True)
    ws["A1"].font = Font(bold=True)
    for c in sorted(customers.values(), key=lambda c: c.name.lower()):
        if c.merged_into_id is not None:  # its entries now belong to the customer it was merged into
            continue
        st = states.get(c.id)
        last_paid = npl_date(st.last_paid) if st and st.last_paid else None
        ws.append(
            [
                c.name, c.phone or "", st.balance if st else 0, st.opening if st else 0,
                *_bs_ad(last_paid), *_bs_ad(c.next_collection_date),
                *([st.crates if st else 0] if crates else []),
            ]
        )

    ws2 = wb.create_sheet("Sales")
    ws2.append(["Date (BS)", "Date (AD)", "Bill no", "Customer", "Fruit", "Kg", "Rate", "Amount", "Status", *(["Crates"] if crates else [])])
    for cell in ws2[1]:
        cell.font = Font(bold=True)
    sales = db.scalars(
        select(Sale).options(selectinload(Sale.lines)).where(Sale.shop_id == shop_id).order_by(Sale.bill_date, Sale.created_at)
    )
    for s in sales:
        status = "Voided" if s.voided_at else "Active"
        for ln in s.lines:
            ws2.append(
                [
                    *_bs_ad(s.bill_date), s.bill_no or "", customers[s.customer_id].name, ln.fruit_name,
                    ln.kg, ln.rate, ln.amount, status,
                    *([ln.crates or 0] if crates else []),
                ]
            )

    ws3 = wb.create_sheet("Payments")
    ws3.append(["Date (BS)", "Date (AD)", "Time", "Customer", "Amount", "Mode", "Note", "Status", "Type", *(["Crates returned"] if crates else [])])
    for cell in ws3[1]:
        cell.font = Font(bold=True)
    for p in db.scalars(select(Payment).where(Payment.shop_id == shop_id).order_by(Payment.paid_at)):
        local = aware(p.paid_at).astimezone(NPT)
        ws3.append(
            [
                *_bs_ad(local.date()), f"{local:%H:%M}", customers[p.customer_id].name, p.amount, p.mode,
                p.note or "", "Voided" if p.voided_at else "Active",
                {"discount": "Discount / round-off", "crates": "Crates entry"}.get(p.kind, "Payment"),
                *([p.crates_in] if crates else []),
            ]
        )

    for sheet in wb.worksheets:
        for col in sheet.columns:
            width = max((len(str(c.value)) for c in col if c.value is not None), default=8)
            sheet.column_dimensions[col[0].column_letter].width = min(max(width + 2, 10), 40)

    buf = io.BytesIO()
    wb.save(buf)
    return f"Hisab-{today.isoformat()}.xlsx", buf.getvalue()
