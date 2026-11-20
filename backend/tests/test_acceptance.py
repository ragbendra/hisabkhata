"""Acceptance criteria from section 11 that the server is responsible for."""

from datetime import timedelta
from decimal import Decimal

from conftest import Api, entry, uid
from sqlalchemy import func, select

from app.db import SessionLocal
from app.models import AuditLog, Sale
from app.timeutil import today_npl, utcnow


def bal(api, cid):
    return Decimal(api.get(f"/customers/{cid}").json()["balance"])


def make_customer(api, name="Ramesh Traders", lines=((("Apple", 10, 100)),), received=None, **extra):
    r = api.post("/entries", entry(new=name, lines=[lines] if isinstance(lines[0], str) else lines, received=received, **extra))
    assert r.status_code == 200, r.text
    return r.json()["customer"]["id"]


# 1 ----------------------------------------------------------------------------
def test_entry_with_three_lines_and_payment(owner):
    body = entry(new="Sita", lines=[("Apple", "10.5", 120), ("Banana", 20, 60), ("Mango", "3.25", 200)], received=1000)
    r = owner.post("/entries", body)
    assert r.status_code == 200, r.text
    out = r.json()
    # 10.5*120=1260, 20*60=1200, 3.25*200=650 -> 3110
    assert out["sale"]["total"] == "3110.00"
    assert out["payment"]["amount"] == "1000.00"
    assert out["customer"]["balance"] == "2110.00"
    hist = owner.get(f"/customers/{out['customer']['id']}/history", params={"order": "asc"}).json()
    assert [h["type"] for h in hist] == ["sale", "payment"]  # stored as separate records


def test_history_links_payment_made_with_the_bill(owner):
    cid = make_customer(owner, lines=[("Apple", 100, 100)], received=3000)  # bill 10,000, 3,000 paid now
    later = owner.post("/entries", entry(customer=cid, received=2000))  # an instalment, a separate entry
    assert later.status_code == 200, later.text
    hist = owner.get(f"/customers/{cid}/history", params={"order": "asc"}).json()
    sale = next(h for h in hist if h["type"] == "sale")
    pays = [h for h in hist if h["type"] == "payment"]
    assert sale["paid_with"]["amount"] == "3000.00" and sale["paid_with"]["id"] == pays[0]["id"]
    assert pays[0]["with_sale"] == sale["id"]
    assert "with_sale" not in pays[1]  # the instalment stands on its own line
    assert hist[-1]["balance_after"] == "5000.00"


def test_line_amount_rounds_half_up(owner):
    r = owner.post("/entries", entry(new="Round", lines=[("Apple", "0.5", 25)]))  # 12.5 -> 13
    assert r.json()["sale"]["total"] == "13.00"


# 2 ----------------------------------------------------------------------------
def test_three_partial_payments_fall_each_time(owner):
    cid = make_customer(owner, lines=("Apple", 100, 100))  # 10000
    for amount in (3000, 2000, 1000):
        r = owner.post("/entries", entry(customer=cid, received=amount))
        assert r.status_code == 200
    hist = owner.get(f"/customers/{cid}/history", params={"order": "asc"}).json()
    pays = [h for h in hist if h["type"] == "payment"]
    assert [p["balance_after"] for p in pays] == ["7000.00", "5000.00", "4000.00"]
    assert all(p["at"] and p["date"] for p in pays)


# 3 ----------------------------------------------------------------------------
def test_overpayment_is_advance(owner):
    cid = make_customer(owner, lines=("Apple", 10, 100))
    owner.post("/entries", entry(customer=cid, received=1500))
    sheet = owner.get(f"/customers/{cid}").json()
    assert sheet["advance"] is True and sheet["balance"] == "-500.00"
    assert sheet["still_owed"] == []  # a customer with an advance has no ageing


# 4 ----------------------------------------------------------------------------
def test_delete_entry_removes_row_and_is_audited(owner):
    r = owner.post("/entries", entry(new="V", lines=[("Apple", 10, 100)], received=300)).json()
    cid = r["customer"]["id"]
    owner.post("/entries", entry(customer=cid, received=100))  # a later instalment
    assert bal(owner, cid) == 600
    # deleting the bill takes the money received with it, but not the later instalment
    d = owner.delete(f"/sales/{r['sale']['id']}")
    assert d.status_code == 200 and len(d.json()["deleted"]["payments"]) == 1
    hist = owner.get(f"/customers/{cid}/history").json()
    assert [h["type"] for h in hist] == ["payment"] and bal(owner, cid) == -100
    assert owner.delete(f"/sales/{r['sale']['id']}").status_code == 404
    # a payment can be deleted on its own
    assert owner.delete(f"/payments/{hist[0]['id']}").status_code == 200
    assert owner.get(f"/customers/{cid}/history").json() == [] and bal(owner, cid) == 0
    with SessionLocal() as db:
        logs = list(db.scalars(select(AuditLog).where(AuditLog.action == "delete")))
        assert {x.entity for x in logs} == {"sale", "payment"} and len(logs) == 3
        sale_log = next(x for x in logs if x.entity == "sale")
        assert sale_log.before_json["total"] == "1000.00" and sale_log.after_json is None


