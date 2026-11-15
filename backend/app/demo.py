"""Create the small, isolated demo shop used by the public live demo.

Run once against the production database after deploying:
    python -m app.cli create-demo --yes
"""

from decimal import Decimal

from sqlalchemy import select

from .db import SessionLocal
from .models import Shop, User
from .routers.entries import EntryIn, process
from .security import hash_password


DEMO_LOGIN = "demo@hisab.app"
DEMO_PASSWORD = "TryHisab2026!"


def create_demo() -> None:
    """Create an independent tenant; never touch an existing shop or its data."""
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.login == DEMO_LOGIN)):
            print("The demo login already exists; no changes made.")
            return

        shop = Shop(name="Hisab Demo Fruit Traders", next_bill_no=104)
        db.add(shop)
        db.flush()
        owner = User(
            shop_id=shop.id,
            name="Demo Owner",
            login=DEMO_LOGIN,
            password_hash=hash_password(DEMO_PASSWORD),
            role="owner",
        )
        db.add(owner)
        db.commit()

        entries = (
            {
                "new_customer": {"id": "1cf4e50b-73c3-4a79-b9bc-2357ae0dc001", "name": "Everest Fruit Mart", "phone": "9800000001", "address": "Biratnagar"},
                "sale_id": "1cf4e50b-73c3-4a79-b9bc-2357ae0df001",
                "bill_no": "101",
                "lines": [{"fruit_name": "Apple", "kg": "25", "rate": "240"}, {"fruit_name": "Banana", "kg": "40", "rate": "110"}],
                "received_amount": "5000", "payment_id": "1cf4e50b-73c3-4a79-b9bc-2357ae0df101", "mode": "cash",
            },
            {
                "new_customer": {"id": "1cf4e50b-73c3-4a79-b9bc-2357ae0dc002", "name": "Koshi Juice Corner", "phone": "9800000002", "address": "Main Road"},
                "sale_id": "1cf4e50b-73c3-4a79-b9bc-2357ae0df002",
                "bill_no": "102",
                "lines": [{"fruit_name": "Orange", "kg": "30", "rate": "130"}, {"fruit_name": "Papaya", "kg": "20", "rate": "85"}],
                "received_amount": "2500", "payment_id": "1cf4e50b-73c3-4a79-b9bc-2357ae0df102", "mode": "esewa",
            },
            {
                "new_customer": {"id": "1cf4e50b-73c3-4a79-b9bc-2357ae0dc003", "name": "Sunrise Fruit Stall", "phone": "9800000003", "address": "Traffic Chowk"},
                "sale_id": "1cf4e50b-73c3-4a79-b9bc-2357ae0df003",
                "bill_no": "103",
                "lines": [{"fruit_name": "Grapes", "kg": "15", "rate": "260"}, {"fruit_name": "Guava", "kg": "25", "rate": "100"}],
                "received_amount": str(Decimal("3000")), "payment_id": "1cf4e50b-73c3-4a79-b9bc-2357ae0df103", "mode": "bank",
            },
        )
        for entry in entries:
            process(db, owner, EntryIn.model_validate(entry))

        print(f"Created demo shop with 3 fake customers. Login: {DEMO_LOGIN}")

