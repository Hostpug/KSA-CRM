# KSA Practice CRM

Practice CRM for **Karthik S & Associates, Chartered Accountants**.

- **Backend:** Node.js (Express) + MySQL, with no native-compiled packages.
- **Frontend:** Astro, built to static files and served by the same Node app.
- **Hosting:** cPanel → *Setup Node.js App* (Passenger).

## Status

| Phase | Scope | Status |
|---|---|---|
| 1. Foundation | Sign-in, roles, team/onboarding, clients, activity log, settings, mobile app shell (PWA), security | **Built** |
| 2. Practice workflow | Leads → estimates (`EST/2026-27/0001`, printable) → sales orders (`SO/2026-27/0001`) → work stages → review → delivery; direct tasks; lost/reopen | **Built** |
| 3. Billing | Zoho Books: contacts, invoices (SO ref in notes), payments, nightly sync | — |
| 4. GST & vault | GST notice tracker, staff reminders, partner daily digest, encrypted password vault | — |
| 5. Go-live | Email, cron jobs, backups, data import, training | — |

The client specs from the old ChatGPT tools are in `Instruction MD Files/`.

## Workflow (Phase 2)

Stage IDs match the client's old Practice Desk. Rules are in `server/workflow.js`.

| Stage | Can move to | Needs |
|---|---|---|
| 0 New lead | 1, 11 | client or prospect name, service |
| 1 Estimate sent | 2, 0, 11 | estimate date (issues `EST/FY/####`) |
| 2 Sales order confirmed | 3 | a linked client (can be created in the same step), SO date (issues `SO/FY/####`) |
| 3 Work received | 4 | work received on |
| 4 Work allotted | 5 | assigned to |
| 5 Started | 6, 7 | — |
| 6 Data pending with client | 5, 7 | information awaited |
| 7 Pending review | 8, 5 (send back) | reviewer |
| 8 Delivered | (billing, Phase 3) | delivered on |
| 9 Billed / 10 Received | set by billing | — |
| 11 Lead closed | 0 (reopen) | optional reason |

- **Direct tasks** start at stage 3 and get an SO number immediately.
- **Numbering:** numbers reset every financial year (April–March). They come from the `counters` table inside a transaction, so two people can never get the same number.
- **Estimate lines:** they lock once the sales order is confirmed. The approved total pre-fills the agreed fee.

## Project layout

```
app.js                 entry point (cPanel "Application startup file")
server/
  config.js            env + .env loader
  db.js                MySQL pool (UTC), helpers
  migrate.js           versioned schema, auto-runs on start
  auth.js              scrypt passwords, sessions, CSRF, roles
  security.js          headers/CSP, origin check, rate limit
  audit.js             activity log
  validate.js          input validation (PAN, GSTIN, etc.)
  routes/*.js          API: auth, dashboard, clients, employees, settings, activity
  cli.js               create-owner / reset-password / migrate
web/                   Astro source (pages, layout, styles, lib)
dist/                  built front end (generated, served by Express)
scripts/make-icons.js  PWA icon generator
```

## Local development

You need Node 18.18+ and a MySQL 8 / MariaDB 10.3+ database.

```bash
npm install
cp .env.example .env              # set DB_* values and NODE_ENV=development
npm run create-owner -- --name "Karthik S" --email partner@ksaca.net
npm run build                     # builds web/ into dist/
npm run dev                       # http://localhost:3000
```

For live front-end editing, run `npm run dev` and `npm run dev:web` together. Then open http://localhost:4321. Astro proxies `/api` to port 3000.

## Deploying to cPanel

1. **Database.** In cPanel → *MySQL Databases*, create a database and a user, and give the user *All privileges* on it.
2. **Build locally.** Run `npm run build`, then upload the project to a folder **outside** `public_html`, for example `~/ksacrm`. You can skip `node_modules/` and `web/`. The live server only needs `app.js`, `server/`, `dist/`, `package.json` and `package-lock.json`.
3. **Create the Node app.** In cPanel → *Setup Node.js App* → *Create Application*:
   - Node.js version: 20 or newer (18.18 minimum)
   - Application mode: Production
   - Application root: `ksacrm`
   - Application URL: `crm.ksaca.net`
   - Application startup file: `app.js`
   - Environment variables: everything in `.env.example` (`NODE_ENV=production`, `DB_*`, `APP_URL`, `TRUST_PROXY=1`).
4. **Install packages.** Click *Run NPM Install*. Only `express` and `mysql2` are installed in production.
5. **Create the first Owner.** Open cPanel *Terminal* and run the `source …/activate` command shown at the top of the Node app page. Then run:
   ```bash
   cd ~/ksacrm && node server/cli.js create-owner --name "Karthik S" --email partner@ksaca.net
   ```
   It prints a temporary password. The Owner must change it at first sign-in.
6. **SSL.** Turn on AutoSSL for the sub-domain. Session cookies are marked Secure in production, so the CRM needs HTTPS.
7. **Restart.** Click *Restart* after every upload.

The database tables are created and upgraded automatically when the app starts.

## Password vault key

Client portal passwords are encrypted with AES-256-GCM using `VAULT_KEY`, which is kept outside the database.

1. Generate a key once: `npm run vault-key`. It prints `VAULT_KEY=...`.
2. On cPanel, add it under **Setup Node.js App → Environment variables**, or put it in `.env` outside the web root.
3. **Back it up** in a password manager or a sealed envelope with the partner. If the key is lost, the saved passwords cannot be recovered. The database backup alone is not enough.

In development a key is created automatically in `.vault-key`. That file is git-ignored; never deploy it. If the key is missing in production, the vault is switched off with a clear message.

## Security notes

- **Passwords:** hashed with scrypt (Node's built-in crypto).
- **Lockout:** an account locks for 15 minutes after 5 failed sign-ins. Each IP is also limited to 20 sign-in attempts per 15 minutes.
- **Sessions:** a random token, stored only as a SHA-256 hash, in an HttpOnly, SameSite=Lax cookie (Secure in production). Sessions last 8 hours.
  - Changing a password, resetting a password, changing someone's role or deactivating them signs that person out everywhere, using `auth_version`.
- **Request checks:** every write needs a CSRF token header plus a same-origin check.
- **Content Security Policy:** strict, with no inline scripts or styles. The Astro build is configured for this.
- **Database access:** only parameterised queries. Every request body is checked against a whitelist of allowed fields.
- **Saving conflicts:** client edits use a revision number. A save based on an outdated version gets a 409 instead of overwriting someone else's changes.
- **Audit:** the activity log records sign-ins, lockouts and every create and update, with a per-field before/after diff.
- **Time zone:** all times are stored in UTC and shown in IST.

## Roles

| | Owner | Admin | Staff |
|---|---|---|---|
| Dashboard, Clients | ✓ | ✓ | ✓ |
| Team list, add/edit employees | ✓ (anyone) | ✓ (not Owners) | own profile only |
| Activity log | ✓ | ✓ | — |
| Settings | ✓ | — | — |
| Billing & payments (Phase 3) | ✓ | ✓ | hidden |
