import { useState, type FormEvent } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { apiJson } from '../api';
import { useTickets } from '../contexts/TicketsContext';

const PHRASE = 'DELETE ALL DATA';

/** Start afresh: delete every past request and what belongs to it. Needs the typed phrase and the lead's password. */
export default function DeleteAllData() {
  const { refresh } = useTickets();
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [removeClients, setRemoveClients] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!window.confirm('Delete all past data now? This cannot be undone.')) return;
    setBusy(true); setError(null); setDone(null);
    try {
      const r = await apiJson<{ tickets: number; files: number; clients_removed: number }>('/api/admin/delete-all-data', {
        method: 'POST', json: { confirm: confirm.trim(), password, remove_clients: removeClients },
      });
      setDone(`Deleted ${r.tickets} request${r.tickets === 1 ? '' : 's'} and ${r.files} file${r.files === 1 ? '' : 's'}`
        + (removeClients ? `, and removed ${r.clients_removed} client account${r.clients_removed === 1 ? '' : 's'}` : '') + '.');
      setConfirm(''); setPassword('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the data.');
    } finally { setBusy(false); }
  };

  return (
    <section className="glass-card" style={{ padding: '1.5rem', border: '1px solid rgba(239,68,68,0.35)' }} aria-labelledby="danger-h">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div className="icon-tile" style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.25)', color: '#B91C1C' }}><AlertTriangle size={16} /></div>
        <h2 id="danger-h" style={{ fontSize: '1rem', fontWeight: 800, color: '#B91C1C' }}>Delete all past data</h2>
      </div>
      <p style={{ fontSize: '0.85rem', color: '#475569', lineHeight: 1.6 }}>
        Start afresh, for example after testing. This deletes <strong>every request</strong> and everything that belongs to one:
        designs and their files, approvals, attachments, source files, client changes, time logged, history,
        notifications, campaigns and social posts. It <strong>keeps</strong> the team's accounts, design types, settings, templates and the library.
        New requests carry on numbering from where the old ones stopped. <strong>This cannot be undone.</strong>
      </p>

      <form onSubmit={e => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: '#0F172A' }}>
          <input type="checkbox" checked={removeClients} onChange={e => setRemoveClients(e.target.checked)} style={{ accentColor: '#B91C1C' }} />
          Also remove all client accounts (staff accounts always stay)
        </label>
        <div>
          <label htmlFor="del-confirm" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: 4 }}>Type <code>{PHRASE}</code> to confirm</label>
          <input id="del-confirm" className="input-field" autoComplete="off" value={confirm} onChange={e => setConfirm(e.target.value)} style={{ maxWidth: 320 }} />
        </div>
        <div>
          <label htmlFor="del-pw" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: 4 }}>Your password</label>
          <input id="del-pw" className="input-field" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} style={{ maxWidth: 320 }} />
        </div>
        {error && <p role="alert" style={{ fontSize: '0.82rem', color: '#B91C1C', fontWeight: 600 }}>{error}</p>}
        {done && <p role="status" style={{ fontSize: '0.82rem', color: '#047857', fontWeight: 600 }}>{done}</p>}
        <button type="submit" className="btn-primary" disabled={busy || confirm.trim() !== PHRASE || !password}
          style={{ alignSelf: 'flex-start', background: '#DC2626', borderColor: '#B91C1C', gap: 6 }}>
          <Trash2 size={14} aria-hidden="true" /> {busy ? 'Deleting…' : 'Delete all past data'}
        </button>
      </form>
    </section>
  );
}
