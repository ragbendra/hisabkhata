"""Platform admin: dashboard, users and devices, sign-in history, flags, action log."""

import json
from datetime import timedelta

import pytest
from conftest import Api, entry, uid

from app.db import SessionLocal
from app.models import PlatformAdmin, SecurityEvent, Shop
from app.security import hash_password
from app.timeutil import utcnow

ADMIN = ("boss@example.com", "a-long-admin-pass")


@pytest.fixture
def admin():
    with SessionLocal() as db:
        db.add(PlatformAdmin(email=ADMIN[0], name="Boss", password_hash=hash_password(ADMIN[1])))
        db.commit()
    a = Api()
    assert a.post("/admin/login", {"email": ADMIN[0], "password": ADMIN[1]}).status_code == 200
    return a


def shop_login(login="owner@example.com", password="ownerpass1", ua="Mozilla/5.0 (Windows NT 10.0) Chrome/120"):
    a = Api()
    a.c.headers["user-agent"] = ua
    r = a.c.post("/api/auth/login", json={"login": login, "password": password})
    return a, r


def test_only_the_admin_can_open_these_pages(owner):
    for path in ("/admin/dashboard", "/admin/users", "/admin/security/events", "/admin/security/flags", "/admin/log"):
        assert owner.get(path).status_code == 401


def test_sign_ins_are_recorded_with_device_and_address(admin):
    shop_login(password="wrong")
    shop_login(login="nobody@example.com", password="x")
    shop_login()
    ev = admin.get("/admin/security/events").json()
    assert [e["kind"] for e in ev] == ["login_ok", "login_failed", "login_failed"]
    assert ev[0]["device"] == "Chrome on Windows" and ev[0]["shop"] == "Test Fruits" and ev[0]["ip"]
    assert {e["detail"] for e in ev[1:]} == {"wrong password", "unknown login"}
    assert [e["kind"] for e in admin.get("/admin/security/events?kind=login_failed").json()] == ["login_failed", "login_failed"]
    assert len(admin.get("/admin/security/events?q=nobody").json()) == 1
    assert "ownerpass1" not in json.dumps(ev) and "wrong" not in json.dumps([e["login"] for e in ev])  # passwords are never stored


def test_many_wrong_passwords_raise_one_flag_that_can_be_reviewed(admin):
    for _ in range(5):
        shop_login(password="nope")
    flags = admin.get("/admin/security/flags").json()
    assert len(flags) == 1 and flags[0]["kind"] == "failed_logins" and "owner@example.com" in flags[0]["title"]
    assert flags[0]["shop"]["name"] == "Test Fruits"
    assert len(admin.get("/admin/security/flags").json()) == 1  # asking again does not flag it twice
    assert admin.post(f"/admin/security/flags/{flags[0]['id']}/review").json() == {"reviewed": True}
    assert admin.get("/admin/security/flags").json() == []
    assert len(admin.get("/admin/security/flags?status=all").json()) == 1


def test_device_limit_burst_deletes_and_exports_are_flagged(admin, owner):
    for _ in range(3):
        shop_login()
    for _ in range(3):
        assert shop_login()[1].status_code == 409  # 3 refusals
    cid = owner.post("/entries", entry(new="Hari", lines=[("Apple", 1, 100)])).json()["customer"]["id"]
    for _ in range(5):
        r = owner.post("/entries", entry(customer=cid, lines=[("Apple", 1, 10)])).json()
        assert owner.delete(f"/sales/{r['sale']['id']}").status_code == 200
    for _ in range(2):
        assert owner.get("/export/full").status_code == 200
    kinds = {f["kind"] for f in admin.get("/admin/security/flags").json()}
    assert {"device_limit", "delete_burst", "export"} <= kinds


