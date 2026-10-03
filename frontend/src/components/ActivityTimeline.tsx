import React from 'react';
import { Clock, CheckCircle, ArrowRight, Play, MessageSquare, AlertCircle, Paperclip, ShieldCheck, FileImage } from 'lucide-react';

export interface AuditLogEntry {
  id:        string;
  action:    string;
  actor:     string;
  timestamp: string;
  details?:  string;
  type:      'status_change' | 'comment' | 'timer_start' | 'timer_stop' | 'created' | 'alert' | 'attachment' | 'approval' | 'proof';
}

interface ActivityTimelineProps {
  logs: AuditLogEntry[];
}

/* Maps each event type to MCCIA design tokens */
const TYPE_MAP: Record<string, { icon: any; color: string; bg: string; border: string }> = {
  created:       { icon: CheckCircle,   color: '#059669', bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.15)'  },
  status_change: { icon: ArrowRight,    color: '#18181b', bg: 'rgba(24,24,27,0.07)',    border: 'rgba(24,24,27,0.14)'    },
  timer_start:   { icon: Play,          color: '#8B5CF6', bg: 'rgba(24,24,27,0.08)',  border: 'rgba(24,24,27,0.15)'  },
  timer_stop:    { icon: Clock,         color: '#64748B', bg: 'rgba(100,116,139,0.08)', border: 'rgba(100,116,139,0.14)' },
  comment:       { icon: MessageSquare, color: '#f97316', bg: 'rgba(249,115,22,0.08)',  border: 'rgba(249,115,22,0.14)'  },
  attachment:    { icon: Paperclip,     color: '#0ea5e9', bg: 'rgba(14,165,233,0.08)',  border: 'rgba(14,165,233,0.15)' },
  approval:      { icon: ShieldCheck,   color: '#059669', bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.15)' },
  proof:         { icon: FileImage,     color: '#8B5CF6', bg: 'rgba(24,24,27,0.08)',  border: 'rgba(24,24,27,0.15)' },
  alert:         { icon: AlertCircle,   color: '#EF4444', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.14)'   },
};

const DEFAULT_TYPE = { icon: Clock, color: '#64748B', bg: 'rgba(100,116,139,0.06)', border: 'rgba(226,232,240,0.85)' };

const ActivityTimeline: React.FC<ActivityTimelineProps> = ({ logs }) => (
  <div
    className="glass-card"
    style={{ padding: '1.5rem' }}
  >
    <h3 className="section-label" style={{ marginBottom: '1.25rem' }}>Activity History</h3>

    {logs.length === 0 && <p style={{ fontSize: '0.82rem', color: '#94a3b8' }}>No activity yet.</p>}
    <div style={{ position: 'relative', paddingLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Vertical line */}
      <div style={{ position: 'absolute', left: 14, top: 8, bottom: 8, width: 2, background: 'rgba(226,232,240,0.85)', borderRadius: 2 }} />

      {logs.map((log) => {
        const cfg = TYPE_MAP[log.type] ?? DEFAULT_TYPE;
        const Icon = cfg.icon;
        return (
          <div key={log.id} style={{ position: 'relative', paddingLeft: '1.75rem' }}>
            {/* Icon dot */}
            <div style={{
              position:       'absolute', left: -7, top: 2,
              width:          30, height: 30, borderRadius: 'var(--radius-btn)',
              background:     cfg.bg, border: `1px solid ${cfg.border}`,
              display:        'flex', alignItems: 'center', justifyContent: 'center',
              color:          cfg.color, flexShrink: 0,
              boxShadow:      '0 2px 8px rgba(0,0,0,0.04)',
            }}>
              <Icon size={14} />
            </div>

            {/* Content */}
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.25rem' }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0F172A', fontFamily: 'var(--font-body)' }}>
                <span style={{ color: cfg.color }}>{log.actor}</span>{' '}{log.action}
              </h4>
              <time style={{ fontSize: '0.68rem', color: '#94a3b8', whiteSpace: 'nowrap', fontFamily: 'var(--font-body)' }}>
                {new Date(log.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
              </time>
            </div>

            {log.details && (
              <div
                className="quote-box"
                style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#475569' }}
              >
                {log.details}
              </div>
            )}
          </div>
        );
      })}
    </div>
  </div>
);

export default ActivityTimeline;
