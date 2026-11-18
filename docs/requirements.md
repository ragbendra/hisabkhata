# Fruit Khata: Requirements (v1)

A ledger for a wholesale fruit shop in Biratnagar, Nepal. It keeps track of which customers owe the owner money, what he sold them, and how they have paid. This document lists only what is built in v1.

## 1. Purpose

The shop owner sells fruit by weight to resellers (vendors who buy from him and sell on). Today he writes a paper bill, then copies the bill number and total into a paper ledger. The fruits, kg and rates live only on the bill slip that the customer takes away.

Fruit Khata records every sale with its fruits, records every payment with date and time, and calculates each customer's balance from those records. The balance is never typed. All of a customer's sales and payments are kept in one place, the customer sheet.

## 2. Users and context

- **Owner:** enters sales and payments, checks balances, collects money, and manages settings and backups. Uses a phone (most likely an iPhone, to be confirmed), always carries it, and has a connection most of the time but not always.
- **Helper:** a trusted person, for example a replacement when the owner is away. The owner creates the helper login. A helper can add entries and view customers. Nothing more (FR-3).
- **Customers:** resellers only. They do not use the app. The app sends them nothing.
- **Language:** English and Nepali, switchable at any time.
- **Dates:** Bikram Sambat (BS) is the displayed date. AD is stored.
- **Currency:** NPR only.

## 3. Scope

### Built in v1
One entry form for sales and payments, customers created from entries, a customer sheet with the full history, a customer list with balances, collection dates with a "Collect now" list, a day-wise sales list, an end-of-day summary, ageing of old balances, owner and helper logins, entries kept safe on the phone until saved, daily server backups plus an export and weekly emailed copy, English/Nepali UI, BS dates.

### Explicitly not built (rejected by the owner)
- Inventory or stock tracking
- Purchase entries or supplier ledgers
- Tracking of small consumer buyers
- Selling units other than kg (crates are an optional note on a line)

## 4. Functional requirements

### 4.1 Accounts
- FR-1. One shop with one owner login (email plus password, with password reset by an emailed link). Sessions last 30 days on a device.
- FR-2. Shop settings: shop name, next bill number, language, export and backup email day (FR-37).
- FR-3. The owner can create a helper login (name and password) and disable it. A helper can create entries (FR-4 to FR-12) and view Khata, customer sheets and the Sales list. A helper cannot edit or void saved entries, create discounts or round-offs, set an old balance, backdate an entry, merge or archive customers, change settings, or export.

### 4.2 New entry (sale, payment, or both)
- FR-4. One form records a sale, a payment, or both. It needs at least one fruit line with kg and rate, or a received amount.
- FR-5. The customer is chosen by typing a name. Saved names that contain or closely resemble the text are suggested as tappable rows showing the name, phone or place, and balance, so that similar customers can be told apart. A name that matches no saved customer is labelled "New customer" and is created when the entry is saved. There is no separate add-customer step.
- FR-6. For a new name only, the owner can add optional details (phone, address, other spelling of the name) and an optional "Old balance" with an as-of date, carried over from the paper ledger. A helper cannot set an old balance.
- FR-7. A fruit line has: fruit name (typed text, no dropdown), kg (up to 2 decimals), rate per kg, optional crates (whole number, information only), and an amount calculated as kg × rate. Fruit names used in saved entries are remembered with their last rate. While typing, matching names are suggested, and when a name matches, the last rate is prefilled and stays editable.
- FR-8. The form shows the bill total, the customer's previous balance, the received amount, and the balance after the entry, updating as the user types.
- FR-9. "Received now" is optional: an amount and a mode (cash, eSewa, Khalti, bank, other). Saving creates a sale record if there are fruit lines and a payment record if there is a received amount. They are stored as separate records.
- FR-10. The bill number is optional, copied by the user from the paper slip. The form suggests the last number plus 1. A number already used shows a warning and can still be saved. The date defaults to today and the owner can change it. A helper's entries are always dated today. The time of entry is stored automatically.
- FR-11. If the balance after the entry is above zero, the form asks "Collect by" with quick choices (3 days, 7 days, 15 days, a chosen date, none). If the customer already has a collection date in the future, it is kept as the default. If it is today or in the past, a new date is suggested. When the balance reaches zero or below, the collection date is cleared.
- FR-12. After saving, an Undo option is available to the person who made the entry for 10 minutes. Undo voids the entry.
- FR-13. The owner can record a "Discount / round-off" instead of a payment to clear a small leftover. It reduces the balance and is labelled separately.
- FR-14. A payment larger than the balance is allowed and results in an advance, shown as "Advance".

