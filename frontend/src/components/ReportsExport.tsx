import { useEffect, useState } from 'react';
import { FileDown, FileText } from 'lucide-react';
import { apiJson, downloadFile } from '../api';

const iso = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60_000); // local calendar date, not UTC
  return z.toISOString().slice(0, 10);
};

function preset(kind: 'last30' | 'thisMonth' | 'lastMonth'): [string, string] {
  const now = new Date();
  if (kind === 'last30') return [iso(new Date(now.getTime() - 29 * 86_400_000)), iso(now)];
  if (kind === 'thisMonth') return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)];
  return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))];
}

const EXPORTS = [
  { key: 'sla', label: 'SLA performance', hint: 'Weekly on-time vs late (CSV)', path: '/api/reports/export.csv?report=sla', ext: 'csv', Icon: FileDown },
  { key: 'design_types', label: 'By design type', hint: 'Turnaround, revisions and on-time rate by design type (CSV)', path: '/api/reports/export.csv?report=design_types', ext: 'csv', Icon: FileDown },
  { key: 'clients', label: 'Revisions per client', hint: 'Revisions, turnaround and on-time rate by client (CSV)', path: '/api/reports/export.csv?report=clients', ext: 'csv', Icon: FileDown },
  { key: 'tickets', label: 'All tickets', hint: 'One row per ticket (CSV)', path: '/api/reports/export.csv?report=tickets', ext: 'csv', Icon: FileDown },
  { key: 'pdf', label: 'Monthly report', hint: 'KPIs, SLA trend and client table (PDF)', path: '/api/reports/export.pdf?x=1', ext: 'pdf', Icon: FileText },
] as const;

/** Lead-only: download SLA / per-client / ticket CSVs and a PDF summary for any date range. */
export default function ReportsExport() {
  const [[from, to], setRange] = useState<[string, string]>(() => preset('lastMonth'));
  const [clients, setClients] = useState<string[]>([]);
  const [client, setClient] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { apiJson<string[]>('/api/reports/clients').then(setClients).catch(() => setClients([])); }, []);

  const invalid = !from || !to || from > to;

  const run = async (e: (typeof EXPORTS)[number]) => {
    setBusy(e.key); setError('');
    try {
      const qs = `&from=${from}&to=${to}${client ? `&client_org=${encodeURIComponent(client)}` : ''}`;
      await downloadFile(`${e.path}${qs}`, `designdesk_${e.key === 'pdf' ? 'report' : e.key}_${from}_${to}.${e.ext}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Export failed.'); }
    finally { setBusy(null); }
  };

  return (
    <section className="glass-card dashboard-chart-card" aria-labelledby="export-h" style={{ marginTop: 16 }}>
      <h3 id="export-h">Export reports</h3>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-soft)', marginBottom: 12 }}>Download figures for monthly reviews. Dates use India time and cover tickets created in the range.</p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 12 }}>
        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-soft)' }}>From
          <input className="input-field" type="date" value={from} max={to || undefined} onChange={e => setRange([e.target.value, to])} style={{ display: 'block', marginTop: 3 }} />
        </label>
        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-soft)' }}>To
          <input className="input-field" type="date" value={to} min={from || undefined} onChange={e => setRange([from, e.target.value])} style={{ display: 'block', marginTop: 3 }} />
        </label>
        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-soft)' }}>Client
          <select className="input-field" value={client} onChange={e => setClient(e.target.value)} style={{ display: 'block', marginTop: 3 }}>
            <option value="">All clients</option>
            {clients.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <div role="group" aria-label="Date presets" style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="chip" onClick={() => setRange(preset('lastMonth'))}>Last month</button>
          <button type="button" className="chip" onClick={() => setRange(preset('thisMonth'))}>This month</button>
          <button type="button" className="chip" onClick={() => setRange(preset('last30'))}>Last 30 days</button>
        </div>
      </div>
      {from > to && to && <p role="alert" style={{ color: 'var(--danger-text)', fontSize: '0.8rem', marginBottom: 8 }}>“From” must be on or before “To”.</p>}

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
        {EXPORTS.map(e => (
          <button key={e.key} type="button" className="btn-ghost" disabled={invalid || busy !== null} onClick={() => void run(e)}
            style={{ flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', gap: 2, padding: '0.7rem 0.9rem', height: 'auto' }}>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontWeight: 700 }}><e.Icon size={14} aria-hidden="true" /> {busy === e.key ? 'Preparing…' : e.label}</span>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-soft)', fontWeight: 500 }}>{e.hint}</span>
          </button>
        ))}
      </div>
      {error && <p role="alert" style={{ color: 'var(--danger-text)', fontSize: '0.82rem', fontWeight: 600, marginTop: 10 }}>{error}</p>}
    </section>
  );
}
