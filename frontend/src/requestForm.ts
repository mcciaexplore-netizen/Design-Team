import type { Ticket } from './types';

/* Shared pieces of the design request form: types, validation, the request body, and what is remembered on this device. */

export interface Question { id: string; label: string; type: 'text' | 'select' | 'multiselect' | 'number'; options: string[]; required: boolean }

export interface RequestFormOptions {
  design_requirements: string[];
  other_label: string;
  max_upload_mb: number;
  max_request_mb?: number | null;   // all files together, if the server caps it (big files go ahead in pieces, so normally not)
  max_files: number;
  max_reference_links: number;
  questions: Record<string, Question[]>;
  turnstile_site_key: string | null;
}

export interface RequestValues {
  name: string; email: string;
  event_name: string; event_date: string; department: string;
  design_requirements: string[]; other_details: string;   // every ticked design becomes its own ticket
  delivery_date: string; num_creatives: string; content: string;
  details: Record<string, Answers>;   // answers to each design's questions: details[design][question id]
  links: string[];
}

export type Answers = Record<string, string | string[]>;

/** Used to open the New Request dialog with some answers already filled in. */
export type RequestPrefill = Partial<RequestValues>;

/** Error messages by field key: name, email, event_name, …, `q:<design>:<question id>`, `link:<row>` or links. */
export type FieldErrors = Record<string, string>;

export const MAX_LINK_LENGTH = 500;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Same list the server accepts.
const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'psd', 'ai', 'fig', 'cdr', 'eps', 'indd'];

export const emptyValues = (): RequestValues => ({
  name: '', email: '', event_name: '', event_date: '', department: '', design_requirements: [], other_details: '',
  delivery_date: '', num_creatives: '1', content: '', details: {}, links: [],
});

/** Today as YYYY-MM-DD in the browser's time zone. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "Fri 10 Oct" for a YYYY-MM-DD string. */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** DOM id of a field's input, so error links and aria-describedby can find it. */
export const fieldId = (prefix: string, key: string) => `${prefix}-${key.replace(/[^\w-]/g, '-')}`;

/** Error key of one design's question. */
export const questionKey = (design: string, id: string) => `q:${design}:${id}`;

export function validate(v: RequestValues, options: RequestFormOptions, needsIdentity: boolean): FieldErrors {
  const e: FieldErrors = {};
  if (needsIdentity) {
    if (!v.name.trim()) e.name = 'Enter your name';
    if (!v.email.trim()) e.email = 'Enter your email address';
    else if (!EMAIL_RE.test(v.email.trim())) e.email = 'Enter a valid email address, like name@example.com';
  }
  if (!v.event_name.trim()) e.event_name = 'Enter the event name';
  if (!v.event_date) e.event_date = 'Choose the event or workshop date';
  if (v.design_requirements.length === 0) e.design_requirement = 'Choose at least one design requirement';
  if (v.design_requirements.includes(options.other_label) && !v.other_details.trim()) e.other_details = 'Describe the design you need';
  const several = v.design_requirements.length > 1;
  for (const design of v.design_requirements) {
    const where = several ? `${design}: ` : '';
    for (const q of options.questions[design] ?? []) {
      const answer = v.details[design]?.[q.id];
      const empty = Array.isArray(answer) ? answer.length === 0 : !(answer ?? '').trim();
      const key = questionKey(design, q.id);
      if (empty) { if (q.required) e[key] = where + (q.type === 'select' || q.type === 'multiselect' ? `Choose an option for “${q.label}”` : `Enter “${q.label}”`); }
      else if (q.type === 'number' && !(Number(answer) > 0)) e[key] = `${where}“${q.label}” must be a number above 0`;
    }
  }
  if (!v.delivery_date) e.delivery_date = 'Choose the expected delivery date';
  else if (v.delivery_date < todayISO()) e.delivery_date = 'The delivery date cannot be in the past';
  const n = Number(v.num_creatives);
  if (!Number.isInteger(n) || n < 1 || n > 100) e.num_creatives = 'Enter a number of creatives from 1 to 100';
  v.links.forEach((link, i) => {
    const l = link.trim();
    if (!l) return;
    if (l.length > MAX_LINK_LENGTH) e[`link:${i}`] = `This link is longer than ${MAX_LINK_LENGTH} characters`;
    else if (!/^https:\/\/[^\s/]+\S*$/.test(l)) e[`link:${i}`] = 'Links must start with https://';
  });
  return e;
}

