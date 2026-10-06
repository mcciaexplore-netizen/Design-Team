import { useEffect, useRef, useState } from 'react';
import { FileText, Paperclip, X } from 'lucide-react';
import { requestLabel } from '../requestForm';

const fmtSize = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

interface Props {
  id: string;
  files: File[];
  notes: string[];          // one message per rejected file
  maxFiles: number;
  maxMb: number;
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
}

/** Image files show a small preview; others show a file icon. */
function Thumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url
    ? <img src={url} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, border: '1px solid rgba(226,232,240,0.9)' }} />
    : <span style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', background: '#f1f5f9', borderRadius: 6 }}><FileText size={16} /></span>;
}

/** Drag-and-drop area plus a picker for up to `maxFiles` attachments. */
export default function FileDropzone({ id, files, notes, maxFiles, maxMb, onAdd, onRemove }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div>
      <label htmlFor={id} style={requestLabel}>Attach files (up to {maxFiles}, max {maxMb} MB each)</label>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); onAdd(Array.from(e.dataTransfer.files)); }}
        style={{ border: `2px dashed ${dragging ? '#18181b' : 'rgba(203,213,225,0.9)'}`, background: dragging ? 'var(--brand-soft)' : '#F8FAFC', borderRadius: 12, padding: '0.9rem', textAlign: 'center' }}>
        <input id={id} ref={input} type="file" multiple hidden aria-describedby={notes.length ? `${id}-notes` : undefined}
          onChange={e => { onAdd(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
          Drag files here or <button type="button" className="chip" onClick={() => input.current?.click()}><Paperclip size={11} /> Browse files</button>
        </p>
      </div>
      {notes.length > 0 && (
        <ul id={`${id}-notes`} role="alert" style={{ margin: '6px 0 0', padding: '0 0 0 1.1rem', fontSize: '0.78rem', color: '#b91c1c' }}>
          {notes.map(n => <li key={n}>{n}</li>)}
        </ul>
      )}
      {files.length > 0 && (
        <ul aria-label="Attached files" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.8rem', color: '#475569' }}>
              <Thumb file={f} />
              <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{f.name}</span>
              <span style={{ color: '#94a3b8' }}>{fmtSize(f.size)}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onRemove(i)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#64748b', display: 'flex' }}><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
