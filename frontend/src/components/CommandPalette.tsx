import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Ticket as TicketIcon, LayoutDashboard, ArrowRight, BarChart3, Gauge, Settings, Users, type LucideIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTickets } from '../contexts/TicketsContext';

interface CommandPaletteProps { isOpen: boolean; onClose: () => void }
interface Entry { key: string; icon: LucideIcon; label: string; sub?: string; to: string; color?: string; group: 'Pages' | 'Tickets' }

const PAGES: (Omit<Entry, 'key' | 'group'> & { roles: string[] })[] = [
  { icon: LayoutDashboard, label: 'Kanban board',          sub: 'Move work between stages',        to: '/',              roles: ['Design Lead', 'Designer'] },
  { icon: Gauge,           label: 'Team workload',         sub: 'Capacity versus planned effort',  to: '/workload',      roles: ['Design Lead', 'Designer'] },
  { icon: BarChart3,       label: 'Performance dashboard', sub: 'Last 30 days',                    to: '/dashboard',     roles: ['Design Lead'] },
  { icon: Users,           label: 'Client portal',         sub: 'Requests and reviews',            to: '/client-portal', roles: ['Design Lead', 'Designer', 'Client'] },
  { icon: Settings,        label: 'Settings',              sub: 'Notifications and integrations',  to: '/settings',      roles: ['Design Lead', 'Designer', 'Client'] },
];

const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tickets } = useTickets();
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (isOpen) { setSearch(''); setActive(0); } }, [isOpen]);

  const entries = useMemo<Entry[]>(() => {
    const q = search.trim().toLowerCase();
    const pages: Entry[] = PAGES.filter(p => user && p.roles.includes(user.role)).map(p => ({ ...p, key: p.to, group: 'Pages' as const }))
      .filter(p => !q || p.label.toLowerCase().includes(q) || (p.sub ?? '').toLowerCase().includes(q));
    const matching = tickets
      .filter(t => !q || t.title.toLowerCase().includes(q) || t.number.toLowerCase().includes(q) || (t.client_org ?? '').toLowerCase().includes(q) || t.assignee.toLowerCase().includes(q))
      .slice(0, q ? 8 : 5)
      .map<Entry>(t => ({ key: `t${t.id}`, icon: TicketIcon, label: `${t.number} — ${t.title}`, sub: `${t.status}${t.assignee ? ` · ${t.assignee}` : ''}`, to: `/tickets/${t.id}`, group: 'Tickets', color: '#f97316' }));
    return [...pages, ...matching];
  }, [search, tickets, user]);

  useEffect(() => { setActive(0); }, [search]);
  useEffect(() => { listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  if (!isOpen) return null;

  const go = (e: Entry) => { onClose(); navigate(e.to); };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setActive(i => Math.min(i + 1, entries.length - 1)); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (ev.key === 'Enter' && entries[active]) { ev.preventDefault(); go(entries[active]); }
    else if (ev.key === 'Escape') { ev.preventDefault(); onClose(); }
  };

  let lastGroup = '';
  return (
    <div className="animate-fade-in" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '15vh 1rem 1rem' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Search" className="animate-fade-in-up" onClick={e => e.stopPropagation()} onKeyDown={onKeyDown}
        style={{ background: 'rgba(255,255,255,0.98)', backdropFilter: 'blur(16px)', borderRadius: 'var(--radius-lg)', boxShadow: '0 30px 80px rgba(24,24,27,0.14)', border: '1px solid rgba(226,232,240,0.85)', width: '100%', maxWidth: 520, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.875rem 1rem', borderBottom: '1px solid rgba(226,232,240,0.85)' }}>
          <div className="icon-tile" style={{ width: 36, height: 36, flexShrink: 0 }}><Search size={16} /></div>
          <input type="text" autoFocus value={search} onChange={e => setSearch(e.target.value)} aria-label="Search tickets and pages" role="combobox" aria-expanded="true" aria-controls="cmd-list"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: '0.95rem', fontFamily: 'var(--font-body)', color: '#0F172A' }}
            placeholder="Search tickets or jump to a page…" />
          <kbd style={{ fontFamily: 'monospace', fontSize: '0.65rem', background: '#F8FAFC', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 6, padding: '2px 7px', color: '#64748B', flexShrink: 0 }}>ESC</kbd>
        </div>

        <div id="cmd-list" ref={listRef} role="listbox" style={{ maxHeight: 360, overflowY: 'auto', padding: '0.5rem' }}>
          {entries.length === 0 && <p style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.85rem', color: '#94a3b8' }}>Nothing matches “{search}”.</p>}
          {entries.map((e, i) => {
            const header = e.group !== lastGroup ? e.group : null;
            lastGroup = e.group;
            const Icon = e.icon;
            const color = e.color ?? '#18181b';
            return (
              <React.Fragment key={e.key}>
                {header && <p className="section-label" style={{ padding: '0.5rem 0.875rem 0.2rem' }}>{header}</p>}
                <button type="button" role="option" aria-selected={i === active} data-active={i === active} onClick={() => go(e)} onMouseMove={() => setActive(i)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.55rem 0.875rem', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-sm)', textAlign: 'left', background: i === active ? 'rgba(24,24,27,0.06)' : 'none' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: `${color}10`, border: `1px solid ${color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color }}><Icon size={15} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</p>
                    {e.sub && <p style={{ fontSize: '0.72rem', color: '#64748b' }}>{e.sub}</p>}
                  </div>
                  <ArrowRight size={14} style={{ color: '#cbd5e1', flexShrink: 0 }} />
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