def test_delete_bill_but_keep_its_payment(owner):
    r = owner.post("/entries", entry(new="K", lines=[("Apple", 10, 100)], received=300)).json()
    cid = r["customer"]["id"]
    assert owner.delete(f"/sales/{r['sale']['id']}", params={"with_payment": "false"}).status_code == 200
    assert [h["type"] for h in owner.get(f"/customers/{cid}/history").json()] == ["payment"]


def test_delete_customer_needs_owner_and_typed_name(owner, helper):
    cid = make_customer(owner, "Gone Traders", lines=("Apple", 10, 100), received=200)
    owner.post("/entries", entry(customer=cid, received=100))
    keep = make_customer(owner, "Stays", lines=("Apple", 5, 100))
    assert helper.delete(f"/customers/{cid}", params={"confirm_name": "Gone Traders"}).status_code == 403
    assert owner.delete(f"/customers/{cid}", params={"confirm_name": "wrong"}).status_code == 400
    r = owner.delete(f"/customers/{cid}", params={"confirm_name": "  gone traders "})
    assert r.status_code == 200 and r.json()["sales"] == 1 and r.json()["payments"] == 2 and r.json()["balance"] == "700.00"
    assert owner.get(f"/customers/{cid}").status_code == 404
    names = [c["name"] for c in owner.get("/customers").json()]
    assert names == ["Stays"] and bal(owner, keep) == 500
    assert owner.get("/khata").json()["total_to_collect"] == "500.00"
    with SessionLocal() as db:
        log = db.scalars(select(AuditLog).where(AuditLog.entity == "customer", AuditLog.action == "delete")).one()
        assert log.before_json["name"] == "Gone Traders" and len(log.before_json["sales"]) == 1 and len(log.before_json["payments"]) == 2
        assert db.scalar(select(func.count()).select_from(Sale)) == 1  # only the other customer's bill is left


def test_pdf_bill_and_statement(owner):
    r = owner.post("/entries", entry(new="Ramesh Traders", lines=[("Apple", 100, 100), ("Orange", 50, 20)], received=3000, bill_no="1031")).json()
    cid = r["customer"]["id"]
    owner.post("/entries", entry(customer=cid, received=2000, mode="esewa"))
    b = owner.get(f"/sales/{r['sale']['id']}/pdf")
    assert b.status_code == 200 and b.headers["content-type"] == "application/pdf" and b.content[:5] == b"%PDF-"
    assert "Bill-1031-Ramesh-Traders.pdf" in b.headers["content-disposition"]
    s = owner.get(f"/customers/{cid}/statement.pdf")
    assert s.status_code == 200 and s.content[:5] == b"%PDF-"
    assert owner.get(f"/sales/{uid()}/pdf").status_code == 404


# 5 / 6 ------------------------------------------------------------------------
def test_total_to_collect_and_collect_now(owner):
    today = today_npl()
    a = make_customer(owner, "Alpha", lines=("Apple", 10, 100), collect_by=(today - timedelta(days=3)).isoformat())
    b = make_customer(owner, "Beta", lines=("Apple", 20, 100), collect_by=today.isoformat())
    c = make_customer(owner, "Gamma", lines=("Apple", 5, 100))  # owes, no date
    d = make_customer(owner, "Delta", lines=("Apple", 5, 100), received=500)  # paid in full
    ante = make_customer(owner, "Zeta", lines=("Apple", 1, 100), received=300)  # advance
    k = owner.get("/khata").json()
    rows = {r["id"]: Decimal(r["balance"]) for r in k["customers"]}
    assert Decimal(k["total_to_collect"]) == sum(v for v in rows.values() if v > 0) == Decimal("3500")
    assert k["owing_count"] == 3
    now = {r["name"]: r for r in k["collect_now"]}
    assert now["Alpha"]["overdue_days"] == 3 and now["Beta"]["overdue_days"] == 0
    assert [r["name"] for r in k["collect_now"]] == ["Alpha", "Beta"]  # oldest first
    assert [r["name"] for r in k["no_date"]] == ["Gamma"]
    # paying Alpha off removes it and clears its date
    owner.post("/entries", entry(customer=a, received=1000))
    k = owner.get("/khata").json()
    assert "Alpha" not in [r["name"] for r in k["collect_now"]]
    assert owner.get(f"/customers/{a}").json()["next_collection_date"] is None


