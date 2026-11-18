"""Platform admin: separate sign-in, access requests, invites, trials, payments, read-only after expiry."""

from datetime import timedelta

import pytest
from conftest import Api, entry
from sqlalchemy import select

from app import totp
from app.db import SessionLocal
from app.models import AuditLog, PlatformAdmin, Shop, User
from app.ratelimit import limiter
from app.security import hash_password
from app.timeutil import utcnow

ADMIN = ("boss@example.com", "a-long-admin-pass")


@pytest.fixture
def admin():
    with SessionLocal() as db:
        db.add(PlatformAdmin(email=ADMIN[0], name="Boss", password_hash=hash_password(ADMIN[1])))
        db.commit()
    a = Api()
    r = a.post("/admin/login", {"email": ADMIN[0], "password": ADMIN[1]})
    assert r.status_code == 200, r.text
    return a


def request_access(anon, **over):
    body = {"shop_name": "Sharma Fruits", "owner_name": "Hari Sharma", "contact": "hari@example.com", "city": "Biratnagar"}
    body.update(over)
    return anon.post("/public/request-access", body)


def token_of(link: str) -> str:
    return link.split("token=")[1]


# ---------------------------------------------------------------- sign in
def test_admin_pages_need_admin_login_and_shop_owner_is_not_admin(owner):
    anon = Api()
    assert anon.get("/admin/shops").status_code == 401
    assert owner.get("/admin/shops").status_code == 401  # a shop owner's cookie is not an admin cookie
    assert anon.post("/admin/login", {"email": "x@example.com", "password": "whatever-long"}).status_code == 401


def test_admin_login_is_rate_limited(admin):
    other = Api()
    for _ in range(5):
        assert other.post("/admin/login", {"email": ADMIN[0], "password": "wrong-wrong-wrong"}).status_code == 401
    assert other.post("/admin/login", {"email": ADMIN[0], "password": ADMIN[1]}).status_code == 429


