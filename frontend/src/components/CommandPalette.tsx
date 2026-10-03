import React, { useState, useEffect } from 'react';
import { Search, Ticket as TicketIcon, Image as ImageIcon, LayoutDashboard, Calendar, ArrowRight } from 'lucide-react';

interface CommandPaletteProps {
  isOpen:  boolean;
  onClose: () => void;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (isOpen) setSearch('');
  }, [isOpen]);

  if (!isOpen) return null;

  const Row = ({ icon: Icon, label, sub, iconColor = '#003F8A' }: { icon: any; label: string; sub?: string; iconColor?: string }) => (
    <button
      onClick={onClose}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.6rem 0.875rem', background: 'none', border: 'none',
        cursor: 'pointer', borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-body)', transition: 'background 0.15s',
        textAlign: 'left',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,63,138,0.04)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
    >
      <div style={{ width: 32, height: 32, borderRadius: 8, background: `${iconColor}10`, border: `1px solid ${iconColor}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: iconColor }}>
        <Icon size={15} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0F172A' }}>{label}</p>
        {sub && <p style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{sub}</p>}
      </div>
      <ArrowRight size={14} style={{ color: '#cbd5e1', flexShrink: 0 }} />
    </button>
  );

  return (
    <div
      className="animate-fade-in"
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '15vh', zIndex: 50, padding: '15vh 1rem 1rem' }}
      onClick={onClose}
    >
      <div
        className="animate-fade-in-up"
        style={{
          background: 'rgba(255,255,255,0.98)', backdropFilter: 'blur(16px)',
          borderRadius: 'var(--radius-lg)', boxShadow: '0 30px 80px rgba(0,63,138,0.14)',
          border: '1px solid rgba(226,232,240,0.85)',
          width: '100%', maxWidth: 520, overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Search bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.875rem 1rem', borderBottom: '1px solid rgba(226,232,240,0.85)' }}>
          <div className="icon-tile" style={{ width: 36, height: 36, flexShrink: 0 }}>
            <Search size={16} />
          </div>
          <input
            type="text"
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: '0.95rem', fontFamily: 'var(--font-body)', color: '#0F172A' }}
            placeholder="Search tickets, assets, or jump to…"
          />
          <kbd style={{ fontFamily: 'monospace', fontSize: '0.65rem', background: '#F8FAFC', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 6, padding: '2px 7px', color: '#64748B', flexShrink: 0 }}>ESC</kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 340, overflowY: 'auto', padding: '0.5rem' }}>
          <p className="section-label" style={{ padding: '0.4rem 0.875rem', marginBottom: 2 }}>Quick Links</p>
          <Row icon={LayoutDashboard} label="Go to Dashboard"    sub="Performance overview"  />
          <Row icon={ImageIcon}       label="Open Asset Library" sub="Browse brand assets"   />
          <Row icon={Calendar}        label="SLA Calendar"       sub="View upcoming deadlines" />

          <p className="section-label" style={{ padding: '0.6rem 0.875rem 0.2rem', marginBottom: 2 }}>Recent Tickets</p>
          <Row icon={TicketIcon} label="DF-0002 — Social Media Q3 Graphics" sub="In Progress" iconColor="#f97316" />
          <Row icon={TicketIcon} label="DF-0001 — Spring Sale Homepage Banner" sub="New" />
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
