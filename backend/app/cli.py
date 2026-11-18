"""Command line helpers.

    python -m app.cli create-shop --name "Shop name" --email owner@example.com --password ...
    python -m app.cli init-db          # dev only; production uses `alembic upgrade head`
"""

import argparse
import getpass
import sys

from sqlalchemy import select

from .db import Base, SessionLocal, engine
from .models import PlatformAdmin, Shop, User
from .security import hash_password


def create_shop(name: str, email: str, password: str, owner_name: str | None = None) -> None:
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.login == email.lower())):
            sys.exit("That email already has a login")
        shop = Shop(name=name)
        db.add(shop)
        db.flush()
        db.add(
            User(
                shop_id=shop.id,
                name=owner_name or "Owner",
                login=email.strip().lower(),
                password_hash=hash_password(password),
                role="owner",
            )
        )
        db.commit()
        print(f"Created shop '{name}' with owner {email}")


def create_admin(email: str, name: str, password: str) -> None:
    """There is exactly one platform admin. A second one cannot be created."""
    with SessionLocal() as db:
        if db.scalar(select(PlatformAdmin.id).limit(1)) is not None:
            sys.exit("A platform admin already exists. Only one is allowed. Use admin-recover if you lost access.")
        db.add(PlatformAdmin(email=email.strip().lower(), name=name, password_hash=hash_password(password)))
        db.commit()
        print(f"Created platform admin {email}. Sign in at /admin")


def admin_recover(password: str) -> None:
    """Lost the password or the phone? Sets a new password, turns two-step sign-in off and signs the admin out."""
    from .models import AdminSession

    with SessionLocal() as db:
        admin = db.scalar(select(PlatformAdmin))
        if admin is None:
            sys.exit("There is no platform admin yet. Use create-admin.")
        admin.password_hash = hash_password(password)
        admin.totp_secret = admin.totp_pending = None
        admin.disabled_at = None
        for sess in db.scalars(select(AdminSession).where(AdminSession.admin_id == admin.id)):
            db.delete(sess)
        db.commit()
        print(f"Password reset for {admin.email}; two-step sign-in is off. Turn it on again after signing in.")


def main() -> None:
    p = argparse.ArgumentParser(prog="app.cli")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create-shop")
    c.add_argument("--name", required=True)
    c.add_argument("--email", required=True)
    c.add_argument("--owner-name")
    c.add_argument("--password")
    a = sub.add_parser("create-admin", help="the person who runs Hisab; signs in at /admin")
    a.add_argument("--email", required=True)
    a.add_argument("--name", default="Admin")
    a.add_argument("--password")
    r = sub.add_parser("admin-recover", help="reset the admin password and turn two-step sign-in off")
    r.add_argument("--password")
    sub.add_parser("init-db")
    args = p.parse_args()

    if args.cmd == "init-db":
        import app.models  # noqa: F401  (registers tables)

        Base.metadata.create_all(engine)
        print("Tables created")
    elif args.cmd == "create-shop":
        pw = args.password or getpass.getpass("Owner password: ")
        if len(pw) < 8:
            sys.exit("Password must be at least 8 characters")
        create_shop(args.name, args.email, pw, args.owner_name)
    elif args.cmd == "admin-recover":
        pw = args.password or getpass.getpass("New admin password (12+ characters): ")
        if len(pw) < 12:
            sys.exit("Admin password must be at least 12 characters")
        admin_recover(pw)
    elif args.cmd == "create-admin":
        pw = args.password or getpass.getpass("Admin password (12+ characters): ")
        if len(pw) < 12:
            sys.exit("Admin password must be at least 12 characters")
        create_admin(args.email, args.name, pw)


if __name__ == "__main__":
    main()
