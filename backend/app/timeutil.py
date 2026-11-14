"""Nepal time helpers (FR-43). All instants are stored in UTC; days follow Nepal time."""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

UTC = timezone.utc
NPT = ZoneInfo("Asia/Kathmandu")  # UTC+05:45


def utcnow() -> datetime:
    return datetime.now(UTC)


def aware(dt: datetime) -> datetime:
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


def npl_date(dt: datetime) -> date:
    return aware(dt).astimezone(NPT).date()


def today_npl() -> date:
    return npl_date(utcnow())


def day_start_utc(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=NPT).astimezone(UTC)


def day_range_utc(d: date) -> tuple[datetime, datetime]:
    return day_start_utc(d), day_start_utc(d + timedelta(days=1))


def at_npl(d: date, like: datetime) -> datetime:
    """The instant on Nepal day `d` at the same Nepal clock time as `like`."""
    t = aware(like).astimezone(NPT).timetz().replace(tzinfo=None)
    return datetime.combine(d, t, tzinfo=NPT).astimezone(UTC)