def test_users_with_devices_and_what_the_admin_can_do(admin):
    a, _ = shop_login()
    owner_id = a.get("/auth/me").json()["id"]
    a.post("/users", {"name": "Sita", "login": "sita", "password": "helperpass"})
    shop_login("sita", "helperpass", ua="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17 Safari/604")

    users = admin.get("/admin/users").json()
    me = next(u for u in users if u["id"] == owner_id)
    assert me["role"] == "owner" and me["shop"]["name"] == "Test Fruits" and me["devices"][0]["label"] == "Chrome on Windows"
    sita = next(u for u in users if u["login"] == "sita")
    assert sita["devices"][0]["label"] == "Safari on iPhone"
    assert [u["login"] for u in admin.get("/admin/users?q=sit").json()] == ["sita"]

    # a locked-out owner: 3 devices full, the admin frees one
    for _ in range(2):
        shop_login()
    assert shop_login()[1].status_code == 409
    dev = admin.get("/admin/users").json()
    dev_id = next(u for u in dev if u["id"] == owner_id)["devices"][0]["id"]
    assert admin.delete(f"/admin/sessions/{dev_id}").json() == {"ok": True}
    assert shop_login()[1].status_code == 200

    assert admin.post(f"/admin/users/{owner_id}/signout-all").json()["signed_out"] == 3
    assert a.get("/auth/me").status_code == 401

    sid = sita["id"]
    admin.post(f"/admin/users/{sid}/disabled", {"disabled": True})
    assert shop_login("sita", "helperpass")[1].status_code == 401
    admin.post(f"/admin/users/{sid}/disabled", {"disabled": False})
    assert shop_login("sita", "helperpass")[1].status_code == 200

    assert admin.post(f"/admin/users/{sid}/password", {"password": "short"}).status_code == 422
    assert admin.post(f"/admin/users/{sid}/password", {"password": "brand-new-pass"}).status_code == 200
    assert shop_login("sita", "helperpass")[1].status_code == 401
    assert shop_login("sita", "brand-new-pass")[1].status_code == 200

    log = admin.get("/admin/log").json()
    assert [l["what"] for l in log][:3] == ["set password", "enable user", "disable user"]
    assert all(l["by"] == ADMIN[0] for l in log) and log[0]["target"] == "sita"
    mine = admin.get(f"/admin/users/{owner_id}/events").json()
    assert mine and all(e["login"] == "owner@example.com" for e in mine)


def test_shop_activity_has_numbers_and_a_timeline_but_no_customer_data(admin, owner):
    cid = owner.post("/entries", entry(new="Secret Customer Name", lines=[("Apple", 5, 100)], received=100)).json()["customer"]["id"]
    sale = owner.post("/entries", entry(customer=cid, lines=[("Mango", 2, 50)])).json()["sale"]["id"]
    owner.delete(f"/sales/{sale}")
    with SessionLocal() as db:
        shop_id = str(db.query(Shop).first().id)
    r = admin.get(f"/admin/shops/{shop_id}/activity")
    assert r.status_code == 200
    d = r.json()
    assert d["week"]["bills"] == 1 and d["week"]["payments"] == 1 and d["week"]["deleted_or_voided"] == 1
    assert len(d["days"]) == 14 and sum(d["entries"]) == 2  # a deleted bill is gone, as everywhere
    assert "Bill deleted" in [t["what"] for t in d["timeline"]]
    assert "Secret Customer Name" not in r.text and "Apple" not in r.text and "Mango" not in r.text


def test_dashboard_numbers_and_graph_series(admin, owner):
    owner.post("/entries", entry(new="A", lines=[("Apple", 1, 100)]))
    shop_login(password="bad")
    d = admin.get("/admin/dashboard?days=14").json()
    assert len(d["days"]) == 14 and len(d["entries"]) == 14 and len(d["by_hour"]) == 24 and len(d["money"]) == 12
    assert d["entries"][-1] == 1 and d["active_shops"][-1] == 1 and d["signins_failed"][-1] == 1 and d["signins_ok"][-1] >= 1
    assert d["numbers"]["entries_today"] == 1 and d["funnel"]["created"] == 1
    assert admin.get("/admin/dashboard?days=500").json()["days"].__len__() == 90  # capped


def test_sign_in_records_are_deleted_after_90_days(admin):
    shop_login(password="bad")
    with SessionLocal() as db:
        e = db.query(SecurityEvent).one()
        e.at = utcnow() - timedelta(days=91)
        db.commit()
    assert admin.get("/admin/security/flags").status_code == 200  # opening the feed runs the clean-up
    assert admin.get("/admin/security/events").json() == []
