import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiJson, ApiError } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { Plus, RefreshCw, Play, Pencil, Trash2, Copy, CalendarClock } from 'lucide-react';

type Priority = 'Low' | 'Normal' | 'High' | 'Urgent';
interface Item {
  title: string; brief: string; design_type_id: number; priority: Priority;
  tags: string[]; type_specific_fields: Record<string, unknown>; estimate_hours: number | null;
}
interface Template { id: number; name: string; description: string | null; items: Item[]; is_active: boolean; created_at: string }
interface DesignType { id: number; name: string }
interface UserRow { id: number; email: string; full_name: string; role: string }
interface Rule {
  id: number; name: string; template_id: number; template_name: string; frequency: 'weekly' | 'monthly';
  day: number; hour: number; requester_id: number; assignee_id: number | null; is_active: boolean;
  next_run_at: string; last_run_at: string | null;
}
type Created = { id: number; ticket_number: string; title?: string }[];

const FIELD_LABEL: React.CSSProperties = { fontSize: '0.78rem', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 6 };
const HINT: React.CSSProperties = { fontSize: '0.72rem', color: '#64748b', marginTop: 4, lineHeight: 1.5 };
const CARD: React.CSSProperties = { padding: '1.25rem' };
const ROW: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' };
const ERR: React.CSSProperties = { color: '#b91c1c', fontSize: '0.82rem', margin: '8px 0' };
const OK: React.CSSProperties = { color: '#15803d', fontSize: '0.82rem', margin: '8px 0' };
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PLACEHOLDERS = ['{month}', '{year}', '{date}', '{client}'];
const PRIORITIES: Priority[] = ['Low', 'Normal', 'High', 'Urgent'];

const errMsg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');