/** Check files as they are added. Returns the files that can be kept plus one message per rejected file. */
export function checkNewFiles(have: File[], incoming: File[], options: RequestFormOptions): { ok: File[]; notes: string[] } {
  const ok: File[] = [];
  const notes: string[] = [];
  for (const f of incoming) {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXTENSIONS.includes(ext)) notes.push(`${f.name}: .${ext} files are not allowed`);
    else if (f.size > options.max_upload_mb * 1024 * 1024) notes.push(`${f.name}: larger than ${options.max_upload_mb} MB`);
    else if (f.size === 0) notes.push(`${f.name}: the file is empty`);
    else if (have.length + ok.length >= options.max_files) notes.push(`${f.name}: only ${options.max_files} files can be attached`);
    else if (options.max_request_mb && [...have, ...ok, f].reduce((n, x) => n + x.size, 0) > options.max_request_mb * 1024 * 1024)
      notes.push(`${f.name}: the files together can be at most ${options.max_request_mb} MB`);
    else ok.push(f);
  }
  return { ok, notes };
}

export function buildBody(v: RequestValues, files: File[], needsIdentity: boolean): FormData {
  const body = new FormData();
  if (needsIdentity) { body.set('name', v.name.trim()); body.set('email', v.email.trim()); }
  body.set('event_name', v.event_name.trim());
  body.set('event_date', v.event_date);
  body.set('department', v.department.trim());
  for (const design of v.design_requirements) body.append('design_requirement', design);
  body.set('other_details', v.other_details.trim());
  body.set('delivery_date', v.delivery_date);
  body.set('num_creatives', v.num_creatives);
  body.set('content', v.content.trim());
  body.set('details', JSON.stringify(Object.fromEntries(v.design_requirements.map(d => [d, v.details[d] ?? {}]))));
  body.set('reference_links', JSON.stringify(v.links.map(l => l.trim()).filter(Boolean)));
  for (const f of files) body.append('files', f);
  return body;
}

/** Point a server error message at the field it is about. Returns null when it is not about one field. */
export function fieldForServerError(message: string, v: RequestValues, options: RequestFormOptions): string | null {
  const lower = message.toLowerCase();
  if (lower.includes('design requirement')) return 'design_requirement';
  if (lower.includes('describe the design')) return 'other_details';
  if (lower.includes('delivery date')) return 'delivery_date';
  if (lower.includes('email address')) return 'email';
  if (lower.startsWith('reference links')) {
    const bad = v.links.findIndex(l => l.trim() && message.includes(l.trim().slice(0, 60)));
    return bad >= 0 ? `link:${bad}` : 'links';
  }
  // With several designs the server names the design first ("Instagram post – Format is required").
  const several = v.design_requirements.length > 1;
  for (const design of v.design_requirements) {
    const rest = !several ? message : message.startsWith(`${design} – `) ? message.slice(design.length + 3) : null;
    const q = rest === null ? undefined : (options.questions[design] ?? []).find(x => rest.startsWith(x.label));
    if (q) return questionKey(design, q.id);
  }
  return null;
}

/* ── Remembered on this device (every access is guarded: storage can be blocked or full) ── */

const PERSON_KEY = 'designdesk.requester';
const draftKey = (form: string) => `designdesk.requestDraft.${form}`;

