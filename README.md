# DesignDesk

The MCCIA Applied AI Studio's design request and workflow platform: clients request designs (signed in, or through
the public `/request` form), the design team works them on a board, sends proofs for approval, and delivers.

## Architecture
- **Frontend**: React + TypeScript, Vite, Tailwind CSS v4, `@fullcalendar/react`, `@dnd-kit/core`
- **Backend**: FastAPI, SQLAlchemy, Alembic; PostgreSQL (Neon) in production, SQLite locally
- **Scheduled jobs**: SLA warnings and escalations, review reminders and auto-closing. On Vercel they run off normal
  traffic every 5 minutes (`cron_jobs.run_if_due`); anywhere, `/internal/tick` runs them on demand (`CRON_SECRET`).
- **Storage**: S3 / Cloudflare R2 when `S3_ENDPOINT_URL` is set; otherwise the database on Vercel and local disk
  (`UPLOAD_DIR`) in development. Files are only served through access-checked endpoints, and big files travel in
  3 MB pieces (Vercel's 4.5 MB body limit).
- **Deployment**: one Vercel project (`vercel.json`): the built frontend plus the API as a Python function under
  `/api` (`api/index.py`). See [DEPLOY.md](DEPLOY.md).

## Pages that need no sign-in
- `/request`: the design request form.
- `/requests`: every request and where it stands, grouped by organisation (`?org=…` for one organisation). Titles,
  status and dates only. `PUBLIC_BOARD=off` hides it.
- `/track/<token>`: one request's progress, linked from the confirmation.
- `/review/<token>`: approve a design or ask for changes, linked from the review email.

## Local Development Setup

1. **Environment Configuration**
   Copy `.env.example` to `.env`. Locally everything is optional (SQLite, files on disk):
   ```powershell
   cp .env.example .env
   ```

2. **Backend Setup (Native Python)**
   ```powershell
   cd backend
   python -m venv venv
   .\venv\Scripts\activate
   pip install -r requirements.txt
   alembic upgrade head      # creates the schema (SQLite by default; set DATABASE_URL for PostgreSQL)
   python seed.py
   uvicorn main:app --reload
   pytest                    # optional: run the backend tests (~45 s)
   pytest -n 4 --basetemp=.pytest_tmp   # in parallel (~30 s)
   ```

3. **Frontend Setup (Native NPM)**
   Open a new terminal:
   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

## Production deployment
Push to `main`: Vercel builds and deploys it. Setup and environment variables are in [DEPLOY.md](DEPLOY.md).

## Browser tests
`npm run test:e2e` (in `frontend/`) drives real Microsoft Edge through sign-in, the public request form, the client's
request dialog and proof approval. It starts its own API and temporary database, so it never touches your data. Set
`E2E_PYTHON` to the Python that has the backend requirements, e.g. `E2E_PYTHON=../.venv/Scripts/python.exe`.

## Optional integrations
Everything below is off until configured (see `.env.example`): Slack alerts (Settings > Integrations), Jira two-way sync
(`JIRA_*`), confirmation and reminder email (`SMTP_*`) and a CAPTCHA on the public `/request` form (`TURNSTILE_*`).
