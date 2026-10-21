# DesignDesk

MCCIA Applied AI Studio's design request and workflow platform. Clients ask for designs, the design team works on
them, sends designs for approval and delivers them.

Live on Vercel: every push to `main` deploys. Setup, email (Zoho) and Google Drive: [DEPLOY.md](DEPLOY.md).

## Who uses what

**Design Leads (admin)**
- **Visual Board**: every ticket by stage or by person; drag to move, tick several to assign or move together.
- **Performance**: a live feed of new requests and changes (updates every 15 seconds), plus delivery, SLA and
  workload numbers with report exports.
- **Ticket page**: assign a designer, set priority, note the client's changes, upload designs and send them for
  approval, files, source files, Figma, time.
- **Settings**: add and remove people (**Users**), check email and file storage (**Email & storage**), and delete
  all past data (**Danger zone**).

**Designers**
- **My Dashboard**: their queue (soonest deadline first), what changed on their work, and where their emails go.
- **Library**: shared folders of logos, brand assets, templates and finished designs, with versions.
- **Workload** and **Calendar**: who has capacity and what is due when.

**Clients**
- **Client portal** (signed in): their requests, designs waiting for approval and finished designs.
- **No sign-in needed:**
  - `/request`: the design request form (several designs at once, files up to 10 MB).
  - `/requests`: every request and where it stands, grouped by organisation (`?org=TATA` for one). Titles, status
    and dates only.
  - `/track/<link>`: one request's progress (link in the confirmation email).
  - `/review/<link>`: approve a design or ask for changes (link in the review email).

## Run it on your computer

Needs Python 3.12 or newer and Node.js 20 or newer. Nothing else: locally it uses SQLite and keeps files on disk.

```powershell
# API (first terminal)
cd backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
$env:ADMIN_EMAIL = "you@example.com"      # becomes your Design Lead account
$env:ADMIN_PASSWORD = "pick-a-password"
alembic upgrade head
python seed.py             # design types, plus your admin account
uvicorn main:app --reload

# Website (second terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and sign in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` you set above. Add designers and
clients from **Settings > Users** once signed in.

## Tests

```powershell
cd backend;  .\venv\Scripts\python -m pytest -q        # API tests
cd frontend; npx tsc -b                                  # type check: the Vercel build fails on any error
cd frontend; $env:E2E_PYTHON="..\backend\venv\Scripts\python.exe"; npm run test:e2e   # real Edge, own temp database
```

## Project layout

| Folder | What's in it |
|---|---|
| `backend/` | the API, database models, migrations (`alembic/versions`) and tests (`test_*.py`) |
| `frontend/src/` | the website: `pages/` and `components/` |
| `frontend/e2e/` | browser tests |
| `api/index.py`, `vercel.json` | how Vercel serves the API under `/api` next to the website |
| `.env.example` | every setting, with what it does |

A change to `backend/models.py` needs a new migration in `backend/alembic/versions`; the tests check for it.