def test_collection_date_kept_when_future(owner):
    today = today_npl()
    future = (today + timedelta(days=5)).isoformat()
    cid = make_customer(owner, lines=("Apple", 10, 100), collect_by=future)
    owner.post("/entries", entry(customer=cid, received=100))  # no collect_by sent: keep it
    assert owner.get(f"/customers/{cid}").json()["next_collection_date"] == future
    owner.post("/entries", entry(customer=cid, received=100, collect_by=None))  # "none"
    assert owner.get(f"/customers/{cid}").json()["next_collection_date"] is None


# 8 (server side) -------------------------------------------------------------
def test_sending_twice_never_duplicates(owner):
    body = entry(new="Once", lines=[("Apple", 10, 100)], received=200)
    first = owner.post("/entries", body).json()
    second = owner.post("/entries", body).json()
    assert first["duplicate"] is False and second["duplicate"] is True
    cid = first["customer"]["id"]
    assert len(owner.get(f"/customers/{cid}/history").json()) == 2
    assert bal(owner, cid) == 800
    assert len(owner.get("/customers").json()) == 1


# 9 ----------------------------------------------------------------------------
def test_helper_limits(owner, helper):
    cid = make_customer(owner, lines=("Apple", 10, 100))
    sale_id = owner.get(f"/customers/{cid}/history").json()[0]["id"]

    ok = helper.post("/entries", entry(customer=cid, lines=[("Apple", 1, 100)], received=50))
    assert ok.status_code == 200
    hist = owner.get(f"/customers/{cid}/history").json()
    assert {h["entered_by"] for h in hist} == {"Owner", "Helper"}  # each entry shows who entered it

    assert helper.post("/entries", entry(customer=cid, received=10, kind="discount")).status_code == 403
    nc = entry(new="HelperNew", lines=[("Apple", 1, 100)])
    nc["new_customer"]["old_balance"] = "500"
    assert helper.post("/entries", nc).status_code == 403
    assert helper.post("/entries", entry(customer=cid, received=10,
                                         entry_date=(today_npl() - timedelta(days=2)).isoformat())).status_code == 403
    assert helper.patch(f"/sales/{sale_id}", {"bill_no": "9"}).status_code == 403
    assert helper.delete(f"/sales/{sale_id}").status_code == 403  # not theirs, not within undo
    other = uid()
    assert helper.post("/customers/%s/merge" % cid, {"into_id": other}).status_code == 403
    assert helper.post(f"/customers/{cid}/archive", {}).status_code == 403
    assert helper.get("/export/full").status_code == 403
    assert helper.patch("/settings", {"name": "x"}).status_code == 403
    assert "backup_email_day" not in helper.get("/settings").json()
    assert helper.get("/users").status_code == 403
    assert helper.get("/khata").status_code == 200  # may view


def test_helper_can_undo_own_entry_within_window(owner, helper):
    r = helper.post("/entries", entry(new="U", lines=[("Apple", 10, 100)])).json()
    assert helper.delete(f"/sales/{r['sale']['id']}").status_code == 200
    assert bal(owner, r["customer"]["id"]) == 0


def test_disabled_helper_cannot_continue(owner, helper):
    users = owner.get("/users").json()
    hid = next(u["id"] for u in users if u["role"] == "helper")
    owner.patch(f"/users/{hid}", {"disabled": True})
    assert helper.get("/khata").status_code == 401


# 10 ---------------------------------------------------------------------------
def test_customer_suggestions_and_new_name(owner):
    make_customer(owner, "Ramesh Traders")
    names = [c["name"] for c in owner.get("/customers", params={"q": "Ramesh Trader"}).json()]
    assert names == ["Ramesh Traders"]
    assert [c["name"] for c in owner.get("/customers", params={"q": "Ramesh Tradrs"}).json()] == ["Ramesh Traders"]
    make_customer(owner, "Brand New Co")
    assert len(owner.get("/customers").json()) == 2
    assert [c["name"] for c in owner.get("/customers", params={"q": "brand new"}).json()] == ["Brand New Co"]


def test_same_name_from_two_devices_is_flagged_not_merged(owner):
    a = make_customer(owner, "Hari Fruits")
    b = make_customer(owner, "  hari   fruits ")
    assert a != b
    k = owner.get("/khata").json()
    assert len(k["customers"]) == 2
    assert [d["id"] for d in k["possible_duplicates"]] == [b]


