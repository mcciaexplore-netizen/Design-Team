import { useEffect, useState } from 'react';
import { publicJson } from './api';

/** The upload limits the server enforces (smaller on Vercel), so every picker checks and states the real numbers. */
export interface UploadLimits {
  max_upload_mb: number;          // per attachment or proof
  max_cdr_upload_mb: number;      // per source file (CDR, PSD, AI…)
  max_request_mb: number | null;  // all files sent together in one request, when the host caps it
}

const FALLBACK: UploadLimits = { max_upload_mb: 4, max_cdr_upload_mb: 4, max_request_mb: 4 };
let pending: Promise<UploadLimits> | null = null;

function load(): Promise<UploadLimits> {
  pending ??= publicJson<UploadLimits>('/api/public/request-form').catch(() => { pending = null; return FALLBACK; });
  return pending;
}

/** Loaded once per page; until then (or if it fails) the strictest limits are assumed. */
export function useUploadLimits(): UploadLimits {
  const [limits, setLimits] = useState<UploadLimits>(FALLBACK);
  useEffect(() => { let live = true; void load().then(l => { if (live) setLimits(l); }); return () => { live = false; }; }, []);
  return limits;
}

/** "File is larger than 4 MB" when it is, else null. */
export function sizeProblem(file: File, mb: number): string | null {
  return file.size > mb * 1024 * 1024 ? `${file.name} is larger than ${mb} MB` : null;
}
