# Deploying DesignDesk

## Everything on Vercel (one project)

`vercel.json` at the repo root builds the frontend and serves the FastAPI backend as a Python function under `/api`
(`api/index.py`). The browser talks to the API on the same domain, so CORS settings are not needed.

1. In Vercel, import the GitHub repo and leave **Root Directory** empty (the repo root, *not* `frontend`). An existing
   frontend-only project can be switched: Settings > Build and Deployment > Root Directory, clear it; then remove its
   `VITE_API_URL` variable.
2. Storage > add a **Neon** Postgres database to the project. It sets `DATABASE_URL` / `POSTGRES_URL` (the pooled
   connection, which is what serverless needs).
3. Environment variables: `SECRET_KEY` (required: a long random string), `CRON_SECRET` (a random string),
   `ADMIN_EMAIL`, `ADMIN_PASSWORD` (first deploy only), `PUBLIC_APP_URL` (the Vercel URL), and the `S3_*` storage
   variables. Optional: `SMTP_*`, `TURNSTILE_*`, `JIRA_*`, as in the table below.
4. Deploy. Migrations and admin/design-type seeding run automatically when the API starts.

What is different from Render:

* **Uploads go to Vercel Blob.** In the project's Storage tab create a Blob store with **Private** access and connect
  it; Vercel adds `BLOB_READ_WRITE_TOKEN`, then redeploy. (A public store also works if you set `BLOB_ACCESS=public`.)
  `S3_*` variables, if set, take precedence. With neither, files are written to `/tmp` and soon lost.
* **Uploads are capped at 4 MB** (Vercel refuses request bodies over 4.5 MB), including CDR/PSD source files.
* **No WebSockets:** live toasts are off; pages still refresh every 30 seconds.
* **Cron** (`/api/internal/tick`: auto-closing expired edit windows, overdue escalations) runs once a day at
  09:00 IST, the Hobby plan's limit. On Pro, change the schedule in `vercel.json` (e.g. `0 * * * *` for hourly).
* **Emails** are sent before the request returns, so actions that send email take a moment longer.
* The Jira webhook URL becomes `https://<your-app>/api/api/webhooks/jira`.

## Environments

| | Production | Demo (optional, separate service + database) |
|---|---|---|
| `DATABASE_URL` | your real Postgres (e.g. Neon) | a different, disposable database |
| `SEED_DEMO_DATA` | `false` (the default for any non-SQLite database) | `true` |
| `SEED_STAFF_PASSWORD` / `SEED_CLIENT_PASSWORD` | not set | set to random values |
| `ADMIN_EMAIL` | the first admin's email | optional |
| `ADMIN_PASSWORD` | only needed once, to create that admin | optional |
| `SECRET_KEY` | **required**, long random string | required |
| `ALLOWED_ORIGINS`, `PUBLIC_APP_URL` | your Vercel production URL | the demo site's URL |

Never point a demo deployment at the production database: demo seeding adds `lead@mccia.in`, `alice@mccia.in`,
`bob@mccia.in`, `client@tata.com`, `client@acme.com` and two sample tickets.

## What `python seed.py` does on every deploy

1. Runs migrations.
2. Creates the default design types if there are none (ticket creation needs at least one).
3. Creates / promotes `ADMIN_EMAIL` as a Design Lead (idempotent).
4. Only if `SEED_DEMO_DATA=true`: adds the demo accounts and sample tickets. On a non-SQLite database it refuses
   to do this unless both `SEED_*_PASSWORD` variables are set.

## Accounts and passwords

* The admin signs in, opens **Settings > Users**, and adds staff and clients. Each new account gets a one-time
  temporary password which the person must replace at first sign-in.
* A forgotten password: the admin uses **Reset password** on that user and shares the new temporary password privately.
  Resetting signs the user out everywhere.
* Anyone can change their own password under **Settings > Password**.

## Removing demo data from an existing production database

If demo accounts were seeded earlier, remove them in the database console (check the `SELECT` first):

```sql
SELECT id, email FROM users WHERE email IN ('lead@mccia.in','alice@mccia.in','bob@mccia.in','client@tata.com','client@acme.com');
-- Deactivating is the safe option and keeps ticket history intact:
UPDATE users SET is_active = false
WHERE email IN ('lead@mccia.in','alice@mccia.in','bob@mccia.in','client@tata.com','client@acme.com');
```

Or deactivate them from **Settings > Users**.
