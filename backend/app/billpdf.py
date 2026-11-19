"""PDF bill and customer statement (English only). Built with reportlab, no network or fonts needed.

Both documents share one look: the shop block centred at the top (name, address, phone), the Hisab logo
as a clickable badge, bordered tables that break across pages with repeated headings, and a footer with
"Page x of y" on every page."""

from __future__ import annotations

import io
from datetime import date
from decimal import Decimal

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import HRFlowable, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from pathlib import Path

from .bs import BS_MONTHS_EN, to_bs
from .config import settings

PINE = colors.HexColor("#1F4D3A")
INK = colors.HexColor("#1B1A17")
MUTED = colors.HexColor("#6B6A63")
LINE = colors.HexColor("#CFCBBF")
PAPER = colors.HexColor("#F1F5EC")
OWED = colors.HexColor("#B4442F")
RECV = colors.HexColor("#1C6B43")

_base = getSampleStyleSheet()["Normal"]


def _style(name: str, **kw) -> ParagraphStyle:
    return ParagraphStyle(name, parent=_base, fontName=kw.pop("fontName", "Helvetica"), textColor=kw.pop("textColor", INK), **kw)


S_SHOP = _style("shop", fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=PINE)
S_SMALL = _style("small", fontSize=8.5, leading=11, textColor=MUTED)
S_TEXT = _style("text", fontSize=10, leading=13)
S_BOLD = _style("bold", fontName="Helvetica-Bold", fontSize=10, leading=13)
S_LABEL = _style("label", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=MUTED)
S_RIGHT = _style("right", fontSize=10, leading=13, alignment=TA_RIGHT)
S_TITLE = _style("title", fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=PINE, alignment=TA_RIGHT)
S_CELL = _style("cell", fontSize=9, leading=11.5)
S_CELLB = _style("cellb", fontName="Helvetica-Bold", fontSize=9, leading=11.5)
S_CELLM = _style("cellm", fontSize=8, leading=10, textColor=MUTED)


# ------------------------------------------------------------------ text helpers


def latin_plain(text: str | None) -> str:
    """The built-in PDF fonts are Latin only: anything else prints as '?' instead of a broken box."""
    out = []
    for ch in text or "":
        try:
            ch.encode("cp1252")
            out.append(ch)
        except UnicodeEncodeError:
            out.append("?")
    return "".join(out)


