import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, CheckCircle2, FileText, MapPin, MessageSquare, Paperclip, RotateCcw, Send, X } from 'lucide-react';
import { apiJson, authFetch, downloadFile } from '../api';
import { useTickets } from '../contexts/TicketsContext';

interface Person { id: number; full_name: string; role: string }
interface Attachment { id: number; file_name: string; content_type: string | null; size_bytes: number }
interface Comment {
  id: number; content: string; created_at: string | null;
  author: { id: number; full_name: string; role: string | null };
  mentions: { id: number; full_name: string }[];
  attachments: Attachment[];
}

/** Everything said or done on a request, in time order: comments, designs sent, marked spots and client decisions. */
type ThreadItem =
  | ({ kind: 'comment'; at: string | null } & Comment)
  | { kind: 'design_sent'; id: string; at: string | null; by: string; version: number | null }
  | { kind: 'decision'; id: string; at: string | null; by: string; decision: 'approved' | 'changes_requested'; version: number | null; comment: string | null }
  | { kind: 'pin'; id: number; at: string | null; by: string; role: string | null; version: number | null; content: string; is_resolved: boolean };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '');

function EventRow({ icon, tone, children, at }: { icon: React.ReactNode; tone: string; children: React.ReactNode; at: string | null }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '0.35rem 0.5rem', fontSize: '0.78rem', color: '#475569' }}>
      <span aria-hidden="true" style={{ color: tone, marginTop: 2, flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</div>
      {at && <time dateTime={at} style={{ fontSize: '0.65rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>{when(at)}</time>}
    </div>
  );
}

const MAX_MB = 10;
const ALLOWED = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'psd', 'ai', 'fig'];

const fmtSize = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Render comment text with @Name mentions highlighted. Text only — never HTML. */
function MentionText({ text, names }: { text: string; names: string[] }) {
  if (!names.length) return <>{text}</>;
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
  const parts = text.split(new RegExp(`(@(?:${escaped.join('|')}))`, 'g'));
  return (
    <>
      {parts.map((p, i) => (p.startsWith('@') && names.includes(p.slice(1))
        ? <strong key={i} style={{ color: '#18181b', background: 'rgba(24,24,27,0.08)', borderRadius: 4, padding: '0 3px' }}>{p}</strong>
        : <React.Fragment key={i}>{p}</React.Fragment>))}
    </>
  );
}

export default function CommentsPanel({ ticketId, compact = false }: { ticketId: string; compact?: boolean }) {
  const { refresh } = useTickets();
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [text, setText] = useState('');
  const [mentioned, setMentioned] = useState<Person[]>([]);
  const [picker, setPicker] = useState<{ query: string; start: number } | null>(null);
  const [pickerIdx, setPickerIdx] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'warn'; text: string } | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setItems(await apiJson<ThreadItem[]>(`/api/tickets/${ticketId}/thread`));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load comments.');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    setLoading(true); setItems([]); setText(''); setMentioned([]); setFiles([]); setNotice(null);
    void load();
    apiJson<Person[]>(`/api/tickets/${ticketId}/mentionable`).then(setPeople).catch(() => setPeople([]));
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 20_000);
    return () => clearInterval(id);
  }, [ticketId, load]);

  const matches = useMemo(() => {
    if (!picker) return [];
    const q = picker.query.toLowerCase();
    return people.filter(p => p.full_name.toLowerCase().includes(q)).slice(0, 6);
  }, [picker, people]);

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);
    if (value.trim()) setNotice(n => (n?.kind === 'error' && n.text.startsWith('Write a comment') ? null : n));
    const caret = e.target.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const m = /(^|\s)@([\w .'-]{0,30})$/.exec(before);
    if (m) { setPicker({ query: m[2], start: caret - m[2].length - 1 }); setPickerIdx(0); } else setPicker(null);
  };

  const choose = (p: Person) => {
    if (!picker) return;
    const caret = areaRef.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, picker.start)}@${p.full_name} ${text.slice(caret)}`;
    setText(next);
    setMentioned(prev => (prev.some(x => x.id === p.id) ? prev : [...prev, p]));
    setPicker(null);
    requestAnimationFrame(() => {
      const pos = picker.start + p.full_name.length + 2;
      areaRef.current?.focus();
      areaRef.current?.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (picker && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPickerIdx(i => (i + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setPickerIdx(i => (i - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(matches[pickerIdx]); return; }
    }
    if (e.key === 'Escape' && picker) { e.stopPropagation(); setPicker(null); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); }
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const problems: string[] = [];
    const ok: File[] = [];
    for (const f of Array.from(list)) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      if (!ALLOWED.includes(ext)) problems.push(`${f.name}: .${ext} files are not allowed`);
      else if (f.size > MAX_MB * 1024 * 1024) problems.push(`${f.name}: larger than ${MAX_MB} MB`);
      else ok.push(f);
    }
    setFiles(prev => [...prev, ...ok].slice(0, 5));
    setNotice(problems.length ? { kind: 'error', text: problems.join(' · ') } : null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const submit = async () => {
    const content = text.trim();
    if (busy) return;
    if (!content) { setNotice({ kind: 'error', text: 'Write a comment first, then press Post.' }); areaRef.current?.focus(); return; }
    setBusy(true); setNotice(null);
    try {
      // Only send mentions whose @Name is still in the text.
      const ids = mentioned.filter(p => content.includes(`@${p.full_name}`)).map(p => p.id);
      const created = await apiJson<Comment>(`/api/tickets/${ticketId}/comments`, { method: 'POST', json: { content, mentioned_user_ids: ids } });
      const failed: string[] = [];
      for (const f of files) {
        const body = new FormData();
        body.append('file', f);
        body.append('comment_id', String(created.id));
        const res = await authFetch(`/api/tickets/${ticketId}/attachments`, { method: 'POST', body });
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try { detail = (await res.json()).detail ?? detail; } catch { /* keep status */ }
          failed.push(`${f.name}: ${detail}`);
        }
      }
      setText(''); setMentioned([]); setFiles([]);
      if (failed.length) setNotice({ kind: 'warn', text: `Comment posted, but some files failed — ${failed.join(' · ')}` });
      await load();
      void refresh();
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Could not post the comment.' });
    } finally {
      setBusy(false);
    }
  };

  const download = async (a: Attachment) => {
    try { await downloadFile(`/api/attachments/${a.id}/download`, a.file_name); }
    catch (e) { setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Download failed.' }); }
  };

  return (
    <section aria-label="Comments">
      <h3 className="section-label" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
        <MessageSquare size={11} /> Conversation ({items.length})
      </h3>

      {loading && <p role="status" style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Loading comments…</p>}
      {loadError && <p role="alert" style={{ fontSize: '0.78rem', color: '#b91c1c' }}>{loadError} <button type="button" className="chip" onClick={() => void load()}>Retry</button></p>}
      {!loading && !loadError && items.length === 0 && (
        <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: 10 }}>Nothing here yet. Start the conversation — use @ to mention a teammate.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12, maxHeight: compact ? 260 : 420, overflowY: 'auto' }}>
        {items.map(item => {
          if (item.kind === 'design_sent') {
            return (
              <EventRow key={item.id} icon={<Send size={13} />} tone="#2563eb" at={item.at}>
                <strong>{item.by}</strong> sent {item.version ? `version ${item.version}` : 'a design'} for review
              </EventRow>
            );
          }
          if (item.kind === 'pin') {
            return (
              <EventRow key={`pin-${item.id}`} icon={<MapPin size={13} />} tone={item.is_resolved ? '#059669' : '#dc2626'} at={item.at}>
                <strong>{item.by}</strong> marked a spot{item.version ? ` on version ${item.version}` : ''}: <span style={{ textDecoration: item.is_resolved ? 'line-through' : 'none' }}>{item.content}</span>{item.is_resolved && <span style={{ color: '#059669' }}> · done</span>}
              </EventRow>
            );
          }
          if (item.kind === 'decision') {
            const ok = item.decision === 'approved';
            return (
              <div key={item.id} style={{ background: ok ? 'rgba(16,185,129,0.07)' : 'rgba(245,158,11,0.09)', border: `1px solid ${ok ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.3)'}`, borderRadius: 8, padding: '0.5rem 0.75rem' }}>
                <EventRow icon={ok ? <CheckCircle2 size={14} /> : <RotateCcw size={14} />} tone={ok ? '#059669' : '#b45309'} at={item.at}>
                  <strong>{item.by}</strong> {ok ? 'approved' : 'asked for changes on'} {item.version ? `version ${item.version}` : 'the design'}
                </EventRow>
                {item.comment && <p style={{ fontSize: '0.82rem', color: '#334155', padding: '0 0.5rem 0.25rem 1.8rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.comment}</p>}
              </div>
            );
          }
          const c = item;
          return (
          <div key={`c-${c.id}`} style={{ background: '#F8FAFC', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 8, padding: '0.625rem 0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#18181b' }}>
                {c.author.full_name}{c.author.role === 'Requester' && <span style={{ color: '#94a3b8', fontWeight: 600 }}> · client</span>}
              </span>
              {c.created_at && <time dateTime={c.created_at} style={{ fontSize: '0.65rem', color: '#94a3b8' }}>{new Date(c.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</time>}
            </div>
            <p style={{ fontSize: '0.82rem', color: '#334155', lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              <MentionText text={c.content} names={c.mentions.map(m => m.full_name)} />
            </p>
            {c.attachments.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {c.attachments.map(a => (
                  <button key={a.id} type="button" className="chip" onClick={() => void download(a)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }} title={`Download ${a.file_name}`}>
                    <FileText size={11} /> {a.file_name} <span style={{ color: '#94a3b8' }}>{fmtSize(a.size_bytes)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          );
        })}
      </div>

      <div style={{ position: 'relative' }}>
        <label htmlFor={`comment-${ticketId}`} className="section-label" style={{ display: 'block', marginBottom: 4 }}>Add a comment</label>
        <textarea
          id={`comment-${ticketId}`}
          ref={areaRef}
          className="input-field"
          rows={compact ? 2 : 3}
          value={text}
          maxLength={5000}
          placeholder="Write a comment…  @ to mention · Ctrl+Enter to send"
          onChange={onChange}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setPicker(null), 120)}
          style={{ resize: 'vertical', fontSize: '0.82rem' }}
          aria-autocomplete="list"
          aria-expanded={!!picker && matches.length > 0}
          aria-activedescendant={picker && matches[pickerIdx] ? `mention-opt-${matches[pickerIdx].id}` : undefined}
        />
        {picker && matches.length > 0 && (
          <ul role="listbox" aria-label="People to mention" style={{ position: 'absolute', left: 0, right: 0, bottom: '100%', margin: '0 0 4px', padding: 4, listStyle: 'none', background: 'white', border: '1px solid rgba(226,232,240,0.95)', borderRadius: 10, boxShadow: '0 8px 24px rgba(15,23,42,0.12)', zIndex: 5 }}>
            {matches.map((p, i) => (
              <li key={p.id} id={`mention-opt-${p.id}`} role="option" aria-selected={i === pickerIdx}
                onMouseDown={e => { e.preventDefault(); choose(p); }} onMouseEnter={() => setPickerIdx(i)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.4rem 0.6rem', borderRadius: 7, cursor: 'pointer', background: i === pickerIdx ? 'var(--brand-soft)' : 'transparent', fontSize: '0.8rem' }}>
                <AtSign size={12} style={{ color: '#64748b' }} /> {p.full_name} <span style={{ color: '#94a3b8', fontSize: '0.7rem' }}>{p.role === 'Requester' ? 'Client' : p.role}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <FileText size={11} /> {f.name} <span style={{ color: '#94a3b8' }}>{fmtSize(f.size)}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: '#94a3b8' }}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}

      {notice && (
        <p role="alert" style={{ marginTop: 8, fontSize: '0.76rem', color: notice.kind === 'error' ? '#b91c1c' : '#92400e' }}>{notice.text}</p>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <div>
          <input ref={fileRef} type="file" multiple hidden onChange={e => addFiles(e.target.files)} aria-label="Attach files" />
          <button type="button" className="btn-ghost" style={{ padding: '0.35rem 0.75rem', fontSize: '0.76rem' }} onClick={() => fileRef.current?.click()} disabled={files.length >= 5}>
            <Paperclip size={12} /> Attach
          </button>
          <span style={{ fontSize: '0.68rem', color: '#94a3b8', marginLeft: 8 }}>Up to 5 files, {MAX_MB} MB each</span>
        </div>
        <button type="button" className="btn-primary" style={{ padding: '0.4rem 0.9rem', fontSize: '0.8rem' }} onClick={() => void submit()} disabled={busy}>
          <Send size={12} /> {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
    </section>
  );
}
