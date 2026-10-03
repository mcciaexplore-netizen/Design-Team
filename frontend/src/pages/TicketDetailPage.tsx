import React, { useState } from 'react';
import { authFetch } from '../api';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Clock, ChevronDown, GitBranch, Tag } from 'lucide-react';
import { SEED_TICKETS, STATUSES, PRIORITY_STYLE, type Ticket } from '../types';
import ActivityTimeline from '../components/ActivityTimeline';
import CDRApprovalGate  from '../components/CDRApprovalGate';
import DesignProofer    from '../components/DesignProofer';

const MOCK_LOGS = [
  { id: 'l1', type: 'created'      as const, action: 'created this ticket',               actor: 'Alice',   timestamp: new Date(Date.now() - 7_200_000).toISOString(), details: undefined },
  { id: 'l2', type: 'status_change'as const, action: 'moved to In Progress',              actor: 'Bob',     timestamp: new Date(Date.now() - 3_600_000).toISOString(), details: 'Status changed from New → In Progress' },
  { id: 'l3', type: 'comment'      as const, action: 'left a comment',                    actor: 'Alice',   timestamp: new Date(Date.now() - 1_800_000).toISOString(), details: 'Fonts look off — please use Bricolage Grotesque.' },
  { id: 'l4', type: 'timer_start'  as const, action: 'started the timer',                  actor: 'Bob',     timestamp: new Date(Date.now() - 900_000).toISOString(),  details: undefined },
];

const MOCK_PREVIEWS = [
  'https://images.unsplash.com/photo-1626785774573-4b799315345d?auto=format&fit=crop&q=80&w=800',
  'https://images.unsplash.com/photo-1626785774625-ddcddc3445e9?auto=format&fit=crop&q=80&w=800',
];

const TicketDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<Ticket | undefined>(SEED_TICKETS.find(t => t.id === id));
  const [activeTab, setActiveTab] = useState<'overview' | 'proofing' | 'delivery' | 'figma'>('overview');
  const [figmaInput, setFigmaInput] = useState(ticket?.figma_url || '');

  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [revisionCategory, setRevisionCategory] = useState('Scope Change');
  const [revisionReason, setRevisionReason] = useState('');

  if (!ticket) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <p style={{ fontSize: '1rem', color: '#64748B', fontFamily: 'var(--font-body)' }}>
          Ticket not found.{' '}
          <Link to="/" style={{ color: '#003F8A', fontWeight: 700 }}>← Back to Board</Link>
        </p>
      </div>
    );
  }

  const ps = PRIORITY_STYLE[ticket.priority] ?? {};
  const update = (patch: Partial<Ticket>) => setTicket(prev => prev ? { ...prev, ...patch } : prev);

  const TABS: { key: typeof activeTab; label: string }[] = [
    { key: 'overview',  label: 'Overview & Activity' },
    { key: 'figma',     label: 'Figma Embed'         },
    { key: 'proofing',  label: 'Visual Proofing'     },
    { key: 'delivery',  label: 'CDR Delivery Gate'   },
  ];

  return (
    <div style={{ padding: '0 0 3rem', height: '100%', overflowY: 'auto' }}>
      {/* ── Back + Header ── */}
      <div style={{ marginBottom: '1.5rem' }}>
        <Link
          to="/"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', fontWeight: 700, color: '#64748B', textDecoration: 'none', marginBottom: '0.75rem', fontFamily: 'var(--font-body)' }}
        >
          <ArrowLeft size={14} /> Back to Board
        </Link>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <p style={{ fontSize: '0.68rem', fontFamily: 'monospace', color: '#94a3b8', fontWeight: 700, marginBottom: 4 }}>{ticket.number}</p>
            <h1 style={{ fontSize: 'clamp(1.3rem,3vw,1.8rem)', fontFamily: 'var(--font-heading)', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              {ticket.title}
            </h1>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <span className="badge-blue" style={ps}>{ticket.priority}</span>
          </div>
        </div>
      </div>

      {/* ── Two-column layout ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '1.5rem', alignItems: 'start' }}>

        {/* Left: Tabs */}
        <div>
          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 0, background: '#F8FAFC', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 'var(--radius-md)', padding: 4, marginBottom: '1.25rem' }}>
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  flex: 1, padding: '0.45rem 0.75rem', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background:  activeTab === tab.key ? 'white' : 'transparent',
                  boxShadow:   activeTab === tab.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                  color:       activeTab === tab.key ? '#003F8A' : '#64748B',
                  fontSize:    '0.78rem', fontWeight: 700, fontFamily: 'var(--font-body)',
                  transition:  'all 0.15s',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Description */}
              <div className="glass-card" style={{ padding: '1.25rem' }}>
                <h3 className="section-label" style={{ marginBottom: 8 }}>Description</h3>
                <p style={{ fontSize: '0.85rem', color: '#475569', lineHeight: 1.7 }}>{ticket.description || 'No description provided.'}</p>
              </div>
              {/* Activity */}
              <ActivityTimeline logs={MOCK_LOGS} />
            </div>
          )}

          {activeTab === 'proofing' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="btn-primary"
                  onClick={() => {
                    update({ status: 'In Review' });
                    alert('Proof uploaded! Ticket status automatically moved to "In Review".');
                  }}
                >
                  ↑ Upload New Proof
                </button>
              </div>
              <div style={{ height: 500 }}>
                <DesignProofer ticketId={ticket.id} imageUrls={MOCK_PREVIEWS} />
              </div>
            </div>
          )}

          {activeTab === 'figma' && (
            <div className="glass-card" style={{ height: 550, padding: '1rem', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', gap: 10, marginBottom: '1rem' }}>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Paste Figma or Canva URL here..."
                  value={figmaInput}
                  onChange={e => setFigmaInput(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn-primary"
                  onClick={() => {
                    update({ figma_url: figmaInput, status: 'In Review' });
                    alert('Figma embed link saved! Ticket status automatically moved to "In Review".');
                  }}
                >
                  Save Embed
                </button>
              </div>
              {ticket.figma_url ? (
                <iframe
                  title="Figma Embed"
                  style={{ border: '1px solid rgba(226,232,240,0.85)', borderRadius: 'var(--radius-md)', flex: 1 }}
                  src={`https://www.figma.com/embed?embed_host=designdesk&url=${encodeURIComponent(ticket.figma_url)}`}
                  allowFullScreen
                />
              ) : (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,63,138,0.03)', borderRadius: 'var(--radius-md)', border: '2px dashed rgba(226,232,240,0.85)' }}>
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>No Embed Yet</p>
                    <p style={{ fontSize: '0.85rem', color: '#64748B' }}>Paste a Figma URL above to live-preview the design.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'delivery' && (
            <CDRApprovalGate
              status={ticket.status === 'Delivered' ? 'Delivered' : 'In Review'}
              previewImageUrls={MOCK_PREVIEWS}
              onApprove={idx => {
                update({ status: 'Closed' });
                alert(`Option ${idx + 1} approved! CDR file unlocked.`);
              }}
            />
          )}
        </div>

        {/* Right: Meta sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Action Buttons */}
          {(() => {
            const isWithin24Hours = !!ticket.due_at && (new Date(ticket.due_at).getTime() - Date.now()) < 24 * 3600 * 1000;
            return (ticket.status === 'In Review' || ticket.status === 'Delivered') && (
              <button
                className="btn-primary"
                disabled={isWithin24Hours}
                title={isWithin24Hours ? "Revisions locked within 24 hours of deadline. Contact manager." : ""}
                style={{ width: '100%', background: isWithin24Hours ? '#FCA5A5' : '#EF4444', borderColor: isWithin24Hours ? '#FCA5A5' : '#DC2626', cursor: isWithin24Hours ? 'not-allowed' : 'pointer' }}
                onClick={() => setShowRevisionModal(true)}
              >
                Request Changes {isWithin24Hours ? '(Locked)' : ''}
              </button>
            );
          })()}

          {/* Status */}
          <div className="glass-card" style={{ padding: '1rem' }}>
            <label className="section-label" style={{ marginBottom: 6, display: 'block' }}>Status</label>
            <div style={{ position: 'relative' }}>
              <select
                value={ticket.status}
                onChange={e => update({ status: e.target.value })}
                className="input-field"
                style={{ width: '100%', fontSize: '0.82rem' }}
              >
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none' }} />
            </div>
          </div>

          {/* Details */}
          <div className="glass-card" style={{ padding: '1rem' }}>
            <h3 className="section-label" style={{ marginBottom: '0.75rem' }}>Details</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              {[
                { label: 'Assignee', value: ticket.assignee || 'Unassigned' },
                { label: 'Priority', value: ticket.priority },
                { label: 'Due Date', value: new Date(ticket.due_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="section-label">{label}</span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0F172A', fontFamily: 'var(--font-body)' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Time */}
          <div className="glass-card" style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.5rem' }}>
              <Clock size={14} style={{ color: '#003F8A' }} />
              <span className="section-label">Time Logged</span>
            </div>
            <p style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: '#0F172A', letterSpacing: '-0.02em' }}>
              {Math.floor(ticket.time_spent_seconds / 3600)}h {Math.floor((ticket.time_spent_seconds % 3600) / 60)}m
            </p>
          </div>

          {/* Tags */}
          {ticket.tags?.length > 0 && (
            <div className="glass-card" style={{ padding: '1rem' }}>
              <h3 className="section-label" style={{ marginBottom: 8 }}>Tags</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {ticket.tags.map(t => <span key={t} className="chip">{t}</span>)}
              </div>
            </div>
          )}

          {/* Subtasks */}
          {ticket.subtasks?.length > 0 && (
            <div className="glass-card" style={{ padding: '1rem' }}>
              <h3 className="section-label" style={{ marginBottom: 8 }}>
                Subtasks ({ticket.subtasks.filter(s => s.is_completed).length}/{ticket.subtasks.length})
              </h3>
              <div style={{ height: 4, background: 'rgba(226,232,240,0.7)', borderRadius: 99, marginBottom: 10, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(ticket.subtasks.filter(s => s.is_completed).length / ticket.subtasks.length) * 100}%`, background: 'linear-gradient(90deg,#059669,#10B981)', borderRadius: 99, transition: 'width 0.3s' }} />
              </div>
              {ticket.subtasks.map(s => (
                <div key={s.id} onClick={() => {
                  const updatedSubtasks = ticket.subtasks.map(sub => sub.id === s.id ? { ...sub, is_completed: !sub.is_completed } : sub);
                  const isAllCompleted = updatedSubtasks.every(sub => sub.is_completed);
                  update({ subtasks: updatedSubtasks, status: isAllCompleted ? 'In Review' : ticket.status });
                  if (isAllCompleted && !s.is_completed && ticket.status !== 'In Review') {
                    alert('All subtasks completed! Ticket status automatically moved to "In Review".');
                  }
                }} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: '0.78rem', color: s.is_completed ? '#94a3b8' : '#0F172A', textDecoration: s.is_completed ? 'line-through' : 'none' }}>
                  <span style={{ fontSize: '0.7rem' }}>{s.is_completed ? '✅' : '⬜'}</span> {s.title}
                </div>
              ))}
            </div>
          )}

          {/* Revision History */}
          {(ticket.parent_id || (ticket.version_number && ticket.version_number > 1) || SEED_TICKETS.some(t => t.parent_id === ticket.id)) && (() => {
            const revisions = SEED_TICKETS
              .filter(t => t.id === ticket.id || t.id === ticket.parent_id || t.parent_id === ticket.id || (ticket.parent_id && t.parent_id === ticket.parent_id))
              .sort((a, b) => (a.version_number || 1) - (b.version_number || 1));
            return (
              <div className="glass-card" style={{ padding: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
                  <GitBranch size={13} style={{ color: '#003F8A' }} />
                  <h3 className="section-label">Revision History</h3>
                  <span style={{ marginLeft: 'auto', fontSize: '0.65rem', fontWeight: 700, color: '#94a3b8' }}>{revisions.length} version{revisions.length !== 1 ? 's' : ''}</span>
                </div>
                <div style={{ position: 'relative', paddingLeft: 20 }}>
                  {/* Timeline spine */}
                  <div style={{ position: 'absolute', left: 7, top: 8, bottom: 8, width: 2, background: 'rgba(0,63,138,0.1)', borderRadius: 2 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                    {revisions.map((t, i) => {
                      const isCurrent = t.id === ticket.id;
                      const isLatest  = i === revisions.length - 1;
                      return (
                        <a href={`/tickets/${t.id}`} key={t.id} style={{ display: 'block', textDecoration: 'none', position: 'relative' }}>
                          {/* Dot */}
                          <div style={{ position: 'absolute', left: -16, top: 10, width: 10, height: 10, borderRadius: '99px', background: isCurrent ? '#003F8A' : isLatest ? '#10B981' : '#cbd5e1', border: `2px solid ${isCurrent ? '#003F8A' : isLatest ? '#10B981' : '#e2e8f0'}`, zIndex: 1 }} />
                          <div style={{ padding: '0.5rem 0.625rem', borderRadius: 8, background: isCurrent ? 'rgba(0,63,138,0.06)' : 'transparent', border: `1px solid ${isCurrent ? 'rgba(0,63,138,0.15)' : 'rgba(226,232,240,0.7)'}`, transition: 'background 0.15s' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: t.reason_for_change ? 4 : 0 }}>
                              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: isCurrent ? '#003F8A' : '#0F172A' }}>
                                V{t.version_number || 1}
                              </span>
                              <span style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 500 }}>{t.status}</span>
                              {isCurrent && (
                                <span style={{ marginLeft: 'auto', fontSize: '0.58rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#003F8A', background: 'rgba(0,63,138,0.1)', borderRadius: 4, padding: '1px 5px' }}>current</span>
                              )}
                            </div>
                            {t.revision_category && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                                <Tag size={9} style={{ color: '#8b5cf6' }} />
                                <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#7c3aed' }}>{t.revision_category}</span>
                              </div>
                            )}
                            {t.reason_for_change && (
                              <p style={{ fontSize: '0.68rem', color: '#64748B', lineHeight: 1.5, fontStyle: 'italic' }}>{t.reason_for_change}</p>
                            )}
                          </div>
                        </a>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Audit Trail / Change Log */}
          <div className="glass-card" style={{ padding: '1rem' }}>
            <h3 className="section-label" style={{ marginBottom: 8 }}>Audit Trail</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '250px', overflowY: 'auto' }}>
              {MOCK_LOGS.map(l => (
                <div key={l.id} style={{ fontSize: '0.72rem', color: '#64748B', borderLeft: '2px solid rgba(0,63,138,0.2)', paddingLeft: '0.6rem' }}>
                  <span style={{ fontWeight: 700, color: '#0F172A' }}>{l.actor}</span> {l.action} 
                  <span style={{ fontSize: '0.65rem', display: 'block', marginTop: 2 }}>{new Date(l.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                  {l.details && <span style={{ display: 'block', marginTop: 4, padding: '4px 6px', background: 'rgba(226,232,240,0.4)', borderRadius: '4px', fontStyle: 'italic', fontSize: '0.68rem' }}>{l.details}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Revision Modal */}
      {showRevisionModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center' }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: 400, padding: '1.5rem', background: 'white' }}>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem', color: '#0F172A' }}>Request Changes (V{ (ticket.version_number || 1) + 1 })</h2>
            
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.5rem' }}>Reason Category</label>
            <select
              className="input-field"
              value={revisionCategory}
              onChange={e => setRevisionCategory(e.target.value)}
              style={{ marginBottom: '1rem' }}
            >
              <option value="Scope Change">Scope Change (Client changed mind)</option>
              <option value="Missing Asset">Missing Asset (Files missing)</option>
              <option value="Design Error">Design Error (Missed requirement)</option>
            </select>

            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.5rem' }}>Additional Details</label>
            <textarea
              className="input-field"
              rows={3}
              placeholder="Explain the changes needed..."
              value={revisionReason}
              onChange={e => setRevisionReason(e.target.value)}
              style={{ marginBottom: '1.5rem', resize: 'vertical' }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button className="btn-ghost" onClick={() => setShowRevisionModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={async () => {
                try {
                  const res = await authFetch(`/api/tickets/${ticket.id}/revisions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reason_for_change: `[${revisionCategory}] ${revisionReason}` })
                  });
                  if (res.ok) {
                    alert("Ticket duplicated successfully for revisions.");
                    window.location.href = '/';
                  } else {
                    const data = await res.json();
                    alert("Error: " + data.detail);
                  }
                } catch(e) {
                  console.error(e);
                  alert("Failed to request changes.");
                }
              }}>Submit Revision</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TicketDetailPage;
