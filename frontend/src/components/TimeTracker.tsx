import { useCallback, useEffect, useState } from 'react';
import { Clock, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { apiJson } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useTickets } from '../contexts/TicketsContext';
import type { Ticket } from '../types';

interface Entry {
  id: number; user_id: number; user_name: string | null; started_at: string; ended_at: string | null;
  seconds: number; note: string | null; source: 'timer' | 'manual';
}

export function fmtClock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const fmtHm = (secs: number) => {
  const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

export default function TimeTracker({ ticket, showEntries = true }: { ticket: Ticket; showEntries?: boolean }) {
  const { user } = useAuth();
  const { startTimer, stopTimer, updateTicket, refresh } = useTickets();
  const isLead = user?.role === 'Design Lead';
  const myId = user ? Number(user.id) : null;

  const [elapsed, setElapsed] = useState(0);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');
  const [estimate, setEstimate] = useState(ticket.estimate_hours != null ? String(ticket.estimate_hours) : '');

  const running = !!ticket.timer_started_at;

  useEffect(() => {
    const compute = () => setElapsed(ticket.time_spent_seconds + (ticket.timer_started_at ? (Date.now() - new Date(ticket.timer_started_at).getTime()) / 1000 : 0));
    compute();
    if (!ticket.timer_started_at) return;
    const id = setInterval(compute, 1000);
    return () => clearInterval(id);
  }, [ticket.timer_started_at, ticket.time_spent_seconds]);

  useEffect(() => { setEstimate(ticket.estimate_hours != null ? String(ticket.estimate_hours) : ''); }, [ticket.id, ticket.estimate_hours]);

  const loadEntries = useCallback(async () => {
    if (!showEntries) return;
    try { setEntries(await apiJson<Entry[]>(`/api/tickets/${ticket.id}/time`)); } catch { /* entries are supplementary */ }
  }, [ticket.id, showEntries]);
  useEffect(() => { void loadEntries(); }, [loadEntries, ticket.time_spent_seconds, ticket.timer_started_at]);

  const toggle = async () => {
    setBusy(true); setError(null);
    try { await (running ? stopTimer(ticket.id) : startTimer(ticket.id)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not change the timer.'); }
    finally { setBusy(false); }
  };

  const logManual = async (e: React.FormEvent) => {
    e.preventDefault();
    const seconds = (Number(hours || 0) * 3600) + (Number(minutes || 0) * 60);
    if (!Number.isFinite(seconds) || seconds < 60) { setError('Enter at least 1 minute.'); return; }
    setBusy(true); setError(null);
    try {
      await apiJson(`/api/tickets/${ticket.id}/time`, { method: 'POST', json: { seconds: Math.round(seconds), note: note.trim() || null } });
      setHours(''); setMinutes(''); setNote(''); setManualOpen(false);
      await refresh(); await loadEntries();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not log time.'); }
    finally { setBusy(false); }
  };

  const removeEntry = async (id: number) => {
    setError(null);
    try { await apiJson(`/api/time/${id}`, { method: 'DELETE' }); await refresh(); await loadEntries(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not delete the entry.'); }
  };

  const saveEstimate = async () => {
    const v = estimate.trim() === '' ? null : Number(estimate);
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 200)) { setError('Estimate must be between 0 and 200 hours.'); return; }
    if (v === (ticket.estimate_hours ?? null)) return;
    setError(null);
    try { await updateTicket(ticket.id, { estimate_hours: v }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save the estimate.'); }
  };

  const est = ticket.estimate_hours ?? null;
  const pct = est ? Math.min(100, Math.round((elapsed / 3600 / est) * 100)) : null;
  const over = est != null && elapsed / 3600 > est;

  return (
    <div style={{ background: running ? 'rgba(16,185,129,0.05)' : '#F8FAFC', border: `1px solid ${running ? 'rgba(16,185,129,0.2)' : 'rgba(226,232,240,0.85)'}`, borderRadius: 'var(--radius-md)', padding: '0.875rem 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: running ? 'rgba(16,185,129,0.12)' : 'rgba(0,63,138,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: running ? '#059669' : '#003F8A' }}>
            <Clock size={15} />
          </div>
          <div>
            <p className="section-label">Time logged</p>
            <p style={{ fontSize: '1.1rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: running ? '#059669' : '#0F172A', lineHeight: 1 }}>{fmtClock(elapsed)}</p>
          </div>
        </div>
        <button type="button" onClick={() => void toggle()} disabled={busy}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.5rem 1rem', borderRadius: 'var(--radius-btn)', border: 'none', cursor: busy ? 'wait' : 'pointer',
                   background: running ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)', color: running ? '#b91c1c' : '#047857', fontSize: '0.78rem', fontWeight: 800 }}>
          {running ? <><Pause size={13} /> Stop</> : <><Play size={13} /> Start</>}
        </button>
      </div>

      {running && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: '0.7rem', color: '#047857', fontWeight: 700 }}>
          <span style={{ width: 6, height: 6, borderRadius: 99, background: '#10B981', display: 'inline-block', animation: 'pulse-dot 1.2s ease-in-out infinite' }} /> Timer running…
        </div>
      )}

      {/* Estimate vs logged */}
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <label htmlFor={`est-${ticket.id}`} className="section-label">Estimate (hours)</label>
          {isLead ? (
            <input id={`est-${ticket.id}`} className="input-field" inputMode="decimal" value={estimate} placeholder="Default"
              onChange={e => setEstimate(e.target.value)} onBlur={() => void saveEstimate()} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              style={{ width: 84, padding: '0.25rem 0.5rem', fontSize: '0.78rem', textAlign: 'right' }} />
          ) : (
            <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>{est != null ? `${est} h` : 'Default'}</span>
          )}
        </div>
        {pct !== null && (
          <>
            <div style={{ height: 5, background: 'rgba(226,232,240,0.8)', borderRadius: 99, marginTop: 6, overflow: 'hidden' }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Time used versus estimate">
              <div style={{ height: '100%', width: `${pct}%`, background: over ? '#EF4444' : '#10B981', transition: 'width 0.3s' }} />
            </div>
            <p style={{ fontSize: '0.68rem', color: over ? '#b91c1c' : '#64748b', marginTop: 3 }}>{over ? 'Over estimate' : `${pct}% of estimate used`}</p>
          </>
        )}
      </div>

      {error && <p role="alert" style={{ marginTop: 8, fontSize: '0.74rem', color: '#b91c1c' }}>{error}</p>}

      {showEntries && (
        <div style={{ marginTop: 10, borderTop: '1px solid rgba(226,232,240,0.8)', paddingTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="section-label">Entries ({entries.length})</span>
            <button type="button" className="chip" onClick={() => setManualOpen(o => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={11} /> Log time</button>
          </div>

          {manualOpen && (
            <form onSubmit={logManual} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'flex-end' }}>
              <label style={{ fontSize: '0.68rem', color: '#64748b' }}>Hours
                <input className="input-field" inputMode="numeric" value={hours} onChange={e => setHours(e.target.value.replace(/\D/g, '').slice(0, 2))} style={{ width: 60, padding: '0.3rem 0.5rem', fontSize: '0.8rem', display: 'block' }} />
              </label>
              <label style={{ fontSize: '0.68rem', color: '#64748b' }}>Minutes
                <input className="input-field" inputMode="numeric" value={minutes} onChange={e => setMinutes(e.target.value.replace(/\D/g, '').slice(0, 2))} style={{ width: 60, padding: '0.3rem 0.5rem', fontSize: '0.8rem', display: 'block' }} />
              </label>
              <label style={{ fontSize: '0.68rem', color: '#64748b', flex: 1, minWidth: 100 }}>Note (optional)
                <input className="input-field" value={note} maxLength={200} onChange={e => setNote(e.target.value)} style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', display: 'block', width: '100%' }} />
              </label>
              <button type="submit" className="btn-primary" disabled={busy} style={{ padding: '0.35rem 0.8rem', fontSize: '0.76rem' }}>Add</button>
            </form>
          )}

          {entries.length === 0 ? (
            <p style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: 6 }}>No time recorded yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 150, overflowY: 'auto' }}>
              {entries.map(en => (
                <li key={en.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.74rem', color: '#475569' }}>
                  <strong style={{ minWidth: 48 }}>{en.ended_at ? fmtHm(en.seconds) : 'running'}</strong>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {en.user_name}{en.note ? ` — ${en.note}` : ''} <span style={{ color: '#94a3b8' }}>· {en.source} · {new Date(en.started_at).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>
                  </span>
                  {en.ended_at && (en.user_id === myId || isLead) && (
                    <button type="button" aria-label="Delete time entry" onClick={() => void removeEntry(en.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', padding: 2 }}><Trash2 size={12} /></button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
