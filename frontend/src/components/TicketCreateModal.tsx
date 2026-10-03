import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, FileText, Paperclip, Plus, Trash2, X } from 'lucide-react';
import { apiJson, authFetch } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useTickets, type DesignType } from '../contexts/TicketsContext';
import FigmaEmbed from './FigmaEmbed';

const PRIORITIES: { value: string; color: string }[] = [
  { value: 'Low', color: '#059669' }, { value: 'Normal', color: '#0056B3' },
  { value: 'High', color: '#f97316' }, { value: 'Urgent', color: '#EF4444' },
];
const PRESET_TAGS = ['Needs Copy', 'Marketing', 'Social', 'Internal', 'Urgent Fix'];
const MAX_FILES = 5;
const MAX_MB = 10;
const ALLOWED = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'psd', 'ai', 'fig'];

const sectionTitle: React.CSSProperties = { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748B', marginBottom: '0.5rem', display: 'block' };
const fmtSize = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

interface Props { isOpen: boolean; onClose: () => void }

const TicketCreateModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { designTypes, staff, createTicket, updateTicket, addSubtask, refresh } = useTickets();
  const isStaff = user?.role === 'Design Lead' || user?.role === 'Designer';
  const isLead = user?.role === 'Design Lead';

  const [typeId, setTypeId] = useState<number | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [priority, setPriority] = useState('Normal');
  const [deadline, setDeadline] = useState('');
  const [link, setLink] = useState('');
  const [linkInfo, setLinkInfo] = useState<{ valid: boolean; name?: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [newSubtask, setNewSubtask] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [estimate, setEstimate] = useState('');
  const [dragging, setDragging] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileNotes, setFileNotes] = useState<string[]>([]);
  const [done, setDone] = useState<{ id: string; number: string; warnings: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const type: DesignType | undefined = designTypes.find(d => d.id === typeId) ?? designTypes[0];

  const reset = useCallback(() => {
    setTypeId(null); setFields({}); setTitle(''); setBrief(''); setPriority('Normal'); setDeadline(''); setLink(''); setLinkInfo(null);
    setShowPreview(false); setTags([]); setCustomTag(''); setFiles([]); setSubtasks([]); setNewSubtask(''); setAssigneeId(''); setEstimate('');
    setBusy(false); setError(null); setFileNotes([]); setDone(null);
  }, []);

  useEffect(() => { if (isOpen) { reset(); setTimeout(() => titleRef.current?.focus(), 50); } }, [isOpen, reset]);

  const dirty = !!(title || brief || link || files.length || Object.values(fields).some(Boolean));

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && (!dirty || done)) closeRef.current(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isOpen, dirty, done]);

  /* Advisory completeness score (the server never blocks on it). */
  const score = useMemo(() => {
    let s = 25;
    const len = brief.trim().length;
    s += len > 150 ? 40 : len > 50 ? 20 : len > 10 ? 10 : 0;
    if (files.length) s += 30;
    if (link.trim()) s += 20;
    return Math.min(100, s);
  }, [brief, files.length, link]);

  const addFiles = (list: FileList | File[]) => {
    const notes: string[] = [];
    const ok: File[] = [];
    for (const f of Array.from(list)) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      if (!ALLOWED.includes(ext)) notes.push(`${f.name}: .${ext} files are not allowed`);
      else if (f.size > MAX_MB * 1024 * 1024) notes.push(`${f.name}: larger than ${MAX_MB} MB`);
      else ok.push(f);
    }
    setFiles(prev => [...prev, ...ok].slice(0, MAX_FILES));
    if (prev_over(files.length, ok.length)) notes.push(`Only ${MAX_FILES} files can be attached.`);
    setFileNotes(notes);
  };
  const prev_over = (have: number, adding: number) => have + adding > MAX_FILES;

  const checkLink = async () => {
    const v = link.trim();
    if (!v) { setLinkInfo(null); return; }
    try { setLinkInfo(await apiJson<{ valid: boolean; name?: string }>(`/api/figma/preview?url=${encodeURIComponent(v)}`)); }
    catch { setLinkInfo(null); }
  };

  const toggleTag = (t: string) => setTags(prev => (prev.includes(t) ? prev.filter(x => x !== t) : prev.length < 10 ? [...prev, t] : prev));
  const addCustomTag = () => {
    const t = customTag.trim().slice(0, 30);
    if (t && !tags.includes(t) && tags.length < 10) setTags([...tags, t]);
    setCustomTag('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!type) { setError('No design types are available yet.'); return; }
    if (!title.trim()) { setError('Please enter a title.'); return; }
    if (!brief.trim()) { setError('Please describe what you need in the brief.'); return; }
    for (const f of type.required_fields) {
      if (!fields[f.name]?.trim()) { setError(`Please fill in “${f.label}”.`); return; }
    }
    const est = estimate.trim() === '' ? null : Number(estimate);
    if (est !== null && (!Number.isFinite(est) || est < 0 || est > 200)) { setError('Estimate must be between 0 and 200 hours.'); return; }

    const extra: Record<string, unknown> = { ...fields };
    if (deadline) extra.requested_deadline = deadline;
    let figma: string | null = null;
    const l = link.trim();
    if (l) {
      if (linkInfo?.valid || /^https:\/\/(www\.)?figma\.com\//.test(l)) figma = l;
      else if (/^https:\/\//.test(l)) extra.reference_link = l;
      else { setError('The reference link must start with https://'); return; }
    }

    setBusy(true); setError(null);
    try {
      const created = await createTicket({
        title: title.trim(), brief: brief.trim(), design_type_id: type.id, priority, tags,
        type_specific_fields: extra, figma_url: figma, ...(isStaff ? { estimate_hours: est } : {}),
      });
      const warnings: string[] = [];

      for (const f of files) {
        const body = new FormData();
        body.append('file', f);
        const res = await authFetch(`/api/tickets/${created.id}/attachments`, { method: 'POST', body });
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try { detail = (await res.json()).detail ?? detail; } catch { /* keep status */ }
          warnings.push(`${f.name} was not attached (${detail})`);
        }
      }
      if (isStaff) {
        for (const s of subtasks) {
          try { await addSubtask(created.id, s); } catch { warnings.push(`Subtask “${s}” was not added`); }
        }
      }
      if (isLead && assigneeId) {
        try { await updateTicket(created.id, { assignee_id: Number(assigneeId) }); } catch { warnings.push('The assignee could not be set'); }
      }
      await refresh();
      setDone({ id: created.id, number: created.number, warnings });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the ticket.');
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  const scoreColor = score >= 90 ? '#059669' : score >= 60 ? '#d97706' : '#dc2626';

  return (
    <div className="animate-fade-in" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }}>
      <div role="dialog" aria-modal="true" aria-labelledby="new-ticket-title" className="animate-fade-in-up"
        style={{ background: 'rgba(255,255,255,0.98)', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 'var(--radius-lg)', boxShadow: '0 30px 80px rgba(0,63,138,0.12)', width: '100%', maxWidth: 680, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.1rem 1.5rem', borderBottom: '1px solid rgba(226,232,240,0.85)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="icon-tile" style={{ width: 36, height: 36 }}><Plus size={16} /></div>
            <div>
              <h2 id="new-ticket-title" style={{ fontSize: '1rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: '#0F172A', lineHeight: 1.1 }}>{isStaff ? 'New design ticket' : 'New design request'}</h2>
              <p style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 1 }}>MCCIA Applied AI Studio</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(226,232,240,0.85)', background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B' }}><X size={16} /></button>
        </div>

        {done ? (
          <div style={{ padding: '2.5rem 1.5rem', textAlign: 'center' }} role="status">
            <CheckCircle2 size={44} style={{ color: '#10B981', margin: '0 auto 12px' }} />
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0F172A' }}>{done.number} created</h3>
            <p style={{ fontSize: '0.85rem', color: '#64748B', marginTop: 6 }}>The design team has been notified. You'll be told when it moves forward.</p>
            {done.warnings.length > 0 && (
              <ul style={{ margin: '14px auto 0', maxWidth: 440, textAlign: 'left', fontSize: '0.78rem', color: '#92400e', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, padding: '0.6rem 1rem 0.6rem 1.6rem' }}>
                {done.warnings.map(w => <li key={w}>{w}</li>)}
              </ul>
            )}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
              <button type="button" className="btn-primary" onClick={() => { onClose(); navigate(`/tickets/${done.id}`); }}>Open ticket</button>
              <button type="button" className="btn-ghost" onClick={reset}>Create another</button>
              <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }} noValidate>
            <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.35rem' }}>

              <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                <legend style={sectionTitle}>What do you need?</legend>
                {designTypes.length === 0 ? (
                  <p role="status" style={{ fontSize: '0.82rem', color: '#94a3b8' }}>Loading design types…</p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem' }}>
                    {designTypes.map(d => {
                      const on = d.id === type?.id;
                      return (
                        <label key={d.id} style={{ cursor: 'pointer', padding: '0.7rem 0.8rem', borderRadius: 10, border: `1.5px solid ${on ? '#003F8A' : 'rgba(226,232,240,0.9)'}`, background: on ? 'var(--brand-soft)' : 'white' }}>
                          <input type="radio" name="design-type" className="sr-only" checked={on} onChange={() => { setTypeId(d.id); setFields({}); }} style={{ position: 'absolute', opacity: 0 }} />
                          <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: on ? '#003F8A' : '#0F172A' }}>{d.name}</span>
                          <span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b' }}>Typical turnaround {d.default_sla_hours} working hours</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </fieldset>

              <div>
                <label htmlFor="nt-title" style={sectionTitle}>Title *</label>
                <input id="nt-title" ref={titleRef} className="input-field" maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Spring sale homepage banner" required />
              </div>

              <div>
                <label htmlFor="nt-brief" style={sectionTitle}>Brief *</label>
                <textarea id="nt-brief" className="input-field" rows={5} maxLength={5000} value={brief} onChange={e => setBrief(e.target.value)} placeholder="What should it communicate? Who is it for? Any copy, sizes, colours or references?" style={{ resize: 'vertical' }} required />
                <p style={{ fontSize: '0.68rem', color: '#94a3b8', textAlign: 'right', marginTop: 2 }}>{brief.length}/5000</p>
              </div>

              {type && type.required_fields.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.85rem' }}>
                  {type.required_fields.map(f => (
                    <div key={f.name}>
                      <label htmlFor={`nt-f-${f.name}`} style={sectionTitle}>{f.label} *</label>
                      {f.type === 'select' ? (
                        <select id={`nt-f-${f.name}`} className="input-field" value={fields[f.name] ?? ''} onChange={e => setFields({ ...fields, [f.name]: e.target.value })} required>
                          <option value="">Select…</option>
                          {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : f.type === 'text' ? (
                        <textarea id={`nt-f-${f.name}`} className="input-field" rows={2} value={fields[f.name] ?? ''} onChange={e => setFields({ ...fields, [f.name]: e.target.value })} required />
                      ) : (
                        <input id={`nt-f-${f.name}`} className="input-field" value={fields[f.name] ?? ''} onChange={e => setFields({ ...fields, [f.name]: e.target.value })} required />
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.85rem' }}>
                <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                  <legend style={sectionTitle}>Priority</legend>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {PRIORITIES.map(p => (
                      <button key={p.value} type="button" aria-pressed={priority === p.value} onClick={() => setPriority(p.value)}
                        style={{ padding: '0.35rem 0.8rem', borderRadius: 99, fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer', border: `1.5px solid ${priority === p.value ? p.color : 'rgba(226,232,240,0.9)'}`, background: priority === p.value ? `${p.color}14` : 'white', color: priority === p.value ? p.color : '#475569' }}>
                        {p.value}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <div>
                  <label htmlFor="nt-deadline" style={sectionTitle}>Needed by (optional)</label>
                  <input id="nt-deadline" type="date" className="input-field" min={new Date().toISOString().slice(0, 10)} value={deadline} onChange={e => setDeadline(e.target.value)} />
                </div>
              </div>

              <div>
                <label htmlFor="nt-link" style={sectionTitle}>Reference link (Figma, Canva, Drive…)</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input id="nt-link" type="url" className="input-field" value={link} onChange={e => { setLink(e.target.value); setLinkInfo(null); setShowPreview(false); }} onBlur={() => void checkLink()} placeholder="https://www.figma.com/design/…" />
                  {linkInfo?.valid && <button type="button" className="btn-ghost" onClick={() => setShowPreview(s => !s)}>{showPreview ? 'Hide' : 'Preview'}</button>}
                </div>
                {linkInfo?.valid && <p style={{ fontSize: '0.72rem', color: '#047857', marginTop: 4 }}>Figma file detected: “{linkInfo.name}”.</p>}
                {showPreview && linkInfo?.valid && <FigmaEmbed url={link.trim()} />}
              </div>

              <div>
                <span style={sectionTitle}>Tags</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  {[...PRESET_TAGS, ...tags.filter(t => !PRESET_TAGS.includes(t))].map(t => (
                    <button key={t} type="button" aria-pressed={tags.includes(t)} onClick={() => toggleTag(t)} className="chip"
                      style={tags.includes(t) ? { background: 'var(--brand-soft)', borderColor: '#003F8A', color: '#003F8A' } : undefined}>{t}</button>
                  ))}
                  <input className="input-field" aria-label="Add a custom tag" value={customTag} maxLength={30} placeholder="+ custom tag" onChange={e => setCustomTag(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomTag(); } }} style={{ width: 130, padding: '0.25rem 0.6rem', fontSize: '0.75rem' }} />
                </div>
              </div>

              <div>
                <span style={sectionTitle}>Attachments</span>
                <div
                  onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                  onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
                  style={{ border: `2px dashed ${dragging ? '#003F8A' : 'rgba(203,213,225,0.9)'}`, background: dragging ? 'var(--brand-soft)' : '#F8FAFC', borderRadius: 12, padding: '1rem', textAlign: 'center' }}>
                  <input ref={fileRef} type="file" multiple hidden aria-label="Choose files" onChange={e => { if (e.target.files) addFiles(e.target.files); if (fileRef.current) fileRef.current.value = ''; }} />
                  <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    Drag files here or <button type="button" className="chip" onClick={() => fileRef.current?.click()}><Paperclip size={11} /> browse</button>
                  </p>
                  <p style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: 4 }}>Up to {MAX_FILES} files, {MAX_MB} MB each · images, PDF, Office files, zip, PSD/AI</p>
                </div>
                {fileNotes.length > 0 && <p role="alert" style={{ fontSize: '0.74rem', color: '#b91c1c', marginTop: 6 }}>{fileNotes.join(' · ')}</p>}
                {files.length > 0 && (
                  <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {files.map((f, i) => (
                      <li key={`${f.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', color: '#475569' }}>
                        <FileText size={13} /> <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{f.name}</span> <span style={{ color: '#94a3b8' }}>{fmtSize(f.size)}</span>
                        <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex' }}><X size={13} /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {isStaff && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
                  {isLead && (
                    <div>
                      <label htmlFor="nt-assignee" style={sectionTitle}>Assign to</label>
                      <select id="nt-assignee" className="input-field" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
                        <option value="">Unassigned</option>
                        {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label htmlFor="nt-est" style={sectionTitle}>Estimate (hours)</label>
                    <input id="nt-est" className="input-field" inputMode="decimal" placeholder="Uses the design type default" value={estimate} onChange={e => setEstimate(e.target.value)} />
                  </div>
                </div>
              )}

              {isStaff && (
                <div>
                  <span style={sectionTitle}>Subtasks</span>
                  {subtasks.map((s, i) => (
                    <div key={`${s}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', padding: '3px 0' }}>
                      <span style={{ flex: 1 }}>{s}</span>
                      <button type="button" aria-label={`Remove subtask ${s}`} onClick={() => setSubtasks(subtasks.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex' }}><Trash2 size={13} /></button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <input className="input-field" aria-label="New subtask" maxLength={200} value={newSubtask} onChange={e => setNewSubtask(e.target.value)} placeholder="Add a subtask…" style={{ fontSize: '0.8rem' }}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const t = newSubtask.trim(); if (t) { setSubtasks([...subtasks, t]); setNewSubtask(''); } } }} />
                    <button type="button" className="btn-ghost" aria-label="Add subtask" onClick={() => { const t = newSubtask.trim(); if (t) { setSubtasks([...subtasks, t]); setNewSubtask(''); } }}><Plus size={13} /></button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ padding: '0.85rem 1.5rem', borderTop: '1px solid rgba(226,232,240,0.85)', background: '#F8FAFC' }}>
              {error && <p role="alert" style={{ fontSize: '0.8rem', color: '#b91c1c', marginBottom: 8 }}>{error}</p>}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 190 }} title="A fuller brief means fewer questions and revisions">
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#64748b', marginBottom: 3 }}>
                    <span>Brief completeness</span><strong style={{ color: scoreColor }}>{score}%</strong>
                  </div>
                  <div style={{ height: 5, background: 'rgba(226,232,240,0.9)', borderRadius: 99, overflow: 'hidden' }} role="progressbar" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100} aria-label="Brief completeness">
                    <div style={{ height: '100%', width: `${score}%`, background: scoreColor, transition: 'width 0.25s' }} />
                  </div>
                  {score < 90 && <p style={{ fontSize: '0.66rem', color: '#94a3b8', marginTop: 3 }}>More detail, a file or a link speeds things up.</p>}
                </div>
                <div style={{ display: 'flex', gap: '0.6rem' }}>
                  <button type="button" onClick={onClose} className="btn-ghost" style={{ padding: '0.6rem 1.1rem', fontSize: '0.82rem' }}>Cancel</button>
                  <button type="submit" className="btn-primary" disabled={busy || !type} style={{ padding: '0.6rem 1.25rem', fontSize: '0.82rem' }}>
                    <Plus size={14} /> {busy ? 'Creating…' : 'Create ticket'}
                  </button>
                </div>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default TicketCreateModal;
