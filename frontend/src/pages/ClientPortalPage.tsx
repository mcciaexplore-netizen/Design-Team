import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle, CalendarClock, Check, CheckCircle2, ChevronDown, ChevronUp, Clock, Download, Eye, FileText, Hourglass,
  Megaphone, Plus, RotateCcw, Search, SlidersHorizontal, Ticket as TicketIcon, X,
} from 'lucide-react';
import { DONE_STATUSES, type Ticket } from '../types';
import { apiJson, downloadFile, fetchBlobUrl } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useTickets } from '../contexts/TicketsContext';
import ProofApprovalPanel from '../components/ProofApprovalPanel';
import { useNewRequest } from '../contexts/NewRequestContext';
import { prefillFromTicket } from '../requestForm';

/* The client's dashboard: what needs them first, then work in progress, then finished designs to download. */

interface Overview {
  latest_proof: { id: number; version: number; file_name: string; content_type: string | null } | null;
  review: { id: number; expires_at: string } | null;
  delivered_at: string | null;
}

const DONE = DONE_STATUSES;
const STEPS = ['Received', 'Assigned', 'In progress', 'In review', 'Delivered'];
const STEP_OF: Record<string, number> = {
  'New': 0, 'Assigned': 1, 'In Progress': 2, 'Waiting on Requester': 2, 'In Review': 3,
  'Delivered': 4, 'Closed': 4, 'Closed without approval': 4, 'Revision Requested': 2,
};
const DAY = 86_400_000;

const niceDate = (d: Date) => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

/** What is happening with a request right now, in one plain sentence. */
function nowLine(t: Ticket): string {
  const who = t.assignee || 'A designer';
  switch (t.status) {
    case 'Pending Review': return 'Received. The design team is reviewing your request.';
    case 'Declined': return t.decline_reason ? `This request was declined: ${t.decline_reason}` : 'This request was declined.';
    case 'New': return 'Received. A designer will pick it up soon.';
    case 'Assigned': return `${who} will start on it soon.`;
    case 'In Progress': return `${who} is working on it.`;
    case 'Waiting on Requester': return 'The design team needs information from you. They will contact you by email.';
    case 'In Review': return 'The design is ready for your review.';
    case 'Delivered': return 'Delivered.';
    case 'Revision Requested': return 'You asked for changes: the work continues in a new version.';
    default: return 'Completed.';
  }
}

/** "Expected Tue 20 Oct · in 3 days", or a warning once the date has passed. */
function expectedLine(due: string): { text: string; tone: string } {
  if (!due) return { text: 'Delivery date to be confirmed', tone: '#525252' };
  const d = new Date(due);
  const days = Math.ceil((d.getTime() - Date.now()) / DAY);
  if (days < 0) return { text: `Was expected ${niceDate(d)}`, tone: '#B91C1C' };
  if (days === 0) return { text: `Expected today, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`, tone: '#B45309' };
  if (days === 1) return { text: `Expected tomorrow, ${niceDate(d)}`, tone: '#B45309' };
  return { text: `Expected ${niceDate(d)} · in ${days} days`, tone: '#334155' };
}

/** "Closes in 1 day 4 h" for an open review. */
function closesIn(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Review has closed';
  const h = Math.floor(ms / 3_600_000);
  return h >= 24 ? `Closes in ${Math.floor(h / 24)} day${h >= 48 ? 's' : ''} ${h % 24} h` : h >= 1 ? `Closes in ${h} h` : 'Closes in under an hour';
}

