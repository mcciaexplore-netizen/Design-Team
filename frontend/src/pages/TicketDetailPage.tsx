import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown, GitBranch, Tag, CheckSquare, Square } from 'lucide-react';
import { STATUSES, PRIORITIES, PRIORITY_STYLE } from '../types';
import { apiJson } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useTickets } from '../contexts/TicketsContext';
import AuditTrail from '../components/AuditTrail';
import CommentsPanel from '../components/CommentsPanel';
import AnnotatePanel from '../components/AnnotatePanel';
import FigmaEmbed from '../components/FigmaEmbed';
import ProofApprovalPanel from '../components/ProofApprovalPanel';
import TimeTracker from '../components/TimeTracker';

type TabKey = 'overview' | 'figma' | 'proofs' | 'annotate';

const TicketDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tickets, loading, updateTicket, toggleSubtask, refresh } = useTickets();
  const ticket = tickets.find(t => t.id === id);
  const isClient = user?.role === 'Client';
  const isLead = user?.role === 'Design Lead';

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

  const related = useMemo(() => {
    if (!ticket) return [];
    const rootId = ticket.parent_id ?? ticket.id;
    return tickets
      .filter(t => t.id === rootId || t.parent_id === rootId)
      .sort((a, b) => (a.version_number ?? 1) - (b.version_number ?? 1));
  }, [tickets, ticket]);

  if (!ticket) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }} role={loading ? 'status' : undefined}>
        <p style={{ fontSize: '1rem', color: '#64748B' }}>
          {loading ? 'Loading ticket…' : <>Ticket not found. <Link to={isClient ? '/client-portal' : '/'} style={{ color: '#18181b', fontWeight: 700 }}>← Back</Link></>}
        </p>
      </div>
    );
  }

  const run = async (op: () => Promise<void>, fallback: string) => {
    setError(null);
    try { await op(); } catch (e) { setError(e instanceof Error ? e.message : fallback); }
  };

  const ps = PRIORITY_STYLE[ticket.priority] ?? {};
  const statusOptions = STATUSES.includes(ticket.status) ? STATUSES : [...STATUSES, ticket.status];
  const dueMs = ticket.due_at ? new Date(ticket.due_at).getTime() : NaN;
  const revisionsLocked = !Number.isNaN(dueMs) && dueMs - Date.now() < 24 * 3600 * 1000 && ticket.status !== 'Delivered';
  const canRequestChanges = (ticket.status === 'In Review' || ticket.status === 'Delivered') && !ticket.is_locked;
  const done = ticket.subtasks.filter(s => s.is_completed).length;

  const TABS: { key: TabKey; label: string; hidden?: boolean }[] = [
    { key: 'overview', label: 'Overview & activity' },
    { key: 'proofs',   label: 'Proofs & approval' },
    { key: 'figma',    label: 'Figma' },
    { key: 'annotate', label: 'Annotate', hidden: isClient },
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
        <Link to={isClient ? '/client-portal' : '/'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', fontWeight: 700, color: '#64748B', textDecoration: 'none', marginBottom: '0.75rem' }}>
          <ArrowLeft size={14} /> {isClient ? 'Back to my requests' : 'Back to board'}
        </Link>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <p style={{ fontSize: '0.68rem', fontFamily: 'monospace', color: '#64748b', fontWeight: 700, marginBottom: 4 }}>
              {ticket.number}{ticket.client_org ? ` · ${ticket.client_org}` : ''}{ticket.design_type ? ` · ${ticket.design_type}` : ''}
            </p>
            <h1 style={{ fontSize: 'clamp(1.3rem,3vw,1.8rem)', fontFamily: 'var(--font-body)', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1.2 }}>{ticket.title}</h1>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span className="badge-blue" style={ps}>{ticket.priority}</span>
            <span className="badge-blue">{ticket.status}</span>
          </div>
        </div>
      </div>

      {error && <p role="alert" style={{ fontSize: '0.8rem', color: '#b91c1c', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '0.5rem 0.75rem', marginBottom: '1rem' }}>{error}</p>}

      <div className="ticket-layout" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: '1.5rem', alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <div role="tablist" aria-label="Ticket sections" style={{ display: 'flex', gap: 0, background: '#F8FAFC', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 'var(--radius-md)', padding: 4, marginBottom: '1.25rem', overflowX: 'auto' }}>
            {TABS.filter(t => !t.hidden).map(tab => (
              <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key} onClick={() => setActiveTab(tab.key)}
                style={{ flex: 1, whiteSpace: 'nowrap', padding: '0.45rem 0.75rem', borderRadius: 8, border: 'none', cursor: 'pointer',
                         background: activeTab === tab.key ? 'white' : 'transparent', boxShadow: activeTab === tab.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                         color: activeTab === tab.key ? '#18181b' : '#64748B', fontSize: '0.78rem', fontWeight: 700 }}>
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="glass-card" style={{ padding: '1.25rem' }}>
                <h3 className="section-label" style={{ marginBottom: 8 }}>Brief</h3>
                <p style={{ fontSize: '0.85rem', color: '#475569', lineHeight: 1.7, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{ticket.description || 'No brief provided.'}</p>
                {ticket.type_specific_fields && Object.keys(ticket.type_specific_fields).length > 0 && (
                  <dl style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'minmax(110px,auto) 1fr', gap: '6px 14px', fontSize: '0.8rem' }}>
                    {Object.entries(ticket.type_specific_fields).map(([k, v]) => (
                      <React.Fragment key={k}>
                        <dt style={{ color: '#64748b', fontWeight: 700, textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</dt>
                        <dd style={{ margin: 0, color: '#0F172A', overflowWrap: 'anywhere' }}>{String(v)}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                )}
              </div>
              <div className="glass-card" style={{ padding: '1.25rem' }}><CommentsPanel ticketId={ticket.id} /></div>
              <AuditTrail ticketId={ticket.id} />
            </div>
          )}

          {activeTab === 'proofs' && <ProofApprovalPanel ticket={ticket} />}

          {activeTab === 'figma' && (
            <div className="glass-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {!isClient && (
                <>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <label htmlFor="figma-url" className="section-label" style={{ width: '100%' }}>Figma link</label>
                    <input id="figma-url" type="url" className="input-field" placeholder="https://www.figma.com/design/…" value={figmaInput}
                      onChange={e => { setFigmaInput(e.target.value); setFigmaCheck(null); }} style={{ flex: 1, minWidth: 220 }} />
                    <button type="button" className="btn-ghost" onClick={() => void checkFigma()}>Check link</button>
                    <button type="button" className="btn-primary" onClick={() => void saveFigma()} disabled={figmaInput.trim() === (ticket.figma_url ?? '')}>Save</button>
                  </div>
                  {figmaCheck && (
                    <p role="status" style={{ fontSize: '0.78rem', color: figmaCheck.valid ? '#047857' : '#b91c1c' }}>
                      {figmaCheck.valid ? `Looks good: “${figmaCheck.name}”.` : figmaCheck.detail}
                    </p>
                  )}
                </>
              )}
              <div style={{ minHeight: 300 }}><FigmaEmbed url={ticket.figma_url ?? ''} /></div>
            </div>
          )}

          {activeTab === 'annotate' && !isClient && <AnnotatePanel ticketId={ticket.id} />}
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0 }}>
          {canRequestChanges && (
            <button type="button" className="btn-primary" disabled={revisionsLocked}
              title={revisionsLocked ? 'Revisions are locked within 24 hours of the deadline. Contact the design lead.' : undefined}
              style={{ width: '100%', justifyContent: 'center', background: revisionsLocked ? '#FCA5A5' : '#EF4444', borderColor: revisionsLocked ? '#FCA5A5' : '#DC2626' }}
              onClick={() => setShowRevisionModal(true)}>
              Request changes {revisionsLocked ? '(locked)' : ''}
            </button>
          )}

          {!isClient && (
            <div className="glass-card" style={{ padding: '1rem' }}>
              <label htmlFor="d-status" className="section-label" style={{ marginBottom: 6, display: 'block' }}>Status</label>
              <div style={{ position: 'relative', marginBottom: 10 }}>
                <select id="d-status" value={ticket.status} onChange={e => void run(() => updateTicket(ticket.id, { status: e.target.value }), 'Could not change status.')} className="input-field" style={{ width: '100%', fontSize: '0.82rem' }}>
                  {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none' }} />
              </div>
              {isLead && (
                <>
                  <label htmlFor="d-prio" className="section-label" style={{ marginBottom: 6, display: 'block' }}>Priority</label>
                  <select id="d-prio" value={ticket.priority} onChange={e => void run(() => updateTicket(ticket.id, { priority: e.target.value }), 'Could not change priority.')} className="input-field" style={{ width: '100%', fontSize: '0.82rem' }}>
                    {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </>
              )}
            </div>
          )}

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
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0F172A', textAlign: 'right', overflowWrap: 'anywhere' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {!isClient && <TimeTracker ticket={ticket} />}

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
                <button key={s.id} type="button" role="checkbox" aria-checked={s.is_completed} disabled={isClient}
                  onClick={() => void run(() => toggleSubtask(ticket.id, s.id), 'Could not update the subtask.')}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '4px 0', background: 'none', border: 'none', cursor: isClient ? 'default' : 'pointer', textAlign: 'left', fontSize: '0.78rem', color: s.is_completed ? '#94a3b8' : '#0F172A', textDecoration: s.is_completed ? 'line-through' : 'none' }}>
                  {s.is_completed ? <CheckSquare size={14} style={{ color: '#059669', flexShrink: 0 }} /> : <Square size={14} style={{ color: '#94a3b8', flexShrink: 0 }} />} {s.title}
                </button>
              ))}
            </div>
          )}

          {related.length > 1 && (
            <div className="glass-card" style={{ padding: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
                <GitBranch size={13} style={{ color: '#18181b' }} />
                <h3 className="section-label">Revision history</h3>
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', fontWeight: 700, color: '#94a3b8' }}>{related.length} versions</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {related.map(t => {
                  const current = t.id === ticket.id;
                  return (
                    <Link key={t.id} to={`/tickets/${t.id}`} aria-current={current ? 'page' : undefined} style={{ display: 'block', textDecoration: 'none', padding: '0.5rem 0.625rem', borderRadius: 8, background: current ? 'rgba(24,24,27,0.06)' : 'transparent', border: `1px solid ${current ? 'rgba(24,24,27,0.15)' : 'rgba(226,232,240,0.7)'}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: current ? '#18181b' : '#0F172A' }}>V{t.version_number ?? 1}</span>
                        <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>{t.status}</span>
                        {current && <span style={{ marginLeft: 'auto', fontSize: '0.58rem', fontWeight: 800, textTransform: 'uppercase', color: '#18181b' }}>current</span>}
                      </div>
                      {t.reason_for_change && (
                        <p style={{ fontSize: '0.68rem', color: '#64748B', lineHeight: 1.5, fontStyle: 'italic', marginTop: 3, display: 'flex', gap: 4 }}>
                          <Tag size={9} style={{ color: '#8b5cf6', flexShrink: 0, marginTop: 3 }} /> {t.reason_for_change}
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
            <h2 style={{ fontSize: '1.15rem', marginBottom: '1rem', color: '#0F172A' }}>Request changes (V{(ticket.version_number ?? 1) + 1})</h2>
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
