export const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://127.0.0.1:8000';
export const TOKEN_KEY = 'mccia_access_token';

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

/** fetch() against the API with the bearer token attached. A 401 signs the user out. Big files in a form body are
 *  sent ahead in pieces (see withBigFilesSentFirst). */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const body = init.body instanceof FormData ? await withBigFilesSentFirst(init.body) : init.body;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, body });
  if (res.status === 401) window.dispatchEvent(new Event('auth:expired'));
  return res;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Turn FastAPI error bodies ({detail: string | [{msg}]}) into one readable message. */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const d = body?.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) return d.map((e: { msg?: string }) => e.msg ?? 'Invalid input').join('; ');
  } catch { /* not JSON */ }
  if (res.status === 403) return 'You do not have permission to do that.';
  if (res.status === 404) return 'Not found.';
  if (res.status === 413) return 'The files are too large to send. Attach smaller files, or fewer at once.';
  if (res.status >= 500) return 'The server had a problem. Please try again.';
  return `Request failed (${res.status}).`;
}

/** JSON request helper for authenticated endpoints. Throws ApiError with a readable message. */
export async function apiJson<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  let body = rest.body;
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(json);
  }
  let res: Response;
  try {
    res = await authFetch(path, { ...rest, headers, body });
  } catch (e) {
    if (e instanceof ApiError) throw e;   // a piece of a big file was refused, with its own reason
    throw new ApiError('Cannot reach the server. Check your connection.', 0);
  }
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Same as apiJson but with no token and no sign-out on 401 (for the public review link page). */
export async function publicJson<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  let body = rest.body;
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(json);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...rest, headers, body });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection.', 0);
  }
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  return res.json() as Promise<T>;
}

/** Public multipart POST (the design request form): no token, no sign-out on 401. */
export async function publicForm<T>(path: string, body: FormData): Promise<T> {
  body = await withBigFilesSentFirst(body);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: 'POST', body });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection.', 0);
  }
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  return res.json() as Promise<T>;
}

/* ── Big files ───────────────────────────────────
 * Vercel refuses request and response bodies over 4.5 MB, so files move in pieces of PART_BYTES (same as the
 * server's common.PART_BYTES). Uploads: each big file goes to /api/uploads first and the form carries a placeholder
 * the server swaps back. Downloads: byte ranges, joined here. */
const PART_BYTES = 3 * 1024 * 1024;
const SEND_AHEAD_OVER = 512 * 1024;   // smaller files ride along in the form (at most a few MB together)

async function sendInPieces(file: File): Promise<File> {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  const count = Math.ceil(file.size / PART_BYTES);
  const headers = new Headers({ 'Content-Type': 'application/octet-stream' });
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  for (let n = 0; n < count; n++) {
    const piece = file.slice(n * PART_BYTES, (n + 1) * PART_BYTES);
    let res: Response | null = null;
    for (let attempt = 0; attempt < 2 && !res; attempt++) {   // one retry for a dropped connection
      try { res = await fetch(`${API_BASE}/api/uploads/${id}/parts/${n}`, { method: 'PUT', headers, body: piece }); } catch { /* retry */ }
    }
    if (!res) throw new ApiError('Cannot reach the server. Check your connection.', 0);
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  }
  return new File([`DESIGNDESK-STAGED-UPLOAD:${id}:${count}`], file.name, { type: file.type });
}

/** The same form, with every big file already sent and replaced by its placeholder. */
async function withBigFilesSentFirst(body: FormData): Promise<FormData> {
  const entries = [...body.entries()];
  if (!entries.some(([, v]) => v instanceof File && v.size > SEND_AHEAD_OVER)) return body;
  const out = new FormData();
  for (const [key, v] of entries) {
    if (v instanceof File) out.append(key, v.size > SEND_AHEAD_OVER ? await sendInPieces(v) : v, v.name);
    else out.append(key, v);
  }
  return out;
}

/** A file of any size, fetched in ranges and joined, plus the name the server gave it. */
async function fetchWhole(path: string, send: (path: string, init: RequestInit) => Promise<Response>): Promise<{ blob: Blob; name: string | null }> {
  const first = await send(path, { headers: { Range: `bytes=0-${PART_BYTES - 1}` } });
  if (!first.ok) throw new ApiError(await errorMessage(first), first.status);
  const name = /filename="?([^";]+)"?/.exec(first.headers.get('Content-Disposition') ?? '')?.[1] ?? null;
  const pieces: Blob[] = [await first.blob()];
  const total = Number(/\/(\d+)$/.exec(first.headers.get('Content-Range') ?? '')?.[1] ?? 0);
  for (let at = PART_BYTES; first.status === 206 && at < total; at += PART_BYTES) {
    const res = await send(path, { headers: { Range: `bytes=${at}-${Math.min(at + PART_BYTES, total) - 1}` } });
    if (res.status !== 206) throw new ApiError(res.ok ? 'The download was interrupted. Please try again.' : await errorMessage(res), res.status);
    pieces.push(await res.blob());
  }
  return { blob: new Blob(pieces, { type: first.headers.get('Content-Type') ?? '' }), name };
}

const publicFetch = (path: string, init: RequestInit) => fetch(`${API_BASE}${path}`, init);

/** Download an authenticated file (CSV, PDF, attachment) by fetching it as a blob and saving it. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const { blob, name } = await fetchWhole(path, authFetch);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Fetch an authenticated file as an object URL for <img src> / previews. Caller should revoke it. */
export async function fetchBlobUrl(path: string): Promise<string> {
  return URL.createObjectURL((await fetchWhole(path, authFetch)).blob);
}

/** The same for a file behind a public link (the review page). Caller should revoke it. */
export async function fetchPublicBlobUrl(path: string): Promise<string> {
  return URL.createObjectURL((await fetchWhole(path, publicFetch)).blob);
}
