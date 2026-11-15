"""Command line helpers.

    python -m app.cli create-shop --name "Shop name" --email owner@example.com --password ...
    python -m app.cli init-db          # dev only; production uses `alembic upgrade head`
"""

import argparse
import getpass
import sys

from sqlalchemy import select

from .db import Base, SessionLocal, engine
from .models import Shop, User
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


def main() -> None:
    p = argparse.ArgumentParser(prog="app.cli")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create-shop")
    c.add_argument("--name", required=True)
    c.add_argument("--email", required=True)
    c.add_argument("--owner-name")
    c.add_argument("--password")
    d = sub.add_parser("create-demo", help="create the isolated public demo shop")
    d.add_argument("--yes", action="store_true", help="required because this writes to the configured database")
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
    elif args.cmd == "create-demo":
        if not args.yes:
            sys.exit("Run create-demo with --yes to create the public demo shop.")
        from .demo import create_demo

        create_demo()


if __name__ == "__main__":
    main()