def latin(text: str | None) -> str:
    """Same, escaped for use inside a Paragraph."""
    return latin_plain(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def inr(value) -> str:
    """Indian digit grouping (1,25,400). Whole rupees print without decimals."""
    d = Decimal(str(value))
    neg = d < 0
    d = abs(d)
    whole, frac = divmod(d, 1)
    s = str(int(whole))
    head, tail = s[:-3], s[-3:]
    if head:
        head = ",".join(reversed([head[::-1][i : i + 2][::-1] for i in range(0, len(head), 2)]))
        s = head + "," + tail
    if frac:
        s += f"{frac:.2f}"[1:]
    return ("-" if neg else "") + s


def kg_text(value) -> str:
    return f"{Decimal(str(value)).normalize():f}"


def bs_text(d: date) -> str:
    y, m, day = to_bs(d)
    return f"{day} {BS_MONTHS_EN[m - 1]} {y}"


def ad_text(d: date) -> str:
    return d.strftime("%d %b %Y").lstrip("0")


_ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def _below_100(n: int) -> str:
    return _ONES[n] if n < 20 else _TENS[n // 10] + (f"-{_ONES[n % 10]}" if n % 10 else "")


def _below_1000(n: int) -> str:
    out = []
    if n >= 100:
        out.append(f"{_ONES[n // 100]} hundred")
        n %= 100
    if n:
        out.append(_below_100(n))
    return " ".join(out)


def rupees_in_words(amount) -> str:
    """'Rupees Six Thousand Only', with crore and lakh. Paisa are ignored (bills are in whole rupees)."""
    n = int(abs(Decimal(str(amount))))
    if n == 0:
        return "Rupees Zero Only"
    parts = []
    for unit, name in ((10_000_000, "crore"), (100_000, "lakh"), (1000, "thousand")):
        if n >= unit:
            parts.append(f"{_below_100(n // unit)} {name}")
            n %= unit
    if n:
        parts.append(_below_1000(n))
    return "Rupees " + " ".join(parts).title() + " Only"


def mode_text(mode: str | None) -> str:
    return {"cash": "Cash", "esewa": "Online (eSewa)", "khalti": "Online (Khalti)", "bank": "Online (Bank)", "other": "Other"}.get(
        mode or "", "Cash"
    )


# ------------------------------------------------------------------ shared page furniture

LOGO = Path(__file__).parent / "assets" / "logo.png"
W, H = A4
MARGIN = 14 * mm
CONTENT = W - 2 * MARGIN  # 182 mm


def _brand_host() -> str:
    return settings.brand_url.replace("https://", "").replace("http://", "").rstrip("/")


def _draw_logo(c, x: float, y: float, size: float) -> None:
    """The app icon with rounded corners; (x, y) is its bottom-left corner."""
    c.saveState()
    p = c.beginPath()
    p.roundRect(x, y, size, size, size * 0.22)
    c.clipPath(p, stroke=0, fill=0)
    c.drawImage(ImageReader(str(LOGO)), x, y, size, size, mask="auto")
    c.restoreState()


def _brand_badge(c) -> None:
    """Top right of the first page: logo, name and a hint. The whole badge is a link to the app."""
    size = 10 * mm
    right = W - MARGIN
    top = H - 9 * mm
    c.setFont("Helvetica-Bold", 12)
    name_w = c.stringWidth("Hisab", "Helvetica-Bold", 12)
    x_logo = right - name_w - 2.5 * mm - size
    _draw_logo(c, x_logo, top - size, size)
    c.setFillColor(PINE)
    c.drawString(x_logo + size + 2.5 * mm, top - size / 2 - 1.5 * mm, "Hisab")
    c.setFont("Helvetica", 6.5)
    c.setFillColor(MUTED)
    c.drawRightString(right, top - size - 2.6 * mm, "Tap to open Hisab")
    c.linkURL(settings.brand_url, (x_logo, top - size - 4 * mm, right, top), relative=0)


def _make_canvas(running_title: str, footer_note: str, printed_on: date):
    """A canvas that knows the page count, so every page can say 'Page x of y'."""

    class Numbered(rl_canvas.Canvas):
        def __init__(self, *a, **kw):
            super().__init__(*a, **kw)
            self._saved: list[dict] = []

        def showPage(self):
            self._saved.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._saved)
            links = 0  # restoring a page's state resets reportlab's link counter; keep one across pages
            for state in self._saved:
                self.__dict__.update(state)
                self._annotationCount = links
                self._chrome(self._pageNumber, total)
                links = self._annotationCount
                super().showPage()
            super().save()

        def _chrome(self, page: int, total: int):
            c = self
            c.saveState()
            if page == 1:
                _brand_badge(c)
            else:
                # running header: who and what, with a small logo that links to the app
                c.setFont("Helvetica-Bold", 9)
                c.setFillColor(PINE)
                c.drawString(MARGIN, H - 10 * mm, running_title)
                _draw_logo(c, W - MARGIN - 5.5 * mm, H - 13.5 * mm, 5.5 * mm)
                c.linkURL(settings.brand_url, (W - MARGIN - 5.5 * mm, H - 13.5 * mm, W - MARGIN, H - 8 * mm), relative=0)
                c.setStrokeColor(LINE)
                c.setLineWidth(0.6)
                c.line(MARGIN, H - 15 * mm, W - MARGIN, H - 15 * mm)
            # footer
            c.setStrokeColor(LINE)
            c.setLineWidth(0.6)
            c.line(MARGIN, 14 * mm, W - MARGIN, 14 * mm)
            c.setFont("Helvetica", 7.5)
            c.setFillColor(MUTED)
            c.drawString(MARGIN, 10 * mm, f"Generated on {bs_text(printed_on)} BS ({ad_text(printed_on)}) by Hisab. {footer_note}")
            c.drawRightString(W - MARGIN, 10 * mm, f"Page {page} of {total}")
            host = _brand_host()
            c.setFillColor(PINE)
            c.drawString(MARGIN, 6.2 * mm, host)
            c.linkURL(settings.brand_url, (MARGIN, 5 * mm, MARGIN + c.stringWidth(host, "Helvetica", 7.5), 8.6 * mm), relative=0)
            c.restoreState()

    return Numbered


def _shop_block(shop_name: str, address: str | None, phone: str | None) -> list:
    """Name, address and phone, centred, under the brand badge."""
    out: list = [Spacer(1, 7 * mm), Paragraph(latin(shop_name), _style("shopc", fontName="Helvetica-Bold", fontSize=21, leading=25, textColor=PINE, alignment=TA_CENTER))]
    if address:
        out.append(Paragraph(latin(address), _style("addrc", fontSize=10, leading=13.5, textColor=MUTED, alignment=TA_CENTER)))
    if phone:
        out.append(Paragraph(f"Phone: {latin(phone)}", _style("phonec", fontSize=10, leading=13.5, textColor=MUTED, alignment=TA_CENTER)))
    out += [Spacer(1, 3 * mm), HRFlowable(width="100%", thickness=1.6, color=PINE, spaceAfter=3 * mm)]
    return out


def _title_row(title: str, right: str = "") -> Table:
    t = Table(
        [[Paragraph(title, _style("tt", fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=PINE)),
          Paragraph(right, _style("tr", fontSize=9, leading=12, textColor=MUTED, alignment=TA_RIGHT))]],
        colWidths=[CONTENT * 0.6, CONTENT * 0.4],
    )
    t.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("VALIGN", (0, 0), (-1, -1), "BOTTOM")]))
    return t


