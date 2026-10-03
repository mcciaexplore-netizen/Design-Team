import { useEffect, useState } from 'react';
import { apiJson, fetchBlobUrl } from '../api';
import DesignProofer from './DesignProofer';

interface Proof { id: number; version: number; content_type: string | null }

/** Loads a ticket's image proofs and lets the team pin comments on them. */
export default function AnnotatePanel({ ticketId }: { ticketId: string }) {
  const [items, setItems] = useState<{ url: string; key: string; label: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      try {
        const proofs = (await apiJson<Proof[]>(`/api/tickets/${ticketId}/proofs`)).filter(p => p.content_type?.startsWith('image/')).reverse();
        const loaded = await Promise.all(proofs.map(async p => {
          const url = await fetchBlobUrl(`/api/proofs/${p.id}/file`);
          urls.push(url);
          return { url, key: `proof:${p.id}`, label: `Version ${p.version}` };
        }));
        if (!cancelled) setItems(loaded);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load proofs.');
      }
    })();
    return () => { cancelled = true; urls.forEach(u => URL.revokeObjectURL(u)); };
  }, [ticketId]);

  if (error) return <p role="alert" style={{ color: '#b91c1c', fontSize: '0.82rem' }}>{error}</p>;
  if (!items) return <p role="status" style={{ color: '#94a3b8', fontSize: '0.82rem' }}>Loading proofs…</p>;
  return (
    <div style={{ height: items.length ? 520 : undefined }}>
      <DesignProofer ticketId={ticketId} imageUrls={items.map(i => i.url)} imageKeys={items.map(i => i.key)} labels={items.map(i => i.label)} />
    </div>
  );
}