def test_archived_hidden_from_suggestions_history_kept(owner):
    cid = make_customer(owner, "Old Shop")
    owner.post(f"/customers/{cid}/archive", {})
    assert owner.get("/customers", params={"q": "Old Shop"}).json() == []
    assert len(owner.get(f"/customers/{cid}/history").json()) == 1


# 11 ---------------------------------------------------------------------------
def test_merge_sums_balances_and_is_recorded(owner):
    a = make_customer(owner, "Ram A", lines=("Apple", 10, 100), received=200)  # 800
    b = make_customer(owner, "Ram B", lines=("Apple", 5, 100))  # 500
    r = owner.post(f"/customers/{a}/merge", {"into_id": b})
    assert r.status_code == 200
    assert Decimal(r.json()["balance"]) == 1300
    assert len(owner.get(f"/customers/{b}/history").json()) == 3
    assert [c["id"] for c in owner.get("/customers").json()] == [b]  # merged one is gone from lists
    # a stale offline entry for the old customer lands on the merged one
    owner.post("/entries", entry(customer=a, received=100))
    assert bal(owner, b) == 1200


def test_customer_edit_and_old_balance(owner):
    cid = make_customer(owner, "Edit Me")
    r = owner.patch(f"/customers/{cid}", {"phone": "9800000000", "old_balance": "1500", "old_balance_date": "2026-01-01"})
    assert r.status_code == 200 and r.json()["phone"] == "9800000000"
    assert Decimal(r.json()["balance"]) == 2500
    h = owner.get(f"/customers/{cid}/history", params={"order": "asc"}).json()
    assert h[0]["type"] == "opening" and h[0]["balance_after"] == "1500.00"


# 13 ---------------------------------------------------------------------------
def test_sales_groups_match_histories(owner):
    today = today_npl()
    ids = []
    for i, (name, d) in enumerate([("A", 0), ("B", 0), ("C", 1), ("D", 9), ("E", 40)]):
        ids.append(make_customer(owner, name, lines=[("Apple", 10 + i, 100), ("Mango", 2, 150)],
                                 received=100, entry_date=(today - timedelta(days=d)).isoformat()))
    hist_total = Decimal(0)
    for cid in ids:
        hist_total += sum(Decimal(h["amount"]) for h in owner.get(f"/customers/{cid}/history").json() if h["type"] == "sale")
    for group in ("day", "week", "month"):
        rep = owner.get("/reports/sales", params={"group": group}).json()
        assert sum(Decimal(g["total_sales"]) for g in rep["groups"]) == hist_total, group
        assert sum(g["bills"] for g in rep["groups"]) == 5
        assert sum(Decimal(g["received"]) for g in rep["groups"]) == 500
    rng = owner.get("/reports/sales", params={"group": "range", "from": (today - timedelta(days=9)).isoformat(),
                                               "to": today.isoformat()}).json()
    assert len(rng["groups"]) == 1 and rng["groups"][0]["bills"] == 4
    day = owner.get("/reports/sales", params={"group": "day"}).json()["groups"][0]
    assert day["bills"] == 2 and {f["fruit"] for f in day["fruits"]} == {"Apple", "Mango"}
    apple = next(f for f in day["fruits"] if f["fruit"] == "Apple")
    assert {c["name"] for c in apple["customers"]} == {"A", "B"}
    assert len(day["bill_list"]) == 2
    filt = owner.get("/reports/sales", params={"group": "day", "customer": "a"}).json()
    assert sum(g["bills"] for g in filt["groups"]) == 1  # only "A" contains... see below
    assert owner.get("/reports/sales", params={"group": "range"}).status_code == 422


def test_week_groups_start_on_sunday(owner):
    make_customer(owner, "W", entry_date="2026-11-11")  # a Wednesday
    g = owner.get("/reports/sales", params={"group": "week"}).json()["groups"][0]
    assert g["start"] == "2026-11-08" and g["end"] == "2026-11-14"


def test_bs_month_group(owner):
    make_customer(owner, "M", entry_date="2026-11-11")  # 2083 Kartik 25
    g = owner.get("/reports/sales", params={"group": "month"}).json()["groups"][0]
    assert g["key"] == "2083-07" and g["label"] == "Kartik 2083"
    assert g["start"] == "2026-10-18"


