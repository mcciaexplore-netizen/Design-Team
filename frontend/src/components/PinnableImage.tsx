import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { fetchBlobUrl } from '../api';

export interface PinItem { id: number; x: number; y: number; content: string; author: string; resolved: boolean }

interface Props {
  proofId: number;
  name: string;
  pins: PinItem[];
  /** The viewer may mark new spots on this design. */
  canAdd: boolean;
  /** The viewer may tick spots off as done. */
  canToggle: boolean;
  onAdd: (x: number, y: number, text: string) => Promise<void>;
  onToggle: (pin: PinItem) => void;
}

/** A design image where people can click a spot and say what to change there. Spots are numbered and listed below. */
export default function PinnableImage({ proofId, name, pins, canAdd, canToggle, onAdd, onToggle }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let revoked = false, made: string | null = null;
    fetchBlobUrl(`/api/proofs/${proofId}/file`)
      .then(u => { if (revoked) URL.revokeObjectURL(u); else { made = u; setUrl(u); } })
      .catch(() => setFailed(true));
    return () => { revoked = true; if (made) URL.revokeObjectURL(made); };
  }, [proofId]);

  useEffect(() => { if (draft) area.current?.focus(); }, [draft]);

  const start = (x: number, y: number) => { setDraft({ x, y }); setText(''); setError(null); };

  const onClick = (e: MouseEvent<HTMLImageElement>) => {
    if (!canAdd || !img.current) return;
    const r = img.current.getBoundingClientRect();
    start(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)), Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)));
  };
  const onKey = (e: KeyboardEvent<HTMLImageElement>) => { if (canAdd && e.key === 'Enter') { e.preventDefault(); start(50, 50); } };

  const save = async () => {
    if (!draft) return;
    if (!text.trim()) { setError('Write what should change at this spot.'); return; }
    setSaving(true); setError(null);
    try { await onAdd(draft.x, draft.y, text.trim()); setDraft(null); setText(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save this note.'); }
    finally { setSaving(false); }
  };

  if (failed) return <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.78rem', color: '#94a3b8' }}>Preview unavailable</div>;
  if (!url) return <div role="status" style={{ padding: '2rem', textAlign: 'center', fontSize: '0.78rem', color: '#94a3b8' }}>Loading preview…</div>;

  const marker = (n: number, x: number, y: number, tone: string, dashed = false) => (
    <span aria-hidden="true" key={`${n}-${x}-${y}`}
      style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)', width: 24, height: 24, borderRadius: 99, background: tone, color: 'white',
               border: `2px ${dashed ? 'dashed' : 'solid'} white`, boxShadow: '0 1px 6px rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center',
               fontSize: '0.7rem', fontWeight: 800, lineHeight: 1, pointerEvents: 'none' }}>
      {n}
    </span>
  );

  return (
    <div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', lineHeight: 0 }}>
          <img ref={img} src={url} alt={`Design: ${name}`} onClick={onClick} onKeyDown={onKey}
            role={canAdd ? 'button' : undefined} tabIndex={canAdd ? 0 : undefined} aria-label={canAdd ? `Design: ${name}. Click to mark a spot that needs changing.` : undefined}
            style={{ display: 'block', maxWidth: '100%', maxHeight: 420, objectFit: 'contain', cursor: canAdd ? 'crosshair' : 'default' }} />
          {pins.map((p, i) => marker(i + 1, p.x, p.y, p.resolved ? '#059669' : '#dc2626'))}
          {draft && marker(pins.length + 1, draft.x, draft.y, '#2563eb', true)}
        </div>
      </div>
      {canAdd && !draft && <p style={{ fontSize: '0.74rem', color: '#64748b', textAlign: 'center', marginTop: 6 }}>Click the design to mark a spot that needs changing.</p>}

      {draft && (
        <form onSubmit={e => { e.preventDefault(); void save(); }} style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor={`pin-note-${proofId}`} className="section-label">What should change at spot {pins.length + 1}?</label>
          <textarea id={`pin-note-${proofId}`} ref={area} className="input-field" rows={2} maxLength={1000} value={text}
            aria-invalid={error ? true : undefined} aria-describedby={error ? `pin-err-${proofId}` : undefined}
            onChange={e => { setText(e.target.value); setError(null); }} placeholder="e.g. Make this logo bigger" />
          {error && <p id={`pin-err-${proofId}`} role="alert" style={{ fontSize: '0.76rem', color: '#b91c1c' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save this spot'}</button>
            <button type="button" className="btn-ghost" onClick={() => { setDraft(null); setError(null); }}>Cancel</button>
          </div>
        </form>
      )}

      {pins.length > 0 && (
        <ol aria-label="Marked spots" style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {pins.map((p, i) => (
            <li key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.8rem', color: '#334155' }}>
              <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 99, flexShrink: 0, background: p.resolved ? '#059669' : '#dc2626', color: 'white', fontSize: '0.68rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
              <span style={{ flex: 1, overflowWrap: 'anywhere', textDecoration: p.resolved ? 'line-through' : 'none', color: p.resolved ? '#94a3b8' : undefined }}>
                <strong>{p.author}:</strong> {p.content}
              </span>
              {canToggle && (
                <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: '0.72rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={p.resolved} onChange={() => onToggle(p)} aria-label={`Spot ${i + 1} is done`} style={{ accentColor: '#059669' }} /> Done
                </label>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
