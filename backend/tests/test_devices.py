"""Three devices per login, sign out one to add another, 7 days idle, one owner, three helpers."""

from datetime import timedelta

import pytest
from sqlalchemy.exc import IntegrityError

from app.db import SessionLocal
from app.models import Shop, User, UserSession
from app.security import hash_password
from app.timeutil import utcnow
from conftest import Api, H


def sign_in(login="owner@example.com", password="ownerpass1", replace=None, ua="Mozilla/5.0 (Windows NT 10.0) Chrome/120"):
    a = Api()
    a.c.headers["user-agent"] = ua
    body = {"login": login, "password": password}
    if replace:
        body["replace_session_id"] = replace
    r = a.c.post("/api/auth/login", json=body)
    return a, r


def three_devices():
    return [sign_in(ua=f"Mozilla/5.0 (Linux; Android 13) Chrome/120 #{i}")[0] for i in range(3)]


def test_fourth_device_is_refused_until_one_is_signed_out():
    devs = three_devices()
    _, r = sign_in()
    assert r.status_code == 409 and "3 devices" in r.json()["detail"]

    # after the right password the three devices can be listed; a wrong password gets nothing
    bad = Api().c.post("/api/auth/login/devices", json={"login": "owner@example.com", "password": "nope"})
    assert bad.status_code == 401
    listed = Api().c.post("/api/auth/login/devices", json={"login": "owner@example.com", "password": "ownerpass1"}, headers=H).json()
    assert len(listed) == 3 and all(d["label"] == "Chrome on Android" for d in listed)

    new, r = sign_in(replace=listed[0]["id"])
    assert r.status_code == 200
    assert new.get("/auth/me").status_code == 200
    gone = [d for d in devs if d.get("/auth/me").status_code == 401]
    assert len(gone) == 1  # exactly the one that was picked


def test_a_made_up_device_id_does_not_let_a_fourth_in():
    three_devices()
    from uuid import uuid4
    _, r = sign_in(replace=str(uuid4()))
    assert r.status_code == 409


def test_signing_in_again_on_the_same_browser_uses_no_extra_slot():
    a, r = sign_in()
    assert r.status_code == 200
    for _ in range(4):
        assert a.c.post("/api/auth/login", json={"login": "owner@example.com", "password": "ownerpass1"}).status_code == 200
    with SessionLocal() as db:
        assert db.query(UserSession).count() == 1


def test_refused_sign_in_on_a_signed_in_browser_keeps_that_session():
    devs = three_devices()
    # a 4th browser is refused; one that is already signed in is not logged out by a failed attempt
    again = devs[0]
    again.c.post("/api/auth/login", json={"login": "owner@example.com", "password": "wrong"})
    assert again.get("/auth/me").status_code == 200


def test_device_list_and_sign_out_one():
    devs = three_devices()
    mine = devs[0].get("/auth/devices").json()
    assert len(mine) == 3 and sum(d["current"] for d in mine) == 1
    other = next(d for d in mine if not d["current"])
    assert devs[0].delete(f"/auth/devices/{other['id']}").json() == {"ok": True}
    assert len(devs[0].get("/auth/devices").json()) == 2
    # signing out the one you are on ends your own session
    here = next(d for d in devs[0].get("/auth/devices").json() if d["current"])
    devs[0].delete(f"/auth/devices/{here['id']}")
    assert devs[0].get("/auth/me").status_code == 401
    # and a slot is free again
    assert sign_in()[1].status_code == 200


def test_you_cannot_sign_out_another_users_device():
    a, _ = sign_in()
    a.post("/users", {"name": "H", "login": "hh", "password": "helperpass"})
    h, r = sign_in("hh", "helperpass")
    hid = h.get("/auth/devices").json()[0]["id"]
    assert a.delete(f"/auth/devices/{hid}").status_code == 404
    assert h.get("/auth/me").status_code == 200


def test_device_unused_for_seven_days_is_signed_out_and_frees_its_slot():
    devs = three_devices()
    with SessionLocal() as db:
        s = db.query(UserSession).first()
        s.last_seen_at = utcnow() - timedelta(days=8)
        db.commit()
    gone = [d for d in devs if d.get("/auth/me").status_code == 401]
    assert len(gone) == 1
    assert sign_in()[1].status_code == 200  # the idle one no longer counts


def test_using_the_app_keeps_a_device_signed_in():
    a, _ = sign_in()
    with SessionLocal() as db:
        s = db.query(UserSession).one()
        s.last_seen_at = utcnow() - timedelta(days=6)
        db.commit()
    assert a.get("/auth/me").status_code == 200
    with SessionLocal() as db:
        assert utcnow() - db.query(UserSession).one().last_seen_at < timedelta(minutes=1)


def test_each_helper_has_their_own_three_devices():
    owner, _ = sign_in()
    owner.post("/users", {"name": "H", "login": "hh", "password": "helperpass"})
    for i in range(3):
        assert sign_in("hh", "helperpass")[1].status_code == 200
    assert sign_in("hh", "helperpass")[1].status_code == 409
    assert sign_in()[1].status_code == 200  # the owner's slots are separate


def test_at_most_three_helpers():
    owner, _ = sign_in()
    for i in range(3):
        assert owner.post("/users", {"name": f"H{i}", "login": f"h{i}", "password": "helperpass"}).status_code == 201
    r = owner.post("/users", {"name": "H4", "login": "h4", "password": "helperpass"})
    assert r.status_code == 400 and "at most 3" in r.json()["detail"]
    # a disabled helper still counts (otherwise disabling is a way round the limit); deleting one frees the place
    uid = owner.get("/users").json()[1]["id"]
    owner.patch(f"/users/{uid}", {"disabled": True})
    assert owner.post("/users", {"name": "H4", "login": "h4", "password": "helperpass"}).status_code == 400
    owner.delete(f"/users/{uid}")
    assert owner.post("/users", {"name": "H4", "login": "h4", "password": "helperpass"}).status_code == 201


def test_a_shop_can_never_have_two_owners():
    with SessionLocal() as db:
        shop = db.query(Shop).first()
        db.add(User(shop_id=shop.id, name="Second", login="second@example.com", password_hash=hash_password("x" * 8), role="owner"))
        with pytest.raises(IntegrityError):
            db.commit()


def test_wrong_passwords_are_rate_limited():
    for _ in range(8):
        assert sign_in(password="nope")[1].status_code == 401
    assert sign_in(password="nope")[1].status_code == 429
    assert sign_in()[1].status_code == 429  # even the right password waits: this is what stops guessing


def test_device_names():
    from app.devices import device_label
    assert device_label("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17.0 Safari/604.1") == "Safari on iPhone"
    assert device_label("Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/120 Safari/537 Edg/120") == "Edge on Windows"
    assert device_label("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Gecko Firefox/120.0") == "Firefox on Mac"
    assert device_label(None) == "Unknown device"