/** The newest design as a picture when it is an image, otherwise a file tile. Loaded with the sign-in token. */
function Thumb({ proof, height = 120 }: { proof: Overview['latest_proof']; height?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = !!proof?.content_type?.startsWith('image/');
  useEffect(() => {
    if (!proof || !isImage) return;
    let live = true, made: string | null = null;
    fetchBlobUrl(`/api/proofs/${proof.id}/file`).then(u => { made = u; if (live) setUrl(u); else URL.revokeObjectURL(u); }).catch(() => {});
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [proof, isImage]);
  const box = { height, borderRadius: 10, background: '#F1F5F9', border: '1px solid #E2E8F0', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' } as const;
  if (!proof) return <div style={box} aria-hidden="true"><Hourglass size={22} style={{ color: '#737373' }} /></div>;
  if (isImage && url) return <div style={box}><img src={url} alt={`Version ${proof.version}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>;
  return (
    <div style={{ ...box, flexDirection: 'column', gap: 4 }}>
      <FileText size={24} aria-hidden="true" style={{ color: '#525252' }} />
      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#525252', textTransform: 'uppercase' }}>{proof.file_name.split('.').pop()}</span>
    </div>
  );
}

function Progress({ status }: { status: string }) {
  const current = STEP_OF[status] ?? 0;
  return (
    <ol aria-label="Progress" style={{ listStyle: 'none', display: 'flex', gap: 4, margin: 0, padding: 0 }}>
      {STEPS.map((step, i) => (
        <li key={step} className="portal-step" aria-current={i === current ? 'step' : undefined} style={{ flex: 1, minWidth: 0 }}>
          <div style={{ height: 5, borderRadius: 99, background: i <= current ? '#0B1F3A' : '#E2E8F0' }} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 6, fontSize: '0.68rem', fontWeight: i === current ? 800 : 600, color: i <= current ? '#0B1F3A' : '#737373', whiteSpace: 'nowrap' }}>
            {i < current && <Check size={10} aria-hidden="true" style={{ color: '#047857', flexShrink: 0 }} />}
            <span className="portal-step-text" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{step}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Tile({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: string | number; hint?: string; tone: string }) {
  return (
    <div className="glass-card" style={{ padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#525252' }}>
        <span aria-hidden="true" style={{ color: tone, display: 'inline-flex' }}>{icon}</span>{label}
      </span>
      <span style={{ fontSize: '1.6rem', fontWeight: 800, color: '#0B1F3A', lineHeight: 1.1, overflowWrap: 'anywhere' }}>{value}</span>
      {hint && <span style={{ fontSize: '0.76rem', color: '#525252', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hint}</span>}
    </div>
  );
}

const sectionTitle = { fontSize: '1.05rem', fontWeight: 800, color: '#0B1F3A', margin: '1.75rem 0 0.75rem', display: 'flex', alignItems: 'center', gap: 8 } as const;

const ClientPortalPage = ({ onNewRequest }: { onNewRequest?: () => void }) => {
  const { user } = useAuth();
  const { tickets, loading, error, refresh } = useTickets();
  const { openNewRequest } = useNewRequest();
  const [overview, setOverview] = useState<Record<string, Overview>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showAllDone, setShowAllDone] = useState(false);
  const [query, setQuery] = useState('');
  const [designType, setDesignType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Newest designs, open reviews and delivery dates for every request, in one call; refreshed with the list.
  const listKey = tickets.map(t => `${t.id}:${t.status}`).join(',');
  useEffect(() => {
    let live = true;
    apiJson<Record<string, Overview>>('/api/portal/overview').then(o => { if (live) setOverview(o); }).catch(() => {});
    return () => { live = false; };
  }, [listKey]);

  const designTypes = useMemo(() => [...new Set(tickets.map(t => t.design_type).filter((d): d is string => !!d))].sort(), [tickets]);
  const q = query.trim().toLowerCase();
  const day = (iso: string | undefined) => (iso ? iso.slice(0, 10) : '');
  const matches = (t: Ticket) => {
    if (designType && t.design_type !== designType) return false;
    const created = day(t.created_at);
    if (from && (!created || created < from)) return false;
    if (to && (!created || created > to)) return false;
    return !q || `${t.number} ${t.title} ${t.tags.join(' ')} ${t.description ?? ''}`.toLowerCase().includes(q);
  };
  const advanced = [designType, from, to].filter(Boolean).length;
  const hasFilters = !!q || advanced > 0;
  const clearFilters = () => { setQuery(''); setDesignType(''); setFrom(''); setTo(''); };

  const needsYou = tickets.filter(t => (t.status === 'In Review' || t.status === 'Waiting on Requester') && matches(t))
    .sort((a, b) => (overview[a.id]?.review?.expires_at ?? '9').localeCompare(overview[b.id]?.review?.expires_at ?? '9'));
  const inProgress = tickets.filter(t => !DONE.includes(t.status) && t.status !== 'In Review' && t.status !== 'Waiting on Requester' && matches(t))
    .sort((a, b) => (a.due_at || '9').localeCompare(b.due_at || '9'));
  const finished = tickets.filter(t => DONE.includes(t.status) && t.status !== 'Revision Requested' && matches(t))
    .sort((a, b) => (overview[b.id]?.delivered_at ?? b.created_at ?? '').localeCompare(overview[a.id]?.delivered_at ?? a.created_at ?? ''));

  // Summary numbers are about everything, not just what the search shows.
  const stats = useMemo(() => {
    const waitingOnYou = (t: Ticket) => t.status === 'In Review' || t.status === 'Waiting on Requester';
    const open = tickets.filter(t => !DONE.includes(t.status));
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const deliveredThisMonth = Object.values(overview).filter(o => o.delivered_at && new Date(o.delivered_at) >= monthStart).length;
    const upcoming = open.filter(t => t.due_at && new Date(t.due_at).getTime() > Date.now()).sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
    return {
      open: open.filter(t => !waitingOnYou(t)).length,   // the ones waiting on the client are counted separately
      waiting: open.filter(waitingOnYou).length,
      deliveredThisMonth,
      next: upcoming ? { date: niceDate(new Date(upcoming.due_at)), title: upcoming.title } : null,
    };
  }, [tickets, overview]);

  const firstName = user?.name?.split(' ')[0] ?? '';
  const toggle = (id: string) => setOpenId(v => (v === id ? null : id));
  const doneShown = showAllDone ? finished : finished.slice(0, 8);

  return (
    <div style={{ padding: '0.5rem 0 3rem' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        {/* Greeting and the one primary action */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          <div>
            <h1 style={{ fontSize: 'clamp(1.4rem,3vw,1.9rem)', fontFamily: 'var(--font-body)', fontWeight: 800, color: '#0B1F3A', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              {firstName ? `Hi ${firstName}` : 'Your design requests'}
            </h1>
            <p style={{ fontSize: '0.9rem', color: '#525252', marginTop: 6 }}>
              {stats.waiting > 0 ? `${stats.waiting} request${stats.waiting === 1 ? ' needs' : 's need'} you.` : 'Nothing needs you right now.'}{' '}
              {stats.open > 0 ? `${stats.open} in progress.` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link to="/campaigns" className="btn-ghost" style={{ fontSize: '0.86rem', padding: '0.6rem 1.1rem', gap: 6, textDecoration: 'none' }}>
              <Megaphone size={15} aria-hidden="true" /> Campaigns &amp; posts
            </Link>
            <button type="button" className="btn-primary" style={{ fontSize: '0.86rem', padding: '0.6rem 1.1rem', gap: 6 }} onClick={onNewRequest}>
              <Plus size={15} aria-hidden="true" /> New request
            </button>
          </div>
        </div>

        {/* Summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          <Tile icon={<Clock size={14} />} label="In progress" value={stats.open} tone="#1E3A5F" />
          <Tile icon={<AlertCircle size={14} />} label="Waiting for you" value={stats.waiting} tone={stats.waiting ? '#B45309' : '#525252'} />
          <Tile icon={<CheckCircle2 size={14} />} label="Delivered this month" value={stats.deliveredThisMonth} tone="#047857" />
          <Tile icon={<CalendarClock size={14} />} label="Next delivery" value={stats.next?.date ?? '—'} hint={stats.next?.title} tone="#0B1F3A" />
        </div>

        {/* Search and filters apply to every section below */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: '1.25rem' }}>
          <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 180 }}>
            <Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#737373' }} />
            <input className="input-field" aria-label="Search requests" placeholder="Search your requests" value={query} onChange={e => setQuery(e.target.value)} style={{ width: '100%', paddingLeft: '2.2rem' }} />
          </div>
          <button type="button" className="btn-ghost" aria-expanded={showFilters} aria-controls="portal-filters" onClick={() => setShowFilters(v => !v)} style={{ gap: 6 }}>
            <SlidersHorizontal size={14} aria-hidden="true" /> Filters{advanced > 0 && <span style={{ background: '#0B1F3A', color: 'white', borderRadius: 99, fontSize: '0.66rem', fontWeight: 800, padding: '0 6px' }}>{advanced}</span>}
          </button>
          {hasFilters && (
            <button type="button" className="chip" onClick={clearFilters} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><X size={12} aria-hidden="true" /> Clear</button>
          )}
        </div>
        {showFilters && (
          <div id="portal-filters" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, padding: '0.9rem', background: 'white', border: '1px solid rgba(226,232,240,0.9)', borderRadius: 12, marginTop: 10 }}>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#525252' }}>Design type
              <select className="input-field" value={designType} onChange={e => setDesignType(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }}>
                <option value="">All design types</option>
                {designTypes.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#525252' }}>Requested from
              <input className="input-field" type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }} />
            </label>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#525252' }}>Requested to
              <input className="input-field" type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }} />
            </label>
          </div>
        )}

        {error && <p role="alert" style={{ color: '#B91C1C', fontSize: '0.85rem', marginTop: 12 }}>{error} <button type="button" className="chip" onClick={() => void refresh()}>Retry</button></p>}
        {loading && tickets.length === 0 && <p role="status" style={{ color: '#525252', marginTop: 12 }}>Loading your requests…</p>}

        {/* 1. Needs your action */}
        {needsYou.length > 0 && (
          <section aria-labelledby="needs-you-h">
            <h2 id="needs-you-h" style={sectionTitle}><AlertCircle size={18} aria-hidden="true" style={{ color: '#B45309' }} /> Needs your action</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {needsYou.map(t => {
                const o = overview[t.id];
                const reviewing = t.status === 'In Review';
                const open = openId === t.id;
                return (
                  <article key={t.id} aria-label={`${t.number} ${t.title}`} className="glass-card" style={{ padding: 0, overflow: 'hidden', borderLeft: '4px solid #B45309' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 150px) 1fr', gap: '1rem', padding: '1rem 1.1rem', alignItems: 'center' }} className="portal-action">
                      <Thumb proof={o?.latest_proof ?? null} height={110} />
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#525252', fontWeight: 700 }}>{t.number}{t.design_type ? ` · ${t.design_type}` : ''}</p>
                        <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0B1F3A', margin: '2px 0 4px', overflowWrap: 'anywhere' }}>{t.title}</h3>
                        <p style={{ fontSize: '0.88rem', color: '#334155' }}>{nowLine(t)}</p>
                        {reviewing && o?.review && (
                          <p style={{ fontSize: '0.82rem', fontWeight: 800, color: '#B45309', marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Clock size={13} aria-hidden="true" /> {closesIn(o.review.expires_at)}: after that the design is treated as accepted
                          </p>
                        )}
                        {reviewing && (
                          <button type="button" className="btn-primary" aria-expanded={open} onClick={() => toggle(t.id)} style={{ marginTop: 10, gap: 6 }}>
                            <Eye size={14} aria-hidden="true" /> {open ? 'Hide design' : 'Review & approve'}
                          </button>
                        )}
                      </div>
                    </div>
                    {open && (
                      <div style={{ padding: '1.1rem', background: '#FAFAFA', borderTop: '1px solid rgba(226,232,240,0.85)' }}>
                        <ProofApprovalPanel ticket={t} />
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {/* 2. In progress */}
        <section aria-labelledby="progress-h">
          <h2 id="progress-h" style={sectionTitle}><Clock size={18} aria-hidden="true" style={{ color: '#1E3A5F' }} /> In progress</h2>
          {inProgress.length === 0 ? (
            <div className="glass-card" style={{ textAlign: 'center', padding: '2rem 1.5rem', border: '2px dashed rgba(226,232,240,0.85)' }}>
              <TicketIcon size={22} aria-hidden="true" style={{ color: '#0B1F3A', margin: '0 auto 8px' }} />
              <p style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0B1F3A' }}>
                {hasFilters ? 'No requests in progress match your search' : tickets.length === 0 ? 'Make your first request' : 'Nothing in progress right now'}
              </p>
              {!hasFilters && (
                <button type="button" className="btn-primary" onClick={onNewRequest} style={{ marginTop: 12, gap: 6 }}><Plus size={14} aria-hidden="true" /> New request</button>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {inProgress.map(t => {
                const o = overview[t.id];
                const open = openId === t.id;
                const expected = expectedLine(t.due_at);
                const next = t.status === 'Revision Requested' ? tickets.find(x => x.parent_id === t.id) : undefined;
                return (
                  <article key={t.id} aria-label={`${t.number} ${t.title}`} className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: o?.latest_proof ? 'minmax(0, 110px) 1fr' : '1fr', gap: '1rem', padding: '1rem 1.1rem', alignItems: 'center' }} className="portal-action">
                      {o?.latest_proof && <Thumb proof={o.latest_proof} height={84} />}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                          <p style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#525252', fontWeight: 700 }}>{t.number}{t.design_type ? ` · ${t.design_type}` : ''}</p>
                          <p style={{ fontSize: '0.8rem', fontWeight: 700, color: expected.tone }}>{expected.text}</p>
                        </div>
                        <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#0B1F3A', margin: '2px 0 4px', overflowWrap: 'anywhere' }}>
                          <Link to={`/tickets/${t.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{t.title}</Link>
                        </h3>
                        <p style={{ fontSize: '0.86rem', color: '#334155', marginBottom: 10 }}>{nowLine(t)}</p>
                        <Progress status={t.status} />
                        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                          {next && <Link to={`/tickets/${next.id}`} className="btn-primary" style={{ gap: 6, textDecoration: 'none' }}>Open {next.number}</Link>}
                          {o?.latest_proof && (
                            <button type="button" className="chip" aria-expanded={open} onClick={() => toggle(t.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              {open ? <>Hide designs <ChevronUp size={12} aria-hidden="true" /></> : <>See designs <ChevronDown size={12} aria-hidden="true" /></>}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    {open && (
                      <div style={{ padding: '1.1rem', background: '#FAFAFA', borderTop: '1px solid rgba(226,232,240,0.85)' }}>
                        <ProofApprovalPanel ticket={t} />
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* 3. Finished designs */}
        <section aria-labelledby="finished-h">
          <h2 id="finished-h" style={sectionTitle}><CheckCircle2 size={18} aria-hidden="true" style={{ color: '#047857' }} /> Finished designs</h2>
          {finished.length === 0 ? (
            <p style={{ fontSize: '0.88rem', color: '#525252' }}>{hasFilters ? 'No finished designs match your search.' : 'Delivered designs will appear here, ready to download.'}</p>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
                {doneShown.map(t => {
                  const o = overview[t.id];
                  const delivered = o?.delivered_at ? niceDate(new Date(o.delivered_at)) : null;
                  return (
                    <article key={t.id} aria-label={`${t.number} ${t.title}`} className="glass-card" style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                      <Thumb proof={o?.latest_proof ?? null} height={130} />
                      <div style={{ minWidth: 0 }}>
                        <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#0B1F3A', overflowWrap: 'anywhere', lineHeight: 1.3 }}>
                          <Link to={`/tickets/${t.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{t.title}</Link>
                        </h3>
                        <p style={{ fontSize: '0.74rem', color: '#525252', marginTop: 2 }}>{t.number}{delivered ? ` · Delivered ${delivered}` : ''}</p>
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 'auto', flexWrap: 'wrap' }}>
                        <button type="button" className="btn-primary" style={{ gap: 5, fontSize: '0.78rem', padding: '0.4rem 0.7rem' }}
                          aria-label={`Download all assets for ${t.title}`}
                          onClick={() => void downloadFile(`/api/tickets/${t.id}/download-bundle`, `${t.number}_all_assets.zip`).catch(() => {})}>
                          <Download size={13} aria-hidden="true" /> Download All (.zip)
                        </button>
                        {o?.latest_proof && (
                          <button type="button" className="btn-ghost" style={{ gap: 5, fontSize: '0.78rem', padding: '0.4rem 0.7rem' }}
                            aria-label={`Download ${t.title} preview only`}
                            onClick={() => void downloadFile(`/api/proofs/${o.latest_proof!.id}/file`, o.latest_proof!.file_name).catch(() => {})}>
                            Preview
                          </button>
                        )}
                        <button type="button" className="btn-ghost" aria-label={`Request again: ${t.title}`} onClick={() => openNewRequest(prefillFromTicket(t))}
                          style={{ gap: 5, fontSize: '0.78rem', padding: '0.4rem 0.7rem' }}>
                          <RotateCcw size={12} aria-hidden="true" /> Request again
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
              {finished.length > 8 && (
                <button type="button" className="chip" onClick={() => setShowAllDone(v => !v)} style={{ marginTop: 12 }}>
                  {showAllDone ? 'Show fewer' : `Show all ${finished.length} finished designs`}
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default ClientPortalPage;
