import { useState, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'warning' | 'info' | 'error';

export interface Toast {
  id:      string;
  message: string;
  type:    ToastType;
}

interface ToastItemProps {
  toast:    Toast;
  onRemove: (id: string) => void;
}

const TOAST_CFG: Record<ToastType, { icon: any; color: string; bg: string; border: string }> = {
  success: { icon: CheckCircle2, color: '#059669', bg: 'rgba(16,185,129,0.1)',  border: 'rgba(16,185,129,0.25)' },
  warning: { icon: AlertTriangle,color: '#f97316', bg: 'rgba(249,115,22,0.1)',  border: 'rgba(249,115,22,0.25)' },
  error:   { icon: AlertTriangle,color: '#EF4444', bg: 'rgba(239,68,68,0.1)',   border: 'rgba(239,68,68,0.25)'  },
  info:    { icon: Info,         color: '#003F8A', bg: 'rgba(0,63,138,0.08)',   border: 'rgba(0,63,138,0.2)'   },
};

function ToastItem({ toast, onRemove }: ToastItemProps) {
  const cfg  = TOAST_CFG[toast.type];
  const Icon = cfg.icon;

  return (
    <div
      className="animate-fade-in-up"
      style={{
        display:        'flex',
        alignItems:     'center',
        gap:            '0.75rem',
        padding:        '0.75rem 1rem',
        background:     'rgba(255,255,255,0.98)',
        backdropFilter: 'blur(16px)',
        border:         `1px solid ${cfg.border}`,
        borderLeft:     `3px solid ${cfg.color}`,
        borderRadius:   'var(--radius-md)',
        boxShadow:      '0 8px 24px rgba(0,0,0,0.1)',
        minWidth:       260,
        maxWidth:       360,
        animationFillMode: 'both',
      }}
    >
      <div style={{ color: cfg.color, flexShrink: 0 }}>
        <Icon size={16} />
      </div>
      <p style={{ flex: 1, fontSize: '0.82rem', fontWeight: 600, color: '#0F172A', fontFamily: 'var(--font-body)' }}>
        {toast.message}
      </p>
      <button
        onClick={() => onRemove(toast.id)}
        style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0 }}
      >
        <X size={13} />
      </button>
    </div>
  );
}

/* ── Toast Container ── */
export function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  if (!toasts.length) return null;
  return (
    <div style={{
      position:       'fixed',
      bottom:         '1.5rem',
      right:          '1.5rem',
      zIndex:         9999,
      display:        'flex',
      flexDirection:  'column',
      gap:            '0.5rem',
      pointerEvents:  'none',
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{ pointerEvents: 'all' }}>
          <ToastItem toast={t} onRemove={onRemove} />
        </div>
      ))}
    </div>
  );
}

/* ── Hook ── */
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => removeToast(id), 3500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, addToast, removeToast };
}
