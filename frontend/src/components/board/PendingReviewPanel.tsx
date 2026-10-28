import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Clock, Eye, HelpCircle, UserPlus, X } from 'lucide-react';
import { type Ticket } from '../../types';
import { useTickets, type StaffUser } from '../../contexts/TicketsContext';
import { SLABadge } from './TicketCard';

interface Props {
  tickets: Ticket[];
  onAccept: (t: Ticket, assigneeId?: number) => void;
  onDecline: (t: Ticket) => void;
  onBulkAccept: (tickets: Ticket[]) => void;
  onClarify?: (t: Ticket, question: string) => Promise<void>;
}

/** Design-Lead-only queue: requests a client submitted, not yet accepted into the board. */
export default function PendingReviewPanel({ tickets, onAccept, onDecline, onBulkAccept, onClarify }: Props) {
  const { staff } = useTickets();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [peekTicket, setPeekTicket] = useState<Ticket | null>(null);
  const [assignDropdownId, setAssignDropdownId] = useState<string | null>(null);

  if (!tickets.length) return null;

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allSelected = tickets.every(t => selected.has(t.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(tickets.map(t => t.id)));
  const acceptSelected = () => {
    onBulkAccept(tickets.filter(t => selected.has(t.id)));
    setSelected(new Set());
  };

  const handleAskClarification = async (t: Ticket) => {
    const question = window.prompt(`Ask clarification from ${t.requester_name || 'the client'} for "${t.title}":`);
    if (!question || !question.trim()) return;
    if (onClarify) {
      await onClarify(t, question.trim());
    }
  };

  return (
    <>
      <section aria-labelledby="pending-review-h" className="glass-card"
        style={{ padding: '0.9rem 1.1rem', marginBottom: '0.9rem', border: '1px solid rgba(180,83,9,0.25)', background: 'rgba(180,83,9,0.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <h2 id="pending-review-h" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.92rem', fontWeight: 800, color: '#92400e' }}>
            <Clock size={15} aria-hidden="true" /> Pending review ({tickets.length})
          </h2>
          {selected.size > 0 && (
            <button type="button" className="btn-primary" style={{ gap: 5, padding: '0.35rem 0.7rem', fontSize: '0.76rem' }} onClick={acceptSelected}>
              <Check size={13} aria-hidden="true" /> Accept {selected.size} selected
            </button>
          )}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.74rem', fontWeight: 700, color: '#737373', marginBottom: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} /> Select all
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tickets.map(t => {
            const department = t.type_specific_fields?.department;
            const isDropdownOpen = assignDropdownId === t.id;

            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '0.6rem 0.75rem', background: 'white', borderRadius: 10, border: '1px solid rgba(226,232,240,0.9)', position: 'relative' }}>
                <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Select ${t.number}`} />
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <p style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#525252', fontWeight: 700 }}>{t.number}{t.design_type ? ` · ${t.design_type}` : ''}</p>
                  <p
                    onClick={() => setPeekTicket(t)}
                    title="Click to preview details"
                    style={{ fontSize: '0.88rem', fontWeight: 700, overflowWrap: 'anywhere', margin: 0, cursor: 'pointer', color: '#003F8A' }}>
                    {t.title}
                  </p>
                  <p style={{ fontSize: '0.76rem', color: '#737373', marginTop: 2 }}>
                    From {t.requester_name ?? 'a client'}{t.client_org ? ` · ${t.client_org}` : ''}{typeof department === 'string' && department ? ` · ${department}` : ''}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <SLABadge dueAt={t.due_at} />
                </div>

                <div style={{ display: 'flex', gap: 6, alignItems: 'center', position: 'relative' }}>
                  {/* Quick-Peek Button */}
                  <button type="button" className="btn-ghost" style={{ gap: 5, padding: '0.4rem 0.75rem', fontSize: '0.78rem' }} onClick={() => setPeekTicket(t)} title="Quick-Peek request details">
                    <Eye size={13} aria-hidden="true" /> Quick-Peek
                  </button>

                  {/* Accept Button + 1-Click Assign Dropdown */}
                  <div style={{ position: 'relative' }}>
                    <div style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden' }}>
                      <button type="button" className="btn-primary" style={{ gap: 5, padding: '0.4rem 0.75rem', fontSize: '0.78rem', borderRadius: '8px 0 0 8px' }} onClick={() => onAccept(t)}>
                        <Check size={13} aria-hidden="true" /> Accept
                      </button>
                      <button
                        type="button"
                        aria-label="Assign to designer"
                        title="Accept & Assign to..."
                        className="btn-primary"
                        style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem', borderLeft: '1px solid rgba(255,255,255,0.25)', borderRadius: '0 8px 8px 0' }}
                        onClick={() => setAssignDropdownId(isDropdownOpen ? null : t.id)}>
                        <UserPlus size={13} aria-hidden="true" />
                      </button>
                    </div>

                    {isDropdownOpen && (
                      <div className="glass-card" style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, width: 220, zIndex: 50, background: 'white', padding: '0.4rem 0', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.15)', border: '1px solid #E2E8F0', borderRadius: 8 }}>
                        <div style={{ padding: '0.35rem 0.75rem', fontSize: '0.7rem', fontWeight: 700, color: '#737373', textTransform: 'uppercase' }}>
                          Accept &amp; Assign to:
                        </div>
                        <button
                          type="button"
                          className="menu-item"
                          style={{ width: '100%', textAlign: 'left', padding: '0.45rem 0.75rem', fontSize: '0.78rem', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                          onClick={() => { setAssignDropdownId(null); onAccept(t); }}>
                          <span style={{ fontWeight: 600 }}>⚡ Auto-assign (Capacity)</span>
                        </button>
                        <div style={{ height: 1, background: '#F1F5F9', margin: '4px 0' }} />
                        {staff.filter((s: StaffUser) => s.role === 'Designer' || s.role === 'Design Lead').map((s: StaffUser) => (
                          <button
                            key={s.id}
                            type="button"
                            className="menu-item"
                            style={{ width: '100%', textAlign: 'left', padding: '0.45rem 0.75rem', fontSize: '0.78rem', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                            onClick={() => { setAssignDropdownId(null); onAccept(t, s.id); }}>
                            <span>{s.name}</span>
                            <span style={{ fontSize: '0.7rem', color: '#94A3B8', marginLeft: 'auto' }}>{s.role}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Ask Clarification Button */}
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ gap: 5, padding: '0.4rem 0.75rem', fontSize: '0.78rem', color: '#B45309' }}
                    onClick={() => void handleAskClarification(t)}
                    title="Ask Client for Clarification">
                    <HelpCircle size={13} aria-hidden="true" /> Clarify
                  </button>

                  {/* Decline Button */}
                  <button type="button" className="btn-ghost" style={{ gap: 5, padding: '0.4rem 0.75rem', fontSize: '0.78rem', color: '#B91C1C' }} onClick={() => onDecline(t)}>
                    <X size={13} aria-hidden="true" /> Decline
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Quick-Peek Slide-Over Drawer */}
      {peekTicket && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', justifyContent: 'flex-end', background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(3px)' }}>
          <div style={{ width: 'min(100vw, 520px)', height: '100%', background: 'white', padding: '1.75rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem', boxShadow: '-10px 0 30px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: '0.74rem', fontFamily: 'monospace', fontWeight: 700, color: '#737373' }}>{peekTicket.number} · {peekTicket.design_type || 'Design'}</span>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#003F8A', marginTop: 2 }}>{peekTicket.title}</h3>
              </div>
              <button type="button" className="chip" onClick={() => setPeekTicket(null)} aria-label="Close drawer">
                <X size={16} />
              </button>
            </div>

            <div style={{ background: '#F8FAFC', padding: '0.85rem 1rem', borderRadius: 10, border: '1px solid #E2E8F0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
              <div>
                <p style={{ fontSize: '0.7rem', color: '#737373', fontWeight: 600 }}>Requester</p>
                <p style={{ fontSize: '0.85rem', fontWeight: 700, color: '#003F8A' }}>{peekTicket.requester_name || 'Client'}</p>
              </div>
              <div>
                <p style={{ fontSize: '0.7rem', color: '#737373', fontWeight: 600 }}>Organisation</p>
                <p style={{ fontSize: '0.85rem', fontWeight: 700, color: '#003F8A' }}>{peekTicket.client_org || '—'}</p>
              </div>
              <div>
                <p style={{ fontSize: '0.7rem', color: '#737373', fontWeight: 600 }}>Needed by</p>
                <p style={{ fontSize: '0.85rem', fontWeight: 700, color: '#003F8A' }}>{peekTicket.due_at ? new Date(peekTicket.due_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Flexible'}</p>
              </div>
            </div>

            <div>
              <h4 style={{ fontSize: '0.76rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#737373', marginBottom: 6 }}>Brief / Requirements</h4>
              <div style={{ background: '#F8FAFC', padding: '1rem', borderRadius: 10, fontSize: '0.88rem', color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.6, border: '1px solid #E2E8F0' }}>
                {peekTicket.description || 'No description provided.'}
              </div>
            </div>

            {peekTicket.type_specific_fields && Object.keys(peekTicket.type_specific_fields).length > 0 && (
              <div>
                <h4 style={{ fontSize: '0.76rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#737373', marginBottom: 6 }}>Specifications</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                  {Object.entries(peekTicket.type_specific_fields).map(([k, v]) => (
                    <div key={k} style={{ padding: '0.6rem 0.8rem', background: '#F1F5F9', borderRadius: 8 }}>
                      <p style={{ fontSize: '0.68rem', color: '#737373', textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</p>
                      <p style={{ fontSize: '0.82rem', fontWeight: 700, color: '#003F8A', marginTop: 2 }}>{String(v)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 'auto', display: 'flex', gap: 8, paddingTop: '1rem', borderTop: '1px solid #E2E8F0' }}>
              <Link to={`/tickets/${peekTicket.id}`} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', textDecoration: 'none' }}>
                Open Full Ticket
              </Link>
              <button
                type="button"
                className="btn-primary"
                style={{ flex: 1, justifyContent: 'center', gap: 6 }}
                onClick={() => { const t = peekTicket; setPeekTicket(null); onAccept(t); }}>
                <Check size={14} /> Accept Request
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