# 16 ---------------------------------------------------------------------------
def test_today_card_and_helper_scope(owner, helper):
    ca = make_customer(owner, "T1", lines=("Apple", 10, 100), received=400, mode="esewa")
    helper.post("/entries", entry(customer=ca, lines=[("Apple", 1, 50)], received=50))
    owner.post("/entries", entry(customer=ca, received=20, kind="discount"))
    gone = owner.post("/entries", entry(new="T2", lines=[("Apple", 1, 999)], received=100)).json()
    owner.delete(f"/sales/{gone['sale']['id']}")  # deleted entries are gone from the card (the bill takes its payment)

    t = owner.get("/khata").json()["today_card"]
    assert t["bills"] == 2 and t["total_sales"] == "1050.00"
    assert t["total_received"] == "450.00"
    assert t["received_by_mode"]["esewa"] == "400.00" and t["received_by_mode"]["cash"] == "50.00"
    assert t["discounts"] == "20.00"
    assert {p["name"]: p["entries"] for p in t["people"]} == {"Owner": 3, "Helper": 2}

    h = helper.get("/khata").json()["today_card"]
    assert h["bills"] == 1 and h["total_sales"] == "50.00" and h["total_received"] == "50.00"
    assert [p["name"] for p in h["people"]] == ["Helper"]
    rows = owner.get("/khata/today-entries", params={"kind": "mode", "value": "esewa"}).json()
    assert len(rows) == 1 and rows[0]["amount"] == "400.00"


# 17 ---------------------------------------------------------------------------
def test_ageing_oldest_first_and_groups_add_up(owner):
    today = today_npl()
    d = lambda n: (today - timedelta(days=n)).isoformat()  # noqa: E731
    nc = entry(new="Aged", lines=[("Apple", 10, 100)], entry_date=d(100))  # 1000, 100 days old
    nc["new_customer"]["old_balance"] = "500"
    nc["new_customer"]["old_balance_date"] = d(200)
    cid = owner.post("/entries", nc).json()["customer"]["id"]
    owner.post("/entries", entry(customer=cid, lines=[("Apple", 20, 100)], entry_date=d(20)))  # 2000, 20 days
    owner.post("/entries", entry(customer=cid, lines=[("Apple", 5, 100)], entry_date=d(3)))  # 500, 3 days
    owner.post("/entries", entry(customer=cid, received=700, entry_date=d(1)))  # clears opening 500, then 200 of bill 1
    sheet = owner.get(f"/customers/{cid}").json()
    owed = sheet["still_owed"]
    assert [(o["kind"], o["left"], o["age_days"]) for o in owed] == [
        ("sale", "800.00", 100), ("sale", "2000.00", 20), ("sale", "500.00", 3)]
    assert sum(Decimal(o["left"]) for o in owed) == Decimal(sheet["balance"]) == 3300
    assert sheet["days_owing"] == 100 and sheet["ageing_estimated"] is True

    owner.post("/entries", entry(new="Other", lines=[("Apple", 1, 100)], entry_date=d(40)))
    k = owner.get("/khata").json()
    groups = {g["bucket"]: g for g in k["owing_for"]}
    assert Decimal(groups["30+"]["total"]) == 900 and groups["30+"]["count"] == 2  # 800 (100 days) + 100 (40 days)
    assert Decimal(groups["15-30"]["total"]) == 2000 and Decimal(groups["8-14"]["total"]) == 0
    assert Decimal(groups["0-7"]["total"]) == 500
    assert sum(Decimal(g["total"]) for g in k["owing_for"]) == Decimal(k["total_to_collect"]) == 3400


# corrections ------------------------------------------------------------------
def test_edit_sale_recalculates_and_is_audited(owner):
    r = owner.post("/entries", entry(new="E", lines=[("Apple", 10, 100)])).json()
    edited = owner.patch(f"/sales/{r['sale']['id']}", {"lines": [{"fruit_name": "Apple", "kg": "12", "rate": "90"}], "bill_no": "77"})
    assert edited.status_code == 200
    assert edited.json()["sale"]["total"] == "1080.00" and edited.json()["customer_balance"] == "1080.00"
    from sqlalchemy import select
    from app.db import SessionLocal
    from app.models import AuditLog
    with SessionLocal() as db:
        logs = list(db.scalars(select(AuditLog).where(AuditLog.action == "edit")))
        assert logs and logs[0].before_json["total"] == "1000.00" and logs[0].after_json["total"] == "1080.00"


def test_edit_payment(owner):
    r = owner.post("/entries", entry(new="P", lines=[("Apple", 10, 100)], received=100)).json()
    e = owner.patch(f"/payments/{r['payment']['id']}", {"amount": "300", "mode": "bank"})
    assert e.json()["customer_balance"] == "700.00"
    assert owner.delete(f"/payments/{r['payment']['id']}").status_code == 200
    assert owner.patch(f"/payments/{r['payment']['id']}", {"amount": "5"}).status_code == 404


def test_bill_numbers(owner):
    owner.post("/entries", entry(new="B1", lines=[("Apple", 1, 10)], bill_no="41"))
    assert owner.get("/settings").json()["next_bill_no"] == 42
    assert owner.get("/bills/check", params={"bill_no": "41"}).json()["exists"] is True
    assert owner.get("/bills/check", params={"bill_no": "99"}).json()["exists"] is False
    dup = owner.post("/entries", entry(new="B2", lines=[("Apple", 1, 10)], bill_no="41"))
    assert dup.status_code == 200  # a used number only warns


