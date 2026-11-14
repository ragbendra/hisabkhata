"""Bikram Sambat (BS) conversion. Dates are stored as AD; BS is for display and grouping."""

from datetime import date

import nepali_datetime

BS_MONTHS_EN = [
    "Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin",
    "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra",
]


def to_bs(d: date) -> tuple[int, int, int]:
    b = nepali_datetime.date.from_datetime_date(d)
    return b.year, b.month, b.day


def bs_str(d: date | None) -> str:
    if d is None:
        return ""
    y, m, day = to_bs(d)
    return f"{y:04d}-{m:02d}-{day:02d}"


def bs_month_key(d: date) -> str:
    y, m, _ = to_bs(d)
    return f"{y:04d}-{m:02d}"


def bs_month_label(key: str) -> str:
    y, m = key.split("-")
    return f"{BS_MONTHS_EN[int(m) - 1]} {y}"


def bs_month_bounds(key: str) -> tuple[date, date]:
    y, m = (int(x) for x in key.split("-"))
    start = nepali_datetime.date(y, m, 1).to_datetime_date()
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    next_start = nepali_datetime.date(ny, nm, 1).to_datetime_date()
    from datetime import timedelta

    return start, next_start - timedelta(days=1)
