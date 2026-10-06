import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { AlertTriangle } from 'lucide-react';

export const STATUS_COLORS: Record<string, string> = {
  'New':                  '#94a3b8',
  'Assigned':             '#52525b',
  'In Progress':          '#8b5cf6',
  'Waiting on Requester': '#f59e0b',
  'In Review':            '#06b6d4',
  'Delivered':            '#10b981',
  'Closed':               '#475569',
};

/* ── Droppable Column ─────────────────────── */
export function DroppableColumn({ id, label, count, wipLimit, isOver, children }: {
  id: string; label: string; count: number; wipLimit?: number; isOver: boolean; children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id });
  const exceeded = wipLimit !== undefined && count > wipLimit;
  const dotColor = STATUS_COLORS[label] ?? '#94a3b8';
  return (
    <div ref={setNodeRef} className="glass-card" style={{
      flexShrink: 0, width: 276,
      display: 'flex', flexDirection: 'column',
      background: isOver ? 'rgba(24,24,27,0.015)' : undefined,
      border: isOver ? '1px solid rgba(24,24,27,0.18)' : undefined,
      maxHeight: '100%', transition: 'border-color 0.2s, background 0.2s',
    }}>
      {/* Column header */}
      <div style={{
        padding: '0.75rem 0.875rem 0.65rem',
        borderBottom: '1px solid rgba(226, 232, 240, 0.7)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderRadius: '12px 12px 0 0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: dotColor, flexShrink: 0, opacity: isOver ? 1 : 0.85 }} />
          <h3 style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: isOver ? '#2563eb' : '#374151' }}>{label}</h3>
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {exceeded && (
            <span title={`WIP limit: ${wipLimit}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: 6, padding: '1px 6px', color: '#EF4444', fontSize: '0.62rem', fontWeight: 800 }}>
              <AlertTriangle size={9} /> {count}/{wipLimit}
            </span>
          )}
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, borderRadius: 6, background: isOver ? 'rgba(24,24,27,0.12)' : '#f1f5f9', border: `1px solid ${isOver ? 'rgba(24,24,27,0.2)' : '#e2e8f0'}`, fontSize: '0.65rem', fontWeight: 800, color: isOver ? '#2563eb' : '#64748B', padding: '0 5px' }}>{count}</span>
        </div>
      </div>
      <div style={{ padding: '0.625rem', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {children}
        {count === 0 && (
          <div className={`empty-drop-zone${isOver ? ' is-over' : ''}`}>
            {isOver ? '↓ Drop here' : 'No tickets'}
          </div>
        )}
      </div>
    </div>
  );
}
