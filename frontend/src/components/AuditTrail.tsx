import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '../api';
import { useTickets } from '../contexts/TicketsContext';
import ActivityTimeline, { type AuditLogEntry } from './ActivityTimeline';

interface Row { id: number; action: string; actor: string; details: Record<string, unknown>; timestamp: string | null }

const hm = (secs: number) => {
  const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

type Change = { from: unknown; to: unknown };
const isChange = (v: unknown): v is Change => typeof v === 'object' && v !== null && 'to' in v;

/** Turn a server audit row into a sentence that reads naturally after the actor's name. */
export function describe(row: Row, personName: (id: unknown) => string): Pick<AuditLogEntry, 'action' | 'type' | 'details'> {
  const d = row.details ?? {};
  const str = (v: unknown) => (v === null || v === undefined || v === '' ? 'none' : String(v));

  switch (row.action) {
    case 'Created': {
      const from = d.duplicated_from;
      return { action: from ? `created this ticket as a copy of ${str(from)}` : 'created this ticket', type: 'created' };
    }
    case 'Updated':
    case 'Bulk update': {
      const parts: string[] = [];
      let type: AuditLogEntry['type'] = 'status_change';
      for (const [key, val] of Object.entries(d)) {
        if (!isChange(val)) continue;
        if (key === 'status') parts.push(`moved from ${str(val.from)} to ${str(val.to)}`);
        else if (key === 'assignee_id') parts.push(`assigned to ${personName(val.to)}`);
        else if (key === 'priority') parts.push(`changed priority from ${str(val.from)} to ${str(val.to)}`);
        else if (key === 'title') parts.push('renamed the ticket');
        else if (key === 'tags') parts.push('updated tags');
        else if (key === 'figma_url') parts.push('changed the Figma link');
        else if (key === 'brief') parts.push('edited the brief');
        else if (key === 'estimate_hours') parts.push(`set the estimate to ${str(val.to)} h`);
        else parts.push(`changed ${key.replace(/_/g, ' ')}`);
      }
      if (!parts.length) { parts.push('updated the ticket'); type = 'alert'; }
      return { action: (row.action === 'Bulk update' ? '(bulk) ' : '') + parts.join(', '), type };
    }
    case 'Commented': return { action: 'left a comment', type: 'comment' };
    case 'Attached file': return { action: `attached ${str(d.file_name)}`, type: 'attachment' };
    case 'Removed file': return { action: `removed ${str(d.file_name)}`, type: 'attachment' };
    case 'Logged time': return { action: `logged ${hm(Number(d.seconds) || 0)}`, type: 'timer_stop' };
    case 'Deleted time entry': return { action: `deleted a ${hm(Number(d.seconds) || 0)} time entry`, type: 'timer_stop' };
    case 'Uploaded proof': return { action: `uploaded proof version ${str(d.version)}`, type: 'proof' };
    case 'Sent for approval': return { action: `sent version ${str(d.proof_version)} for client approval`, type: 'approval' };
    case 'Revoked approval link': return { action: 'withdrew an approval link', type: 'approval' };
    case 'Client approved': return { action: 'approved the design', type: 'approval', details: d.comment ? String(d.comment) : undefined };
    case 'Client requested changes': return { action: 'requested changes', type: 'alert', details: d.comment ? String(d.comment) : undefined };
    case 'Duplicated': return { action: `duplicated this ticket as ${str(d.copy)}`, type: 'created' };
    default:
      if (row.action.startsWith('Created from')) return { action: row.action.toLowerCase() + (d.template ? ` “${str(d.template)}”` : ''), type: 'created' };
      return { action: row.action.toLowerCase(), type: 'alert' };
  }
}

export default function AuditTrail({ ticketId }: { ticketId: string }) {
  const { staff } = useTickets();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await apiJson<Row[]>(`/api/tickets/${ticketId}/audit`)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load activity.'); }
    finally { setLoading(false); }
  }, [ticketId]);

  useEffect(() => {
    setLoading(true);
    void load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const personName = (id: unknown) => (id === null || id === undefined ? 'no one' : staff.find(s => s.id === Number(id))?.name ?? `user #${String(id)}`);

  if (loading) return <p role="status" style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Loading activity…</p>;
  if (error) return <p role="alert" style={{ fontSize: '0.8rem', color: '#b91c1c' }}>{error} <button type="button" className="chip" onClick={() => void load()}>Retry</button></p>;

  const logs: AuditLogEntry[] = [...rows].reverse().map(r => {
    const d = describe(r, personName);
    return { id: String(r.id), actor: r.actor, timestamp: r.timestamp ?? new Date().toISOString(), ...d };
  });
  return <ActivityTimeline logs={logs} />;
}
