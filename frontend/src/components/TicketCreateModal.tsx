import React, { useState, useRef, useCallback } from 'react';
import {
  X, LayoutTemplate, Palette, Image as ImageIcon, Link2, Calendar, ChevronDown,
  Plus, Trash2, CheckSquare, Square, Bold, Italic, List, AlignLeft,
  Users, Tag, FileText, Eye
} from 'lucide-react';

/* ─── Types ───────────────────────────────────── */
type Priority = 'Low' | 'Medium' | 'High' | 'Urgent';

interface SubTask {
  id:           string;
  text:         string;
  is_completed: boolean;
}

interface UploadedFile {
  file:     File;
  previewUrl: string | null;
}

interface Tag_ {
  id:    string;
  label: string;
  color: string;
}

/* ─── Constants ───────────────────────────────── */
const TEMPLATES = [
  { id: 'social',   name: 'Social Media Graphic', icon: <ImageIcon    size={16}/>, fields: ['Platform (IG, FB, LinkedIn)', 'Dimensions (e.g. 1080×1080)', 'Primary Text Copy', 'Brand Colors'] },
  { id: 'logo',     name: 'Brand Logo',            icon: <Palette      size={16}/>, fields: ['Company Name', 'Slogan (Optional)', 'Vibe (e.g. Modern, Vintage)', 'Preferred Colors'] },
  { id: 'landing',  name: 'Landing Page UI',       icon: <LayoutTemplate size={16}/>, fields: ['Target Audience', 'Main CTA', 'Wireframe Link', 'Brand Guidelines'] },
];

const PRIORITY_OPTIONS: { value: Priority; color: string; bg: string }[] = [
  { value: 'Low',    color: '#059669', bg: 'rgba(16,185,129,0.06)'  },
  { value: 'Medium', color: '#0056B3', bg: 'rgba(0,86,179,0.06)'    },
  { value: 'High',   color: '#f97316', bg: 'rgba(249,115,22,0.06)'  },
  { value: 'Urgent', color: '#EF4444', bg: 'rgba(239,68,68,0.06)'   },
];

const REVIEWERS = ['Alice (UI/UX)', 'Bob (Graphic)', 'Charlie (Video)', 'Dana (Copy)', 'Eve (Brand)'];

const PRESET_TAGS: Tag_[] = [
  { id: 't1', label: 'Needs Copy',  color: '#8B5CF6' },
  { id: 't2', label: 'Marketing',   color: '#003F8A' },
  { id: 't3', label: 'Social',      color: '#0056B3' },
  { id: 't4', label: 'Client A',    color: '#059669' },
  { id: 't5', label: 'Urgent Fix',  color: '#EF4444' },
  { id: 't6', label: 'Internal',    color: '#64748B' },
];

const DESIGN_TOOL_PATTERNS: { name: string; pattern: RegExp; embedBase: (id: string) => string }[] = [
  {
    name: 'Figma',
    pattern: /figma\.com\/(file|proto|design)\/([a-zA-Z0-9]+)/,
    embedBase: (id) => `https://www.figma.com/embed?embed_host=designdesk&url=https://www.figma.com/file/${id}`,
  },
  {
    name: 'Canva',
    pattern: /canva\.com\/design\/([a-zA-Z0-9_-]+)/,
    embedBase: (id) => `https://www.canva.com/design/${id}/view?embed`,
  },
  {
    name: 'Miro',
    pattern: /miro\.com\/app\/board\/([a-zA-Z0-9_=-]+)/,
    embedBase: (id) => `https://miro.com/app/live-embed/${id}/`,
  },
];

/* ─── Helpers ─────────────────────────────────── */
function detectDesignLink(url: string): { name: string; embedUrl: string } | null {
  for (const tool of DESIGN_TOOL_PATTERNS) {
    const match = url.match(tool.pattern);
    if (match) return { name: tool.name, embedUrl: tool.embedBase(match[2] ?? match[1]) };
  }
  return null;
}