def _th(text: str, right: bool = False, center: bool = False) -> Paragraph:
    return Paragraph(
        text,
        _style("th", fontName="Helvetica-Bold", fontSize=8.5, leading=11, textColor=PINE, alignment=TA_RIGHT if right else (TA_CENTER if center else 0)),
    )


def _grid(extra: list | None = None) -> TableStyle:
    """Bordered table: pale green heading band, thin ruling inside, a firm pine frame."""
    return TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), PAPER),
            ("LINEBELOW", (0, 0), (-1, 0), 1.2, PINE),
            ("GRID", (0, 0), (-1, -1), 0.4, LINE),
            ("BOX", (0, 0), (-1, -1), 1, PINE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            *(extra or []),
        ]
    )


def _party_box(label: str, name: str, phone: str | None, address: str | None, right: list | None = None) -> Table:
    left = [Paragraph(label, S_LABEL), Spacer(1, 1 * mm), Paragraph(latin(name), _style("pn", fontName="Helvetica-Bold", fontSize=14, leading=17))]
    for x in (phone, address):
        if x:
            left.append(Paragraph(latin(x), S_TEXT))
    cells = [[left, right or ""]] if right else [[left]]
    t = Table(cells, colWidths=[CONTENT * 0.58, CONTENT * 0.42] if right else [CONTENT])
    t.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.8, PINE),
                ("BACKGROUND", (-1, 0), (-1, -1), PAPER) if right else ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return t


def _doc(buf, title: str, shop_name: str) -> SimpleDocTemplate:
    return SimpleDocTemplate(
        buf, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=19 * mm, bottomMargin=19 * mm,
        title=title, author=shop_name, creator="Hisab", subject="Generated by Hisab",
    )


def _date_cell(d: date) -> list:
    y, m, day = to_bs(d)
    return [
        Paragraph(f"<b>{day}</b>", _style("dd", fontSize=12, leading=14, alignment=TA_CENTER)),
        Paragraph(BS_MONTHS_EN[m - 1], _style("dm", fontSize=8, leading=10, textColor=MUTED, alignment=TA_CENTER)),
        Paragraph(str(y), _style("dy", fontSize=8, leading=10, textColor=MUTED, alignment=TA_CENTER)),
        Paragraph(ad_text(d), _style("da", fontSize=7, leading=9, textColor=MUTED, alignment=TA_CENTER)),
    ]


def _num(v, color=INK, bold: bool = False, empty: str = "") -> Paragraph:
    txt = inr(v) if v else empty
    return Paragraph(
        f"<font color='{color.hexval().replace('0x', '#')}'>{txt}</font>",
        _style("n", fontName="Helvetica-Bold" if bold else "Helvetica", fontSize=9.5, leading=12, alignment=TA_RIGHT),
    )


# ------------------------------------------------------------------ the bill