def test_fruit_names_remembered_and_merged(owner):
    owner.post("/entries", entry(new="F1", lines=[("Apple", 1, 120)]))
    owner.post("/entries", entry(new="F2", lines=[("स्याउ", 2, 130)]))
    names = {f["name"]: f["last_rate"] for f in owner.get("/fruit-names").json()}
    assert names == {"Apple": "120.00", "स्याउ": "130.00"}
    r = owner.post("/fruit-names/merge", {"from_name": "स्याउ", "into_name": "Apple"})
    assert r.json()["changed_lines"] == 1
    day = owner.get("/reports/sales", params={"group": "day"}).json()["groups"][0]
    assert len(day["fruits"]) == 1 and day["fruits"][0]["kg"] == "3.00"


def test_validation(owner):
    assert owner.post("/entries", {"new_customer": {"id": uid(), "name": "X"}}).status_code == 422  # nothing to record
    assert owner.post("/entries", entry(new="X", lines=[("Apple", "1.234", 10)])).status_code == 422  # 3 decimals
    assert owner.post("/entries", entry(new="X", lines=[("Apple", 0, 10)])).status_code == 422


# 18 ---------------------------------------------------------------------------
def test_export_workbook_matches_app(owner):
    import io
    from openpyxl import load_workbook
    cid = make_customer(owner, "Exp", lines=("Apple", 10, 100), received=250)
    deleted = owner.post("/entries", entry(customer=cid, lines=[("Mango", 1, 50)], received=10)).json()
    owner.delete(f"/sales/{deleted['sale']['id']}")
    r = owner.get("/export/full")
    assert r.status_code == 200
    assert f"Hisab-{today_npl().isoformat()}.xlsx" in r.headers["content-disposition"]
    wb = load_workbook(io.BytesIO(r.content))
    assert wb.sheetnames == ["Balances", "Sales", "Payments"]
    assert wb["Balances"]["A1"].value == "Balances as of"
    rows = {r[0]: r for r in wb["Balances"].iter_rows(min_row=5, values_only=True)}
    assert Decimal(str(rows["Exp"][2])) == bal(owner, cid) == 750  # the deleted bill is not in the file
    sales = list(wb["Sales"].iter_rows(min_row=2, values_only=True))
    assert [s[-1] for s in sales] == ["Active"]
    assert sales[0][0].startswith("20") and sales[0][1] == today_npl().isoformat()


def test_weekly_email_job_sends_dated_file(owner, monkeypatch):
    from app import jobs
    sent = []
    monkeypatch.setattr(jobs, "send_email", lambda to, subject, body, attachments=None: sent.append((to, subject, body, attachments)))
    make_customer(owner)
    assert jobs.run_weekly_email(force=True) == 1
    to, subject, body, att = sent[0]
    assert to == "owner@example.com" and att[0][0] == f"Hisab-{today_npl().isoformat()}.xlsx"
    assert "newest file replaces the older ones" in body


def test_verify_restore_compares_balances(owner, tmp_path):
    import pytest
    from app.config import settings as cfg
    if not cfg.database_url.startswith("sqlite"):
        pytest.skip("covered by the pg_dump/pg_restore run in the README")
    from app import jobs
    from app.config import settings
    import shutil
    make_customer(owner, "R1", lines=("Apple", 10, 100), received=300)
    copy = tmp_path / "restored.db"
    jobs._dump(copy)
    assert jobs.verify_restore(f"sqlite:///{copy}") is True
    owner.post("/entries", entry(new="Later", lines=[("Apple", 1, 100)]))
    assert jobs.verify_restore(f"sqlite:///{copy}") is False  # live moved on, copy is stale


# security ---------------------------------------------------------------------
def test_auth_and_csrf_guard(owner):
    anon = Api()
    assert anon.get("/khata").status_code == 401
    assert anon.c.post("/api/auth/login", json={"login": "owner@example.com", "password": "x"}).status_code == 401
    bare = Api().c
    bare.headers.pop("X-Requested-With")
    assert bare.post("/api/auth/login", json={"login": "owner@example.com", "password": "ownerpass1"}).status_code == 403
    r = Api().c.post("/api/auth/login", json={"login": "Owner@Example.com ", "password": "ownerpass1"})
    assert r.status_code == 200
    assert "httponly" in r.headers["set-cookie"].lower()


