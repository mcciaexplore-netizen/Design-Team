import { useState } from 'react';

export interface BreakdownRow {
  tickets: number; revisions: number; avg_revisions: number; delivered: number;
  on_time_rate_pct: number | null; avg_turnaround_hours: number | null; hours_logged: number;
  client?: string; design_type?: string;
}

const hours = (h: number | null) => (h === null ? '—' : h >= 48 ? `${(h / 24).toFixed(1)} d` : `${h} h`);
const pct = (p: number | null) => (p === null ? '—' : `${p}%`);

/** Turnaround, revision rate and on-time rate, switchable between design types and clients. */
export default function BreakdownTable({ byDesignType, byClient }: { byDesignType: BreakdownRow[]; byClient: BreakdownRow[] }) {
  const [view, setView] = useState<'type' | 'client'>('type');
  const rows = view === 'type' ? byDesignType : byClient;

  return (
    <section className="glass-card dashboard-chart-card" aria-labelledby="bd-h" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <h3 id="bd-h">Turnaround and revisions</h3>
        <div role="group" aria-label="Group by" style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="chip" aria-pressed={view === 'type'} onClick={() => setView('type')}>By design type</button>
          <button type="button" className="chip" aria-pressed={view === 'client'} onClick={() => setView('client')}>By client</button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-soft)' }}>No tickets in this period.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748b', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <th style={{ padding: '4px 8px' }}>{view === 'type' ? 'Design type' : 'Client'}</th>
                <th style={{ padding: '4px 8px' }}>Tickets</th><th style={{ padding: '4px 8px' }}>Delivered</th>
                <th style={{ padding: '4px 8px' }}>On time</th><th style={{ padding: '4px 8px' }}>Avg turnaround</th>
                <th style={{ padding: '4px 8px' }}>Revisions / ticket</th><th style={{ padding: '4px 8px' }}>Hours</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.design_type ?? r.client} style={{ borderTop: '1px solid var(--border-soft)' }}>
                  <td style={{ padding: '7px 8px', fontWeight: 700 }}>{r.design_type ?? r.client}</td>
                  <td style={{ padding: '7px 8px' }}>{r.tickets}</td><td style={{ padding: '7px 8px' }}>{r.delivered}</td>
                  <td style={{ padding: '7px 8px' }}>{pct(r.on_time_rate_pct)}</td><td style={{ padding: '7px 8px' }}>{hours(r.avg_turnaround_hours)}</td>
                  <td style={{ padding: '7px 8px' }}>{r.avg_revisions}</td><td style={{ padding: '7px 8px' }}>{r.hours_logged}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