### 4.3 Customer sheet
- FR-15. Each customer has one sheet that holds everything about them: name, other spelling, phone, address, balance (to collect, advance, or Nil), total sold, total received, number of payments, when they last paid, and the collection date (editable).
- FR-16. The history lists every entry (opening balance, sale, payment, discount) with date and time. A sale entry lists its fruits with kg, rate and amount. Every entry shows the balance left after it, so a customer who pays in many rounds shows the balance falling at each round. The list can be flipped between newest first and oldest first.
- FR-17. Tapping an entry opens its details: for a sale, the full bill (fruits, kg, rate, amount, crates, bill number, net total, balance before and after); for a payment, the amount, mode, date, time, note, and balance before and after. Every entry shows who entered it and when.
- FR-18. Tapping a sale anywhere in the app (Khata, Sales list, history) opens that customer's sheet scrolled to that sale.
- FR-19. The owner can edit a customer's name, other spelling, phone, address and old balance, archive a customer (hidden from suggestions, history kept), and merge a customer into another. A merge moves all entries to the other customer and is recorded. A customer with entries cannot be deleted.
- FR-20. If two customers are created on different devices with the same name, the server flags them to the owner as a possible duplicate and does not merge them by itself.

### 4.4 Khata (home)
- FR-21. Shows the total to collect (sum of positive balances) and the number of customers who owe.
- FR-22. A "Collect now" panel lists customers with a balance above zero whose collection date is today or earlier, oldest first, labelled "Due today" or "Overdue N days". Each row has "Received" (opens the entry form for that customer with the received amount focused) and "Tomorrow" (moves the date by one day). A "Coming up" list shows collection dates in the next 7 days.
- FR-23. A "No date set" list shows customers who owe money but have no collection date, oldest activity first.
- FR-24. Below these, a searchable list of all customers with balance and last activity date, sorted by balance (highest first). The list is for viewing. Customers are not created here.
- FR-25. A line shows how many entries are still waiting to be sent to the server, when there are any (FR-32).

### 4.5 Sales list
- FR-26. Sales are listed grouped by day by default. The owner can regroup by calendar week (Sunday to Saturday), BS month, or a chosen date range. Each group shows its dates, number of bills, total kg, total sales, and the money received in that period.
- FR-27. Opening a group shows each fruit with total kg and amount, with the customers who bought it and their kg, followed by the group's bills. Tapping a bill opens the customer sheet (FR-18). A typed customer-name filter narrows every group.

### 4.6 Corrections
- FR-28. The owner can edit and void sales and payments. A voided entry stays visible, struck through, and is excluded from balances. The void action needs a second tap to confirm.
- FR-29. Editing a sale recalculates its total from its lines. Every edit, void, undo and merge is recorded with who, when, and the before and after values.
- FR-30. The owner can rename or merge fruit names (for example "Apple" and "स्याउ") so that Sales totals are not split.

### 4.7 Entries are never lost
- FR-31. While an entry form is open, everything typed is saved on the phone continuously. If the app is closed, the phone restarts, or a call interrupts, the form comes back as it was.
- FR-32. Pressing Save writes the entry to the phone first, then sends it to the server. The screen shows "Saved" only after the server confirms. Until then it shows "Saved on this phone, sending when online", and Khata shows how many entries are waiting. Sending retries automatically when the app opens and when the connection returns. Sending the same entry twice never creates a duplicate.
- FR-33. If any entry has waited more than 24 hours to be sent, Khata shows a warning.
- FR-34. When there is no connection, the app shows the customers and histories it last loaded, together with the entries waiting to be sent, and balances include those waiting entries.
- FR-35. On first launch on an iPhone, the app shows how to add it to the home screen, because the phone may clear the stored data of a web page that is not installed.

