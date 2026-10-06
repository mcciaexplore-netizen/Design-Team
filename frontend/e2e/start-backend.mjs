// Starts a throwaway API for the browser tests: fresh SQLite database, migrations, demo seed, then uvicorn.
// Set E2E_PYTHON to the Python that has the backend requirements installed (default: `python`).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const python = process.env.E2E_PYTHON || 'python';
const backend = resolve(import.meta.dirname, '..', '..', 'backend');
const dbFile = join(mkdtempSync(join(tmpdir(), 'dd-e2e-')), 'e2e.db').replaceAll('\\', '/');

const env = {
  ...process.env,
  DATABASE_URL: `sqlite:///${dbFile}`,
  SECRET_KEY: 'e2e-only-secret-key-not-for-production-use',
  BCRYPT_ROUNDS: '4',
  SEED_DEMO_DATA: 'true',
  ALLOWED_ORIGINS: 'http://127.0.0.1:5199',
  PUBLIC_APP_URL: 'http://127.0.0.1:5199',
  UPLOAD_DIR: join(tmpdir(), 'dd-e2e-uploads'),
};

for (const args of [['-m', 'alembic', 'upgrade', 'head'], ['seed.py']]) {
  const r = spawnSync(python, args, { cwd: backend, env, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const server = spawn(python, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8765'], { cwd: backend, env, stdio: 'inherit' });
server.on('exit', code => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.kill(); process.exit(0); });
