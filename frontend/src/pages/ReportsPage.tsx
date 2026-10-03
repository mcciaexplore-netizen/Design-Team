import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { format, subDays, startOfYear, parseISO } from 'date-fns';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { Download, FileText, RefreshCw, AlertTriangle, Lock, BarChart3 } from 'lucide-react';
import { apiJson, downloadFile } from '../api';
import { useAuth } from '../contexts/AuthContext';

interface Kpis {
  tickets_created: number; tickets_delivered: number; on_time_rate_pct: number | null;
  avg_turnaround_hours: number | null; avg_revisions_per_ticket: number | null; hours_logged: number;
}
interface SlaWeek {
  week_start: string; due: number; on_time: number; late: number; overdue_open: number;
  on_time_rate_pct: number | null;
}
interface ClientRow {
  client: string; tickets: number; revisions: number; avg_revisions: number;
  tickets_with_3plus_revisions: number; delivered: number; on_time_rate_pct: number | null;
  avg_turnaround_hours: number | null; hours_logged: number;
}
interface Summary {
  range: { from: string; to: string; client_org: string | null };
  kpis: Kpis; sla_trend: SlaWeek[]; by_client: ClientRow[];
  revision_categories: { category: string; count: number }[];
}

const BLUE = '#003F8A', GREEN = '#10B981', RED = '#EF4444', AMBER = '#f59e0b';
const iso = (d: Date) => format(d, 'yyyy-MM-dd');
const dash = '—';
const fmtPct = (v: number | null | undefined) => (v == null ? dash : `${Math.round(v * 10) / 10}%`);
const fmtNum = (v: number | null | undefined, d = 1) => (v == null ? dash : String(Math.round(v * 10 ** d) / 10 ** d));
const fmtHours = (h: number | null | undefined) =>
  h == null ? dash : h >= 48 ? `${Math.round((h / 24) * 10) / 10} d` : `${Math.round(h * 10) / 10} h`;
const fmtWeek = (s: string) => { try { return format(parseISO(s), 'd MMM'); } catch { return s; } };

const PRESETS = [
  { label: 'Last 30 days', get: (): [string, string] => [iso(subDays(new Date(), 30)), iso(new Date())] },
  { label: 'Last 90 days', get: (): [string, string] => [iso(subDays(new Date(), 90)), iso(new Date())] },
  { label: 'Last 180 days', get: (): [string, string] => [iso(subDays(new Date(), 180)), iso(new Date())] },
  { label: 'This year', get: (): [string, string] => [iso(startOfYear(new Date())), iso(new Date())] },
];

const FIELD: CSSProperties = { fontSize: '0.78rem', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 6 };
const CARD: CSSProperties = { padding: '1.25rem' };
const H2: CSSProperties = { fontFamily: 'var(--font-heading)', fontSize: '1rem', fontWeight: 700, color: '#0f172a', margin: '0 0 4px' };
const TH: CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', whiteSpace: 'nowrap', borderBottom: '1px solid #e2e8f0' };
const TD: CSSProperties = { padding: '8px 10px', fontSize: '0.82rem', color: '#0f172a', whiteSpace: 'nowrap', borderBottom: '1px solid #f1f5f9' };

