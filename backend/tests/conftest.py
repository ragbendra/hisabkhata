import os
import tempfile
import uuid

# Must be set before the app is imported.
_tmp = tempfile.mkdtemp()
os.environ["FK_DATABASE_URL"] = os.environ.get("FK_TEST_DATABASE_URL") or f"sqlite:///{_tmp}/test.db"
os.environ["FK_STATIC_DIR"] = os.path.join(_tmp, "no-static")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Shop, User  # noqa: E402
from app.security import hash_password  # noqa: E402

H = {"X-Requested-With": "fruit-khata"}


class Api:
    """A signed-in browser: its own cookie jar."""

    def __init__(self):
        self.c = TestClient(app, headers=H)

    def login(self, login, password):
        r = self.c.post("/api/auth/login", json={"login": login, "password": password})
        assert r.status_code == 200, r.text
        return self

    def get(self, url, **kw):
        return self.c.get("/api" + url, **kw)

    def post(self, url, json=None, **kw):
        return self.c.post("/api" + url, json=json, **kw)

    def put(self, url, json=None, **kw):
        return self.c.put("/api" + url, json=json, **kw)

    def patch(self, url, json=None, **kw):
        return self.c.patch("/api" + url, json=json, **kw)

    def delete(self, url, **kw):
        return self.c.delete("/api" + url, **kw)


@pytest.fixture(autouse=True)
def fresh_db():
    from app.ratelimit import limiter

    limiter.reset()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        shop = Shop(name="Test Fruits")
        db.add(shop)
        db.flush()
        db.add(User(shop_id=shop.id, name="Owner", login="owner@example.com",
                    password_hash=hash_password("ownerpass1"), role="owner"))
        db.commit()
    yield


@pytest.fixture
def owner():
    return Api().login("owner@example.com", "ownerpass1")


@pytest.fixture
def helper(owner):
    r = owner.post("/users", {"name": "Helper", "login": "helper", "password": "helperpass"})
    assert r.status_code == 201, r.text
    return Api().login("helper", "helperpass")


def uid() -> str:
    return str(uuid.uuid4())


def entry(customer=None, new=None, lines=None, received=None, **extra):
    """Build a POST /entries body. `new` is a customer name for a new customer."""
    body = {}
    if new:
        body["new_customer"] = {"id": uid(), "name": new}
    else:
        body["customer_id"] = customer
    if lines:
        body["sale_id"] = uid()
        body["lines"] = [{"fruit_name": n, "kg": str(kg), "rate": str(rate)} for n, kg, rate in lines]
    if received is not None:
        body["payment_id"] = uid()
        body["received_amount"] = str(received)
    body.update(extra)
    return body