function hourLabel(h: number) {
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${h % 12 === 0 ? 12 : h % 12}:00 ${ampm}`;
}
function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd']; const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function scheduleText(r: Pick<Rule, 'frequency' | 'day' | 'hour'>) {
  return r.frequency === 'weekly'
    ? `Every ${DAYS[r.day] ?? 'week'} at ${hourLabel(r.hour)} IST`
    : `Monthly on day ${r.day} (${ordinal(r.day)}) at ${hourLabel(r.hour)} IST`;
}
const fmtIst = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) + ' IST';

/* ---------------- Template editor ---------------- */
interface DraftItem { title: string; brief: string; design_type_id: number; priority: Priority; tags: string; estimate: string }
const blankItem = (dt: number): DraftItem => ({ title: '', brief: '', design_type_id: dt, priority: 'Normal', tags: '', estimate: '' });

const TemplateEditor: React.FC<{
  template: Template | null; designTypes: DesignType[]; onSaved: () => void; onCancel: () => void;
}> = ({ template, designTypes, onSaved, onCancel }) => {
  const defDt = designTypes[0]?.id ?? 0;
  const [name, setName] = useState(template?.name ?? '');
  const [desc, setDesc] = useState(template?.description ?? '');
  const [items, setItems] = useState<DraftItem[]>(() =>
    template
      ? template.items.map(i => ({ title: i.title, brief: i.brief, design_type_id: i.design_type_id, priority: i.priority, tags: i.tags.join(', '), estimate: i.estimate_hours == null ? '' : String(i.estimate_hours) }))
      : [blankItem(defDt)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const titleRefs = useRef<(HTMLInputElement | null)[]>([]);
  const briefRefs = useRef<(HTMLTextAreaElement | null)[]>([]);

  const patch = (i: number, p: Partial<DraftItem>) => setItems(a => a.map((x, k) => (k === i ? { ...x, ...p } : x)));

  const insert = (i: number, field: 'title' | 'brief', ph: string) => {
    const el = field === 'title' ? titleRefs.current[i] : briefRefs.current[i];
    const cur = items[i][field];
    const s = el?.selectionStart ?? cur.length;
    const e = el?.selectionEnd ?? cur.length;
    patch(i, { [field]: cur.slice(0, s) + ph + cur.slice(e) });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(s + ph.length, s + ph.length); });
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError('');
    const n = name.trim();
    if (n.length < 1 || n.length > 80) return setError('Name must be 1 to 80 characters.');
    if (desc.length > 500) return setError('Description must be 500 characters or fewer.');
    if (items.length < 1 || items.length > 30) return setError('A template needs 1 to 30 items.');
    const out: Item[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i]; const lbl = `Item ${i + 1}`;
      const t = it.title.trim(); const b = it.brief.trim();
      if (!t || t.length > 200) return setError(`${lbl}: title must be 1 to 200 characters.`);
      if (!b || b.length > 5000) return setError(`${lbl}: brief must be 1 to 5000 characters.`);
      if (!it.design_type_id) return setError(`${lbl}: choose a design type.`);
      const tags = Array.from(new Set(it.tags.split(',').map(x => x.trim()).filter(Boolean)));
      if (tags.length > 10) return setError(`${lbl}: at most 10 tags.`);
      let est: number | null = null;
      if (it.estimate.trim() !== '') {
        est = Number(it.estimate);
        if (!Number.isFinite(est) || est < 0 || est > 200) return setError(`${lbl}: estimate must be between 0 and 200 hours.`);
      }
      out.push({ title: t, brief: b, design_type_id: it.design_type_id, priority: it.priority, tags, type_specific_fields: {}, estimate_hours: est });
    }
    setBusy(true);
    try {
      await apiJson(template ? `/api/templates/${template.id}` : '/api/templates', {
        method: template ? 'PUT' : 'POST',
        json: { name: n, description: desc.trim() || null, items: out },
      });
      onSaved();
    } catch (e) { setError(errMsg(e)); setBusy(false); }
  };

  return (
    <form className="glass-card" style={CARD} onSubmit={submit} onKeyDown={e => { if (e.key === 'Escape') onCancel(); }} aria-label={template ? 'Edit template' : 'New template'}>
      <div className="section-label">{template ? 'Edit template' : 'New template'}</div>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="tpl-name" style={FIELD_LABEL}>Template name</label>
        <input id="tpl-name" className="input-field" value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="Monthly social media pack" />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label htmlFor="tpl-desc" style={FIELD_LABEL}>Description (optional)</label>
        <textarea id="tpl-desc" className="input-field" rows={2} maxLength={500} value={desc} onChange={e => setDesc(e.target.value)} />
      </div>
      {items.map((it, i) => (
        <fieldset key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, margin: '0 0 12px', minWidth: 0 }}>
          <legend style={{ fontSize: '0.78rem', fontWeight: 700, padding: '0 6px' }}>Item {i + 1}</legend>
          <div style={{ marginBottom: 10 }}>
            <label htmlFor={`it-title-${i}`} style={FIELD_LABEL}>Title</label>
            <input id={`it-title-${i}`} ref={el => { titleRefs.current[i] = el; }} className="input-field" value={it.title} maxLength={200} onChange={e => patch(i, { title: e.target.value })} />
            <div style={{ ...ROW, marginTop: 6 }} aria-label="Insert placeholder">
              <span style={HINT}>Insert:</span>
              {PLACEHOLDERS.map(p => (
                <button key={p} type="button" className="badge-blue" style={{ cursor: 'pointer', border: 0 }} onClick={() => insert(i, 'title', p)}>{p}</button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label htmlFor={`it-brief-${i}`} style={FIELD_LABEL}>Brief</label>
            <textarea id={`it-brief-${i}`} ref={el => { briefRefs.current[i] = el; }} className="input-field" rows={3} maxLength={5000} value={it.brief} onChange={e => patch(i, { brief: e.target.value })} />
            <div style={{ ...ROW, marginTop: 6 }}>
              <span style={HINT}>Insert:</span>
              {PLACEHOLDERS.map(p => (
                <button key={p} type="button" className="badge-blue" style={{ cursor: 'pointer', border: 0 }} onClick={() => insert(i, 'brief', p)}>{p}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <div>
              <label htmlFor={`it-dt-${i}`} style={FIELD_LABEL}>Design type</label>
              <select id={`it-dt-${i}`} className="input-field" value={it.design_type_id} onChange={e => patch(i, { design_type_id: Number(e.target.value) })}>
                {!designTypes.some(d => d.id === it.design_type_id) && <option value={it.design_type_id}>Unknown design type</option>}
                {designTypes.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`it-pr-${i}`} style={FIELD_LABEL}>Priority</label>
              <select id={`it-pr-${i}`} className="input-field" value={it.priority} onChange={e => patch(i, { priority: e.target.value as Priority })}>
                {PRIORITIES.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`it-est-${i}`} style={FIELD_LABEL}>Estimate (hours)</label>
              <input id={`it-est-${i}`} className="input-field" type="number" min={0} max={200} step="any" value={it.estimate} onChange={e => patch(i, { estimate: e.target.value })} />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label htmlFor={`it-tags-${i}`} style={FIELD_LABEL}>Tags (comma-separated, max 10)</label>
            <input id={`it-tags-${i}`} className="input-field" value={it.tags} onChange={e => patch(i, { tags: e.target.value })} />
          </div>
          {items.length > 1 && (
            <button type="button" className="btn-ghost" style={{ marginTop: 10 }} onClick={() => setItems(a => a.filter((_, k) => k !== i))}>
              <Trash2 size={14} /> Remove item {i + 1}
            </button>
          )}
        </fieldset>
      ))}
      <button type="button" className="btn-ghost" disabled={items.length >= 30} onClick={() => setItems(a => [...a, blankItem(defDt)])}>
        <Plus size={14} /> Add item
      </button>
      {error && <div role="alert" style={ERR}>{error}</div>}
      <div style={{ ...ROW, marginTop: 14 }}>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save template'}</button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
};

/* ---------------- Rule editor ---------------- */
const RuleEditor: React.FC<{
  rule: Rule | null; templates: Template[]; clients: UserRow[]; staff: UserRow[]; onSaved: () => void; onCancel: () => void;
}> = ({ rule, templates, clients, staff, onSaved, onCancel }) => {
  const [name, setName] = useState(rule?.name ?? '');
  const [templateId, setTemplateId] = useState<number>(rule?.template_id ?? templates[0]?.id ?? 0);
  const [freq, setFreq] = useState<'weekly' | 'monthly'>(rule?.frequency ?? 'monthly');
  const [day, setDay] = useState<number>(rule?.day ?? 1);
  const [hour, setHour] = useState<number>(rule?.hour ?? 9);
  const [requester, setRequester] = useState<number>(rule?.requester_id ?? clients[0]?.id ?? 0);
  const [assignee, setAssignee] = useState<string>(rule?.assignee_id ? String(rule.assignee_id) : '');
  const [active, setActive] = useState(rule?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const changeFreq = (f: 'weekly' | 'monthly') => { setFreq(f); setDay(f === 'weekly' ? 0 : 1); };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError('');
    const n = name.trim();
    if (!n || n.length > 80) return setError('Name must be 1 to 80 characters.');
    if (!templateId) return setError('Choose a template.');
    if (!requester) return setError('Choose a client.');
    setBusy(true);
    try {
      await apiJson(rule ? `/api/recurring/${rule.id}` : '/api/recurring', {
        method: rule ? 'PUT' : 'POST',
        json: { name: n, template_id: templateId, frequency: freq, day, hour, requester_id: requester, assignee_id: assignee ? Number(assignee) : null, is_active: active },
      });
      onSaved();
    } catch (e) { setError(errMsg(e)); setBusy(false); }
  };

  return (
    <form className="glass-card" style={CARD} onSubmit={submit} onKeyDown={e => { if (e.key === 'Escape') onCancel(); }} aria-label={rule ? 'Edit schedule' : 'New schedule'}>
      <div className="section-label">{rule ? 'Edit schedule' : 'New schedule'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
        <div>
          <label htmlFor="rl-name" style={FIELD_LABEL}>Schedule name</label>
          <input id="rl-name" className="input-field" value={name} maxLength={80} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="rl-tpl" style={FIELD_LABEL}>Template</label>
          <select id="rl-tpl" className="input-field" value={templateId} onChange={e => setTemplateId(Number(e.target.value))}>
            {!templates.some(t => t.id === templateId) && <option value={templateId}>{rule?.template_name ?? 'Unknown template'}</option>}
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={FIELD_LABEL}>Frequency</legend>
          <label style={{ marginRight: 14, fontSize: '0.85rem' }}>
            <input type="radio" name="rl-freq" checked={freq === 'weekly'} onChange={() => changeFreq('weekly')} /> Weekly
          </label>
          <label style={{ fontSize: '0.85rem' }}>
            <input type="radio" name="rl-freq" checked={freq === 'monthly'} onChange={() => changeFreq('monthly')} /> Monthly
          </label>
        </fieldset>
        <div>
          <label htmlFor="rl-day" style={FIELD_LABEL}>{freq === 'weekly' ? 'Day of week' : 'Day of month'}</label>
          <select id="rl-day" className="input-field" value={day} onChange={e => setDay(Number(e.target.value))}>
            {freq === 'weekly'
              ? DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)
              : Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          {freq === 'monthly' && <div style={HINT}>Capped at 28 so it runs every month.</div>}
        </div>
        <div>
          <label htmlFor="rl-hour" style={FIELD_LABEL}>Time (IST)</label>
          <select id="rl-hour" className="input-field" value={hour} onChange={e => setHour(Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="rl-client" style={FIELD_LABEL}>Client (requester)</label>
          <select id="rl-client" className="input-field" value={requester} onChange={e => setRequester(Number(e.target.value))}>
            {!clients.some(c => c.id === requester) && <option value={requester}>Unknown user</option>}
            {clients.map(c => <option key={c.id} value={c.id}>{c.full_name} ({c.email})</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="rl-assignee" style={FIELD_LABEL}>Assignee (optional)</label>
          <select id="rl-assignee" className="input-field" value={assignee} onChange={e => setAssignee(e.target.value)}>
            <option value="">Unassigned</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>
      </div>
      <label style={{ display: 'block', margin: '12px 0', fontSize: '0.85rem' }}>
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active
      </label>
      {error && <div role="alert" style={ERR}>{error}</div>}
      <div style={ROW}>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save schedule'}</button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
};

/* ---------------- Page ---------------- */
type Tab = 'templates' | 'recurring';

const TemplatesPage: React.FC = () => {
  const { user } = useAuth();
  const isLead = user?.role === 'Design Lead';
  const [tab, setTab] = useState<Tab>('templates');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [designTypes, setDesignTypes] = useState<DesignType[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [editingTpl, setEditingTpl] = useState<Template | 'new' | null>(null);
  const [editingRule, setEditingRule] = useState<Rule | 'new' | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [runTpl, setRunTpl] = useState<number | null>(null);
  const [runClient, setRunClient] = useState('');
  const [runAssignee, setRunAssignee] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [t, r, d, u] = await Promise.all([
        apiJson<Template[]>('/api/templates'),
        apiJson<Rule[]>('/api/recurring'),
        apiJson<DesignType[]>('/api/design-types'),
        apiJson<UserRow[]>('/api/users'),
      ]);
      setTemplates(t ?? []); setRules(r ?? []); setDesignTypes(d ?? []); setUsers(u ?? []);
    } catch (e) { setLoadError(errMsg(e)); }
    setLoading(false);
  }, []);

  useEffect(() => { if (isLead) void load(); }, [isLead, load]);

  const clients = useMemo(() => users.filter(u => u.role === 'Requester'), [users]);
  const staff = useMemo(() => users.filter(u => u.role !== 'Requester'), [users]);
  const dtName = (id: number) => designTypes.find(d => d.id === id)?.name ?? 'Unknown design type';
  const userName = (id: number | null) => (id == null ? 'Unassigned' : users.find(u => u.id === id)?.full_name ?? 'Unknown user');

  if (!isLead) {
    return (
      <div className="glass-card" style={CARD}>
        <p style={{ margin: 0, color: '#64748b' }}>Templates are managed by Design Leads.</p>
      </div>
    );
  }

  const act = async (key: string, fn: () => Promise<string | void>) => {
    setBusyKey(key); setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ ok: true, text });
      await load();
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
    setBusyKey(null);
  };

  const nums = (c: Created | undefined) => (c ?? []).map(x => x.ticket_number).join(', ') || 'none';

  const tabBtn = (t: Tab, label: string) => (
    <button type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} tabIndex={tab === t ? 0 : -1}
      className={tab === t ? 'btn-primary' : 'btn-ghost'}
      onClick={() => { setTab(t); setMsg(null); setConfirmDel(null); }}
      onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { setTab(t === 'templates' ? 'recurring' : 'templates'); } }}>
      {label}
    </button>
  );

  const templatesPanel = () => {
    if (editingTpl) {
      return <TemplateEditor template={editingTpl === 'new' ? null : editingTpl} designTypes={designTypes}
        onCancel={() => setEditingTpl(null)}
        onSaved={() => { setEditingTpl(null); setMsg({ ok: true, text: 'Template saved.' }); void load(); }} />;
    }
    if (templates.length === 0) {
      return (
        <div className="glass-card" style={{ ...CARD, textAlign: 'center' }}>
          <p style={{ margin: '0 0 6px', fontWeight: 700 }}>No templates yet</p>
          <p style={{ ...HINT, marginBottom: 12 }}>e.g. Monthly social media pack — 4 posts</p>
          <button type="button" className="btn-primary" onClick={() => setEditingTpl('new')}>Create your first template</button>
        </div>
      );
    }
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        {templates.map(t => {
          const key = `t${t.id}`;
          return (
            <div key={t.id} className="glass-card" style={CARD}>
              <div style={{ ...ROW, justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontSize: '1rem', color: '#0f172a' }}>{t.name}</h3>
                <span className="badge-blue">{t.items.length} {t.items.length === 1 ? 'ticket' : 'tickets'}</span>
              </div>
              {t.description && <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: '0.85rem' }}>{t.description}</p>}
              <ul style={{ margin: '8px 0', paddingLeft: 18, fontSize: '0.83rem', color: '#0f172a' }}>
                {t.items.slice(0, 3).map((i, k) => <li key={k}>{i.title} <span style={{ color: '#64748b' }}>({dtName(i.design_type_id)})</span></li>)}
                {t.items.length > 3 && <li style={{ color: '#64748b' }}>+{t.items.length - 3} more</li>}
              </ul>
              <div style={ROW}>
                <button type="button" className="btn-primary" disabled={busyKey === key} onClick={() => { setRunTpl(runTpl === t.id ? null : t.id); setRunClient(''); setRunAssignee(''); setMsg(null); }}>
                  <Copy size={14} /> Create tickets now
                </button>
                <button type="button" className="btn-ghost" onClick={() => { setEditingTpl(t); setMsg(null); }}><Pencil size={14} /> Edit</button>
                {confirmDel === key ? (
                  <>
                    <span style={{ fontSize: '0.82rem' }}>Delete? Its schedules will be disabled.</span>
                    <button type="button" className="btn-destructive" disabled={busyKey === key}
                      onClick={() => { setConfirmDel(null); void act(key, async () => { await apiJson(`/api/templates/${t.id}`, { method: 'DELETE' }); return 'Template deleted.'; }); }}>Yes, delete</button>
                    <button type="button" className="btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
                  </>
                ) : (
                  <button type="button" className="btn-destructive" disabled={busyKey === key} onClick={() => setConfirmDel(key)}><Trash2 size={14} /> Delete</button>
                )}
              </div>
              {runTpl === t.id && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                  <div>
                    <label htmlFor={`run-c-${t.id}`} style={FIELD_LABEL}>Client (optional)</label>
                    <select id={`run-c-${t.id}`} className="input-field" value={runClient} onChange={e => setRunClient(e.target.value)}>
                      <option value="">Myself</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.full_name} ({c.email})</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`run-a-${t.id}`} style={FIELD_LABEL}>Assignee (optional)</label>
                    <select id={`run-a-${t.id}`} className="input-field" value={runAssignee} onChange={e => setRunAssignee(e.target.value)}>
                      <option value="">Unassigned</option>
                      {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                    </select>
                  </div>
                  <div style={{ alignSelf: 'end' }}>
                    <button type="button" className="btn-primary" disabled={busyKey === key}
                      onClick={() => void act(key, async () => {
                        const body: Record<string, number> = {};
                        if (runClient) body.requester_id = Number(runClient);
                        if (runAssignee) body.assignee_id = Number(runAssignee);
                        const r = await apiJson<{ created: Created }>(`/api/templates/${t.id}/instantiate`, { method: 'POST', json: body });
                        setRunTpl(null);
                        return `Created tickets: ${nums(r?.created)}`;
                      })}>{busyKey === key ? 'Creating…' : 'Create'}</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const recurringPanel = () => {
    if (editingRule) {
      return <RuleEditor rule={editingRule === 'new' ? null : editingRule} templates={templates} clients={clients} staff={staff}
        onCancel={() => setEditingRule(null)}
        onSaved={() => { setEditingRule(null); setMsg({ ok: true, text: 'Schedule saved.' }); void load(); }} />;
    }
    if (templates.length === 0) {
      return (
        <div className="glass-card" style={{ ...CARD, textAlign: 'center' }}>
          <p style={{ margin: '0 0 10px', color: '#64748b' }}>You need a template before you can schedule one.</p>
          <button type="button" className="btn-primary" onClick={() => setTab('templates')}>Go to Templates</button>
        </div>
      );
    }
    if (rules.length === 0) {
      return (
        <div className="glass-card" style={{ ...CARD, textAlign: 'center' }}>
          <p style={{ margin: '0 0 10px', color: '#64748b' }}>No recurring schedules yet.</p>
          <button type="button" className="btn-primary" onClick={() => setEditingRule('new')}>Create a schedule</button>
        </div>
      );
    }
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        {rules.map(r => {
          const key = `r${r.id}`;
          return (
            <div key={r.id} className="glass-card" style={CARD}>
              <div style={{ ...ROW, justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontSize: '1rem', color: '#0f172a' }}>{r.name}</h3>
                <span className={r.is_active ? 'badge-green' : 'badge-red'}>{r.is_active ? 'Active' : 'Paused'}</span>
              </div>
              <div style={{ fontSize: '0.83rem', color: '#64748b', margin: '6px 0 10px', lineHeight: 1.7 }}>
                <div><CalendarClock size={13} style={{ verticalAlign: -2 }} /> {scheduleText(r)}</div>
                <div>Template: <strong style={{ color: '#0f172a' }}>{r.template_name}</strong> · Client: {userName(r.requester_id)} · Assignee: {userName(r.assignee_id)}</div>
                <div>Next run: {fmtIst(r.next_run_at)} · Last run: {r.last_run_at ? fmtIst(r.last_run_at) : 'Never'}</div>
              </div>
              <div style={ROW}>
                <button type="button" className="btn-ghost" disabled={busyKey === key}
                  onClick={() => void act(key, async () => {
                    await apiJson(`/api/recurring/${r.id}`, { method: 'PUT', json: {
                      name: r.name, template_id: r.template_id, frequency: r.frequency, day: r.day, hour: r.hour,
                      requester_id: r.requester_id, assignee_id: r.assignee_id, is_active: !r.is_active } });
                    return r.is_active ? 'Schedule paused.' : 'Schedule activated.';
                  })}>{r.is_active ? 'Pause' : 'Activate'}</button>
                <button type="button" className="btn-ghost" disabled={busyKey === key}
                  onClick={() => void act(key, async () => {
                    const x = await apiJson<{ created: Created }>(`/api/recurring/${r.id}/run-now`, { method: 'POST' });
                    return `Created tickets: ${nums(x?.created)}`;
                  })}><Play size={14} /> Run now</button>
                <button type="button" className="btn-ghost" onClick={() => { setEditingRule(r); setMsg(null); }}><Pencil size={14} /> Edit</button>
                {confirmDel === key ? (
                  <>
                    <span style={{ fontSize: '0.82rem' }}>Delete?</span>
                    <button type="button" className="btn-destructive" disabled={busyKey === key}
                      onClick={() => { setConfirmDel(null); void act(key, async () => { await apiJson(`/api/recurring/${r.id}`, { method: 'DELETE' }); return 'Schedule deleted.'; }); }}>Yes, delete</button>
                    <button type="button" className="btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
                  </>
                ) : (
                  <button type="button" className="btn-destructive" disabled={busyKey === key} onClick={() => setConfirmDel(key)}><Trash2 size={14} /> Delete</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const editing = tab === 'templates' ? editingTpl : editingRule;

  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 900 }}>
      <div style={{ ...ROW, justifyContent: 'space-between' }}>
        <div role="tablist" aria-label="Templates and schedules" style={ROW}>
          {tabBtn('templates', 'Templates')}
          {tabBtn('recurring', 'Recurring schedules')}
        </div>
        {!editing && !loading && !loadError && (
          tab === 'templates' ? (
            <button type="button" className="btn-primary" onClick={() => { setEditingTpl('new'); setMsg(null); }}><Plus size={14} /> New template</button>
          ) : templates.length > 0 ? (
            <button type="button" className="btn-primary" onClick={() => { setEditingRule('new'); setMsg(null); }}><Plus size={14} /> New schedule</button>
          ) : null
        )}
      </div>
      {msg && <div role={msg.ok ? 'status' : 'alert'} style={msg.ok ? OK : ERR}>{msg.text}</div>}
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {loading ? (
          <div className="glass-card" style={CARD} role="status">Loading…</div>
        ) : loadError ? (
          <div className="glass-card" style={CARD}>
            <div role="alert" style={ERR}>{loadError}</div>
            <button type="button" className="btn-primary" onClick={() => { setLoading(true); void load(); }}><RefreshCw size={14} /> Retry</button>
          </div>
        ) : tab === 'templates' ? templatesPanel() : recurringPanel()}
      </div>
    </div>
  );
};

export default TemplatesPage;
