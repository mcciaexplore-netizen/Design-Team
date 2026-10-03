import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Users } from 'lucide-react';
import { apiJson } from '../api';

interface Day { date: string; capacity: number; planned: number }
interface Designer {
  designer_id: number; designer_name: string; daily_capacity_hours: number; capacity_hours: number; planned_hours: number;
  open_tickets: number; logged_hours_prev_7_days: number; utilization_pct: number; is_overloaded: boolean; overload_date: string | null; days: Day[];
}
interface Workload {
  window: { start: string; end: string; days: number }; designers: Designer[]; overloaded_count: number;
  unassigned_hours: number; unassigned_tickets: number;
}

const dayLabel = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso}T00:00:00`).toLocaleDateString([], opts);

/** Colour + text for one day's load. Text is always shown so colour is never the only signal. */
function cell(day: Day): { bg: string; fg: string; text: string; label: string } {
  if (day.capacity === 0) return { bg: '#f1f5f9', fg: '#94a3b8', text: 'off', label: 'Not working' };
  const pct = day.planned / day.capacity;
  const text = `${day.planned}h`;
  if (pct > 1) return { bg: 'rgba(239,68,68,0.16)', fg: '#b91c1c', text, label: 'Over capacity' };
  if (pct >= 0.8) return { bg: 'rgba(245,158,11,0.18)', fg: '#92400e', text, label: 'Nearly full' };
  if (pct > 0) return { bg: 'rgba(16,185,129,0.14)', fg: '#047857', text, label: 'Comfortable' };
  return { bg: '#f8fafc', fg: '#94a3b8', text: '–', label: 'Free' };
}

export default function WorkloadPage() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Workload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await apiJson<Workload>(`/api/workload?days=${days}`)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load workload.'); }
    finally { setLoading(false); }
  }, [days]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', paddingBottom: '2rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div role="group" aria-label="Time window" style={{ display: 'inline-flex', border: '1px solid rgba(226,232,240,0.9)', borderRadius: 9, overflow: 'hidden', background: 'white' }}>
          {[7, 14, 30].map(d => (
            <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}
              style={{ padding: '0.4rem 0.9rem', fontSize: '0.78rem', fontWeight: 700, border: 'none', cursor: 'pointer', background: days === d ? 'var(--brand-soft)' : 'transparent', color: days === d ? 'var(--brand)' : '#64748b' }}>
              Next {d} days
            </button>
          ))}
        </div>
        {data && <span style={{ fontSize: '0.78rem', color: '#64748b' }}>{dayLabel(data.window.start, { day: 'numeric', month: 'short' })} – {dayLabel(data.window.end, { day: 'numeric', month: 'short' })}</span>}
      </div>

      {error && <p role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{error} <button type="button" className="chip" onClick={() => void load()}>Retry</button></p>}
      {loading && !data && <p role="status" style={{ color: '#94a3b8' }}>Calculating workload…</p>}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
            <div className="glass-card" style={{ padding: '1rem' }}>
              <p className="section-label">Overloaded people</p>
              <p style={{ fontSize: '1.7rem', fontWeight: 800, fontFamily: 'var(--font-body)', color: data.overloaded_count ? '#dc2626' : '#047857' }}>{data.overloaded_count}</p>
              <p style={{ fontSize: '0.72rem', color: '#64748b' }}>{data.overloaded_count ? 'Work due exceeds available hours' : 'Everyone can meet their deadlines'}</p>
            </div>
            <div className="glass-card" style={{ padding: '1rem' }}>
              <p className="section-label">Unassigned work</p>
              <p style={{ fontSize: '1.7rem', fontWeight: 800, fontFamily: 'var(--font-body)', color: '#0F172A' }}>{data.unassigned_hours}h</p>
              <p style={{ fontSize: '0.72rem', color: '#64748b' }}>{data.unassigned_tickets} ticket{data.unassigned_tickets === 1 ? '' : 's'} without an owner</p>
            </div>
          </div>

          {data.designers.length === 0 && <p style={{ color: '#94a3b8' }}>No designers found.</p>}

          {data.designers.map(d => {
            const pct = Math.min(100, d.utilization_pct);
            return (
              <section key={d.designer_id} className="glass-card" style={{ padding: '1.1rem 1.25rem' }} aria-label={`${d.designer_name} workload`}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div className="icon-tile" style={{ width: 32, height: 32 }}><Users size={14} /></div>
                  <h3 style={{ fontSize: '0.92rem', fontWeight: 800, fontFamily: 'var(--font-body)' }}>{d.designer_name}</h3>
                  <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{d.open_tickets} open · {d.logged_hours_prev_7_days}h logged last week</span>
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', fontWeight: 800, color: d.is_overloaded ? '#dc2626' : '#047857' }}>
                    {d.is_overloaded ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
                    {d.planned_hours}h planned / {d.capacity_hours}h available ({d.utilization_pct}%)
                  </span>
                </div>
                <div style={{ height: 7, background: 'rgba(226,232,240,0.8)', borderRadius: 99, overflow: 'hidden' }} role="progressbar" aria-valuenow={Math.min(d.utilization_pct, 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${d.designer_name} utilisation`}>
                  <div style={{ height: '100%', width: `${pct}%`, background: d.is_overloaded ? 'linear-gradient(90deg,#EF4444,#f87171)' : 'linear-gradient(90deg,#059669,#10B981)' }} />
                </div>
                {d.overload_date && (
                  <p style={{ fontSize: '0.74rem', color: '#b91c1c', marginTop: 6, fontWeight: 600 }}>
                    Falls behind from {dayLabel(d.overload_date, { weekday: 'long', day: 'numeric', month: 'short' })}: more work is due by then than there are working hours.
                  </p>
                )}
                <div style={{ display: 'flex', gap: 4, marginTop: 12, overflowX: 'auto', paddingBottom: 2 }}>
                  {d.days.map(day => {
                    const c = cell(day);
                    return (
                      <div key={day.date} title={`${dayLabel(day.date, { weekday: 'long', day: 'numeric', month: 'short' })}: ${day.planned}h planned of ${day.capacity}h — ${c.label}`}
                        style={{ minWidth: 46, flex: '1 0 46px', textAlign: 'center', borderRadius: 8, background: c.bg, color: c.fg, padding: '0.35rem 0.1rem' }}>
                        <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', opacity: 0.8 }}>{dayLabel(day.date, { weekday: 'short' })}</div>
                        <div style={{ fontSize: '0.78rem', fontWeight: 800 }}>{c.text}</div>
                        <div style={{ fontSize: '0.58rem' }}>{dayLabel(day.date, { day: 'numeric', month: 'short' })}</div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
          <p style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
            Planned hours are each ticket&apos;s remaining effort (its estimate, or the design-type default, minus time already logged), placed on its due date. Weekends, holidays and leave reduce capacity.
          </p>
        </>
      )}
    </div>
  );
}
