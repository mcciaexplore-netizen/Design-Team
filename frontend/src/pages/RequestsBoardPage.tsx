import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock, Eye, Link2, PackageCheck, Search, Workflow } from 'lucide-react';
import { publicJson } from '../api';

interface BoardRequest {
  ticket_number: string; title: string; design_type: string | null; status: string;
  current_step: number; finished: boolean; due_at: string | null; delivered_at: string | null; created_at: string | null;
}
interface Board { steps: string[]; finished_days: number; requests: BoardRequest[] }
type Show = 'active' | 'finished' | 'all';

const DAY = 24 * 60 * 60 * 1000;
const REFRESH_MS = 60_000;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function readParams() {
  const p = new URLSearchParams(window.location.search);
  const show = p.get('show');
  return { q: p.get('q') ?? '', show: (show === 'finished' || show === 'all' ? show : 'active') as Show };
}

/** Every request and where it stands, without signing in. */
export default function RequestsBoardPage() {
  const [data, setData] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [{ q, show }, setView] = useState(readParams);
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

  useEffect(() => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (show !== 'active') p.set('show', show);
    const qs = p.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, [q, show]);

  const all = useMemo(() => data?.requests ?? [], [data]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter(r => (show === 'all' || (show === 'finished') === r.finished)
      && (!needle || `${r.ticket_number} ${r.title} ${r.design_type ?? ''}`.toLowerCase().includes(needle)));
  }, [all, q, show]);

  const stats = useMemo(() => {
    const active = all.filter(r => !r.finished);
    return {
      active: active.length,
      review: active.filter(r => r.status === 'In Review').length,
      dueSoon: active.filter(r => { const left = r.due_at ? new Date(r.due_at).getTime() - loadedAt : -1; return left >= 0 && left < 7 * DAY; }).length,
      delivered: all.filter(r => r.finished).length,
    };
  }, [all, loadedAt]);

  const set = (patch: Partial<{ q: string; show: Show }>) => setView(v => ({ ...v, ...patch }));

  const copyLink = () => {
    void navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="board-page">
      <div className="board-hero">
        <div className="board-hero-inner">
          <div>
            <h1 className="board-hero-title">Design requests</h1>
            <p className="board-hero-sub">Every request to the design team and where it stands. No sign-in needed.</p>
          </div>
          <div className="board-hero-cta">
            <a href="/campaigns" className="board-campaigns-link">Campaigns &amp; posts →</a>
          </div>
        </div>
      </div>

      <div className="board-body">
        {error && !data && (
          <div className="board-error-card">
            <p role="alert">{error}</p>
            <button type="button" className="btn-ghost" style={{ marginTop: 10 }} onClick={load}>Try again</button>
          </div>
        )}

        {!data && !error && (
          <div className="board-loading">
            <div className="user-spinner" aria-hidden="true" />
            <p role="status">Loading requests…</p>
          </div>
        )}

        {data && (<>
          <section aria-label="Summary" className="board-stats">
            <StatTile icon={Workflow}     label="In progress"         value={stats.active}    gradient="linear-gradient(135deg,#003F8A 0%,#0056B3 100%)" />
            <StatTile icon={Eye}          label="Awaiting approval"   value={stats.review}    gradient="linear-gradient(135deg,#d97706 0%,#f59e0b 100%)" />
            <StatTile icon={Clock}        label="Due in 7 days"       value={stats.dueSoon}   gradient="linear-gradient(135deg,#8B5CF6 0%,#a855f7 100%)" />
            <StatTile icon={PackageCheck} label={`Finished · last ${data.finished_days}d`} value={stats.delivered} gradient="linear-gradient(135deg,#059669 0%,#10B981 100%)" />
          </section>

          <section aria-label="Filters" className="board-filters">
            <label className="board-search-wrap">
              <span className="sr-only">Search requests</span>
              <Search size={15} aria-hidden="true" className="board-search-icon" />
              <input type="search" className="board-search-input" placeholder="Search by title or number…"
                value={q} onChange={e => set({ q: e.target.value })} />
            </label>
            <div role="group" aria-label="Show" className="board-toggle-group">
              {(['active', 'finished', 'all'] as Show[]).map(s => (
                <button key={s} type="button" aria-pressed={show === s}
                  className={`board-toggle-btn${show === s ? ' active' : ''}`}
                  onClick={() => set({ show: s })}>
                  {s === 'active' ? 'In progress' : s === 'finished' ? 'Finished' : 'All'}
                </button>
              ))}
            </div>
            <button type="button" className="btn-ghost board-copy-btn" onClick={copyLink} title="Copy a link to this view">
              <Link2 size={14} aria-hidden="true" />
              <span role="status">{copied ? '✓ Copied' : 'Copy link'}</span>
            </button>
          </section>

          {visible.length === 0 && (
            <div className="board-empty">
              <p>{q
                ? 'No requests match your search.'
                : show === 'finished' ? 'Nothing finished yet.' : 'No requests in progress right now.'}</p>
            </div>
          )}

          {visible.length > 0 && (
            <ul aria-label="Requests" className="board-cards-grid">
              {visible.map(r => <RequestCard key={r.ticket_number} r={r} steps={data.steps} now={loadedAt} />)}
            </ul>
          )}

          <p className="board-refresh-note">
            Updated {new Date(loadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, refreshes every minute.
            {error && <span role="alert" style={{ color: 'var(--danger-text)', marginLeft: 6 }}>Last refresh failed: {error}</span>}
          </p>
        </>)}
      </div>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, gradient }: { icon: typeof Clock; label: string; value: number; gradient: string }) {
  return (
    <div className="stat-tile" style={{ background: gradient }}>
      <div className="stat-tile-icon" aria-hidden="true"><Icon size={20} /></div>
      <div>
        <p className="stat-tile-value">{value}</p>
        <p className="stat-tile-label">{label}</p>
      </div>
    </div>
  );
}

function RequestCard({ r, steps, now }: { r: BoardRequest; steps: string[]; now: number }) {
  const late = !r.finished && r.due_at !== null && new Date(r.due_at).getTime() < now;
  const pct = steps.length ? Math.round(((r.current_step + 1) / steps.length) * 100) : 0;

  const badge = r.finished
    ? { bg: 'rgba(5,150,105,0.12)', color: '#059669' }
    : r.status === 'In Review'
    ? { bg: 'rgba(217,119,6,0.12)', color: '#92400e' }
    : { bg: 'rgba(0,63,138,0.08)', color: '#003F8A' };

  return (
    <li className="request-card">
      <div className="request-card-top">
        <span className="request-card-number">
          {r.ticket_number}{r.design_type ? ` · ${r.design_type}` : ''}
        </span>
        <span className="request-card-badge" style={{ background: badge.bg, color: badge.color }}>
          {r.finished && <Check size={10} aria-hidden="true" />}
          {r.status}
        </span>
      </div>

      <h3 className="request-card-title">{r.title}</h3>

      <div
        role="img"
        aria-label={`Step ${r.current_step + 1} of ${steps.length}: ${steps[r.current_step] ?? ''}`}
        className="request-card-progress-track"
      >
        <div className="request-card-progress-fill"
          style={{ width: `${pct}%`, background: r.finished ? 'var(--green)' : 'var(--brand)' }} />
      </div>
      <p className="request-card-step-label">
        {steps[r.current_step] ?? ''} &mdash; step {r.current_step + 1}/{steps.length}
      </p>

      <div className="request-card-footer">
        <span style={{ color: late ? 'var(--danger-text)' : 'var(--text-soft)', fontWeight: late ? 700 : 500 }}>
          {r.finished
            ? `Delivered ${day(r.delivered_at ?? r.due_at)}`
            : !r.due_at ? 'No date yet'
            : `${late ? 'Was expected' : 'Expected by'} ${day(r.due_at)}`}
        </span>
      </div>
    </li>
  );
}
