# Deploying DesignDesk

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
