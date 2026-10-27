import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock, Eye, Link2, PackageCheck, Search, Workflow } from 'lucide-react';
import { publicJson } from '../api';

interface BoardRequest {
  ticket_number: string; title: string; organisation: string | null; design_type: string | null; status: string;
  current_step: number; finished: boolean; due_at: string | null; delivered_at: string | null; created_at: string | null;
}
interface Board { steps: string[]; finished_days: number; requests: BoardRequest[] }
type Show = 'active' | 'finished' | 'all';

const OTHER = 'Other requests';
const DAY = 24 * 60 * 60 * 1000;
const REFRESH_MS = 60_000;
const orgOf = (r: BoardRequest) => r.organisation || OTHER;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function readParams() {
  const p = new URLSearchParams(window.location.search);
  const show = p.get('show');
  return { org: p.get('org') ?? '', q: p.get('q') ?? '', show: (show === 'finished' || show === 'all' ? show : 'active') as Show };
}

/**
 * Every request and where it stands, without signing in. Anyone can open /requests; ?org=… narrows it to one
 * organisation, so a client can bookmark their own dashboard. Only status and dates are shown, nothing personal.
 */
export default function RequestsBoardPage() {
  const [data, setData] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [{ org, q, show }, setView] = useState(readParams);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    publicJson<Board>('/api/public/requests-board')
      .then(d => { setData(d); setError(null); setLoadedAt(Date.now()); })
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load the requests.'));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Keep the view in the address, so it can be bookmarked or shared.
  useEffect(() => {
    const p = new URLSearchParams();
    if (org) p.set('org', org);
    if (q) p.set('q', q);
    if (show !== 'active') p.set('show', show);
    const qs = p.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, [org, q, show]);

  const orgs = useMemo(() => {
    const names = [...new Set((data?.requests ?? []).map(orgOf))].filter(n => n !== OTHER).sort((a, b) => a.localeCompare(b));
    return data?.requests.some(r => !r.organisation) ? [...names, OTHER] : names;
  }, [data]);

  const inOrg = useMemo(() => (data?.requests ?? []).filter(r => !org || orgOf(r) === org), [data, org]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return inOrg.filter(r => (show === 'all' || (show === 'finished') === r.finished)
      && (!needle || `${r.ticket_number} ${r.title} ${r.design_type ?? ''}`.toLowerCase().includes(needle)));
  }, [inOrg, q, show]);

  const groups = useMemo(() => {
    const by = new Map<string, BoardRequest[]>();
    for (const r of visible) by.set(orgOf(r), [...(by.get(orgOf(r)) ?? []), r]);
    return [...by.entries()].sort(([a], [b]) => (a === OTHER ? 1 : b === OTHER ? -1 : a.localeCompare(b)));
  }, [visible]);

  const stats = useMemo(() => {
    const active = inOrg.filter(r => !r.finished);
    return {
      active: active.length,
      review: active.filter(r => r.status === 'In Review').length,
      dueSoon: active.filter(r => { const left = r.due_at ? new Date(r.due_at).getTime() - loadedAt : -1; return left >= 0 && left < 7 * DAY; }).length,
      delivered: inOrg.filter(r => r.finished).length,
    };
  }, [inOrg, loadedAt]);

  const set = (patch: Partial<{ org: string; q: string; show: Show }>) => setView(v => ({ ...v, ...patch }));

  const copyLink = () => {
    void navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app, #FAFAFA)', padding: '2rem 1rem 3rem' }}>
      <main style={{ maxWidth: 1040, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <img src="/mccia_logo.png" alt="MCCIA Applied AI Studio" style={{ height: 44, marginBottom: 14 }} />
            <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-strong)', letterSpacing: '-0.02em' }}>
              {org ? `${org}: design requests` : 'Design requests'}
            </h1>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-soft)', marginTop: 4 }}>
              Every request to the design team and where it stands. No sign-in needed.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <a href="/request" className="btn-primary" style={{ textDecoration: 'none' }}>Submit a new request</a>
            <a href="/my-requests" className="login-link-btn" style={{ fontSize: '0.82rem' }}>Campaigns &amp; your requests →</a>
          </div>
        </header>

        {error && !data && (
          <div className="glass-card" style={{ padding: '1.25rem' }}>
            <p role="alert" style={{ color: 'var(--danger-text)', fontWeight: 600 }}>{error}</p>
            <button type="button" className="btn-ghost" style={{ marginTop: 10 }} onClick={load}>Try again</button>
          </div>
        )}
        {!data && !error && <p role="status" style={{ color: 'var(--text-hint)' }}>Loading…</p>}

        {data && (<>
          <section aria-label="Summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
            <Tile icon={Workflow} label="In progress" value={stats.active} />
            <Tile icon={Eye} label="Waiting for approval" value={stats.review} />
            <Tile icon={Clock} label="Due in the next 7 days" value={stats.dueSoon} />
            <Tile icon={PackageCheck} label={`Finished, last ${data.finished_days} days`} value={stats.delivered} />
          </section>

          <section aria-label="Filters" className="glass-card" style={{ padding: '0.9rem 1rem', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
            <label style={{ position: 'relative', flex: '1 1 220px' }}>
              <span className="sr-only">Search requests</span>
              <Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-hint)' }} />
              <input type="search" className="input-field" style={{ width: '100%', paddingLeft: 32 }} placeholder="Search by title or number"
                value={q} onChange={e => set({ q: e.target.value })} />
            </label>
            <label style={{ flex: '1 1 200px' }}>
              <span className="sr-only">Organisation</span>
              <select className="input-field" style={{ width: '100%' }} value={org} onChange={e => set({ org: e.target.value })}>
                <option value="">All organisations</option>
                {orgs.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <div role="group" aria-label="Show" style={{ display: 'flex', gap: 4, background: '#F1F5F9', borderRadius: 10, padding: 3 }}>
              {(['active', 'finished', 'all'] as Show[]).map(s => (
                <button key={s} type="button" aria-pressed={show === s} onClick={() => set({ show: s })}
                  style={{ border: 0, borderRadius: 8, padding: '0.4rem 0.8rem', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer',
                           background: show === s ? 'white' : 'transparent', color: show === s ? 'var(--brand)' : 'var(--text-soft)',
                           boxShadow: show === s ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
                  {s === 'active' ? 'In progress' : s === 'finished' ? 'Finished' : 'All'}
                </button>
              ))}
            </div>
            <button type="button" className="btn-ghost" onClick={copyLink} title="Copy a link to exactly this view" style={{ gap: 6 }}>
              <Link2 size={14} aria-hidden="true" /> <span role="status">{copied ? 'Link copied' : 'Copy link'}</span>
            </button>
          </section>

          {groups.length === 0 && (
            <p className="glass-card" style={{ padding: '1.5rem', color: 'var(--text-soft)', textAlign: 'center' }}>
              {q ? 'No requests match your search.' : show === 'finished' ? 'Nothing finished yet.' : 'No requests in progress right now.'}
            </p>
          )}

          {groups.map(([name, rows]) => (
            <section key={name} aria-label={name} style={{ marginBottom: 24 }}>
              {!org && (
                <h2 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-strong)', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {name}
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-hint)' }}>{rows.length}</span>
                  {name !== OTHER && (
                    <button type="button" className="login-link-btn" style={{ marginLeft: 'auto', fontSize: '0.8rem' }} onClick={() => set({ org: name })}>
                      Open {name}'s dashboard
                    </button>
                  )}
                </h2>
              )}
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
                {rows.map(r => <RequestCard key={r.ticket_number} r={r} steps={data.steps} now={loadedAt} />)}
              </ul>
            </section>
          ))}

          <p style={{ fontSize: '0.75rem', color: 'var(--text-hint)', marginTop: 8 }}>
            Updated {new Date(loadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, refreshes every minute.
            {error && <span role="alert" style={{ color: 'var(--danger-text)' }}> Last refresh failed: {error}</span>}
          </p>
        </>)}
      </main>
    </div>
  );
}

function Tile({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: number }) {
  return (
    <div className="glass-card" style={{ padding: '1rem 1.1rem', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div className="icon-tile" aria-hidden="true"><Icon size={18} /></div>
      <div>
        <p style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-strong)', lineHeight: 1.1 }}>{value}</p>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-soft)', fontWeight: 600 }}>{label}</p>
      </div>
    </div>
  );
}

function RequestCard({ r, steps, now }: { r: BoardRequest; steps: string[]; now: number }) {
  const late = !r.finished && r.due_at !== null && new Date(r.due_at).getTime() < now;
  const tone = r.finished ? ['rgba(46,139,87,0.12)', '#047857']
    : r.status === 'In Review' ? ['rgba(245,158,11,0.15)', '#92400e']
    : ['rgba(11,31,58,0.08)', '#0B1F3A'];
  return (
    <li className="glass-card" style={{ padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-hint)' }}>
          {r.ticket_number}{r.design_type ? ` · ${r.design_type}` : ''}
        </span>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '0.15rem 0.55rem', borderRadius: 99, background: tone[0], color: tone[1], whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          {r.finished && <Check size={11} aria-hidden="true" />}{r.status}
        </span>
      </div>
      <h3 style={{ fontSize: '0.98rem', fontWeight: 800, color: 'var(--text-strong)', lineHeight: 1.35 }}>{r.title}</h3>
      <div role="img" aria-label={`Step ${r.current_step + 1} of ${steps.length}: ${steps[r.current_step]}`} style={{ display: 'flex', gap: 4 }}>
        {steps.map((s, i) => (
          <span key={s} title={s} style={{ flex: 1, height: 5, borderRadius: 99, background: i <= r.current_step ? (r.finished ? '#2E8B57' : '#0B1F3A') : '#E2E8F0' }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginTop: 'auto', fontSize: '0.8rem' }}>
        <span style={{ color: late ? 'var(--danger-text)' : 'var(--text-soft)', fontWeight: late ? 700 : 500 }}>
          {r.finished ? `Delivered ${day(r.delivered_at ?? r.due_at)}` : !r.due_at ? 'No date yet' : `${late ? 'Was expected' : 'Expected by'} ${day(r.due_at)}`}
        </span>
      </div>
    </li>
  );
}
