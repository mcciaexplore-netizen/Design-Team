import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { apiJson } from '../api';

interface Entry {
  id: number; at: string | null; kind: 'new' | 'status' | 'client' | 'design' | 'other'; text: string; by: string;
  ticket_id: number; ticket_number: string; title: string;
}

const REFRESH_MS = 15_000;
const TONE: Record<Entry['kind'], [string, string]> = {
  new: ['#DBEAFE', '#1D4ED8'], client: ['#FEF3C7', '#92400E'], status: ['#E0E7FF', '#3730A3'],
  design: ['#DCFCE7', '#166534'], other: ['#F1F5F9', '#525252'],
};
const LABEL: Record<Entry['kind'], string> = { new: 'New', client: 'Client', status: 'Moved', design: 'Design', other: 'Update' };

function ago(iso: string | null, now: number): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** What just happened: new requests, client changes and decisions, designs sent, stage moves. Refreshes every
 *  15 seconds while the page is open, and marks what arrived since it was opened. `mine` keeps it to the
 *  signed-in designer's tickets. */
export default function ActivityFeed({ mine = false, title, limit = 15 }: { mine?: boolean; title: string; limit?: number }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef<Set<number> | null>(null);   // ids on first load; anything else is new
  const [fresh, setFresh] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      const rows = await apiJson<Entry[]>(`/api/activity?limit=${limit}${mine ? '&mine=true' : ''}`);
      if (seen.current === null) seen.current = new Set(rows.map(r => r.id));
      else setFresh(new Set(rows.filter(r => !seen.current!.has(r.id)).map(r => r.id)));
      setEntries(rows); setError(null); setNow(Date.now());
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the latest activity.'); }
  }, [mine, limit]);

  useEffect(() => {
    void load();
    const tick = () => { if (document.visibilityState === 'visible') void load(); };
    const id = setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [load]);

  return (
    <section className="glass-card" style={{ padding: '1.1rem 1.25rem' }} aria-labelledby={`feed-${mine ? 'mine' : 'all'}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Activity size={15} aria-hidden="true" style={{ color: '#003F8A' }} />
        <h2 id={`feed-${mine ? 'mine' : 'all'}`} style={{ fontSize: '0.95rem', fontWeight: 800, color: '#003F8A' }}>{title}</h2>
        {fresh.size > 0 && <span role="status" style={{ fontSize: '0.7rem', fontWeight: 800, color: 'white', background: '#DC2626', borderRadius: 99, padding: '0.1rem 0.5rem' }}>{fresh.size} new</span>}
        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#737373' }}>Live · updates every 15 s</span>
      </div>
      {error && <p role="alert" style={{ fontSize: '0.8rem', color: '#B91C1C' }}>{error}</p>}
      {entries === null && !error && <p role="status" style={{ fontSize: '0.8rem', color: '#737373' }}>Loading…</p>}
      {entries?.length === 0 && <p style={{ fontSize: '0.82rem', color: '#737373' }}>Nothing yet. New requests and changes show up here as they happen.</p>}
      <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {entries?.map(e => {
          const [bg, fg] = TONE[e.kind];
          return (
            <li key={e.id}>
              <Link to={`/tickets/${e.ticket_id}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '0.5rem 0.6rem', borderRadius: 8, textDecoration: 'none',
                                                             background: fresh.has(e.id) ? 'rgba(220,38,38,0.06)' : 'transparent', border: `1px solid ${fresh.has(e.id) ? 'rgba(220,38,38,0.25)' : 'transparent'}` }}>
                <span style={{ fontSize: '0.66rem', fontWeight: 800, background: bg, color: fg, borderRadius: 6, padding: '0.15rem 0.45rem', whiteSpace: 'nowrap', marginTop: 2 }}>{LABEL[e.kind]}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: '0.83rem', color: '#003F8A', overflowWrap: 'anywhere' }}>
                    <strong>{e.ticket_number}</strong> {e.title}: {e.text}
                  </span>
                  <span style={{ fontSize: '0.72rem', color: '#737373' }}>{e.by} · {ago(e.at, now)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
