import { useEffect, useMemo, useState } from 'react';
import { Columns2, History, SlidersHorizontal } from 'lucide-react';
import { fetchBlobUrl } from '../api';

export interface ProofLite { id: number; version: number; file_name: string; content_type: string | null; note: string | null; created_at: string | null }
export interface ApprovalLite {
  id: number; proof_version: number | null; status: 'pending' | 'approved' | 'changes_requested' | 'expired' | 'revoked';
  decided_at: string | null; decided_by_name: string | null; decision_comment: string | null; created_at?: string | null;
}

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
const isImage = (p: ProofLite) => !!p.content_type?.startsWith('image/');

function useProofUrl(proofId: number | undefined) {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
  useEffect(() => {
    if (proofId === undefined) return;
    let cancelled = false, made: string | null = null;
    setState({ url: null, failed: false });
    fetchBlobUrl(`/api/proofs/${proofId}/file`)
      .then(u => { if (cancelled) URL.revokeObjectURL(u); else { made = u; setState({ url: u, failed: false }); } })
      .catch(() => { if (!cancelled) setState({ url: null, failed: true }); });
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [proofId]);
  return state;
}

const VERDICT: Record<ApprovalLite['status'], string | null> = {
  approved: 'Approved', changes_requested: 'Changes requested', pending: 'Awaiting client', expired: null, revoked: null,
};

function Caption({ p, requests }: { p: ProofLite; requests: ApprovalLite[] }) {
  const verdict = requests.filter(r => r.proof_version === p.version).map(r => VERDICT[r.status]).find(Boolean);
  return (
    <div style={{ fontSize: '0.75rem', color: 'var(--text-soft)', lineHeight: 1.5 }}>
      <strong style={{ color: 'var(--text-strong)' }}>Version {p.version}</strong> · {fmt(p.created_at)}
      {verdict && <> · <span>{verdict}</span></>}
      {p.note && <div style={{ fontStyle: 'italic', overflowWrap: 'anywhere' }}>“{p.note}”</div>}
    </div>
  );
}

function Pane({ proof }: { proof: ProofLite }) {
  const { url, failed } = useProofUrl(proof.id);
  if (failed) return <p style={{ padding: '2rem 1rem', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-hint)' }}>Preview unavailable</p>;
  if (!url) return <p role="status" style={{ padding: '2rem 1rem', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-hint)' }}>Loading…</p>;
  return <img src={url} alt={`Version ${proof.version}: ${proof.file_name}`} style={{ display: 'block', width: '100%', maxHeight: 420, objectFit: 'contain' }} />;
}

function Slider({ a, b }: { a: ProofLite; b: ProofLite }) {
  const ua = useProofUrl(a.id);
  const ub = useProofUrl(b.id);
  const [pos, setPos] = useState(50);
  if (ua.failed || ub.failed) return <p style={{ padding: '2rem 1rem', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-hint)' }}>Preview unavailable</p>;
  if (!ua.url || !ub.url) return <p role="status" style={{ padding: '2rem 1rem', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-hint)' }}>Loading…</p>;
  const layer: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' };
  return (
    <div>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', maxHeight: 460, background: 'white', overflow: 'hidden', borderRadius: 8 }}>
        <img src={ua.url} alt={`Version ${a.version}`} style={layer} />
        <img src={ub.url} alt={`Version ${b.version}`} style={{ ...layer, clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
        <div aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, left: `${pos}%`, width: 2, background: '#18181b', boxShadow: '0 0 0 1px white' }} />
        <span style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(24,24,27,0.8)', color: 'white', fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 99 }}>v{b.version}</span>
        <span style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(24,24,27,0.8)', color: 'white', fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 99 }}>v{a.version}</span>
      </div>
      <label htmlFor="cmp-slider" className="section-label" style={{ display: 'block', margin: '10px 0 4px' }}>Drag to compare: version {b.version} on the left, version {a.version} on the right</label>
      <input id="cmp-slider" type="range" min={0} max={100} value={pos} onChange={e => setPos(Number(e.target.value))} style={{ width: '100%', accentColor: '#18181b' }} />
    </div>
  );
}

/** Compare two versions of a proof, side by side or with a reveal slider. */
export function ProofCompare({ proofs, requests }: { proofs: ProofLite[]; requests: ApprovalLite[] }) {
  const images = useMemo(() => proofs.filter(isImage).sort((x, y) => y.version - x.version), [proofs]);
  const [aVer, setAVer] = useState<number | null>(null); // older
  const [bVer, setBVer] = useState<number | null>(null); // newer
  const [mode, setMode] = useState<'side' | 'slider'>('side');

  const defaults = useMemo(() => ({ b: images[0]?.version ?? null, a: images[1]?.version ?? null }), [images]);
  const a = images.find(p => p.version === (aVer ?? defaults.a));
  const b = images.find(p => p.version === (bVer ?? defaults.b));

  if (images.length < 2) {
    return <p style={{ fontSize: '0.8rem', color: 'var(--text-soft)' }}>Comparing needs at least two image versions. Upload another version to compare it with the first.</p>;
  }

  const select = (id: string, label: string, value: number | undefined, onChange: (v: number) => void) => (
    <div>
      <label htmlFor={id} className="section-label" style={{ display: 'block', marginBottom: 4 }}>{label}</label>
      <select id={id} className="input-field" value={value ?? ''} onChange={e => onChange(Number(e.target.value))}>
        {images.map(p => <option key={p.id} value={p.version}>Version {p.version}</option>)}
      </select>
    </div>
  );

  return (
    <div className="glass-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {select('cmp-a', 'Earlier version', a?.version, setAVer)}
        {select('cmp-b', 'Later version', b?.version, setBVer)}
        <div role="group" aria-label="Compare mode" style={{ display: 'inline-flex', border: '1px solid var(--border-soft)', borderRadius: 9, overflow: 'hidden', background: 'white', marginLeft: 'auto' }}>
          {([['side', 'Side by side', Columns2], ['slider', 'Slider', SlidersHorizontal]] as const).map(([k, label, Icon]) => (
            <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}
              style={{ padding: '0.4rem 0.8rem', fontSize: '0.78rem', fontWeight: 700, border: 'none', cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center', background: mode === k ? 'var(--brand-soft)' : 'transparent', color: mode === k ? 'var(--brand)' : 'var(--text-soft)' }}>
              <Icon size={13} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
      </div>

      {a && b && a.id === b.id && <p role="status" style={{ fontSize: '0.78rem', color: 'var(--text-soft)' }}>Choose two different versions to see what changed.</p>}

      {a && b && (mode === 'side' ? (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {[a, b].map(p => (
            <figure key={p.id} style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ background: '#F1F5F9', borderRadius: 8, padding: 8 }}><Pane proof={p} /></div>
              <figcaption><Caption p={p} requests={requests} /></figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <>
          <Slider a={a} b={b} />
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <Caption p={a} requests={requests} /><Caption p={b} requests={requests} />
          </div>
        </>
      ))}
    </div>
  );
}

interface TimelineEvent { at: string; title: string; detail?: string | null }

/** One chronological list: uploads, links sent, and client decisions. */
export function RevisionTimeline({ proofs, requests }: { proofs: ProofLite[]; requests: ApprovalLite[] }) {
  const events = useMemo(() => {
    const out: TimelineEvent[] = [];
    for (const p of proofs) if (p.created_at) out.push({ at: p.created_at, title: `Version ${p.version} uploaded`, detail: p.note ? `“${p.note}”` : p.file_name });
    for (const r of requests) {
      if (r.created_at) out.push({ at: r.created_at, title: `Version ${r.proof_version ?? '?'} sent for approval` });
      if (r.decided_at && (r.status === 'approved' || r.status === 'changes_requested')) {
        out.push({
          at: r.decided_at,
          title: `Version ${r.proof_version ?? '?'} ${r.status === 'approved' ? 'approved' : 'needs changes'}${r.decided_by_name ? ` by ${r.decided_by_name}` : ''}`,
          detail: r.decision_comment ? `“${r.decision_comment}”` : null,
        });
      }
    }
    return out.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
  }, [proofs, requests]);

  if (events.length === 0) return null;
  return (
    <div className="glass-card" style={{ padding: '1rem' }}>
      <h3 className="section-label" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}><History size={13} aria-hidden="true" /> Revision history</h3>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {events.map((e, i) => (
          <li key={i} style={{ borderLeft: '2px solid rgba(24,24,27,0.2)', paddingLeft: 10, fontSize: '0.8rem', color: 'var(--text-soft)' }}>
            <div><strong style={{ color: 'var(--text-strong)' }}>{e.title}</strong> <span style={{ color: 'var(--text-hint)' }}>· {fmt(e.at)}</span></div>
            {e.detail && <div style={{ fontStyle: 'italic', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{e.detail}</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}
