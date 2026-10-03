# DesignFlow - Batch 1

## Final Architecture (Batches 1-6)
- **Frontend**: React + TypeScript, Vite, Tailwind CSS v4, `@fullcalendar/react`, `@dnd-kit/core`
- **Backend Core**: FastAPI, PostgreSQL (Neon/Supabase), SQLAlchemy, Alembic
- **Background & SLA**: Cron-triggered `/internal/tick` endpoint running idempotently for SLA tracking, escalations, and auto-close.
- **Storage**: Cloudflare R2 / Supabase Storage (S3-Compatible API) for secure, private CDR delivery via Presigned URLs. No local disk storage.
- **Deployment**: Render via `render.yaml` (Static frontend + Web Service backend).

## Local Development Setup

1. **Environment Configuration**
   Copy `.env.example` to `.env` and fill in your PostgreSQL `DATABASE_URL`, `CRON_SECRET`, and S3 credentials:
   ```powershell
   cp .env.example .env
   ```

2. **Backend Setup (Native Python)**
   ```powershell
   cd backend
   python -m venv venv
   .\venv\Scripts\activate
   pip install -r requirements.txt
   alembic upgrade head
   python seed.py
   uvicorn main:app --reload
   ```

3. **Frontend Setup (Native NPM)**
   Open a new terminal:
   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

## Production Deployment (Render)
This project is configured for 1-click deployment on Render. 
Simply connect the repository to Render and it will automatically provision the Backend API and the React Static site based on the `render.yaml` blueprint. Make sure to populate the required environment variables in the Render dashboard and configure an external cron service (like cron-job.org) to ping `POST /internal/tick` every 5 minutes with the `X-Cron-Secret` header.