function formatBytes(n: number): string {
  if (n < 1024)       return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/* ─── Sub-components ─────────────────────────── */

/** Simple bold/italic/list rich-text toolbar over a contenteditable div */
function RichTextEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  const exec = (cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
    ref.current?.focus();
  };

  const ToolBtn = ({ icon, cmd, val }: { icon: React.ReactNode; cmd: string; val?: string }) => (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); exec(cmd, val); }}
      title={cmd}
      style={{
        width: 28, height: 28, borderRadius: 6, border: '1px solid rgba(226,232,240,0.85)',
        background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: '#64748B', flexShrink: 0,
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#003F8A'; (e.currentTarget as HTMLButtonElement).style.color = '#003F8A'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(226,232,240,0.85)'; (e.currentTarget as HTMLButtonElement).style.color = '#64748B'; }}
    >
      {icon}
    </button>
  );

  return (
    <div style={{ border: '1px solid rgba(226,232,240,0.85)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 4, padding: '6px 10px', borderBottom: '1px solid rgba(226,232,240,0.85)', background: '#F8FAFC' }}>
        <ToolBtn icon={<Bold    size={13}/>} cmd="bold"          />
        <ToolBtn icon={<Italic  size={13}/>} cmd="italic"        />
        <ToolBtn icon={<List    size={13}/>} cmd="insertUnorderedList" />
        <ToolBtn icon={<AlignLeft size={13}/>} cmd="formatBlock" val="p" />
      </div>
      {/* Editable area */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={e => onChange((e.currentTarget as HTMLDivElement).innerHTML)}
        style={{
          minHeight: 90, padding: '10px 14px', outline: 'none',
          fontSize: '0.875rem', fontFamily: 'var(--font-body)',
          color: '#0F172A', lineHeight: 1.7,
        }}
        data-placeholder="Describe your design requirements — use bold, lists, links…"
      />
      <style>{`[contenteditable]:empty:before{content:attr(data-placeholder);color:#94a3b8;pointer-events:none;}`}</style>
    </div>
  );
}

/** File preview card */
function FileCard({ uf, onRemove }: { uf: UploadedFile; onRemove: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: '#F8FAFC', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 'var(--radius-sm)' }}>
      {uf.previewUrl ? (
        <img src={uf.previewUrl} alt={uf.file.name} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
      ) : (
        <div style={{ width: 40, height: 40, background: 'rgba(0,63,138,0.06)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <FileText size={18} color="#003F8A" />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{uf.file.name}</p>
        <p style={{ fontSize: '0.7rem', color: '#64748B' }}>{formatBytes(uf.file.size)}</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        style={{ color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 4, flexShrink: 0 }}
        title="Remove file"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/* ─── Main Modal ─────────────────────────────── */
interface Props { isOpen: boolean; onClose: () => void; }

const TicketCreateModal: React.FC<Props> = ({ isOpen, onClose }) => {
  /* Template */
  const [selectedTemplate, setSelectedTemplate] = useState(TEMPLATES[0]);
  const [templateData, setTemplateData] = useState<Record<string, string>>({});

  /* Basic fields */
  const [title,    setTitle]    = useState('');
  const [richText, setRichText] = useState('');

  /* Priority + Due date */
  const [priority, setPriority] = useState<Priority>('Medium');
  const [dueDate,  setDueDate]  = useState('');

  /* Design tool link */
  const [designLink,   setDesignLink]   = useState('');
  const [embedInfo,    setEmbedInfo]    = useState<{ name: string; embedUrl: string } | null>(null);
  const [showPreview,  setShowPreview]  = useState(false);

  /* Subtasks */
  const [subtasks,    setSubtasks]    = useState<SubTask[]>([]);
  const [newSubtask,  setNewSubtask]  = useState('');

  /* Reviewers */
  const [selectedReviewers, setSelectedReviewers] = useState<string[]>([]);
  const [reviewerOpen,      setReviewerOpen]       = useState(false);

  /* Files */
  const [files,    setFiles]    = useState<UploadedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Tags */
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTag,    setCustomTag]    = useState('');

  /* ── Handlers (all hooks must be declared before any early return) ── */
  const addFiles = useCallback((fileList: FileList) => {
    const newUFs: UploadedFile[] = Array.from(fileList).map(file => ({
      file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    }));
    setFiles(prev => [...prev, ...newUFs]);
  }, []);

  /* Early return — MUST come after all hooks */
  if (!isOpen) return null;

  const handleDesignLinkChange = (url: string) => {
    setDesignLink(url);
    setEmbedInfo(detectDesignLink(url));
    setShowPreview(false);
  };

  const addSubtask = () => {
    if (!newSubtask.trim()) return;
    setSubtasks(prev => [...prev, { id: Date.now().toString(), text: newSubtask.trim(), is_completed: false }]);
    setNewSubtask('');
  };

  const toggleSubtask = (id: string) =>
    setSubtasks(prev => prev.map(s => s.id === id ? { ...s, is_completed: !s.is_completed } : s));

  const removeSubtask = (id: string) =>
    setSubtasks(prev => prev.filter(s => s.id !== id));

  const toggleReviewer = (name: string) =>
    setSelectedReviewers(prev => prev.includes(name) ? prev.filter(r => r !== name) : [...prev, name]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  const toggleTag = (id: string) =>
    setSelectedTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);

  const addCustomTag = () => {
    if (!customTag.trim()) return;
    // no-op: custom tags are just visual for now
    setCustomTag('');
  };

  /* ── Priority config ── */
  const priorityCfg = PRIORITY_OPTIONS.find(p => p.value === priority)!;

  /* ── Styles ── */
  const sectionTitle = { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: '#64748B', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem' };
  const inp = {
    background: 'white', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 'var(--radius-md)',
    padding: '0.55rem 0.875rem', fontSize: '0.875rem', fontFamily: 'var(--font-body)', color: '#0F172A',
    width: '100%', outline: 'none', transition: 'border-color 0.2s, box-shadow 0.2s',
  };

  return (
    <div
      className="animate-fade-in"
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }}
    >
      <div
        className="animate-fade-in-up"
        style={{
          background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(16px)',
          border: '1px solid rgba(226,232,240,0.85)', borderRadius: 'var(--radius-lg)',
          boxShadow: '0 30px 80px rgba(0,63,138,0.12)',
          width: '100%', maxWidth: 680, maxHeight: '92vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* ── Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(226,232,240,0.85)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="icon-tile" style={{ width: 36, height: 36 }}>
              <Plus size={16} />
            </div>
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                New Design Ticket
              </h2>
              <p style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 1 }}>MCCIA Applied AI Studio</p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(226,232,240,0.85)', background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B', transition: 'all 0.2s' }}
            onMouseEnter={e => { (e.currentTarget).style.borderColor = '#EF4444'; (e.currentTarget).style.color = '#EF4444'; }}
            onMouseLeave={e => { (e.currentTarget).style.borderColor = 'rgba(226,232,240,0.85)'; (e.currentTarget).style.color = '#64748B'; }}
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Scrollable Body ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* 1. Template */}
          <section>
            <p style={sectionTitle}><LayoutTemplate size={12} /> Template</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
              {TEMPLATES.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setSelectedTemplate(t); setTemplateData({}); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.75rem',
                    borderRadius: 'var(--radius-sm)', border: '1px solid',
                    borderColor:  selectedTemplate.id === t.id ? '#003F8A' : 'rgba(226,232,240,0.85)',
                    background:   selectedTemplate.id === t.id ? 'rgba(0,63,138,0.06)' : 'white',
                    color:        selectedTemplate.id === t.id ? '#003F8A' : '#475569',
                    fontSize:     '0.78rem', fontWeight: 600, cursor: 'pointer',
                    transition:   'all 0.2s', fontFamily: 'var(--font-body)',
                    boxShadow:    selectedTemplate.id === t.id ? '0 0 0 2px rgba(0,63,138,0.15)' : 'none',
                  }}
                >
                  {t.icon}
                  {t.name}
                </button>
              ))}
            </div>
          </section>

          {/* 2. Title */}
          <section>
            <p style={sectionTitle}><FileText size={12} /> Ticket Title *</p>
            <input
              className="input-field"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Summer Sale Instagram Post"
            />
          </section>

          {/* 3. Priority + Due Date */}
          <section>
            <p style={sectionTitle}><Calendar size={12} /> Priority & Due Date</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              {/* Priority */}
              <div style={{ position: 'relative' }}>
                <select
                  className="input-field"
                  value={priority}
                  onChange={e => setPriority(e.target.value as Priority)}
                  style={{
                    appearance: 'none', paddingRight: '2rem', cursor: 'pointer',
                    background:  priorityCfg.bg,
                    borderColor: `${priorityCfg.color}40`,
                    color:       priorityCfg.color, fontWeight: 700,
                  }}
                >
                  {PRIORITY_OPTIONS.map(p => (
                    <option key={p.value} value={p.value}>{p.value}</option>
                  ))}
                </select>
                <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: priorityCfg.color }} />
              </div>
              {/* Due date */}
              <input
                className="input-field"
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                style={{ colorScheme: 'light' }}
              />
            </div>
          </section>

          {/* 4. Template-specific required fields */}
          <section>
            <p style={sectionTitle}><CheckSquare size={12} /> Required for {selectedTemplate.name}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', background: '#F8FAFC', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid rgba(226,232,240,0.85)' }}>
              {selectedTemplate.fields.map(field => (
                <div key={field}>
                  <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#64748B', marginBottom: 4 }}>{field} *</label>
                  <input className="input-field" type="text" placeholder={`Enter ${field.toLowerCase()}…`} value={templateData[field] || ''} onChange={e => setTemplateData(prev => ({...prev, [field]: e.target.value}))} />
                </div>
              ))}
            </div>
          </section>

          {/* 5. Rich text context */}
          <section>
            <p style={sectionTitle}><AlignLeft size={12} /> Additional Context</p>
            <RichTextEditor value={richText} onChange={setRichText} />
          </section>

          {/* 6. Design Tool Link (Figma / Canva / Miro) */}
          <section>
            <p style={sectionTitle}><Link2 size={12} /> Design Link — Figma, Canva or Miro</p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                className="input-field"
                type="url"
                value={designLink}
                onChange={e => handleDesignLinkChange(e.target.value)}
                placeholder="Paste a Figma, Canva or Miro URL…"
              />
              {embedInfo && (
                <button
                  type="button"
                  onClick={() => setShowPreview(p => !p)}
                  className="btn-ghost"
                  style={{ padding: '0.55rem 0.875rem', whiteSpace: 'nowrap', fontSize: '0.78rem' }}
                >
                  <Eye size={13} />
                  {showPreview ? 'Hide' : `Preview ${embedInfo.name}`}
                </button>
              )}
            </div>
            {embedInfo && !showPreview && (
              <p style={{ fontSize: '0.72rem', color: '#059669', marginTop: 4 }}>
                ✓ {embedInfo.name} link detected — click Preview to embed live view.
              </p>
            )}
            {embedInfo && showPreview && (
              <div style={{ marginTop: '0.75rem', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid rgba(0,63,138,0.15)', aspectRatio: '16/9', background: '#F8FAFC' }}>
                <iframe
                  src={embedInfo.embedUrl}
                  width="100%"
                  height="100%"
                  allowFullScreen
                  title={`${embedInfo.name} Preview`}
                  style={{ border: 'none', display: 'block' }}
                />
              </div>
            )}
          </section>

          {/* 7. Subtasks */}
          <section>
            <p style={sectionTitle}><CheckSquare size={12} /> Subtasks & Checklist</p>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem' }}>
              <input
                className="input-field"
                type="text"
                value={newSubtask}
                onChange={e => setNewSubtask(e.target.value)}
                placeholder="Add a subtask (e.g. Wireframes, High Fidelity…)"
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSubtask())}
              />
              <button type="button" onClick={addSubtask} className="btn-primary" style={{ padding: '0.55rem 0.875rem', whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
                <Plus size={13} /> Add
              </button>
            </div>
            {subtasks.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {subtasks.map(s => (
                  <div
                    key={s.id}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0.75rem', background: '#F8FAFC', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 'var(--radius-sm)' }}
                  >
                    <button type="button" onClick={() => toggleSubtask(s.id)} style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: s.is_completed ? '#059669' : '#94a3b8' }}>
                      {s.is_completed ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                    <span style={{ flex: 1, fontSize: '0.82rem', color: s.is_completed ? '#94a3b8' : '#0F172A', textDecoration: s.is_completed ? 'line-through' : 'none' }}>{s.text}</span>
                    <button type="button" onClick={() => removeSubtask(s.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#cbd5e1', flexShrink: 0 }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <p style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: 2 }}>
                  {subtasks.filter(s => s.is_completed).length}/{subtasks.length} completed
                </p>
              </div>
            )}
          </section>

          {/* 8. Approvers & Reviewers */}
          <section>
            <p style={sectionTitle}><Users size={12} /> Required Approvers</p>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setReviewerOpen(o => !o)}
                style={{ ...inp, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', textAlign: 'left' }}
              >
                <span style={{ color: selectedReviewers.length ? '#0F172A' : '#94a3b8', fontSize: '0.875rem' }}>
                  {selectedReviewers.length ? selectedReviewers.join(', ') : 'Select reviewers…'}
                </span>
                <ChevronDown size={14} style={{ color: '#64748B', transition: 'transform 0.2s', transform: reviewerOpen ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />
              </button>
              {reviewerOpen && (
                <div style={{ position: 'absolute', top: '110%', left: 0, right: 0, background: 'white', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0,63,138,0.08)', zIndex: 10, overflow: 'hidden' }}>
                  {REVIEWERS.map(name => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => toggleReviewer(name)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0.875rem', background: selectedReviewers.includes(name) ? 'rgba(0,63,138,0.04)' : 'white', border: 'none', cursor: 'pointer', fontSize: '0.85rem', color: selectedReviewers.includes(name) ? '#003F8A' : '#475569', fontFamily: 'var(--font-body)', transition: 'background 0.15s' }}
                    >
                      <div style={{ width: 14, height: 14, borderRadius: 4, border: `2px solid ${selectedReviewers.includes(name) ? '#003F8A' : '#cbd5e1'}`, background: selectedReviewers.includes(name) ? '#003F8A' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {selectedReviewers.includes(name) && <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" /></svg>}
                      </div>
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedReviewers.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem' }}>
                {selectedReviewers.map(r => (
                  <span key={r} className="badge-blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {r}
                    <button type="button" onClick={() => toggleReviewer(r)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', lineHeight: 0 }}><X size={10} /></button>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* 9. File upload with preview */}
          <section>
            <p style={sectionTitle}><ImageIcon size={12} /> Upload Sample Designs or Files</p>
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border:        `2px dashed ${dragging ? '#003F8A' : 'rgba(226,232,240,0.85)'}`,
                background:    dragging ? 'rgba(0,63,138,0.03)' : '#F8FAFC',
                borderRadius:  'var(--radius-md)',
                padding:       '1.25rem',
                textAlign:     'center',
                cursor:        'pointer',
                transition:    'all 0.2s',
              }}
            >
              <ImageIcon size={22} style={{ margin: '0 auto 0.5rem', color: '#94a3b8' }} />
              <p style={{ fontSize: '0.82rem', color: '#475569', marginBottom: 2 }}>
                <strong>Click to upload</strong> or drag and drop
              </p>
              <p style={{ fontSize: '0.7rem', color: '#94a3b8' }}>PNG, JPG, GIF, PDF, Sketch, Figma export</p>
              <input ref={fileInputRef} id="dropzone-file" type="file" className="hidden" multiple accept="image/*,.pdf,.sketch,.fig" onChange={e => e.target.files && addFiles(e.target.files)} />
            </div>
            {files.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.6rem' }}>
                {files.map((uf, i) => (
                  <FileCard key={i} uf={uf} onRemove={() => setFiles(prev => prev.filter((_, j) => j !== i))} />
                ))}
              </div>
            )}
          </section>

          {/* 10. Tags / Labels */}
          <section>
            <p style={sectionTitle}><Tag size={12} /> Tags & Labels</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' }}>
              {PRESET_TAGS.map(tag => {
                const active = selectedTags.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    style={{
                      padding:      '0.2rem 0.625rem',
                      borderRadius: 'var(--radius-pill)',
                      border:       `1px solid ${active ? tag.color + '60' : 'rgba(226,232,240,0.85)'}`,
                      background:   active ? tag.color + '10' : 'white',
                      color:        active ? tag.color : '#64748B',
                      fontSize:     '0.7rem', fontWeight: 700, textTransform: 'uppercase',
                      letterSpacing: '0.08em', cursor: 'pointer',
                      fontFamily:   'var(--font-body)', transition: 'all 0.2s',
                    }}
                  >
                    {tag.label}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input
                className="input-field"
                type="text"
                value={customTag}
                onChange={e => setCustomTag(e.target.value)}
                placeholder="Custom label…"
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addCustomTag())}
                style={{ flex: 1 }}
              />
              <button type="button" onClick={addCustomTag} className="btn-ghost" style={{ padding: '0.55rem 0.875rem', fontSize: '0.78rem' }}>
                <Plus size={13} /> Add
              </button>
            </div>
          </section>

        </div>

        {/* ── Footer ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderTop: '1px solid rgba(226,232,240,0.85)', background: '#F8FAFC' }}>
          <p style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
            {subtasks.length > 0 && <span className="badge-blue" style={{ marginRight: 6 }}>{subtasks.length} subtasks</span>}
            {selectedReviewers.length > 0 && <span className="badge-green" style={{ marginRight: 6 }}>{selectedReviewers.length} reviewers</span>}
            {files.length > 0 && <span className="badge-blue">{files.length} file{files.length !== 1 ? 's' : ''}</span>}
          </p>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button type="button" onClick={onClose} className="btn-ghost" style={{ padding: '0.6rem 1.1rem', fontSize: '0.82rem' }}>
              Cancel
            </button>
            <button type="button" className="btn-primary" style={{ padding: '0.6rem 1.25rem', fontSize: '0.82rem' }} onClick={() => {
              if (!title.trim()) { alert("Please enter a ticket title."); return; }
              for (const field of selectedTemplate.fields) {
                if (!templateData[field]?.trim()) {
                  alert(`Please fill out the required field: ${field}`);
                  return;
                }
              }
              
              // Calculate Brief Completeness AI Score
              let score = 0;
              const textLength = richText.replace(/<[^>]*>?/gm, '').trim().length;
              if (textLength > 150) score += 40;
              else if (textLength > 50) score += 20;
              else if (textLength > 10) score += 10;
              
              if (files.length > 0) score += 30;
              if (designLink) score += 20;
              
              // Base score for just filling the required fields
              score += 25;
              
              const finalScore = Math.min(100, score);
              
              if (finalScore < 90) {
                alert(`Ticket created, but Info Score is only ${finalScore}%. The ticket has been blocked and moved to "Waiting on Requester" status until you provide more detailed instructions or assets.`);
              } else {
                alert(`Ticket created successfully! Info Score: ${finalScore}% - Ready for Design.`);
              }
              
              onClose();
            }}>
              <Plus size={14} /> Create Ticket
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TicketCreateModal;