### 4.8 Backups and export
- FR-36. The server database is backed up automatically every day and each backup is kept 30 days. A copy of each backup is stored with a different provider or region from the database host. A restore into a blank database is tested before launch and every 3 months after. The test passes only when every customer balance matches the live system. The app never hard-deletes a sale, payment or customer.
- FR-37. The owner can export all data at any time as one Excel file. The app also emails the same file to the owner's email once a week, on a day and time set in settings. If a daily backup or the weekly email fails, the owner is emailed a warning.
- FR-38. Each export is a complete snapshot, not a set of changes. The file name carries the date (for example `Fruit-Khata-2026-11-14.xlsx`) and the first sheet states "Balances as of" with the date and time. The email says that the newest file replaces the older ones and the older ones can be deleted.
- FR-39. The workbook has three sheets: Balances (customer, phone, balance, last payment date, collection date), Sales (one row per fruit line: date, bill number, customer, fruit, kg, rate, amount, status), and Payments (date, time, customer, amount, mode, note, status). Voided entries are included with status "Voided". Dates show both BS and AD.

### 4.9 End of day and ageing of balances
- FR-44. Khata has a "Today" card for the current Nepal day: number of bills, total sales, total money received, the received total split by mode (cash, eSewa, Khalti, bank, other), total discounts and round-offs, and the number of entries and amounts per person who entered them. Voided entries are excluded. The owner sees all people. A helper sees only their own entries.
- FR-45. Tapping a line in the Today card lists the entries behind it.
- FR-46. Ageing is estimated by applying each customer's payments and discounts to their oldest unpaid amounts first: the opening balance, then bills in date order. The part of an opening balance or bill that is not covered is "still owed", and its age is the number of days since the bill date (or the opening as-of date).
- FR-47. The customer list shows beside each balance how many days the oldest still-owed amount has been owing. The list can be sorted by balance or by oldest first.
- FR-48. Removed: the "Owing for" summary on Khata. The home screen shows the total to collect, the Today card and the customer list.
- FR-49. The customer sheet has a "Still owed for" section listing each bill or opening balance with an amount still owed, the amount left and its age.
- FR-50. Ageing figures are labelled "estimated" because payments are not tied to specific bills. They are calculated when shown and never stored. A customer with an advance has no ageing.

### 4.10 Language and dates
- FR-40. A language toggle in the header switches all labels between English and Nepali. The choice is remembered per device.
- FR-41. In Nepali mode, digits display in Devanagari. Numeric inputs accept both Devanagari and Western digits.
- FR-42. All displayed dates are BS. A date picker lets the user choose a date in BS and shows the AD date beside it.
- FR-43. Days, groups and "today" follow Nepal time (UTC+05:45).

## 5. Business rules

- Line amount = kg × rate, rounded half-up to whole rupees. Bill total = sum of line amounts.
- Balance = sum of opening entries + sum of sales − sum of payments and discounts, excluding voided entries. It is derived and never stored as an editable value.
- Money uses `NUMERIC` in the database and is never handled as floating point on the server.
- Voids and merges never delete rows.
- Every entry gets a UUID on the phone that creates it. The server accepts a given UUID once.
- Ageing and "still owed for" are derived on demand from the same records as the balance. They are never stored.
- Customer phone is optional and shown for the owner's reference only.

## 6. Data model

| Table | Key fields |
|---|---|
| `shops` | id, name, next_bill_no, backup_email_day, backup_email_time |
| `users` | id, shop_id, name, login, password_hash, role (owner or helper), disabled_at |
| `customers` | id, shop_id, name, other_name, phone, address, next_collection_date, archived_at, merged_into_id, possible_duplicate_of |
| `openings` | id, customer_id, amount, as_of_date, created_at, created_by |
| `fruit_names` | id, shop_id, name, last_rate, last_used_at |
| `sales` | id, shop_id, customer_id, bill_no, bill_date, total, created_at, created_by, server_received_at, voided_at, void_reason |
| `sale_lines` | id, sale_id, fruit_name, crates, kg, rate, amount |
| `payments` | id, shop_id, customer_id, kind (payment or discount), amount, mode, paid_at, note, created_at, created_by, server_received_at, voided_at, void_reason |
| `audit_log` | id, shop_id, entity, entity_id, action, before_json, after_json, user_id, at |
| `backup_runs` | id, kind (database, off-site, email), started_at, finished_at, ok |

