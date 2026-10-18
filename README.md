# SmartSpend (Node.js + SQLite)

A personal finance tracker: login, income and expenses, budgets, savings goals, investments, insights and reports.
The frontend is `public/index.html` (landing page, dashboard, Currency Converter with all currencies). The backend is `server.js` and the database is a SQLite file (`smartspend.db`) created automatically the first time you start the server.

> This project replaces the earlier MySQL version. SQLite needs no database server, no `.env` file and no `npm install`, which is why it runs everywhere.

## Run it
1. Install **Node.js 22.5 or newer** from https://nodejs.org (check with `node -v`).
2. Open a terminal in this folder and run:

       npm start

   No `npm install` is needed. The server has no outside packages.
3. Open **http://localhost:3000** in your browser.
4. Optional demo data: stop the server (Ctrl+C), run `npm run seed`, then start it again.
   Login: `Demo User` / `Demo@1234`.

If you have an older Node.js, run `npm install better-sqlite3` once. The server will use it instead.

## Run it in VS Code
Open this folder in VS Code (File > Open Folder), open the terminal (Ctrl + `), run `node -v` (must be 22.5 or newer), then `npm start`.
To reset all data, stop the server and delete `smartspend.db` (plus `smartspend.db-wal` / `-shm` if present).

## Settings (environment variables)
| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | Port number |
| `HOST` | 127.0.0.1 | Use `0.0.0.0` to open it from other devices on your network |
| `DB_FILE` | `smartspend.db` in this folder | Where the database is stored |
| `COOKIE_SECURE` | off | Set to `1` when the site is served over HTTPS |
| `ADMIN_NAME` | `Admin` | Name used to sign in to the admin page |
| `ADMIN_PASSWORD` | none | Creates the admin account at start-up (and resets its password each start). **Set this on any public server.** |

Example (Windows PowerShell): `$env:PORT=4000; npm start`

## Admin dashboard
Sign in with the admin name and password to get the admin panel (a collapsible sidebar with seven pages):
- **Overview**: registered / active / deactivated users, new registrations (7 and 30 days), transactions, budgets, savings goals, investments, total income / expenses / net, open support requests, plus charts. Every number is a live SQL query. A chip shows which database file is in use, and an empty database shows an explanation instead of a silent row of zeros.
- **Users**: Account ID, name, registration date, status, transaction count. Search by Account ID or name, filter by status, sort, view details, activate / deactivate, reset password, delete (the admin must type the user's Account ID; the server checks it too).
- **Transactions**: Transaction ID, Account ID, date, type, category, amount. Search by Transaction ID or Account ID, filter by type / category / date range, sort, pages of 20, CSV export of the current filters.
- **Analytics**: monthly income vs expenses, expense categories and transaction volume for 3 / 6 / 12 / 24 months, per currency.
- **Activity Logs**: every admin sign-in (success or failure), user activate / deactivate / password reset / delete, CSV exports, settings and support changes, and any non-admin attempt to reach an admin API. Each entry has the admin ID and name, action, target, result and time.
- **Support & Feedback**: requests that customers send from **Help & Feedback** in their own menu; admins set status (open / in progress / resolved) and an internal note.
- **Settings & Health**: registration on/off, failed-login limit (3-50), support email (all validated on the server); database integrity, file name and size, journal mode, server uptime, memory, active sessions and row counts.

Admins see account-level data only: never passwords or hashes, and never transaction descriptions or notes.
Running locally with no `ADMIN_PASSWORD`, an admin is created for development: **Admin / Admin@1234** (only when `HOST` is `127.0.0.1`). **Change it (set `ADMIN_PASSWORD`) before putting the site on a network.**
Existing databases are upgraded automatically on start: three new tables (`app_settings`, `admin_logs`, `support_requests`) and one index are added; no existing table, column or row is changed.

## Tests
`npm test` starts the server on throwaway databases and runs ~90 checks (authorization, real statistics, user / transaction management, analytics, logs, settings, support, empty database, preserved customer features). It never touches your real database.

## Account ID
Every new user gets a unique Account ID such as `ACC100001`, `ACC100002`, ... It is made by the server when the account is created (nobody can type or change it),
saved in `users.account_id`, returned by `GET /me`, and shown as a pill on the dashboard. It stays the same every time the user logs in.
It comes from a counter (`counters` table) that is increased in the same database transaction that saves the user, so a failed sign-up wastes no number,
simultaneous sign-ups never share one, and a deleted user's number is never reused. A unique index in the database also refuses duplicates.
When an older database is opened, the existing users are numbered in sign-up order and nothing else is changed. The admin account has no Account ID.

## Database (`schema.sql`)
`users` (with `account_id`, `role` and `is_blocked`, which the admin pages call Active / Deactivated), `counters`, `sessions`, `categories`, `transactions`, `budgets`, `goals`, `investments`, `notifications`, and for the admin dashboard `app_settings`, `admin_logs`, `support_requests`.
Every table except `users` has a `user_id`, so each person only sees their own data.
Open `smartspend.db` with "DB Browser for SQLite" to look at the tables.

## How the money adds up
Balance = income - expenses - invested - saved in goals.
Net worth = balance + current value of investments + saved in goals.

## API (all under `/api`, JSON, cookie login)
`POST /register`, `POST /login`, `POST /logout`, `GET/PUT/DELETE /me` (DELETE = delete account, needs the password), `PUT /me/password`,
`POST /support` (customer help / feedback), and admin only: `GET /admin/stats|analytics|health|logs|settings|support|users|users/:id|transactions|transactions/export`, `PUT /admin/settings`, `PUT /admin/support/:id`, `POST /admin/users/:id/status|password`, `DELETE /admin/users/:id`,
`GET/POST /categories`, `DELETE /categories/:id`,
`GET/POST /transactions`, `PUT/DELETE /transactions/:id`, `GET /transactions/export` (CSV),
`GET/POST /budgets`, `DELETE /budgets/:id`,
`GET/POST /goals`, `PUT/DELETE /goals/:id`,
`GET/POST /investments`, `PUT/DELETE /investments/:id`,
`GET /notifications`, `PUT /notifications/read`, `GET /insights`, `GET /dashboard`, `GET /reports`.

## Security notes
- Passwords are stored with scrypt and a random salt, never as plain text.
- Login sessions use an HttpOnly cookie. Only a hash of the session token is stored.
- All database queries use prepared statements. Failed logins are rate limited.
- Passwords have no length or character rules, as requested. For a real public site, add rules.
- There is no email reset. "Forgot password" tells the user to contact the administrator.

## Tested
The server was exercised end to end (44 checks): sign up / sign in / sign out, profile and currency change, categories, transactions with filters and CSV export, budgets, goals, investments, notifications, dashboard, insights, reports, account deletion, and that one user cannot read or change another user's data.