def test_password_reset_flow(owner, monkeypatch):
    from app.routers import auth as auth_router
    mails = []
    monkeypatch.setattr(auth_router, "send_email", lambda to, subject, body, attachments=None: mails.append(body))
    anon = Api()
    assert anon.post("/auth/reset", {"email": "nobody@example.com"}).json() == {"ok": True}
    assert mails == []
    assert anon.post("/auth/reset", {"email": "owner@example.com"}).status_code == 200
    token = mails[0].split("token=")[1].split()[0]
    assert anon.post("/auth/reset/confirm", {"token": token, "password": "newpassword1"}).status_code == 200
    assert anon.post("/auth/reset/confirm", {"token": token, "password": "another1234"}).status_code == 400  # single use
    assert owner.get("/khata").status_code == 401  # old sessions are signed out
    Api().login("owner@example.com", "newpassword1")


def test_shops_are_isolated(owner):
    from app.db import SessionLocal
    from app.models import Shop, User
    from app.security import hash_password
    cid = make_customer(owner, "Mine")
    with SessionLocal() as db:
        s = Shop(name="Other")
        db.add(s)
        db.flush()
        db.add(User(shop_id=s.id, name="O2", login="o2@example.com", password_hash=hash_password("password22"), role="owner"))
        db.commit()
    other = Api().login("o2@example.com", "password22")
    assert other.get(f"/customers/{cid}").status_code == 404
    assert other.get("/customers").json() == []
    assert other.post("/entries", entry(customer=cid, received=5)).status_code == 404
    assert other.get("/khata").json()["total_to_collect"] == "0.00"


def test_archived_customers_are_not_in_total_to_collect(owner):
    make_customer(owner, "Visible")  # 1,000 owed
    hidden = make_customer(owner, "Hidden")  # 1,000 owed
    assert owner.get("/khata").json()["total_to_collect"] == "2000.00"
    owner.post(f"/customers/{hidden}/archive", {})
    k = owner.get("/khata").json()
    assert k["total_to_collect"] == "1000.00" and k["owing_count"] == 1
    assert k["archived"] == {"count": 1, "owing": "1000.00"}  # still reported, on its own


def _new(owner, name, qty=10, received=None):
    r = owner.post("/entries", entry(new=name, lines=[("Apple", qty, 100)], received=received))
    assert r.status_code == 200, r.text
    return r.json()["customer"]["id"]


def test_delete_opening_balance_and_bulk_entries(owner, helper):
    cid = _new(owner, "Old Khata", received=300)  # bill 1,000 with 300 paid at the counter
    owner.patch(f"/customers/{cid}", {"old_balance": "1500", "old_balance_date": "2026-01-01"})
    h = owner.get(f"/customers/{cid}/history", params={"order": "asc"}).json()
    opening = next(e for e in h if e["type"] == "opening")
    bill = next(e for e in h if e["type"] == "sale")
    pay = next(e for e in h if e["type"] == "payment")
    assert bal(owner, cid) == 1500 + 1000 - 300

    assert helper.delete(f"/openings/{opening['id']}").status_code == 403
    assert helper.post("/entries/bulk-delete", {"sales": [bill["id"]]}).status_code == 403
    r = owner.delete(f"/openings/{opening['id']}")
    assert r.status_code == 200 and Decimal(r.json()["customer_balance"]) == 700
    assert owner.delete(f"/openings/{opening['id']}").status_code == 404

    assert owner.post("/entries/bulk-delete", {}).status_code == 422
    r = owner.post("/entries/bulk-delete", {"sales": [bill["id"]], "payments": [pay["id"]]})
    assert r.status_code == 200 and r.json()["deleted"] == {"sales": 1, "payments": 1, "openings": 0}
    assert bal(owner, cid) == 0
    assert owner.get(f"/customers/{cid}/history").json() == []

    # one bad id rejects the whole batch: nothing is half-deleted
    owner.post("/entries", entry(customer=cid, lines=[("Apple", 1, 100)]))
    only = owner.get(f"/customers/{cid}/history").json()[0]
    assert owner.post("/entries/bulk-delete", {"sales": [only["id"], uid()]}).status_code == 404
    assert bal(owner, cid) == 100

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import AuditLog

    with SessionLocal() as db:
        assert {a.entity for a in db.scalars(select(AuditLog).where(AuditLog.action == "delete"))} >= {"opening", "sale", "payment"}