All primary keys are UUIDs created on the phone that creates the record.

Indexes: `sales(shop_id, customer_id, bill_date)`, `payments(shop_id, customer_id, paid_at)`, `sale_lines(sale_id)`, `customers(shop_id, name)`.

## 7. Screens

1. **Login**
2. **Khata (home):** total to collect, "Today" card, "Collect now", "Coming up", "No date set", "Owing for" summary, unsent-entries line, searchable customer list with days owing.
3. **New entry:** customer, bill number, date, fruit lines, received now, "Collect by", totals with balance after.
4. **Customer sheet:** details, balance, totals, collection date, "Still owed for", full history, entry detail view, edit, merge, archive (owner).
5. **Sales:** grouping by day, week, BS month or range, customer-name filter, expandable groups.
6. **Settings:** shop name, next bill number, language, helper login, export, weekly email day (owner only).

Bottom navigation: Khata, "+ Entry" (primary action), Sales. Settings and the language toggle sit in the header.

## 8. Non-functional requirements

- **Mobile-first:** designed at 360 px width, single column, touch targets of at least 44 px, numeric keypad for numeric fields.
- **Speed of entry:** a 3-line bill with money received is saved in under 45 seconds by someone using the app for the first time. Measure this with the owner.
- **Performance:** first load under 3 seconds on an iPhone (Safari) and on a mid-range Android phone over 4G. A customer sheet with 500 entries scrolls smoothly.
- **Installable:** PWA with an app icon and standalone display mode.
- **Security:** HTTPS only, hashed passwords, HttpOnly session cookies, every query filtered by `shop_id`.
- **Accessibility:** readable contrast in light and dark themes, visible focus states.

## 9. Tech stack decisions

| Layer | Choice | Reason |
|---|---|---|
| Backend | FastAPI (Python 3.12), Pydantic v2 | Fits the developer's existing skills. Typed request validation. |
| ORM and migrations | SQLAlchemy 2 + Alembic | Standard pairing, safe schema changes. |
| Database | PostgreSQL | Exact `NUMERIC` money handling, reliable constraints and backups. |
| Auth | Session cookie, argon2 password hashing, emailed link for owner password reset | No third-party service except an email sender. |
| Frontend | React 18 + TypeScript + Vite, `vite-plugin-pwa` | Fast builds, mature PWA tooling. |
| Data fetching | TanStack Query | Caching and retries for slow connections. |
| Phone storage | IndexedDB (via Dexie) for the open form, the entries waiting to be sent, and the last loaded customers and histories | Keeps entries safe until the server confirms them (FR-31 to FR-34). |
| UI | Tailwind CSS | Quick, consistent mobile layouts. |
| i18n | react-i18next | Standard English/Nepali switching. |
| BS dates | A maintained BS conversion library (for example `nepali-date-converter`) and a custom BS date picker | Do not hand-write the calendar. I have not verified that package's accuracy, so check its output against an official BS calendar for the full date range before adopting it. The browser's own date input is AD only, so the picker is a component to build. |
| Excel export | `openpyxl` on the server | Builds the workbook in FR-39. |
| Email | A transactional email service or SMTP | Sends the weekly file, backup warnings, and password resets. Check each provider's current limits and pricing. |
| Hosting | One small app server and managed Postgres in a nearby region (for example Mumbai) | Lower latency to Biratnagar than a US region. Confirm pricing when you pick a provider. |
| Backups | Managed Postgres daily snapshots and point-in-time recovery where available, plus a daily `pg_dump` copied to object storage at a second provider | Hosts differ in what they include and keep. Check the chosen host's backup and retention terms before relying on them. |

## 10. API outline

All routes are under `/api`, authenticated by session, and scoped to the user's shop.

