# Deploying DesignDesk

## Everything on Vercel (one project)

`vercel.json` at the repo root builds the frontend and serves the FastAPI backend as a Python function under `/api`
(`api/index.py`). The browser talks to the API on the same domain, so CORS settings are not needed.

1. In Vercel, import the GitHub repo and leave **Root Directory** empty (the repo root, *not* `frontend`). An existing
   frontend-only project can be switched: Settings > Build and Deployment > Root Directory, clear it; then remove its
   `VITE_API_URL` variable.
2. Storage > add a **Neon** Postgres database to the project. It sets `DATABASE_URL` / `POSTGRES_URL` (the pooled
   connection, which is what serverless needs).
3. Environment variables: `SECRET_KEY` (required: a long random string), `ADMIN_EMAIL`, `ADMIN_PASSWORD` (first
   deploy only) and `PUBLIC_APP_URL` (the Vercel URL). Optional: `CRON_SECRET`, `S3_*`, `SMTP_*`, `TURNSTILE_*`,
   `JIRA_*`, `PUBLIC_BOARD`, `AUTO_TICK`, as in the table below.
4. Deploy. Migrations and admin/design-type seeding run automatically when the API starts.

How it works on Vercel:

* **Files** are kept in the Postgres database (the `stored_files` table) unless `S3_ENDPOINT_URL` is set, in which
  case they go to S3/R2. Nothing is written to the function's temporary disk.
* **Big files** travel in 3 MB pieces, because Vercel refuses request and response bodies over 4.5 MB. Uploads go up
  through `/api/uploads` first, and downloads come down as byte ranges. The limits are 10 MB per file
  (`MAX_UPLOAD_MB`) and 50 MB per source file (`MAX_CDR_UPLOAD_MB`). Postgres on Neon's free plan holds 0.5 GB, so
  add S3/R2 if many large files are expected.
* **Scheduled jobs** (SLA warnings and escalations, review reminders, closing reviews after two days, closing
  finished edit windows, recurring tickets) run off normal traffic. After any request, if they last ran more than
  5 minutes ago, they run again. `AUTO_TICK=off` turns this off. The daily cron in `vercel.json` is a backup and needs
  `CRON_SECRET`.
* **No WebSockets.** Pages refresh every 30 seconds and show a pop-up for what changed ("DES-12 moved → In Review").
* **Emails** are sent before the request returns, so actions that send email take a moment longer.
* **Public requests board.** `/requests` lists every request with its title, status and dates, without signing in.
  `PUBLIC_BOARD=off` hides it.
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

## Admin locked out

Set `ADMIN_RESET_PASSWORD` (with `ADMIN_EMAIL`) in the hosting environment and redeploy. On start the API makes it
that account's temporary password (creating or reactivating the account), and asks for a new password at sign-in.
Each value is applied once, so a later restart does not undo the new password; still, delete the variable afterwards.

## Forgot password (email)

"Forgot your password?" on the sign-in page emails a reset link that works once, for 30 minutes. It needs SMTP:
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. With Gmail: host `smtp.gmail.com`, port `587`,
user = the Gmail address, password = a Google **App Password** (Google Account > Security > 2-Step Verification >
App passwords; the normal Gmail password does not work). Links point at `PUBLIC_APP_URL` (on Vercel, the production
domain if that is unset). Without SMTP the page says to ask the Design Lead instead.

## Google Drive for files (Workspace Shared Drive)

New uploads go to a folder in a Shared Drive when both variables below are set. Files uploaded before that stay where
they were (the database) and keep working. Settings > Integrations shows where new uploads go.

1. In Google Drive (a Google Workspace account), create a **Shared drive**, e.g. "DesignDesk files", and a folder in it.
   Copy the folder's id from its URL (`https://drive.google.com/drive/folders/<this part>`).
2. In [Google Cloud Console](https://console.cloud.google.com): create a project, enable the **Google Drive API**, then
   IAM & Admin > Service Accounts > **Create service account** (no roles needed) > Keys > Add key > **JSON**. A `.json`
   key file downloads.
3. Back in the Shared drive: Manage members > add the service account's email (`…@….iam.gserviceaccount.com`) as
   **Content manager**.
4. In Vercel > Settings > Environment Variables:
   * `GOOGLE_DRIVE_CREDENTIALS` = the whole contents of the JSON key file (paste it as-is).
   * `GOOGLE_DRIVE_FOLDER_ID` = the folder id from step 1.
5. Redeploy. Files appear in the folder under their original names. Deleting a ticket moves its files to the Shared
   drive's trash (recoverable for 30 days).

A personal My Drive does not work: Google gives service accounts no storage space of their own.

## Zoho Mail for email

Set these in Vercel, redeploy, then use **Settings > Integrations > Send me a test email**:

| Variable | Value |
|---|---|
| `SMTP_HOST` | `smtp.zoho.in` if the account is on zoho.in (India), otherwise `smtp.zoho.com` |
| `SMTP_PORT` | `465` |
| `SMTP_SSL` | `true` |
| `SMTP_USER` | the full mailbox address, e.g. `design@mcciapune.com` |
| `SMTP_PASSWORD` | the mailbox password, or an **app-specific password** if two-factor sign-in is on (Zoho Mail > My Account > Security > App Passwords) |
| `SMTP_FROM` | the same address as `SMTP_USER` (Zoho refuses to send as any other address unless it is an alias of that mailbox) |

Port `587` with `SMTP_SSL` unset also works. A "553 Sender is not allowed to relay" error means `SMTP_FROM` does not
match the mailbox.
