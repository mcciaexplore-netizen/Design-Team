import { useCallback, useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { apiJson } from '../api';
import type { DesignType } from '../contexts/TicketsContext';

interface Row { id: number; name: string; sla: string; effort: string; window: string; saving: boolean; note: { ok: boolean; text: string } | null }

const toRow = (d: DesignType): Row => ({
  id: d.id, name: d.name, sla: String(d.default_sla_hours), effort: String(d.default_effort_hours ?? 4),
  window: d.edit_window_hours ? String(d.edit_window_hours) : '', saving: false, note: null,
});

/** Lead-only: tune each design type's turnaround, typical effort (used for auto-assignment) and edit window. */
export default function DesignTypesAdmin() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows((await apiJson<DesignType[]>('/api/design-types')).map(toRow)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load design types.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const patch = (id: number, p: Partial<Row>) => setRows(rs => rs?.map(r => (r.id === id ? { ...r, ...p, note: p.note ?? null } : r)) ?? null);

  const save = async (r: Row) => {
    const sla = Number(r.sla), effort = Number(r.effort), win = r.window.trim() === '' ? null : Number(r.window);
    if (!Number.isInteger(sla) || sla < 1 || sla > 720) return patch(r.id, { note: { ok: false, text: 'Turnaround must be 1–720 hours.' } });
    if (!(effort > 0 && effort <= 200)) return patch(r.id, { note: { ok: false, text: 'Effort must be above 0 and at most 200 hours.' } });
    if (win !== null && (!Number.isInteger(win) || win < 1 || win > 336)) return patch(r.id, { note: { ok: false, text: 'Edit window must be 1–336 hours, or empty.' } });
    patch(r.id, { saving: true });
    try {
      const saved = await apiJson<DesignType>(`/api/design-types/${r.id}`, { method: 'PATCH', json: { default_sla_hours: sla, default_effort_hours: effort, edit_window_hours: win } });
      setRows(rs => rs?.map(x => (x.id === r.id ? { ...toRow(saved), note: { ok: true, text: 'Saved.' } } : x)) ?? null);
    } catch (e) { patch(r.id, { saving: false, note: { ok: false, text: e instanceof Error ? e.message : 'Could not save.' } }); }
  };

  if (error) return <p role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{error} <button type="button" className="chip" onClick={() => void load()}>Retry</button></p>;
  if (!rows) return <p role="status" style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Loading…</p>;

  return (
    <section className="glass-card" style={{ padding: '1.5rem' }} aria-labelledby="dt-h">
      <h2 id="dt-h" style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748b', marginBottom: 4 }}>Design types</h2>
      <p style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: 14, lineHeight: 1.5 }}>
        Turnaround sets new tickets' due dates. Effort is the typical hands-on time, used to pick the least-loaded designer. After delivery the client can
        still request changes for the edit window; leave it empty to use the studio default.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#64748b', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <th style={{ padding: '4px 8px' }}>Type</th><th style={{ padding: '4px 8px' }}>Turnaround (h)</th>
              <th style={{ padding: '4px 8px' }}>Effort (h)</th><th style={{ padding: '4px 8px' }}>Edit window (h)</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--border-soft)' }}>
                <td style={{ padding: '8px', fontWeight: 700 }}>{r.name}</td>
                <td style={{ padding: '8px' }}><input aria-label={`${r.name} turnaround hours`} className="input-field" inputMode="numeric" value={r.sla} onChange={e => patch(r.id, { sla: e.target.value })} style={{ width: 90 }} /></td>
                <td style={{ padding: '8px' }}><input aria-label={`${r.name} effort hours`} className="input-field" inputMode="decimal" value={r.effort} onChange={e => patch(r.id, { effort: e.target.value })} style={{ width: 90 }} /></td>
                <td style={{ padding: '8px' }}><input aria-label={`${r.name} edit window hours`} className="input-field" inputMode="numeric" placeholder="Default" value={r.window} onChange={e => patch(r.id, { window: e.target.value })} style={{ width: 90 }} /></td>
                <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn-primary" disabled={r.saving} onClick={() => void save(r)}><Save size={13} /> {r.saving ? 'Saving…' : 'Save'}</button>
                  {r.note && <span role="status" style={{ marginLeft: 8, fontSize: '0.75rem', color: r.note.ok ? '#047857' : '#b91c1c' }}>{r.note.text}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
