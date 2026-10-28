import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown, GitBranch, Tag, CheckSquare, Square, Trash2 } from 'lucide-react';
import { STATUSES } from '../types';
import { apiJson } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useTickets } from '../contexts/TicketsContext';
import AnnotatePanel from '../components/AnnotatePanel';
import AttachmentsPanel from '../components/AttachmentsPanel';
import ClientChangesPanel from '../components/ClientChangesPanel';
import { personLabeller } from '../people';
import FigmaEmbed from '../components/FigmaEmbed';
import ProofApprovalPanel from '../components/ProofApprovalPanel';
import CdrPanel from '../components/CdrPanel';
import TimeTracker from '../components/TimeTracker';

type TabKey = 'overview' | 'figma' | 'proofs' | 'source' | 'annotate';

const TicketDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tickets, staff, loading, updateTicket, toggleSubtask, refresh } = useTickets();
  const ticket = tickets.find(t => t.id === id);
  const isLead = user?.role === 'Design Lead';
  const label = useMemo(() => personLabeller(staff), [staff]);

  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [error, setError] = useState<string | null>(null);
  const [figmaInput, setFigmaInput] = useState('');
  const [figmaCheck, setFigmaCheck] = useState<{ valid: boolean; name?: string; detail?: string } | null>(null);

  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [revisionCategory, setRevisionCategory] = useState('Scope Change');
  const [revisionReason, setRevisionReason] = useState('');
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);

  useEffect(() => { setFigmaInput(ticket?.figma_url ?? ''); setFigmaCheck(null); setError(null); }, [ticket?.id, ticket?.figma_url]);

  // Every version of this request (DF-0005, DF-0005-V2, DF-0005-V3…). Each one's parent is the version before it,
  // so they are grouped by the shared ticket number rather than by parent.
  const related = useMemo(() => {
    if (!ticket) return [];
    const base = baseNumber(ticket.number);
    return tickets
      .filter(t => baseNumber(t.number) === base)
      .sort((a, b) => (a.version_number ?? 1) - (b.version_number ?? 1));
  }, [tickets, ticket]);

  if (!ticket) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }} role={loading ? 'status' : undefined}>
        <p style={{ fontSize: '1rem', color: '#737373' }}>
          {loading ? 'Loading ticket…' : <>Ticket not found. <Link to="/" style={{ color: '#003F8A', fontWeight: 700 }}>← Back</Link></>}
        </p>
      </div>
    );
  }

  const run = async (op: () => Promise<void>, fallback: string) => {
    setError(null);
    try { await op(); } catch (e) { setError(e instanceof Error ? e.message : fallback); }
  };

  const statusOptions = STATUSES.includes(ticket.status) ? STATUSES : [...STATUSES, ticket.status];
  const cutoff = changeCutoff(ticket);
  const revisionsLocked = cutoff !== null && Date.now() >= cutoff;
  const canRequestChanges = (ticket.status === 'In Review' || ticket.status === 'Delivered') && !ticket.is_locked;
  const done = ticket.subtasks.filter(s => s.is_completed).length;

  const TABS: { key: TabKey; label: string; hidden?: boolean }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'proofs',   label: 'Proofs & approval' },
    { key: 'source',   label: 'Source files' },
    { key: 'figma',    label: 'Figma' },
    { key: 'annotate', label: 'Annotate' },
  ];

  const checkFigma = async () => {
    if (!figmaInput.trim()) { setFigmaCheck({ valid: false, detail: 'Paste a Figma link first.' }); return; }
    try {
      const r = await apiJson<{ valid: boolean; name?: string; detail?: string }>(`/api/figma/preview?url=${encodeURIComponent(figmaInput.trim())}`);
      setFigmaCheck(r);
    } catch (e) { setFigmaCheck({ valid: false, detail: e instanceof Error ? e.message : 'Could not check the link.' }); }
  };

  const saveFigma = () => run(async () => {
    await updateTicket(ticket.id, { figma_url: figmaInput.trim() });
    setFigmaCheck(null);
  }, 'Could not save the Figma link.');

  const submitRevision = async () => {
    setRevisionBusy(true); setRevisionError(null);
    try {
      const child = await apiJson<{ id: number }>(`/api/tickets/${ticket.id}/revisions`, {
        method: 'POST', json: { reason_for_change: `[${revisionCategory}] ${revisionReason.trim()}` },
      });
      await refresh();
      setShowRevisionModal(false); setRevisionReason('');
      navigate(`/tickets/${child.id}`);
    } catch (e) { setRevisionError(e instanceof Error ? e.message : 'Could not request changes.'); }
    finally { setRevisionBusy(false); }
  };

  return (
    <div style={{ padding: '0 0 3rem', height: '100%', overflowY: 'auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', fontWeight: 700, color: '#737373', textDecoration: 'none', marginBottom: '0.75rem' }}>
          <ArrowLeft size={14} /> Back to Visual Board
        </Link>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <p style={{ fontSize: '0.68rem', fontFamily: 'monospace', color: '#64748b', fontWeight: 700, marginBottom: 4 }}>
              {ticket.number}{ticket.client_org ? ` · ${ticket.client_org}` : ''}{ticket.design_type ? ` · ${ticket.design_type}` : ''}
            </p>
            <h1 style={{ fontSize: 'clamp(1.3rem,3vw,1.8rem)', fontFamily: 'var(--font-body)', fontWeight: 800, color: '#003F8A', letterSpacing: '-0.02em', lineHeight: 1.2 }}>{ticket.title}</h1>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span className="badge-blue">{ticket.status}</span>
          </div>
        </div>
      </div>

      {error && <p role="alert" style={{ fontSize: '0.8rem', color: '#b91c1c', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '0.5rem 0.75rem', marginBottom: '1rem' }}>{error}</p>}

      <VersionBanner ticket={ticket} versions={related} />

      <div className="ticket-layout" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: '1.5rem', alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <div role="tablist" aria-label="Ticket sections" style={{ display: 'flex', gap: 0, background: '#F8FAFC', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 'var(--radius-md)', padding: 4, marginBottom: '1.25rem', overflowX: 'auto' }}>
            {TABS.filter(t => !t.hidden).map(tab => (
              <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key} onClick={() => setActiveTab(tab.key)}
                style={{ flex: 1, whiteSpace: 'nowrap', padding: '0.45rem 0.75rem', borderRadius: 8, border: 'none', cursor: 'pointer',
                         background: activeTab === tab.key ? 'white' : 'transparent', boxShadow: activeTab === tab.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                         color: activeTab === tab.key ? '#003F8A' : '#737373', fontSize: '0.78rem', fontWeight: 700 }}>
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="glass-card" style={{ padding: '1.25rem' }}>
                <h3 className="section-label" style={{ marginBottom: 8 }}>Brief</h3>
                <p style={{ fontSize: '0.85rem', color: '#525252', lineHeight: 1.7, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{ticket.description || 'No brief provided.'}</p>
                {ticket.type_specific_fields && Object.keys(ticket.type_specific_fields).length > 0 && (
                  <dl style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'minmax(110px,auto) 1fr', gap: '6px 14px', fontSize: '0.8rem' }}>
                    {detailRows(ticket.type_specific_fields).map(([k, v]) => (
                      <React.Fragment key={k}>
                        <dt style={{ color: '#64748b', fontWeight: 700, textTransform: 'capitalize' }}>{k}</dt>
                        <dd style={{ margin: 0, color: '#003F8A', overflowWrap: 'anywhere' }}>{v}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                )}
              </div>
              <ClientChangesPanel ticket={ticket} />
              <AttachmentsPanel ticketId={ticket.id} />
            </div>
          )}

          {activeTab === 'proofs' && <ProofApprovalPanel ticket={ticket} />}

          {activeTab === 'source' && <CdrPanel ticket={ticket} />}

          {activeTab === 'figma' && (
            <div className="glass-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <label htmlFor="figma-url" className="section-label" style={{ width: '100%' }}>Figma link</label>
                <input id="figma-url" type="url" className="input-field" placeholder="https://www.figma.com/design/…" value={figmaInput}
                  onChange={e => { setFigmaInput(e.target.value); setFigmaCheck(null); }} style={{ flex: 1, minWidth: 220 }} />
                <button type="button" className="btn-ghost" onClick={() => void checkFigma()}>Check link</button>
                <button type="button" className="btn-primary" onClick={() => void saveFigma()} disabled={figmaInput.trim() === (ticket.figma_url ?? '')}>Save</button>
              </div>
              {figmaCheck && (
                <p role="status" style={{ fontSize: '0.78rem', color: figmaCheck.valid ? '#059669' : '#b91c1c' }}>
                  {figmaCheck.valid ? `Looks good: “${figmaCheck.name}”.` : figmaCheck.detail}
                </p>
              )}
              <div style={{ minHeight: 300 }}><FigmaEmbed url={ticket.figma_url ?? ''} /></div>
            </div>
          )}

          {activeTab === 'annotate' && <AnnotatePanel ticketId={ticket.id} />}
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0 }}>
          {canRequestChanges && (
            <button type="button" className="btn-primary" disabled={revisionsLocked}
              title={revisionsLocked ? 'Changes stop 12 hours before the event. Contact the design team.' : undefined}
              style={{ width: '100%', justifyContent: 'center', background: revisionsLocked ? '#FCA5A5' : '#EF4444', borderColor: revisionsLocked ? '#FCA5A5' : '#DC2626' }}
              onClick={() => setShowRevisionModal(true)}>
              Request changes {revisionsLocked ? '(locked)' : ''}
            </button>
          )}
          {canRequestChanges && cutoff !== null && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-soft)', marginTop: -6 }}>
              {revisionsLocked ? 'Changes closed' : 'Changes allowed until'} {new Date(cutoff).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
            </p>
          )}

          <div className="glass-card" style={{ padding: '1rem' }}>
              <label htmlFor="d-status" className="section-label" style={{ marginBottom: 6, display: 'block' }}>Status</label>
              <div style={{ position: 'relative', marginBottom: 10 }}>
                <select id="d-status" value={ticket.status} onChange={e => void run(() => updateTicket(ticket.id, { status: e.target.value }), 'Could not change status.')} className="input-field" style={{ width: '100%', fontSize: '0.82rem' }}>
                  {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#737373', pointerEvents: 'none' }} />
              </div>
              {isLead && (
                <>
                  <label htmlFor="d-assignee" className="section-label" style={{ marginBottom: 6, display: 'block' }}>Assign to</label>
                  <select id="d-assignee" value={ticket.assignee_id ?? ''} className="input-field" style={{ width: '100%', fontSize: '0.82rem', marginBottom: 10 }}
                    onChange={e => void run(() => updateTicket(ticket.id, { assignee_id: e.target.value ? Number(e.target.value) : null }), 'Could not change who it is assigned to.')}>
                    <option value="">Unassigned</option>
                    {staff.map(p => <option key={p.id} value={p.id}>{label(p)}{p.role === 'Designer' ? '' : ` · ${p.role}`}</option>)}
                    {ticket.assignee_id && !staff.some(p => p.id === ticket.assignee_id) && <option value={ticket.assignee_id}>{ticket.assignee || 'Former team member'}</option>}
                  </select>
                  <button type="button" className="btn-ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 14, color: '#B91C1C', gap: 6 }}
                    onClick={() => {
                      if (!window.confirm(`Delete ${ticket.number}?

Its designs, files, approvals and history are deleted too. Other versions of this request stay. This can't be undone.`)) return;
                      void run(async () => { await apiJson(`/api/tickets/${ticket.id}`, { method: 'DELETE' }); await refresh(); navigate('/'); }, 'Could not delete the ticket.');
                    }}>
                    <Trash2 size={14} aria-hidden="true" /> Delete ticket
                  </button>
                </>
              )}
          </div>

          <div className="glass-card" style={{ padding: '1rem' }}>
            <h3 className="section-label" style={{ marginBottom: '0.75rem' }}>Details</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              {[
                { label: 'Assignee', value: ticket.assignee || 'Unassigned' },
                { label: 'Requested by', value: ticket.requester_name ?? '—' },
                { label: 'Due', value: ticket.due_at ? new Date(ticket.due_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—' },
                { label: 'Revisions', value: String(ticket.revision_count ?? 0) },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span className="section-label">{label}</span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#003F8A', textAlign: 'right', overflowWrap: 'anywhere' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          <TimeTracker ticket={ticket} />

          {ticket.tags?.length > 0 && (
            <div className="glass-card" style={{ padding: '1rem' }}>
              <h3 className="section-label" style={{ marginBottom: 8 }}>Tags</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{ticket.tags.map(t => <span key={t} className="chip">{t}</span>)}</div>
            </div>
          )}

          {ticket.subtasks?.length > 0 && (
            <div className="glass-card" style={{ padding: '1rem' }}>
              <h3 className="section-label" style={{ marginBottom: 8 }}>Subtasks ({done}/{ticket.subtasks.length})</h3>
              <div style={{ height: 4, background: 'rgba(226,232,240,0.7)', borderRadius: 99, marginBottom: 10, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(done / ticket.subtasks.length) * 100}%`, background: 'linear-gradient(90deg,#059669,#10B981)', borderRadius: 99, transition: 'width 0.3s' }} />
              </div>
              {ticket.subtasks.map(s => (
                <button key={s.id} type="button" role="checkbox" aria-checked={s.is_completed}
                  onClick={() => void run(() => toggleSubtask(ticket.id, s.id), 'Could not update the subtask.')}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '4px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '0.78rem', color: s.is_completed ? '#94a3b8' : '#003F8A', textDecoration: s.is_completed ? 'line-through' : 'none' }}>
                  {s.is_completed ? <CheckSquare size={14} style={{ color: '#059669', flexShrink: 0 }} /> : <Square size={14} style={{ color: '#737373', flexShrink: 0 }} />} {s.title}
                </button>
              ))}
            </div>
          )}

          {related.length > 1 && (
            <div className="glass-card" style={{ padding: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
                <GitBranch size={13} style={{ color: '#003F8A' }} />
                <h3 className="section-label">Revision history</h3>
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', fontWeight: 700, color: '#737373' }}>{related.length} versions</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {related.map(t => {
                  const current = t.id === ticket.id;
                  return (
                    <Link key={t.id} to={`/tickets/${t.id}`} aria-current={current ? 'page' : undefined} style={{ display: 'block', textDecoration: 'none', padding: '0.5rem 0.625rem', borderRadius: 8, background: current ? 'rgba(0,63,138,0.06)' : 'transparent', border: `1px solid ${current ? 'rgba(0,63,138,0.15)' : 'rgba(226,232,240,0.7)'}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: current ? '#003F8A' : '#003F8A' }}>V{t.version_number ?? 1}</span>
                        <span style={{ fontSize: '0.65rem', color: '#737373' }}>{t.status}</span>
                        {current && <span style={{ marginLeft: 'auto', fontSize: '0.58rem', fontWeight: 800, textTransform: 'uppercase', color: '#003F8A' }}>current</span>}
                      </div>
                      {t.reason_for_change && (
                        <p style={{ fontSize: '0.68rem', color: '#737373', lineHeight: 1.5, fontStyle: 'italic', marginTop: 3, display: 'flex', gap: 4 }}>
                          <Tag size={9} style={{ color: '#003F8A', flexShrink: 0, marginTop: 3 }} /> {t.reason_for_change}
                        </p>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </aside>
      </div>

      {showRevisionModal && (
        <div role="dialog" aria-modal="true" aria-label="Request changes" style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: 420, padding: '1.5rem', background: 'white' }}>
            <h2 style={{ fontSize: '1.15rem', marginBottom: '1rem', color: '#003F8A' }}>Request changes (V{(ticket.version_number ?? 1) + 1})</h2>
            <label htmlFor="rev-cat" className="section-label" style={{ display: 'block', marginBottom: 6 }}>Reason</label>
            <select id="rev-cat" className="input-field" value={revisionCategory} onChange={e => setRevisionCategory(e.target.value)} style={{ marginBottom: '1rem' }}>
              <option value="Scope Change">Scope change (requirements changed)</option>
              <option value="Missing Asset">Missing asset (files were missing)</option>
              <option value="Design Error">Design error (missed requirement)</option>
            </select>
            <label htmlFor="rev-reason" className="section-label" style={{ display: 'block', marginBottom: 6 }}>Details</label>
            <textarea id="rev-reason" className="input-field" rows={3} placeholder="Explain the changes needed…" value={revisionReason} onChange={e => setRevisionReason(e.target.value)} style={{ marginBottom: '1rem', resize: 'vertical' }} />
            {revisionError && <p role="alert" style={{ fontSize: '0.78rem', color: '#b91c1c', marginBottom: 10 }}>{revisionError}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="btn-ghost" onClick={() => { setShowRevisionModal(false); setRevisionError(null); }}>Cancel</button>
              <button type="button" className="btn-primary" disabled={revisionBusy || !revisionReason.trim()} onClick={() => void submitRevision()}>{revisionBusy ? 'Submitting…' : 'Submit revision'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TicketDetailPage;

/** "DF-0005" for DF-0005, DF-0005-V2, DF-0005-V3… */
const baseNumber = (n: string) => n.replace(/-V\d+$/, '');

/** Fields worth listing under the brief, as readable text: no empty values, no "[object Object]", dates in words.
 *  The requester's name, email, notes and links are already in the brief itself. */
const HIDDEN_FIELDS = new Set(['requester_name', 'requester_email', 'content', 'reference_links', 'details', 'client_changes']);
function detailRows(fields: Record<string, unknown>): [string, string][] {
  const show = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '';
    if (Array.isArray(v)) return v.map(show).filter(Boolean).join(', ');
    if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k.replace(/_/g, ' ')}: ${show(x)}`).join(' · ');
    const text = String(v);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : text;
  };
  return Object.entries(fields)
    .filter(([k]) => !HIDDEN_FIELDS.has(k))
    .map(([k, v]): [string, string] => [k.replace(/_/g, ' '), show(v)])
    .filter(([, v]) => v !== '');
}

type VersionTicket = { id: string; number: string; status: string; version_number?: number; reason_for_change?: string };

/** Says in plain words which version this is, what the client asked to change, and where to work. */
function VersionBanner({ ticket, versions }: { ticket: VersionTicket; versions: VersionTicket[] }) {
  const newest = versions[versions.length - 1];
  const version = ticket.version_number ?? 1;
  const box = { borderRadius: 10, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.85rem', lineHeight: 1.5 } as const;
  if (ticket.status === 'Revision Requested' && newest && newest.id !== ticket.id) {
    return (
      <div role="note" style={{ ...box, background: '#F1F5F9', border: '1px solid #CBD5E1', color: '#334155' }}>
        <strong>This version has been replaced.</strong> The client asked for changes, so the work continues on{' '}
        <Link to={`/tickets/${newest.id}`} style={{ fontWeight: 800, color: '#003F8A' }}>{newest.number}</Link>. Nothing more is needed here.
      </div>
    );
  }
  if (version > 1) {
    const previous = versions.find(v => (v.version_number ?? 1) === version - 1);
    return (
      <div role="note" style={{ ...box, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', color: '#78350F' }}>
        <p style={{ fontWeight: 800, color: '#92400E' }}>Version {version}: the client asked for changes</p>
        {ticket.reason_for_change && <p style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}><strong>What to change:</strong> {ticket.reason_for_change}</p>}
        {previous && (
          <p style={{ marginTop: 4, fontSize: '0.8rem' }}>
            The earlier design is on <Link to={`/tickets/${previous.id}`} style={{ fontWeight: 700, color: '#92400E' }}>{previous.number}</Link> (Proofs & approval tab).
          </p>
        )}
      </div>
    );
  }
  return null;
}

/** When change requests stop (ms), or null if they never do. Same rule as the server (common.change_cutoff): 12 hours
 *  before the event day starts (IST); without an event date, 12 hours before the deadline until the deadline passes. */
function changeCutoff(t: { type_specific_fields?: Record<string, unknown>; due_at?: string }): number | null {
  const event = t.type_specific_fields?.event_date;
  if (typeof event === 'string' && /^\d{4}-\d{2}-\d{2}/.test(event)) {
    return Date.parse(`${event.slice(0, 10)}T00:00:00+05:30`) - 12 * 3600_000;
  }
  const due = t.due_at ? Date.parse(t.due_at) : NaN;
  if (Number.isNaN(due) || Date.now() >= due) return null;
  return due - 12 * 3600_000;
}
