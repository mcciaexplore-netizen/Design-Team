import { Ticket as TicketIcon, CheckCircle, Clock } from 'lucide-react';
import CDRApprovalGate from '../components/CDRApprovalGate';

const CLIENT_TICKETS = [
  {
    id: '1', number: 'DF-0001', title: 'Spring Sale Homepage Banner',
    status: 'In Progress', expected_delivery: 'Tomorrow, 5:00 PM'
  },
  {
    id: '3', number: 'DF-0003', title: 'Brand Guidelines Update',
    status: 'Delivered', expected_delivery: 'Delivered Today',
    previewImages: [
      'https://images.unsplash.com/photo-1626785774573-4b799315345d?auto=format&fit=crop&q=80&w=800',
      'https://images.unsplash.com/photo-1626785774625-ddcddc3445e9?auto=format&fit=crop&q=80&w=800'
    ]
  }
];

const ClientPortalPage = ({ onNewRequest }: { onNewRequest?: () => void }) => (
  <div style={{ padding: '0.25rem 0 2rem' }}>
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.75rem' }}>
        <div>
          <h1 style={{ fontSize: 'clamp(1.4rem,3vw,2rem)', fontFamily: 'var(--font-heading)', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>My Requests</h1>
          <p style={{ fontSize: '0.85rem', color: '#64748B', marginTop: 4 }}>Track the progress of your design requests.</p>
        </div>
        <button className="btn-primary" style={{ fontSize: '0.82rem' }} onClick={onNewRequest}>
          + New Request
        </button>
      </div>

      {/* Tickets */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {CLIENT_TICKETS.map((ticket, i) => (
          <div
            key={ticket.id}
            className="glass-card animate-fade-in-up"
            style={{ overflow: 'hidden', animationDelay: `${i * 80}ms`, animationFillMode: 'both', padding: 0 }}
          >
            <div style={{ padding: '1.1rem 1.4rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: ticket.status === 'Delivered' ? '1px solid rgba(226,232,240,0.85)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 'var(--radius-btn)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  background: ticket.status === 'Delivered' ? 'rgba(16,185,129,0.08)' : 'rgba(0,63,138,0.06)',
                  border:     ticket.status === 'Delivered' ? '1px solid rgba(16,185,129,0.15)' : '1px solid rgba(0,63,138,0.12)',
                  color:      ticket.status === 'Delivered' ? '#059669' : '#003F8A',
                }}>
                  {ticket.status === 'Delivered' ? <CheckCircle size={18} /> : <Clock size={18} />}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: '#94a3b8', fontWeight: 600 }}>{ticket.number}</span>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: '#0F172A' }}>{ticket.title}</h3>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#64748B', marginTop: 3 }}>
                    Status: <strong style={{ color: '#0F172A' }}>{ticket.status}</strong> · {ticket.expected_delivery}
                  </p>
                </div>
              </div>
              <span className={ticket.status === 'Delivered' ? 'badge-green' : 'badge-blue'}>
                {ticket.status}
              </span>
            </div>

            {ticket.status === 'Delivered' && ticket.previewImages && (
              <div style={{ padding: '1.25rem 1.4rem', background: '#F8FAFC' }}>
                <CDRApprovalGate
                  status="Delivered"
                  previewImageUrls={ticket.previewImages}
                  onApprove={(i) => alert(`Design Option ${i + 1} Approved! CDR Source file unlocked.`)}
                />
              </div>
            )}
          </div>
        ))}

        {CLIENT_TICKETS.length === 0 && (
          <div
            className="glass-card"
            style={{ textAlign: 'center', padding: '4rem 2rem', border: '2px dashed rgba(226,232,240,0.85)' }}
          >
            <div style={{ width: 56, height: 56, borderRadius: 'var(--radius-btn)', background: 'rgba(0,63,138,0.06)', border: '1px solid rgba(0,63,138,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', color: '#003F8A' }}>
              <TicketIcon size={24} />
            </div>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: '#0F172A' }}>No active requests</h3>
            <p style={{ fontSize: '0.85rem', color: '#64748B', marginTop: 6 }}>You don't have any design requests currently in progress.</p>
          </div>
        )}
      </div>
    </div>
  </div>
);

export default ClientPortalPage;
