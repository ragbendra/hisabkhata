"""Scheduled jobs (FR-36 to FR-38). Run them from cron or the host's scheduler:

    python -m app.jobs backup         # once a day: pg_dump, prune after 30 days, copy off-site
    python -m app.jobs weekly-email   # every 15 minutes: sends the workbook when the owner's day/time arrives
    python -m app.jobs verify-restore --restored-url postgresql://...   # compares balances with the live database
"""

import argparse
import logging
import shutil
import subprocess
import sys
import time
from datetime import timedelta
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from .config import normalize_db_url, settings
from .db import SessionLocal
from .emailer import send_email
from .export import build_workbook
from .ledger import bulk_state
from .models import BackupRun, Customer, Shop, User
from .timeutil import NPT, utcnow

log = logging.getLogger("fruit_khata.jobs")
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _owners(db: Session) -> list[User]:
    return list(db.scalars(select(User).where(User.role == "owner", User.disabled_at.is_(None))))


def warn_owners(db: Session, subject: str, text: str) -> None:
    for o in _owners(db):
        try:
            send_email(o.login, f"Hisab warning: {subject}", text)
        except Exception:  # a failing warning must not hide the original failure
            log.exception("Could not send warning email to %s", o.login)


def _record(db: Session, kind: str, ok: bool, detail: str, started) -> None:
    db.add(BackupRun(kind=kind, started_at=started, finished_at=utcnow(), ok=ok, detail=detail[:2000]))
    db.commit()


def _dump(target: Path) -> None:
    url = make_url(settings.database_url)
    if url.get_backend_name() == "sqlite":  # development only
        shutil.copy(url.database, target)
        return
    pg_url = url.set(drivername="postgresql").render_as_string(hide_password=False)
    subprocess.run(["pg_dump", "--format=custom", "--no-owner", "--file", str(target), pg_url], check=True, timeout=1800)


def _upload_offsite(path: Path) -> None:
    import boto3

    s3 = boto3.client(
        "s3",
        endpoint_url=settings.offsite_endpoint_url or None,
        aws_access_key_id=settings.offsite_access_key or None,
        aws_secret_access_key=settings.offsite_secret_key or None,
    )
    s3.upload_file(str(path), settings.offsite_bucket, settings.offsite_prefix + path.name)
    # keep 30 days off-site as well
    cutoff = utcnow() - timedelta(days=settings.backup_keep_days)
    listing = s3.list_objects_v2(Bucket=settings.offsite_bucket, Prefix=settings.offsite_prefix)
    for obj in listing.get("Contents", []):
        if obj["LastModified"] < cutoff:
            s3.delete_object(Bucket=settings.offsite_bucket, Key=obj["Key"])


def run_backup() -> bool:
    out_dir = Path(settings.backup_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = utcnow().strftime("%Y%m%d-%H%M%S")
    ok_all = True
    with SessionLocal() as db:
        started = utcnow()
        target = out_dir / f"fruit-khata-{stamp}.dump"
        try:
            _dump(target)
            _record(db, "database", True, str(target), started)
            cutoff = time.time() - settings.backup_keep_days * 86400
            for old in out_dir.glob("fruit-khata-*.dump"):
                if old.stat().st_mtime < cutoff:
                    old.unlink()
        except Exception as e:
            ok_all = False
            _record(db, "database", False, repr(e), started)
            warn_owners(db, "daily backup failed", f"The daily database backup failed:\n\n{e!r}")
            return False

        if settings.offsite_bucket:
            started = utcnow()
            try:
                _upload_offsite(target)
                _record(db, "off-site", True, target.name, started)
            except Exception as e:
                ok_all = False
                _record(db, "off-site", False, repr(e), started)
                warn_owners(db, "off-site backup copy failed", f"Copying the backup off-site failed:\n\n{e!r}")
    return ok_all


def run_weekly_email(force: bool = False) -> int:
    """Sends the workbook to each owner whose chosen day and time has arrived. Returns how many were sent."""
    sent = 0
    now = utcnow().astimezone(NPT)
    with SessionLocal() as db:
        for shop in db.scalars(select(Shop)):
            sunday_based_day = (now.weekday() + 1) % 7
            due = (
                sunday_based_day == shop.backup_email_day
                and f"{now:%H:%M}" >= shop.backup_email_time
                and shop.last_weekly_email_on != now.date()
            )
            if not (due or force):
                continue
            owner = db.scalar(select(User).where(User.shop_id == shop.id, User.role == "owner"))
            if owner is None:
                continue
            started = utcnow()
            try:
                filename, data = build_workbook(db, shop.id)
                send_email(
                    owner.login,
                    f"Hisab backup {now.date().isoformat()}",
                    "Attached is the full Hisab workbook (Balances, Sales, Payments).\n\n"
                    "This file is a complete snapshot. The newest file replaces the older ones, "
                    "and you can delete the older ones.\n",
                    attachments=[(filename, data, XLSX)],
                )
                shop.last_weekly_email_on = now.date()
                _record(db, "email", True, filename, started)
                sent += 1
            except Exception as e:
                _record(db, "email", False, repr(e), started)
                warn_owners(db, "weekly email failed", f"The weekly emailed copy failed:\n\n{e!r}")
    return sent


def verify_restore(restored_url: str) -> bool:
    """FR-36: the restore test passes only when every customer balance matches the live system."""
    other = sessionmaker(bind=create_engine(normalize_db_url(restored_url)))()
    mismatches = 0
    with SessionLocal() as live, other as restored:
        for shop in live.scalars(select(Shop)):
            a = bulk_state(live, shop.id)
            b = bulk_state(restored, shop.id)
            ids = {c.id for c in live.scalars(select(Customer).where(Customer.shop_id == shop.id))}
            rids = {c.id for c in restored.scalars(select(Customer).where(Customer.shop_id == shop.id))}
            if ids != rids:
                print(f"Customer lists differ: {len(ids ^ rids)} customers are in only one database")
                mismatches += 1
            for cid in ids & rids:
                x = a[cid].balance if cid in a else 0
                y = b[cid].balance if cid in b else 0
                if x != y:
                    print(f"Balance differs for {cid}: live {x}, restored {y}")
                    mismatches += 1
    print("PASS: every balance matches" if mismatches == 0 else f"FAIL: {mismatches} differences")
    return mismatches == 0


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    p = argparse.ArgumentParser(prog="app.jobs")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("backup")
    w = sub.add_parser("weekly-email")
    w.add_argument("--force", action="store_true", help="send now, regardless of the chosen day")
    v = sub.add_parser("verify-restore")
    v.add_argument("--restored-url", required=True)
    args = p.parse_args()

    if args.cmd == "backup":
        sys.exit(0 if run_backup() else 1)
    if args.cmd == "weekly-email":
        print(f"Sent {run_weekly_email(args.force)} email(s)")
    if args.cmd == "verify-restore":
        sys.exit(0 if verify_restore(args.restored_url) else 1)


if __name__ == "__main__":
    main()
