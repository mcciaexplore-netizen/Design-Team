import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { AlertTriangle, CheckCircle2, Clock, Inbox } from 'lucide-react';
import { apiJson } from '../api';
import { DONE_STATUSES, STATUSES } from '../types';
import { useTickets } from '../contexts/TicketsContext';
import ForecastingWidget from './ForecastingWidget';
import ReportsExport from './ReportsExport';
import BreakdownTable, { type BreakdownRow } from './BreakdownTable';

interface Summary {
  range: { from: string; to: string };
  kpis: { tickets_created: number; tickets_delivered: number; on_time_rate_pct: number | null; avg_turnaround_hours: number | null; avg_revisions_per_ticket: number | null; hours_logged: number };
  sla_trend: { week_start: string; on_time: number; late: number; overdue_open: number }[];
  by_design_type: BreakdownRow[];
  by_client: BreakdownRow[];
}
interface Workload { designers: { designer_id: number; designer_name: string; capacity_hours: number; planned_hours: number }[] }

const tooltipStyle = { borderRadius: 10, border: '1px solid rgba(226,232,240,0.9)', fontSize: 12 };
const fmtHours = (h: number | null) => (h === null ? '—' : h >= 48 ? `${(h / 24).toFixed(1)} d` : `${h} h`);
const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' });

function Stat({ label, value, sub, icon: Icon, tone = '#18181b' }: { label: string; value: string; sub: string; icon: typeof Clock; tone?: string }) {
  return (
    <div className="glass-card dashboard-stat-card" style={{ padding: '1.25rem' }}>
      <div className="dashboard-stat-icon"><div className="icon-tile" style={{ color: tone }}><Icon size={18} /></div></div>
      <p className="section-label dashboard-stat-label">{label}</p>
      <p className="kpi-number dashboard-stat-number" style={{ color: tone }}>{value}</p>
      <p className="dashboard-stat-trend" style={{ color: '#64748b' }}>{sub}</p>
    </div>
  );
}

const Dashboard = () => {
  const { tickets } = useTickets();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [workload, setWorkload] = useState<Workload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    const end = new Date();
    const start = new Date(end.getTime() - 29 * 86_400_000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    Promise.all([
      apiJson<Summary>(`/api/reports/summary?from=${iso(start)}&to=${iso(end)}`),
      apiJson<Workload>('/api/workload?days=7'),
    ])
      .then(([s, w]) => { setSummary(s); setWorkload(w); setError(null); })
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load the dashboard.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const byStage = useMemo(
    () => STATUSES.map(s => ({ stage: s, tickets: tickets.filter(t => t.status === s).length })),
    [tickets],
  );
  const overdueOpen = useMemo(
    () => tickets.filter(t => t.due_at && new Date(t.due_at).getTime() < Date.now() && !DONE_STATUSES.includes(t.status)).length,
    [tickets],
  );

  const k = summary?.kpis;
  const trend = (summary?.sla_trend ?? []).map(w => ({ week: shortDate(w.week_start), 'On time': w.on_time, Late: w.late, 'Overdue & open': w.overdue_open }));
  const load7 = (workload?.designers ?? []).map(d => ({ name: d.designer_name, Planned: d.planned_hours, Capacity: d.capacity_hours }));

  return (
    <div className="dashboard-page">
      <div className="dashboard-intro">
        <h1>Performance at a glance</h1>
        <p>The last 30 days of delivery, plus what's on the team's plate this week.</p>
      </div>

      {error && <p role="alert" style={{ color: '#b91c1c', marginBottom: 12 }}>{error} <button type="button" className="chip" onClick={load}>Retry</button></p>}
      {loading && !summary && <p role="status" style={{ color: '#94a3b8' }}>Loading…</p>}

      {summary && k && (
        <>
          <div className="dashboard-kpis">
            <Stat label="Delivered" value={String(k.tickets_delivered)} sub={`of ${k.tickets_created} created`} icon={CheckCircle2} tone="#059669" />
            <Stat label="On-time rate" value={k.on_time_rate_pct === null ? '—' : `${k.on_time_rate_pct}%`} sub={k.on_time_rate_pct === null ? 'No delivered tickets yet' : 'delivered by their due date'} icon={Clock} />
            <Stat label="Overdue right now" value={String(overdueOpen)} sub={`avg turnaround ${fmtHours(k.avg_turnaround_hours)}`} icon={AlertTriangle} tone={overdueOpen ? '#dc2626' : '#059669'} />
          </div>

          {k.tickets_created === 0 ? (
            <div className="glass-card" style={{ padding: '2.5rem', textAlign: 'center', marginTop: 16 }}>
              <Inbox size={32} style={{ color: '#94a3b8', margin: '0 auto 8px' }} />
              <p style={{ fontWeight: 700, color: '#0F172A' }}>No tickets in the last 30 days</p>
              <p style={{ fontSize: '0.82rem', color: '#64748b', marginTop: 4 }}>Charts appear once tickets are created and delivered.</p>
            </div>
          ) : (
            <div className="dashboard-chart-grid">
              <div className="glass-card dashboard-chart-card">
                <h3>SLA performance by week</h3>
                <div style={{ height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="On time" stackId="a" fill="#10B981" />
                      <Bar dataKey="Late" stackId="a" fill="#EF4444" />
                      <Bar dataKey="Overdue & open" stackId="a" fill="#f59e0b" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="glass-card dashboard-chart-card">
                <h3>Open work by stage</h3>
                <div style={{ height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byStage} layout="vertical" margin={{ left: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="stage" width={120} tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="tickets" fill="#18181b" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          <div className="dashboard-chart-grid dashboard-chart-grid-secondary">
            <div className="glass-card dashboard-chart-card">
              <h3>This week: planned hours vs capacity</h3>
              {load7.length === 0 ? <p style={{ color: '#94a3b8', fontSize: '0.82rem' }}>No designers yet.</p> : (
                <div style={{ height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={load7}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} unit="h" />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Planned" fill="#8b5cf6" />
                      <Bar dataKey="Capacity" fill="#cbd5e1" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            <ForecastingWidget />
          </div>

          <BreakdownTable byDesignType={summary?.by_design_type ?? []} byClient={summary?.by_client ?? []} />
          <ReportsExport />
        </>
      )}
    </div>
  );
};

export default Dashboard;