function Card({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="glass-card" style={CARD}>
      <h2 style={H2}>{title}</h2>
      {sub && <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0 0 12px' }}>{sub}</p>}
      {children}
    </section>
  );
}

export default function ReportsPage() {
  const { user } = useAuth();
  const isLead = user?.role === 'Design Lead';
  const [initial] = useState(() => PRESETS[1].get());
  const [from, setFrom] = useState<string>(initial[0]);
  const [to, setTo] = useState<string>(initial[1]);
  const [client, setClient] = useState('');
  const [clients, setClients] = useState<string[]>([]);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const reqId = useRef(0);

  const qs = useCallback(() => {
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (client) p.set('client_org', client);
    return p;
  }, [from, to, client]);

  const load = useCallback(() => {
    const id = ++reqId.current;
    setLoading(true); setError(null);
    apiJson<Summary>(`/api/reports/summary?${qs().toString()}`)
      .then(r => { if (id === reqId.current) { setData(r); setLoading(false); } })
      .catch((e: unknown) => {
        if (id !== reqId.current) return;
        setError(e instanceof Error ? e.message : 'Could not load the report.');
        setLoading(false);
      });
  }, [qs]);

  useEffect(() => { if (isLead) load(); }, [isLead, load]);
  useEffect(() => {
    if (!isLead) return;
    let live = true;
    apiJson<string[]>('/api/reports/clients').then(c => { if (live) setClients(c); }).catch(() => undefined);
    return () => { live = false; };
  }, [isLead]);

  if (!isLead) {
    return (
      <div className="glass-card" style={{ ...CARD, textAlign: 'center', padding: '2.5rem 1.25rem' }}>
        <Lock size={28} color="#64748b" aria-hidden="true" />
        <h2 style={{ ...H2, marginTop: 10 }}>Reports are available to Design Leads</h2>
        <p style={{ color: '#64748b', fontSize: '0.85rem', margin: 0 }}>Ask your Design Lead if you need a copy of a report.</p>
      </div>
    );
  }

  const doExport = async (path: string, name: string) => {
    setExporting(true); setExportMsg(null);
    try {
      await downloadFile(`${path}${path.includes('?') ? '&' : '?'}${qs().toString()}`, name);
      setExportMsg({ ok: true, text: `Exported ${name}.` });
    } catch (e) {
      setExportMsg({ ok: false, text: e instanceof Error ? e.message : 'Export failed.' });
    } finally { setExporting(false); }
  };

  const exportBtns: [string, string, string, boolean][] = [
    ['CSV: tickets', '/api/reports/export.csv?report=tickets', 'tickets.csv', false],
    ['CSV: SLA by week', '/api/reports/export.csv?report=sla', 'sla-by-week.csv', false],
    ['CSV: by client', '/api/reports/export.csv?report=clients', 'by-client.csv', false],
    ['PDF summary', '/api/reports/export.pdf', 'summary.pdf', true],
  ];

  const k = data?.kpis;
  const tiles: [string, string][] = k ? [
    ['Tickets created', String(k.tickets_created)],
    ['Delivered', String(k.tickets_delivered)],
    ['On-time rate', fmtPct(k.on_time_rate_pct)],
    ['Avg turnaround', fmtHours(k.avg_turnaround_hours)],
    ['Avg revisions / ticket', fmtNum(k.avg_revisions_per_ticket, 2)],
    ['Hours logged', fmtNum(k.hours_logged, 1)],
  ] : [];

  const sla = (data?.sla_trend ?? []).map(w => ({ ...w, label: fmtWeek(w.week_start) }));
  const byClient = data?.by_client ?? [];
  const cats = data?.revision_categories ?? [];
  const maxCat = Math.max(1, ...cats.map(c => c.count));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="glass-card" style={CARD} aria-label="Report filters">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {PRESETS.map(p => {
            const [f, t] = p.get();
            const active = from === f && to === t;
            return (
              <button key={p.label} type="button" className={active ? 'btn-primary' : 'btn-ghost'}
                aria-pressed={active} onClick={() => { setFrom(f); setTo(t); }}>{p.label}</button>
            );
          })}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <div><label htmlFor="rep-from" style={FIELD}>From</label>
            <input id="rep-from" type="date" className="input-field" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></div>
          <div><label htmlFor="rep-to" style={FIELD}>To</label>
            <input id="rep-to" type="date" className="input-field" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></div>
          <div><label htmlFor="rep-client" style={FIELD}>Client</label>
            <select id="rep-client" className="input-field" value={client} onChange={e => setClient(e.target.value)}>
              <option value="">All clients</option>
              {clients.map(c => <option key={c} value={c}>{c}</option>)}
            </select></div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14, alignItems: 'center' }}>
          <span className="section-label" style={{ margin: 0 }}>Export</span>
          {exportBtns.map(([label, path, name, pdf]) => (
            <button key={name} type="button" className="btn-ghost" disabled={loading || exporting || !!error}
              onClick={() => doExport(path, name)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {pdf ? <FileText size={14} aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}{label}
            </button>
          ))}
          <span role="status" aria-live="polite" style={{ fontSize: '0.78rem', color: exportMsg?.ok ? '#047857' : RED }}>
            {exporting ? 'Preparing export…' : exportMsg?.text}
          </span>
        </div>
        <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '12px 0 0' }}>
          Delivery performance, SLA and revision patterns for the selected range.
        </p>
      </section>

      {error && (
        <div className="glass-card" role="alert" style={{ ...CARD, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <AlertTriangle size={20} color={RED} aria-hidden="true" />
          <span style={{ flex: 1, minWidth: 180, fontSize: '0.85rem', color: '#0f172a' }}>{error}</span>
          <button type="button" className="btn-primary" onClick={load}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {loading && !error && (
        <div role="status" aria-label="Loading report" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className="glass-card" style={{ ...CARD, height: 84, opacity: 0.6 }} />
          ))}
        </div>
      )}

      {!loading && !error && data && k && k.tickets_created === 0 && (
        <div className="glass-card" style={{ ...CARD, textAlign: 'center', padding: '2.5rem 1.25rem' }}>
          <BarChart3 size={28} color="#64748b" aria-hidden="true" />
          <h2 style={{ ...H2, marginTop: 10 }}>No tickets in this range</h2>
          <p style={{ color: '#64748b', fontSize: '0.85rem', margin: 0 }}>Try a wider date range or a different client.</p>
        </div>
      )}

      {!loading && !error && data && k && k.tickets_created > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            {tiles.map(([label, value]) => (
              <div key={label} className="glass-card" style={CARD}>
                <div className="section-label">{label}</div>
                <div style={{ fontFamily: 'var(--font-heading)', fontSize: '1.6rem', fontWeight: 800, color: BLUE }}>{value}</div>
              </div>
            ))}
          </div>

          <Card title="SLA performance by week" sub="Tickets due each week: on time, late, or overdue and still open, with on-time rate %.">
            {sla.length === 0 ? <p style={{ color: '#64748b', fontSize: '0.85rem' }}>No SLA data for this range.</p> : (
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                  <ComposedChart data={sla} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis yAxisId="l" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} label={{ value: 'Tickets', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }} />
                    <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} unit="%" />
                    <Tooltip />
                    <Legend />
                    <Bar yAxisId="l" dataKey="on_time" name="On time" stackId="s" fill={GREEN} />
                    <Bar yAxisId="l" dataKey="late" name="Late" stackId="s" fill={RED} />
                    <Bar yAxisId="l" dataKey="overdue_open" name="Overdue & open" stackId="s" fill={AMBER} />
                    <Line yAxisId="r" type="monotone" dataKey="on_time_rate_pct" name="On-time rate %" stroke={BLUE} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <Card title="Revisions by client" sub="Clients averaging 2+ revisions per ticket may need better briefs.">
            {byClient.length === 0 ? <p style={{ color: '#64748b', fontSize: '0.85rem' }}>No client data.</p> : (
              <>
                <div style={{ width: '100%', height: Math.max(180, byClient.length * 34 + 50) }}>
                  <ResponsiveContainer>
                    <BarChart data={byClient} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                      <YAxis type="category" dataKey="client" width={110} tick={{ fontSize: 11, fill: '#64748b' }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="revisions" name="Total revisions" fill={BLUE} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ overflowX: 'auto', marginTop: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                    <thead><tr>
                      {['Client', 'Tickets', 'Revisions', 'Avg revisions', '3+ revisions', 'On-time %', 'Avg turnaround', 'Hours'].map(h => <th key={h} scope="col" style={TH}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {byClient.map(c => (
                        <tr key={c.client}>
                          <td style={{ ...TD, fontWeight: 600 }}>{c.client}
                            {c.avg_revisions >= 2 && (
                              <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700, background: '#fee2e2', color: '#b91c1c' }}>High revision rate</span>
                            )}
                          </td>
                          <td style={TD}>{c.tickets}</td>
                          <td style={TD}>{c.revisions}</td>
                          <td style={TD}>{fmtNum(c.avg_revisions, 2)}</td>
                          <td style={TD}>{c.tickets_with_3plus_revisions}</td>
                          <td style={TD}>{fmtPct(c.on_time_rate_pct)}</td>
                          <td style={TD}>{fmtHours(c.avg_turnaround_hours)}</td>
                          <td style={TD}>{fmtNum(c.hours_logged, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>

          <Card title="Why changes were requested">
            {cats.length === 0 ? (
              <p style={{ color: '#64748b', fontSize: '0.85rem', margin: 0 }}>No categorised revision requests in this range. Nice and clean.</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {cats.map(c => (
                  <li key={c.category}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#0f172a', marginBottom: 4 }}>
                      <span>{c.category}</span><strong>{c.count}</strong>
                    </div>
                    <div style={{ background: '#e2e8f0', borderRadius: 999, height: 8 }} aria-hidden="true">
                      <div style={{ width: `${(c.count / maxCat) * 100}%`, background: BLUE, height: 8, borderRadius: 999 }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
