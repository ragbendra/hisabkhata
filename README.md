# Hisab: Khata for traders

Hisab is a sales and collection ledger for a wholesale fruit shop. I built it for a trader who sells fruit on credit and was keeping everything in a paper ledger. It works on a phone or a laptop.

It is in daily use now, and I keep changing it based on what he tells me.

**License:** PolyForm Noncommercial 1.0.0. **Author:** Raghabendra Kumar Shah.

## Demo

Sign in on the deployed app with this account. It has three made-up customers and some sample bills. Please don't enter real data.

- Login: `demo@hisab.app`
- Password: `TryHisab2026!`

## Why I built it

The owner writes a paper bill, then copies the bill number and total into a paper ledger. What he sold (fruit, kg, rate) stays on the slip the customer takes away. Customers pay in instalments, so he works out balances by hand and they drift. The ledger apps he tried only record payments, not what was sold.

Hisab keeps every sale with its fruit lines, keeps every payment, and works out each balance from those records. Nobody types a balance.

## What it does

- One form for a sale, a payment, or both. Fruit lines are kg × rate, and the app remembers fruit names and the last rate used.
- Customers are created while entering a bill. If the name looks like an existing customer, the app suggests it.
- The customer page looks like his paper ledger: date, particulars (bill number, cash or online, fruit and kg), debit, credit and balance. Oldest entry first. The latest 10 lines are shown in full and older months fold into one line each.
- Tap any line to see the bill and who entered it. The owner can edit or delete it there.
- Crates are optional. When switched on, the ledger also counts crates given, returned and still with the customer, like the second set of columns in his paper book.
- The "Received" button opens a small box with just the amount, mode, note and date, so recording a payment doesn't need the whole form.
- The owner can enter old entries with an earlier date, delete wrong ones (one at a time or several together), and delete a customer's whole khata. Every delete is saved in an audit log first.
- A customer's ledger can be shared, downloaded or printed as a PDF, with the shop name, address, phone and logo on top. The PDF is in English.
- The home screen shows the total to collect, a Today card, and the customer list.
- Dates can be shown in Bikram Sambat or in AD, chosen per shop. The app is in English and Nepali, with day and night themes.
- The owner can add up to 3 helper logins. Helpers can add entries and view customers, nothing more. Each login works on up to 3 devices.
- Entries are saved on the phone first and sent when there is a connection, so a bad network doesn't lose anything.
- Excel export of all data, a weekly emailed copy, and a daily database backup job.

## What changed after he started using it

I built the first version from a written requirements document. After he used it, his feedback changed a lot:

- He couldn't follow the first design and showed me a photo of his green paper ledger. The customer page was rebuilt as a ledger page.
- He gets paid within a week or two, so "owing for 60 days" meant nothing to him. I removed the age buckets and the "owing for" cards.
- He didn't like the colours and wanted something simple that looked good. The theme was redone, with day mode as the default.
- His ledger has columns for the number of crates. I added crate tracking.
- He wanted to remove wrong or old entries, and long histories were hard to read. I added delete, multi-select, and folded months, and removed the "void" option because it confused him.
- He wanted to send customers their account, so I added the ledger PDF. I left out PDFs for single bills on purpose.
- Old paper entries had to be typed in later, so entries, payments and crates can each take an earlier date.
- Some traders work in AD dates, so the calendar is now a setting.

The full list is in [docs/requirements.md](docs/requirements.md).

## Design choices

- **Balances are worked out, never stored.** They are summed from openings, sales, payments and discounts, so they can't drift. Crate counts work the same way.
- **Money is stored as `NUMERIC(14,2)`.** A line is kg × rate rounded half-up to whole rupees. The server never uses floating point for money.
- **A bill and the money taken with it show as one ledger line,** but stay separate records so each can be edited on its own.
- **Deletes are real, with a snapshot first.** The old values go into `audit_log` before the rows are removed.
- **Saves can't duplicate.** The phone makes a UUID for each entry and the server accepts it only once, so retrying on a bad connection is safe.
- **Failed saves stay on the phone** with Retry and Discard buttons. Nothing is dropped silently.
- **New shops join by invite.** There is no open sign-up. An invite starts a trial, and when it ends the shop becomes read-only.
- **Shops are kept apart.** Most tables carry a `shop_id`, every request filters by it, and a test checks that two shops can't see each other's data.
- **Writes need a custom header** (`X-Requested-With`) on top of HttpOnly session cookies, as a CSRF guard.

## How it is built

```mermaid
flowchart LR
  subgraph Phone
    PWA["React PWA"]
    IDB[("IndexedDB: draft + outbox")]
    PWA --- IDB
  end
  PWA -->|HTTPS /api| API["FastAPI"]
  API --> DB[("PostgreSQL")]
  API -->|SMTP| Mail["Email: reset, weekly Excel, warnings"]
  Cron["Scheduled jobs"] -->|pg_dump| Dump["Backup files, 30 days"]
  Dump -->|S3 API| Off["Object storage, other provider"]
  Cron --> DB
  Cron -->|SMTP| Mail
```

| Part | What I used |
|---|---|
| API | FastAPI, Pydantic v2 |
| Database | PostgreSQL, SQLAlchemy 2, Alembic (SQLite for development only) |
| Login | Session cookies, argon2 password hashing |
| Frontend | React 18, TypeScript, Vite, installable as a PWA |
| Data fetching | TanStack Query |
| Offline storage | IndexedDB through Dexie |
| UI | Tailwind CSS, react-i18next |
| Dates | `nepali-date-converter` and my own BS date picker |
| Export | `openpyxl` for Excel, `reportlab` for PDF |
| Hosting | Docker on Render, PostgreSQL on Neon |