function read(key: string): unknown {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: nothing to do */ }
}
function remove(key: string) {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

export function loadPerson(): { name: string; email: string } | null {
  const p = read(PERSON_KEY) as { name?: unknown; email?: unknown } | null;
  return p && typeof p.name === 'string' && typeof p.email === 'string' && (p.name || p.email) ? { name: p.name, email: p.email } : null;
}
export const savePerson = (name: string, email: string) => write(PERSON_KEY, { name, email });
export const clearPerson = () => remove(PERSON_KEY);

/** Everything except files and the person's identity, which is remembered separately. */
export function loadDraft(form: string): RequestPrefill | null {
  const d = read(draftKey(form));
  if (!d || typeof d !== 'object') return null;
  const base = emptyValues();
  const out: RequestPrefill = {};
  for (const key of ['event_name', 'event_date', 'department', 'other_details', 'delivery_date', 'num_creatives', 'content'] as const) {
    const value = (d as Record<string, unknown>)[key];
    if (typeof value === 'string') out[key] = value;
  }
  const { details, links, design_requirements, design_requirement } = d as Record<string, unknown>;
  const answers = details && typeof details === 'object' && !Array.isArray(details) ? details as Record<string, unknown> : {};
  if (Array.isArray(design_requirements)) {
    out.design_requirements = design_requirements.filter((x): x is string => typeof x === 'string');
    out.details = answers as RequestValues['details'];
  } else if (typeof design_requirement === 'string' && design_requirement) {
    // A draft saved by the older one-choice form: its answers belonged to that one design.
    out.design_requirements = [design_requirement];
    out.details = { [design_requirement]: answers as Answers };
  }
  if (Array.isArray(links)) out.links = links.filter((l): l is string => typeof l === 'string');
  return isBlank({ ...base, ...out }) ? null : out;
}
export function saveDraft(form: string, v: RequestValues) {
  if (isBlank(v)) { remove(draftKey(form)); return; }
  const { name: _name, email: _email, ...rest } = v;
  write(draftKey(form), rest);
}
export const clearDraft = (form: string) => remove(draftKey(form));

/** True when the person has not typed anything (the defaults do not count). */
function isBlank(v: RequestValues): boolean {
  const base = emptyValues();
  return v.event_name === '' && v.event_date === '' && v.department === '' && v.design_requirements.length === 0 && v.other_details === '' && v.delivery_date === ''
    && v.content === '' && v.num_creatives === base.num_creatives
    && Object.values(v.details).every(answers => Object.values(answers ?? {}).every(a => (Array.isArray(a) ? a.length === 0 : !a)))
    && v.links.every(l => !l);
}

/** Tickets made before the channels were split carry the old bundled names; map them to today's choices. */
function currentRequirement(old: string, details: Answers): { requirement: string; details: Answers } {
  if (old === 'Flyer (Email/Whatsapp)') {
    return details.channel === 'WhatsApp' ? { requirement: 'WhatsApp creative', details: {} } : { requirement: 'Flyer (Email / Print)', details };
  }
  if (old === 'Social Media Post (Insta, LinkedIn, Twitter)') {
    const first = Array.isArray(details.platforms) ? details.platforms[0] : '';
    return { requirement: first === 'LinkedIn' ? 'LinkedIn post' : first === 'Twitter' ? 'Twitter / X post' : 'Instagram post', details: {} };
  }
  if (old === 'Directory') return { requirement: 'Book', details };   // renamed
  return { requirement: old, details };
}

/** Answers for "Request again": the earlier request's content, without its dates. */
export function prefillFromTicket(t: Ticket): RequestPrefill {
  const f = t.type_specific_fields ?? {};
  const text = (x: unknown) => (typeof x === 'string' ? x : '');
  if (!f.event_name) return { event_name: t.title, content: t.description ?? '' };   // older ticket: no form fields saved
  const notes = text(f.content) || (t.description ?? '').split('\nContent / notes:\n')[1] || '';
  const details: Answers = {};
  for (const [k, v] of Object.entries((f.details && typeof f.details === 'object' ? f.details : {}) as Record<string, unknown>)) {
    details[k] = Array.isArray(v) ? v.map(String) : String(v);
  }
  const now = currentRequirement(text(f.design_requirement), details);
  return {
    event_name: text(f.event_name), department: text(f.department), design_requirements: now.requirement ? [now.requirement] : [], other_details: text(f.other_details),
    num_creatives: String(f.number_of_creatives ?? 1), content: notes, details: now.requirement ? { [now.requirement]: now.details } : {},
    links: Array.isArray(f.reference_links) ? f.reference_links.map(String) : [],
  };
}

export const requestLabel = { display: 'block', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-strong)', marginBottom: 6 } as const;
