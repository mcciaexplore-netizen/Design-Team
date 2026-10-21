import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface BreakdownRow {
  tickets: number; revisions: number; avg_revisions: number; delivered: number;
  on_time_rate_pct: number | null; avg_turnaround_hours: number | null; hours_logged: number;
  client?: string; design_type?: string;
}

const tooltipStyle = { borderRadius: 10, border: '1px solid rgba(226,232,240,0.9)', fontSize: 12 };
const hours = (h: number | null) => (h === null ? '—' : h >= 48 ? `${(h / 24).toFixed(1)} d` : `${h} h`);

/** Volume, delivery and on-time rate by design type or client, switchable — with the finer numbers alongside each bar. */
export default function BreakdownChart({ byDesignType, byClient }: { byDesignType: BreakdownRow[]; byClient: BreakdownRow[] }) {
  const [view, setView] = useState<'type' | 'client'>('type');
  const rows = view === 'type' ? byDesignType : byClient;
  const data = rows.map(r => ({
    name: r.design_type ?? r.client ?? '—', Tickets: r.tickets, Delivered: r.delivered,
    'On time %': r.on_time_rate_pct ?? 0, avg_turnaround_hours: r.avg_turnaround_hours,
    avg_revisions: r.avg_revisions, hours_logged: r.hours_logged,
  }));

  return (
    <section className="glass-card dashboard-chart-card" aria-labelledby="bd-h" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <h3 id="bd-h">Volume and on-time rate</h3>
        <div role="group" aria-label="Group by" style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="chip" aria-pressed={view === 'type'} onClick={() => setView('type')}>By design type</button>
          <button type="button" className="chip" aria-pressed={view === 'client'} onClick={() => setView('client')}>By client</button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-soft)' }}>No tickets in this period.</p>
      ) : (
        <>
          <div style={{ height: Math.max(180, rows.length * 42) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="Tickets" fill="#cbd5e1" radius={[0, 4, 4, 0]} />
                <Bar dataKey="Delivered" fill="#003F8A" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#64748b', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <th style={{ padding: '4px 8px' }}>{view === 'type' ? 'Design type' : 'Client'}</th>
                  <th style={{ padding: '4px 8px' }}>On time</th><th style={{ padding: '4px 8px' }}>Avg turnaround</th>
                  <th style={{ padding: '4px 8px' }}>Revisions / ticket</th><th style={{ padding: '4px 8px' }}>Hours</th>
                </tr>
              </thead>
              <tbody>
                {data.map(r => (
                  <tr key={r.name} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 700 }}>{r.name}</td>
                    <td style={{ padding: '6px 8px' }}>{r['On time %'] ? `${r['On time %']}%` : '—'}</td>
                    <td style={{ padding: '6px 8px' }}>{hours(r.avg_turnaround_hours)}</td>
                    <td style={{ padding: '6px 8px' }}>{r.avg_revisions}</td>
                    <td style={{ padding: '6px 8px' }}>{r.hours_logged}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