In production the API also serves the built frontend, so it all runs as one app.

## Run it locally

You need Python 3.12 and Node 20 or newer. SQLite is fine for development, so you don't need a database server. Use two terminals.

**Backend (macOS or Linux)**

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export FK_DATABASE_URL=sqlite:///./dev.db
python -m app.cli init-db
python -m app.cli create-shop --name "My Shop" --email you@example.com
uvicorn app.main:app --reload --port 8000
```

**Backend (Windows PowerShell)**

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:FK_DATABASE_URL = "sqlite:///./dev.db"
python -m app.cli init-db
python -m app.cli create-shop --name "My Shop" --email you@example.com
uvicorn app.main:app --reload --port 8000
```

`create-shop` asks you for a password. You can also pass `--address` and `--phone`, or set them later in Settings.

**Frontend** (second terminal; it forwards `/api` to port 8000)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and sign in with the email and password you gave to `create-shop`.

A few things to know:

- Settings are environment variables that start with `FK_`. See `backend/.env.example`. The variable you set only lasts for that terminal, so set `FK_DATABASE_URL` again in a new one.
- To use PostgreSQL, run `alembic upgrade head` instead of `init-db`, and use a URL like `postgresql://user:pass@host/db`.
- To try the weekly email, set `FK_SMTP_HOST`, `FK_SMTP_PORT`, `FK_SMTP_USER`, `FK_SMTP_PASSWORD` and `FK_SMTP_FROM`, then run `python -m app.jobs weekly-email --force`. Set `FK_RUN_SCHEDULER=0` if you don't want the app's built-in schedule running while you develop.
- On plain `http://localhost`, leave `FK_COOKIE_SECURE` unset. Set it to `true` only behind HTTPS.

## Tests

- Backend: `cd backend && python -m pytest`. It runs on SQLite by default. Set `FK_TEST_DATABASE_URL` to run on PostgreSQL.
- Frontend: `cd frontend && npm test`.
- The backend tests cover the ledger maths (rounding, part payments, advances, deletes and their audit snapshots, retried saves, crates), helper permissions, merging, the Excel export, the weekly email, the restore check, the CSRF guard, password reset, device and helper limits, shop isolation, and the invite and trial flow.
- The frontend tests check BS date conversion against an independent Python library, rounding, Devanagari digit input and name matching.
- GitHub Actions runs both on every push.
- There are no browser or end-to-end tests.

## Deployment

- It runs as one Docker service on Render's free plan, with PostgreSQL on Neon's free plan. The root `Dockerfile` builds the frontend and serves it from the API. `render.yaml` describes the service and `deploy/render-entrypoint.sh` starts it.
- In production set `FK_DATABASE_URL` and `FK_COOKIE_SECURE=true`.
- Render's free service sleeps after 15 minutes without traffic, so the first request after a pause is slow. Neon's free database also pauses when idle and only keeps a short restore window, so keep your own exports.
- The weekly email check runs inside the app every 15 minutes. Because the free service sleeps, an uptime monitor that pings `/api/health` keeps it awake. Email is set up with the `FK_SMTP_*` variables above.
- These jobs need cron or another scheduler:
  - `python -m app.jobs backup`: daily `pg_dump`, keeps 30 days, copies to S3-compatible storage if configured, and emails the owner if it fails. `pg_dump` must be installed where it runs.
  - `python -m app.jobs weekly-email`: the same job as the built-in schedule, for running by hand.
  - `python -m app.jobs verify-restore --restored-url <url>`: compares every customer balance between the live database and a restored copy.
- I tested a restore once, from a dump into an empty PostgreSQL 16 database, and every balance matched. It is worth repeating every few months.
- The owner can download an Excel export of everything from Settings whenever he wants.

## Limitations

- No stock tracking, no supplier ledgers, no small retail buyers. Everything is sold by the kg, and crates are counted but not priced.
- Customers don't use the app and it sends them nothing. The owner shares the PDF himself.
- The PDF is English only, and there is no PDF for a single bill.
- One shop per account. Two physical shops are not kept separate, though the Today card shows totals per person.
- Adding an entry works offline. Editing, deleting, merging, archiving and sharing a PDF need a connection.
- A deleted entry or customer can't be restored from the app. The audit log keeps a snapshot, and older backups and weekly emails still contain it.
- Entries queued offline by a shop whose trial has ended are refused and stay on the phone as failed.
- Subscription payments are recorded by hand. There is no online payment gateway.
- A customer's claim for spoiled fruit can only be handled as a discount.
- Later payments aren't tied to specific bills, so the app can't say which bill a payment cleared.
- The weekly Excel email contains every balance and is not encrypted.
- BS dates aren't checked against an official calendar. The two converters I tried disagree for BS 2087, and the npm one stops at BS 2090.
- The Nepali text hasn't been reviewed by a native speaker (`frontend/src/locales/ne.ts`).
- I haven't measured entry speed, first load time, or iPhone Safari behaviour (installed PWA, storage clearing).

## What's next

A native-speaker review of the Nepali text, timing how long a bill takes to enter with the owner, and a more reliable way to send the weekly backup email. After that, whatever he asks for.

## License and contact

PolyForm Noncommercial 1.0.0, see [LICENSE](LICENSE). Commercial use needs my permission.
Contact: [@ragbendra](https://github.com/ragbendra) on GitHub.
