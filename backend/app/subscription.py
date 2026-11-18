"""Trial and paid periods. The state is derived from the shop's status and access_until, never stored."""

from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import PlatformSetting, Shop
from .timeutil import NPT, aware, utcnow

DEFAULT_SETTINGS = {"trial_days": "14", "invite_days": "7", "requests_open": "1"}


def get_setting(db: Session, key: str) -> str:
    row = db.get(PlatformSetting, key)
    return row.value if row else DEFAULT_SETTINGS[key]


def all_settings(db: Session) -> dict:
    return {
        "trial_days": int(get_setting(db, "trial_days")),
        "invite_days": int(get_setting(db, "invite_days")),
        "requests_open": get_setting(db, "requests_open") == "1",
    }


def set_setting(db: Session, key: str, value: str) -> None:
    row = db.get(PlatformSetting, key)
    if row is None:
        db.add(PlatformSetting(key=key, value=value))
    else:
        row.value = value


def end_of_day(d: date) -> datetime:
    """A date typed on the admin page means 'until the end of that day' in Nepal."""
    return datetime.combine(d, time(23, 59, 59), tzinfo=NPT)


def shop_state(shop: Shop, now: datetime | None = None) -> str:
    """suspended | expired | trial | active. Expired shops can look and export but not add or change."""
    now = now or utcnow()
    if shop.status == "suspended":
        return "suspended"
    if shop.access_until is not None and aware(shop.access_until) < now:
        return "expired"
    return "trial" if shop.status == "trial" else "active"


def days_left(shop: Shop, now: datetime | None = None) -> int | None:
    if shop.access_until is None:
        return None
    now = now or utcnow()
    secs = (aware(shop.access_until) - now).total_seconds()
    return int(secs // 86400) if secs >= 0 else -int((-secs) // 86400) - 1


def subscription_payload(shop: Shop) -> dict:
    st = shop_state(shop)
    return {
        "state": st,
        "read_only": st == "expired",
        "access_until": aware(shop.access_until).isoformat() if shop.access_until else None,
        "access_until_date": aware(shop.access_until).astimezone(NPT).date().isoformat() if shop.access_until else None,
        "days_left": days_left(shop),
    }


def extend(shop: Shop, days: int, now: datetime | None = None) -> datetime:
    """Adds days to whatever is left, or starts from now when it already ended."""
    now = now or utcnow()
    base = aware(shop.access_until) if shop.access_until and aware(shop.access_until) > now else now
    shop.access_until = base + timedelta(days=days)
    return shop.access_until


def last_activity(db: Session, shop_id):
    from sqlalchemy import func

    from .models import Payment, Sale

    a = db.scalar(select(func.max(Sale.server_received_at)).where(Sale.shop_id == shop_id))
    b = db.scalar(select(func.max(Payment.server_received_at)).where(Payment.shop_id == shop_id))
    vals = [aware(x) for x in (a, b) if x]
    return max(vals) if vals else None