- `POST /auth/login`, `POST /auth/logout`, `POST /auth/reset`
- `GET/POST/PATCH /users` (owner creates and disables the helper)
- `POST /entries` (a sale, a payment, or both, idempotent by UUID; creates the customer if new)
- `GET /customers?q=`, `GET/PATCH /customers/{id}`, `GET /customers/{id}/history`, `POST /customers/{id}/merge`, `POST /customers/{id}/archive`
- `PATCH /sales/{id}`, `POST /sales/{id}/void`, `PATCH /payments/{id}`, `POST /payments/{id}/void`
- `GET /fruit-names`, `POST /fruit-names/merge`
- `GET /khata` (totals, today card, collect-now, coming-up, no-date, owing-for groups, unsent counts)
- `GET /reports/sales?group=day|week|month|range&from=&to=&customer=`
- `GET /settings`, `PATCH /settings`
- `GET /export/full` (Excel)

## 11. Acceptance criteria

1. Saving an entry with 3 fruit lines and a received amount creates one sale and one payment, and the customer balance changes by exactly bill total minus received amount.
2. Three partial payments on different days lower the balance each time and show each date, time and balance left in the history.
3. A payment larger than the balance shows the customer as "Advance".
4. A voided sale or payment stays visible, is struck through, and no longer affects the balance.
5. The total to collect on Khata equals the sum of positive customer balances.
6. A customer with a past collection date and a positive balance appears in "Collect now" with the right overdue label, and leaves it once the balance is zero. A customer who owes with no date appears in "No date set".
7. Typing half an entry, closing the app, and reopening it brings back the same entry.
8. Saving with no connection shows "Saved on this phone, sending when online". After the connection returns it is sent exactly once and shows "Saved". The balance is correct before and after sending.
9. A helper can add an entry but cannot edit, void, give a discount, set an old balance, backdate, merge, export, or open settings. Each entry shows who entered it.
10. Typing "Ramesh Trader" when "Ramesh Traders" exists suggests the existing customer. Saving under a brand-new name creates one customer, and typing it again later finds that customer.
11. Merging two customers gives one customer whose balance equals the sum of both, and the merge is recorded.
12. Tapping a sale in Khata, Sales or history opens the customer sheet at that sale, showing its fruits and the customer's payment history.
13. Sales groups for day, week, BS month and range total the same sales as the customer histories for the same dates, and their totals match when summed across customers.
14. Switching language changes every label on every screen and shows Devanagari digits in Nepali mode. BS dates match an official calendar for every date used in testing.
15. Restoring the latest backup into a blank database gives the same balance for every customer as the live system.
16. The Today card's totals match the entries made on that Nepal day, voided entries are excluded, and a helper sees only their own entries.
17. For a customer with an opening balance and two bills, where payments total less than the first two amounts, the "Still owed for" section shows the oldest amounts covered first. The amounts still owed add up to the customer's balance, and the "Owing for" groups add up to the total to collect.
18. The exported workbook opens in a spreadsheet, and its Balances sheet matches the app for every customer. The weekly email arrives with the dated file name.

## 12. Assumptions to confirm with the owner

These affect the build and have not been confirmed.

1. **Rounding:** line amounts round to whole rupees. Confirm his bills never carry paisa.
2. **Helper permissions:** assumed as in FR-3. Confirm whether the helper may see every customer's balance.
3. **Collection date:** one date per customer, not per bill. This matches his running-total method.
4. **Payment modes:** cash, eSewa, Khalti, bank and other. Confirm whether he takes cheques.
5. **Spoiled fruit:** the only tool for reducing a bill later is the discount or round-off. Ask how he handles customer claims for rotten fruit today, because it may need a return line.
6. **Paper bills:** he keeps writing paper bills and the app records each sale under the same number.
7. **Nepali wording:** UI text in Nepali needs review by a native speaker before launch.
8. **Phones:** confirm the owner's phone and iOS version, and what phone the helper uses.
9. **Weekly email:** the file contains every customer's balance and is sent by email, which is not private end to end. Confirm that he accepts this, or decide to protect the file with a password.
10. **Ageing method:** the oldest-first estimate in FR-46 assumes a payment clears his oldest bills first. Confirm that matches how he thinks about it.
11. **Rollout (not software):** pick a start date, carry over each customer's balance from the paper ledger, run the app alongside the paper book for 2 to 4 weeks and compare balances weekly, then stop using the iOS Ledger Book app first and the paper book last.