def test_two_step_sign_in(admin):
    s = admin.post("/admin/two-step/start").json()
    assert admin.post("/admin/two-step/confirm", {"code": "000000"}).status_code == 400
    assert admin.post("/admin/two-step/confirm", {"code": totp._code(s["secret"], int(__import__("time").time() // 30))}).status_code == 200
    other = Api()
    r = other.post("/admin/login", {"email": ADMIN[0], "password": ADMIN[1]})
    assert r.json() == {"need_code": True}
    assert other.get("/admin/me").status_code == 401  # no session without the code
    assert other.post("/admin/login", {"email": ADMIN[0], "password": ADMIN[1], "code": "123456"}).status_code == 401
    good = totp._code(s["secret"], int(__import__("time").time() // 30))
    assert other.post("/admin/login", {"email": ADMIN[0], "password": ADMIN[1], "code": good}).status_code == 200
    assert other.get("/admin/me").json()["two_step"] is True


def test_totp_matches_the_rfc_vector():
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"  # ASCII "12345678901234567890"
    assert totp._code(secret, 59 // 30) == "287082"


# ---------------------------------------------------------------- request -> approve -> invite -> shop
def test_request_creates_nothing_but_a_row(admin):
    anon = Api()
    assert request_access(anon).status_code == 201
    with SessionLocal() as db:
        assert db.scalar(select(User).where(User.login == "hari@example.com")) is None
        assert len(db.scalars(select(Shop)).all()) == 1  # only the fixture shop
    rows = admin.get("/admin/requests").json()
    assert len(rows) == 1 and rows[0]["shop_name"] == "Sharma Fruits"


def test_honeypot_and_limits_and_closing(admin):
    anon = Api()
    assert request_access(anon, website="http://spam.example").status_code == 201
    assert admin.get("/admin/requests").json() == []  # bots get "ok" but nothing is stored
    for i in range(4):
        assert request_access(anon, shop_name=f"Shop {i}").status_code == 201
    assert request_access(anon).status_code == 429  # 5 per hour per connection
    limiter.reset()
    admin.put("/admin/settings", {"requests_open": False})
    assert request_access(anon).status_code == 403
    assert anon.get("/public/status").json() == {"requests_open": False}


def test_full_invite_flow_gives_a_14_day_trial(admin):
    anon = Api()
    request_access(anon)
    rid = admin.get("/admin/requests").json()[0]["id"]
    out = admin.post(f"/admin/requests/{rid}/approve", {}).json()
    assert out["trial_days"] == 14 and out["email"] == "hari@example.com"
    token = token_of(out["link"])
    assert admin.get("/admin/requests").json() == []  # handled
    info = anon.get(f"/public/invite/{token}").json()
    assert info["shop_name"] == "Sharma Fruits"

    # the invited email cannot be swapped for another one
    r = anon.post(f"/public/invite/{token}/accept", {"shop_name": "Sharma Fruits", "owner_name": "Hari", "email": "other@example.com", "password": "password123"})
    assert r.status_code == 201, r.text
    me = r.json()
    assert me["login"] == "hari@example.com" and me["subscription"]["state"] == "trial"
    assert 13 <= me["subscription"]["days_left"] <= 14
    assert anon.get("/khata").status_code == 200  # signed in straight away

    # the link works once
    assert Api().get(f"/public/invite/{token}").status_code == 404
    assert Api().post(f"/public/invite/{token}/accept", {"shop_name": "X Shop", "owner_name": "Y Z", "email": "z@example.com", "password": "password123"}).status_code == 404


def test_invite_expiry_revoke_and_duplicate_email(admin, owner):
    made = admin.post("/admin/invites", {"shop_name": "A Shop", "send_email": False}).json()
    token = token_of(made["link"])
    assert admin.delete(f"/admin/invites/{made['id']}").json()["status"] == "revoked"
    assert Api().get(f"/public/invite/{token}").status_code == 404

    expired = admin.post("/admin/invites", {"send_email": False}).json()
    from app.models import Invite

    with SessionLocal() as db:
        inv = db.get(Invite, __import__("uuid").UUID(expired["id"]))
        inv.expires_at = utcnow() - timedelta(minutes=1)
        db.commit()
    assert Api().get(f"/public/invite/{token_of(expired['link'])}").status_code == 404

    ok = admin.post("/admin/invites", {"send_email": False}).json()
    r = Api().post(
        f"/public/invite/{token_of(ok['link'])}/accept",
        {"shop_name": "Dup Shop", "owner_name": "Dup", "email": "owner@example.com", "password": "password123"},
    )
    assert r.status_code == 409  # that email already has a login
    assert admin.post("/admin/invites", {"email": "owner@example.com"}).status_code == 409


# ---------------------------------------------------------------- trials, payments, read-only
def new_trial_shop(admin, email="t@example.com"):
    made = admin.post("/admin/invites", {"send_email": False}).json()
    shop = Api()
    r = shop.post(f"/public/invite/{token_of(made['link'])}/accept", {"shop_name": "Trial Shop", "owner_name": "T Owner", "email": email, "password": "password123"})
    assert r.status_code == 201, r.text
    return shop, r.json()["shop"]["id"]


def set_end(shop_id, delta):
    from uuid import UUID

    with SessionLocal() as db:
        db.get(Shop, UUID(shop_id)).access_until = utcnow() + delta
        db.commit()


def test_expired_shop_is_read_only_and_can_still_export(admin):
    shop, sid = new_trial_shop(admin)
    cid = shop.post("/entries", entry(new="Ram", lines=[("Apple", 10, 100)])).json()["customer"]["id"]
    set_end(sid, -timedelta(days=1))
    me = shop.get("/auth/me").json()["subscription"]
    assert me["state"] == "expired" and me["read_only"] is True
    assert shop.get(f"/customers/{cid}").status_code == 200  # can look
    r = shop.post("/entries", entry(customer=cid, received=100))
    assert r.status_code == 402 and "subscription" in r.json()["detail"].lower()
    assert shop.delete(f"/customers/{cid}?confirm_name=Ram").status_code == 402


def test_payment_extends_activates_and_is_audited(admin):
    shop, sid = new_trial_shop(admin)
    set_end(sid, -timedelta(days=2))
    r = admin.post(f"/admin/shops/{sid}/payments", {"amount": "1500", "mode": "esewa", "extend_days": 30, "note": "Nov"})
    assert r.status_code == 201, r.text
    row = r.json()
    assert row["status"] == "active" and row["state"] == "active" and 29 <= row["days_left"] <= 30
    assert shop.post("/entries", entry(new="Sita", lines=[("Apple", 1, 10)])).status_code == 200  # writable again
    d = admin.get(f"/admin/shops/{sid}").json()
    assert d["payments"][0]["amount"] == "1500.00" and d["users_list"][0]["role"] == "owner"
    assert admin.get("/admin/shops").json()["summary"]["received_this_month"] == "1500.00"
    with SessionLocal() as db:
        log = db.scalars(select(AuditLog).where(AuditLog.action == "admin_payment")).one()
        assert log.after_json["by_admin"] == ADMIN[0] and log.after_json["amount"] == "1500"
    assert admin.post(f"/admin/shops/{sid}/payments", {"amount": "10", "mode": "gold"}).status_code == 422


def test_extend_adds_to_what_is_left(admin):
    _, sid = new_trial_shop(admin)
    before = admin.get(f"/admin/shops/{sid}").json()["days_left"]
    after = admin.post(f"/admin/shops/{sid}/extend", {"days": 7}).json()["days_left"]
    assert after == before + 7


def test_suspend_signs_out_and_blocks_login_restore_allows(admin):
    shop, sid = new_trial_shop(admin, "s@example.com")
    assert admin.patch(f"/admin/shops/{sid}", {"status": "suspended"}).json()["state"] == "suspended"
    assert shop.get("/khata").status_code in (401, 403)
    r = Api().post("/auth/login", {"login": "s@example.com", "password": "password123"})
    assert r.status_code == 403
    admin.patch(f"/admin/shops/{sid}", {"status": "trial"})
    assert Api().login("s@example.com", "password123").get("/khata").status_code == 200


def test_admin_can_edit_dates_notes_and_remove_the_end_date(admin):
    _, sid = new_trial_shop(admin)
    r = admin.patch(f"/admin/shops/{sid}", {"access_until": "2031-01-15", "admin_notes": "friend of Ramesh", "name": "Renamed"}).json()
    assert r["access_until_date"] == "2031-01-15" and r["admin_notes"] == "friend of Ramesh" and r["name"] == "Renamed"
    r = admin.patch(f"/admin/shops/{sid}", {"access_until": None}).json()
    assert r["access_until"] is None and r["days_left"] is None and r["state"] == "trial"


def test_existing_shops_are_active_without_end_date(admin, owner):
    rows = admin.get("/admin/shops").json()["shops"]
    fixture = next(r for r in rows if r["name"] == "Test Fruits")
    assert fixture["state"] == "active" and fixture["access_until"] is None
    assert owner.post("/entries", entry(new="Still works", lines=[("Apple", 1, 10)])).status_code == 200


def test_reset_owner_password_link(admin):
    _, sid = new_trial_shop(admin, "reset@example.com")
    out = admin.post(f"/admin/shops/{sid}/reset-owner-password").json()
    token = token_of(out["link"])
    assert Api().post("/auth/reset/confirm", {"token": token, "password": "brandnewpass1"}).status_code == 200
    Api().login("reset@example.com", "brandnewpass1")


def test_settings_change_the_trial_length(admin):
    assert admin.get("/admin/settings").json() == {"trial_days": 14, "invite_days": 7, "requests_open": True}
    admin.put("/admin/settings", {"trial_days": 30})
    made = admin.post("/admin/invites", {"send_email": False}).json()
    assert made["trial_days"] == 30
    assert admin.post("/admin/invites", {"trial_days": 3, "send_email": False}).json()["trial_days"] == 3


def test_only_one_admin_can_exist_and_recovery_resets_access(admin):
    from app import cli

    with pytest.raises(SystemExit):
        cli.create_admin("second@example.com", "Second", "another-long-pass")
    with SessionLocal() as db:
        assert len(db.scalars(select(PlatformAdmin)).all()) == 1

    # two-step on, then "lost the phone": recovery sets a new password and turns it off
    s = admin.post("/admin/two-step/start").json()
    admin.post("/admin/two-step/confirm", {"code": totp._code(s["secret"], int(__import__("time").time() // 30))})
    cli.admin_recover("brand-new-long-pass")
    assert admin.get("/admin/me").status_code == 401  # signed out everywhere
    fresh = Api()
    assert fresh.post("/admin/login", {"email": ADMIN[0], "password": ADMIN[1]}).status_code == 401  # old password dead
    r = fresh.post("/admin/login", {"email": ADMIN[0], "password": "brand-new-long-pass"})
    assert r.status_code == 200 and r.json()["two_step"] is False