def build_bill(
    *,
    shop_name: str,
    address: str | None,
    phone: str | None = None,
    customer: dict,
    bill_no: str | None,
    bill_date: date,
    lines: list[dict],
    total: Decimal,
    paid: Decimal,
    paid_mode: str | None,
    balance_before: Decimal,
    balance_after: Decimal,
    printed_on: date | None = None,
) -> bytes:
    printed_on = printed_on or bill_date
    buf = io.BytesIO()
    doc = _doc(buf, f"Bill {bill_no or ''}".strip(), shop_name)
    story = _shop_block(shop_name, address, phone)

    meta = Table(
        [
            [Paragraph("BILL NO.", S_LABEL), Paragraph("DATE (BS)", S_LABEL)],
            [Paragraph(f"<b>{latin('#' + bill_no) if bill_no else '-'}</b>", _style("bn", fontSize=13, leading=16)),
             Paragraph(f"<b>{bs_text(bill_date)}</b><br/><font color='#6B6A63' size='8'>{ad_text(bill_date)}</font>", _style("bd", fontSize=11, leading=14))],
        ],
        colWidths=[28 * mm, 45 * mm],
    )
    meta.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2), ("BACKGROUND", (0, 0), (-1, -1), PAPER), ("BOX", (0, 0), (-1, -1), 0.8, PINE)]))
    story.append(_title_row("BILL"))
    story.append(Spacer(1, 2 * mm))
    story.append(_party_box("BILLED TO", customer["name"], customer.get("phone"), customer.get("address"), right=[meta]))
    story.append(Spacer(1, 5 * mm))

    rows = [[_th("S.N.", center=True), _th("PARTICULARS"), _th("QTY (KG)", True), _th("RATE (RS/KG)", True), _th("AMOUNT (RS)", True)]]
    for i, ln in enumerate(lines, 1):
        crates = f" <font color='#6B6A63' size='8'>({ln['crates']} crates)</font>" if ln.get("crates") else ""
        rows.append(
            [
                Paragraph(str(i), _style("sn", fontSize=9.5, leading=12, alignment=TA_CENTER)),
                Paragraph(latin(ln["fruit_name"]) + crates, S_CELLB),
                Paragraph(kg_text(ln["kg"]), _style("kgq", fontSize=9.5, leading=12, alignment=TA_RIGHT)),
                _num(ln["rate"]),
                _num(ln["amount"], bold=True),
            ]
        )
    items = Table(rows, colWidths=[14 * mm, 76 * mm, 28 * mm, 32 * mm, 32 * mm], repeatRows=1)
    items.setStyle(_grid())
    story.append(items)
    story.append(Spacer(1, 5 * mm))

    def money_row(label: str, value: str, bold: bool = False, color=INK) -> list:
        sty = _style("tl", fontName="Helvetica-Bold" if bold else "Helvetica", fontSize=10.5 if bold else 10, leading=14, textColor=color)
        return [Paragraph(label, sty), Paragraph(value, ParagraphStyle("tv", parent=sty, alignment=TA_RIGHT, fontName="Helvetica-Bold"))]

    tot_rows = [money_row("Bill total", f"Rs {inr(total)}", bold=True)]
    if paid > 0:
        tot_rows.append(money_row(f"Received now ({mode_text(paid_mode)})", f"- Rs {inr(paid)}", color=RECV))
        tot_rows.append(money_row("Still to pay on this bill", f"Rs {inr(max(total - paid, 0))}", color=OWED))
    tot_rows.append(money_row("Previous balance", f"Rs {inr(balance_before)}"))
    tot = Table(tot_rows, colWidths=[62 * mm, 36 * mm])
    tot.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("LEFTPADDING", (0, 0), (-1, -1), 2), ("RIGHTPADDING", (0, 0), (-1, -1), 2)]))
    due = Table(
        [[Paragraph("TOTAL BALANCE DUE", _style("d1", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=colors.white)),
          Paragraph(f"Rs {inr(balance_after)}", _style("d2", fontName="Helvetica-Bold", fontSize=14, leading=17, textColor=colors.white, alignment=TA_RIGHT))]],
        colWidths=[56 * mm, 42 * mm],
    )
    due.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), PINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    right = Table([[tot], [Spacer(1, 2 * mm)], [due]], colWidths=[98 * mm])
    right.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    words = [Paragraph("AMOUNT IN WORDS", S_LABEL), Paragraph(rupees_in_words(total), S_BOLD), Spacer(1, 2 * mm),
             Paragraph("Balance due is the customer's total outstanding after this bill.", S_SMALL)]
    both = Table([[words, right]], colWidths=[80 * mm, 102 * mm])
    both.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    story.append(KeepTogether([both]))

    story.append(Spacer(1, 20 * mm))
    sig = Table(
        [[Paragraph("Customer's signature", S_SMALL), Paragraph(f"For {latin(shop_name)}", _style("sr", fontSize=8.5, leading=11, textColor=MUTED, alignment=TA_RIGHT))]],
        colWidths=[CONTENT / 2, CONTENT / 2],
    )
    sig.setStyle(TableStyle([("LINEABOVE", (0, 0), (0, 0), 0.6, MUTED), ("LINEABOVE", (1, 0), (1, 0), 0.6, MUTED), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    story.append(KeepTogether([sig, Spacer(1, 6 * mm), Paragraph("Thank you for your business.", _style("ty", fontSize=9, leading=12, textColor=PINE, fontName="Helvetica-Bold", alignment=TA_CENTER))]))

    doc.build(story, canvasmaker=_make_canvas(latin_plain(f"{shop_name} · Bill {bill_no or ''}".strip()), "Computer generated bill.", printed_on))
    return buf.getvalue()


# ------------------------------------------------------------------ the statement (the ledger page)


def build_statement(
    *,
    shop_name: str,
    address: str | None,
    phone: str | None = None,
    customer: dict,
    rows: list[dict],
    closing: Decimal,
    printed_on: date,
    selection: tuple[int, int] | None = None,
) -> bytes:
    """rows: date, head, tag, items, debit, credit, balance (ledger order, oldest first).
    selection=(shown, all): the statement lists only some entries; balances are still the real running balances."""
    buf = io.BytesIO()
    doc = _doc(buf, f"Statement {customer['name']}", shop_name)
    story = _shop_block(shop_name, address, phone)
    story.append(_title_row("STATEMENT OF ACCOUNT", f"As on {bs_text(printed_on)} BS"))
    story.append(Spacer(1, 2 * mm))

    owes = closing > 0
    label = "TOTAL TO COLLECT" if owes else ("ADVANCE PAID" if closing < 0 else "BALANCE")
    color = OWED if owes else (RECV if closing < 0 else INK)
    amount = [
        Paragraph(label, _style("bl", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=MUTED, alignment=TA_RIGHT)),
        Paragraph(f"Rs {inr(abs(closing))}", _style("ba", fontName="Helvetica-Bold", fontSize=19, leading=23, textColor=color, alignment=TA_RIGHT)),
    ]
    story.append(_party_box("CUSTOMER", customer["name"], customer.get("phone"), customer.get("address"), right=amount))
    if selection:
        story.append(Spacer(1, 2 * mm))
        story.append(Paragraph(f"<b>Selected entries only</b>: {selection[0]} of {selection[1]}. The balance column is the running balance of the full account.", S_SMALL))
    story.append(Spacer(1, 4 * mm))

    data = [[_th("DATE", center=True), _th("PARTICULARS"), _th("DEBIT (RS)", True), _th("CREDIT (RS)", True), _th("BALANCE (RS)", True)]]
    t_debit = t_credit = Decimal(0)
    for r in rows:
        first = f"<b>{latin(r['head'])}</b>"
        part = [Paragraph(first, S_CELL)]
        if r.get("tag"):
            part.append(Paragraph(latin(r["tag"]), _style("tag", fontSize=8.5, leading=11, textColor=PINE)))
        if r.get("items"):
            part.append(Paragraph(latin(r["items"]), S_CELLM))
        t_debit += r["debit"]
        t_credit += r["credit"]
        bal = r["balance"]
        data.append(
            [
                _date_cell(r["date"]),
                part,
                _num(r["debit"], OWED),
                _num(r["credit"], RECV),
                Paragraph(f"<b>{'-' if bal < 0 else ''}{inr(abs(bal))}</b>", _style("nb", fontSize=9.5, leading=12, alignment=TA_RIGHT)),
            ]
        )
    if not rows:
        data.append(["", Paragraph("No entries.", S_CELLM), "", "", ""])
    else:
        data.append(
            [
                Paragraph("<b>TOTAL</b>", _style("tot", fontSize=9.5, leading=12, textColor=PINE)),
                "",
                _num(t_debit, OWED, bold=True),
                _num(t_credit, RECV, bold=True),
                "" if selection else Paragraph(f"<b>{'-' if closing < 0 else ''}{inr(abs(closing))}</b>", _style("tb", fontSize=9.5, leading=12, alignment=TA_RIGHT, textColor=color)),
            ]
        )
    t = Table(data, colWidths=[24 * mm, 78 * mm, 26 * mm, 26 * mm, 28 * mm], repeatRows=1)
    extra = []
    if rows:
        last = len(data) - 1
        extra += [("BACKGROUND", (0, last), (-1, last), PAPER), ("LINEABOVE", (0, last), (-1, last), 1.2, PINE), ("SPAN", (0, last), (1, last))]
    t.setStyle(_grid(extra))
    story.append(t)
    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph("Debit: still to be paid. Credit: paid. Balance: total left to pay after that line. Amounts in Rs.", S_SMALL))

    doc.build(story, canvasmaker=_make_canvas(latin_plain(f"{shop_name} · Statement · {customer['name']}"), "Computer generated statement.", printed_on))
    return buf.getvalue()