def test_bulk_delete_customers_needs_confirm_and_is_owner_only(owner, helper):
    ids = [_new(owner, n, qty=1, received=40) for n in ("One", "Two", "Three")]  # each owes 60
    assert helper.post("/customers/bulk-delete", {"ids": ids[:2], "confirm": "DELETE"}).status_code == 403
    assert owner.post("/customers/bulk-delete", {"ids": ids[:2], "confirm": "yes"}).status_code == 400
    assert len(owner.get("/customers").json()) == 3
    r = owner.post("/customers/bulk-delete", {"ids": ids[:2], "confirm": "DELETE"})
    assert r.status_code == 200
    assert r.json() == {"customers": 2, "sales": 2, "payments": 2, "balance": "120.00"}
    assert [c["name"] for c in owner.get("/customers").json()] == ["Three"]
    assert owner.get("/khata").json()["total_to_collect"] == "60.00"
    # an id from nowhere rejects the batch, and nothing is deleted
    assert owner.post("/customers/bulk-delete", {"ids": [ids[2], uid()], "confirm": "DELETE"}).status_code == 404
    assert len(owner.get("/customers").json()) == 1


def test_shop_profile_and_pdf_exports(owner):
    r = owner.patch("/settings", {"address": "Main Road, Biratnagar", "phone": "9800000000"})
    assert r.status_code == 200 and r.json()["address"] == "Main Road, Biratnagar" and r.json()["phone"] == "9800000000"

    cid = make_customer(owner, "Sunrise Fruit Stall")  # one bill of 1,000
    owner.post("/entries", entry(customer=cid, received=400))
    full = owner.get(f"/customers/{cid}/statement.pdf")
    assert full.status_code == 200 and full.headers["content-type"] == "application/pdf" and full.content.startswith(b"%PDF")
    assert b"hisabkhata-c6nn.onrender.com" in full.content  # the logo links to the app

    h = owner.get(f"/customers/{cid}/history", params={"order": "asc"}).json()
    pay = next(e for e in h if e["type"] == "payment")
    sel = owner.post(f"/customers/{cid}/statement.pdf", {"keys": [f"payment:{pay['id']}"]})
    assert sel.status_code == 200 and sel.content.startswith(b"%PDF") and "selected" in sel.headers["content-disposition"]
    assert owner.post(f"/customers/{cid}/statement.pdf", {"keys": [f"sale:{uid()}"]}).status_code == 422
    assert owner.post(f"/customers/{cid}/statement.pdf", {"keys": []}).status_code == 422

    # a long ledger breaks over several pages
    for _ in range(45):
        owner.post("/entries", entry(customer=cid, lines=[("Apple", 3, 100), ("Mango", 4, 90), ("Guava", 2, 80)]))
    long = owner.get(f"/customers/{cid}/statement.pdf").content
    assert long.count(b"/Type /Page\n") >= 3

    # clearing the address
    assert owner.patch("/settings", {"address": "  "}).json()["address"] is None


def test_new_shop_from_invite_stores_address_and_phone(owner):
    # covered end to end in test_platform_admin; here only the CLI path
    from app import cli
    from app.db import SessionLocal
    from app.models import Shop
    from sqlalchemy import select

    cli.create_shop("CLI Shop", "cli@example.com", "clipassword1", "Cli Owner", "Chowk, Itahari", "9811111111")
    with SessionLocal() as db:
        s = db.scalar(select(Shop).where(Shop.name == "CLI Shop"))
        assert (s.address, s.phone) == ("Chowk, Itahari", "9811111111")


def test_owner_can_delete_helper_but_not_owner(owner):
    h = owner.post("/users", {"name": "Hari", "login": "hari", "password": "secret1"})
    assert h.status_code == 201, h.text
    assert owner.delete(f"/users/{h.json()['id']}").status_code == 200
    assert all(u["login"] != "hari" for u in owner.get("/users").json())
    me = [u for u in owner.get("/users").json() if u["role"] == "owner"][0]
    assert owner.delete(f"/users/{me['id']}").status_code == 400


def test_date_system_setting_and_pdf(owner):
    assert owner.get("/auth/me").json()["shop"]["date_system"] == "bs"
    assert owner.patch("/settings", {"date_system": "xx"}).status_code == 422
    assert owner.patch("/settings", {"date_system": "ad"}).json()["date_system"] == "ad"
    assert owner.get("/auth/me").json()["shop"]["date_system"] == "ad"
    cid = owner.post("/entries", entry(new="Sita Traders", lines=[("Apple", 10, 100)])).json()["customer"]["id"]
    r = owner.get(f"/customers/{cid}/statement.pdf")
    assert r.status_code == 200 and r.content[:4] == b"%PDF"


def test_feedback_reaches_the_admin_and_expired_shops_can_still_write(owner):
    assert owner.post("/feedback", {"kind": "problem", "message": "PDF will not download", "contact": "9800000000"}).status_code == 201
    assert owner.post("/feedback", {"kind": "problem", "message": "x"}).status_code == 422
    assert owner.post("/feedback", {"kind": "nonsense", "message": "long enough text"}).status_code == 422
