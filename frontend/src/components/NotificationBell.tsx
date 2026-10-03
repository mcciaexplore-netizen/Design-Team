import React, { useState } from 'react';
import { Bell, AlertTriangle, Info, CheckCircle } from 'lucide-react';

interface Notification {
  id:    string;
  type:  'warning' | 'info' | 'error';
  text:  string;
  time:  string;
  read:  boolean;
}

const MOCK_NOTIFICATIONS: Notification[] = [
  { id: '1', type: 'warning', text: 'DF-0001 is approaching its SLA in 6 hours.',    time: '10 mins ago', read: false },
  { id: '2', type: 'info',    text: 'You were assigned to DF-0002.',                  time: '1 hour ago',  read: false },
  { id: '3', type: 'error',   text: 'Escalation: DF-0003 is 4+ hrs overdue!',        time: '2 hours ago', read: false },
];

const TYPE_CONFIG = {
  warning: { icon: AlertTriangle, color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.15)' },
  info:    { icon: Info,          color: '#003F8A',  bg: 'rgba(0,63,138,0.06)',   border: 'rgba(0,63,138,0.12)'  },
  error:   { icon: AlertTriangle, color: '#EF4444',  bg: 'rgba(239,68,68,0.07)',  border: 'rgba(239,68,68,0.15)' },
};

const NotificationBell = () => {
  const [notifications, setNotifications] = useState(MOCK_NOTIFICATIONS);
  const [isOpen, setIsOpen] = useState(false);

  const unread = notifications.filter(n => !n.read).length;

  const markAllRead = () =>
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position:   'relative', padding: '0.5rem',
          background: 'none', border: 'none', cursor: 'pointer',
          color:      '#64748B', transition: 'color 0.2s',
          borderRadius: 'var(--radius-sm)',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#003F8A')}
        onMouseLeave={e => (e.currentTarget.style.color = '#64748B')}
      >
        <Bell size={20} />
        {unread > 0 && (
          <span style={{
            position:      'absolute', top: 4, right: 4,
            width:         17, height: 17,
            background:    '#EF4444', color: 'white',
            borderRadius:  '99px', fontSize: '0.6rem', fontWeight: 800,
            display:       'flex', alignItems: 'center', justifyContent: 'center',
            border:        '2px solid white', fontFamily: 'var(--font-body)',
            boxShadow:     '0 2px 6px rgba(239,68,68,0.3)',
          }}>
            {unread}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="animate-fade-in-up"
          style={{
            position:        'absolute', right: 0, top: 'calc(100% + 8px)',
            width:           320,
            background:      'rgba(255,255,255,0.98)',
            backdropFilter:  'blur(16px)',
            border:          '1px solid rgba(226,232,240,0.85)',
            borderRadius:    'var(--radius-lg)',
            boxShadow:       '0 20px 40px rgba(0,63,138,0.1)',
            zIndex:          50,
            overflow:        'hidden',
          }}
        >
          {/* Header */}
          <div style={{
            padding:      '0.875rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            borderBottom: '1px solid rgba(226,232,240,0.85)', background: '#F8FAFC',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Bell size={14} style={{ color: '#003F8A' }} />
              <h3 style={{ fontSize: '0.82rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: '#0F172A' }}>Notifications</h3>
              {unread > 0 && <span className="badge-red">{unread} new</span>}
            </div>
            <button
              onClick={markAllRead}
              style={{ fontSize: '0.72rem', fontWeight: 700, color: '#003F8A', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)' }}
            >
              Mark all read
            </button>
          </div>

          {/* Notification rows */}
          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            {notifications.map(n => {
              const cfg = TYPE_CONFIG[n.type];
              const Icon = cfg.icon;
              return (
                <div
                  key={n.id}
                  style={{
                    display:      'flex', alignItems: 'flex-start', gap: '0.75rem',
                    padding:      '0.875rem 1rem',
                    borderBottom: '1px solid rgba(226,232,240,0.6)',
                    background:   n.read ? 'white' : `${cfg.bg}`,
                    cursor:       'pointer', transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,63,138,0.03)')}
                  onMouseLeave={e => (e.currentTarget.style.background = n.read ? 'white' : cfg.bg)}
                >
                  <div style={{
                    width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                    background: cfg.bg, border: `1px solid ${cfg.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: cfg.color,
                  }}>
                    <Icon size={14} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '0.8rem', color: '#0F172A', lineHeight: 1.5, fontWeight: n.read ? 400 : 600 }}>
                      {n.text}
                    </p>
                    <p style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: 3 }}>{n.time}</p>
                  </div>
                  {!n.read && (
                    <div style={{ width: 6, height: 6, borderRadius: '99px', background: '#003F8A', flexShrink: 0, marginTop: 6 }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
