export const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://127.0.0.1:8000';
export const TOKEN_KEY = 'mccia_access_token';

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

/** fetch() against the API with the bearer token attached. A 401 signs the user out. */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
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
  } catch {
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

/** Download an authenticated file (CSV, PDF, attachment) by fetching it as a blob and saving it. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const res = await authFetch(path);
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match?.[1] ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Fetch an authenticated file as an object URL for <img src> / previews. Caller should revoke it. */
export async function fetchBlobUrl(path: string): Promise<string> {
  const res = await authFetch(path);
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  return URL.createObjectURL(await res.blob());
}
