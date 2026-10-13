import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, ExternalLink, Pencil, Plus, Trash2, X } from 'lucide-react';
import { apiJson, authFetch, fetchBlobUrl } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useTickets } from '../contexts/TicketsContext';
import { useReveal } from '../hooks/useReveal';
import { ToastContainer, useToast } from '../components/Toast';

interface Campaign { id: number; name: string; description: string | null; color: string; start_date: string; end_date: string; post_count: number }
interface Post { id: number; campaign_id: number | null; platform: string; title: string; post_url: string | null; post_date: string; status: 'Planned' | 'Posted'; notes: string | null; has_image: boolean }

const PLATFORMS = ['Instagram', 'Facebook', 'LinkedIn', 'WhatsApp', 'X', 'YouTube', 'Other'];
const COLORS = ['#0056B3', '#EF4444', '#059669', '#d97706', '#8B5CF6', '#0891b2'];
const DAY = 86_400_000;
const PX_PER_DAY = 16;
const LABEL_W = 170;

const dayNum = (iso: string) => Math.floor(new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime() / DAY);
const fmt = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const today = () => new Date().toISOString().slice(0, 10);

type CampaignDraft = { id?: number; name: string; description: string; color: string; start_date: string; end_date: string };
type PostDraft = { id?: number; campaign_id: string; platform: string; title: string; post_url: string; post_date: string; status: 'Planned' | 'Posted'; notes: string; hasImage: boolean; file: File | null; removeImage: boolean };

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-soft)' }}>{label}
    <div style={{ marginTop: 4 }}>{children}</div>
  </label>
);

function PostImage({ id, title }: { id: number; title: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let url = '';
    let live = true;
    fetchBlobUrl(`/api/social-posts/${id}/image`).then(u => { url = u; if (live) setSrc(u); else URL.revokeObjectURL(u); }).catch(() => undefined);
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [id]);
  return src ? <img src={src} alt={`Image for ${title}`} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} /> : null;
}

function Timeline({ campaigns, posts, deadlines }: { campaigns: Campaign[]; posts: Post[]; deadlines: { id: string; label: string; date: string }[] }) {
  const days = [...campaigns.flatMap(c => [c.start_date, c.end_date]), ...posts.map(p => p.post_date), ...deadlines.map(d => d.date), today()].map(dayNum);
  const first = Math.min(...days) - 3;
  const last = Math.max(...days) + 3;
  const span = last - first + 1;
  const pct = (d: number) => `${(d / span) * 100}%`;   // positions are percentages, so a short range stretches to the card
  const x = (iso: string) => pct(dayNum(iso) - first);

  const months: { label: string; left: string }[] = [];
  for (let d = first; d <= last; d++) {
    const dt = new Date(d * DAY);
    if (dt.getUTCDate() === 1 || d === first) months.push({ label: dt.toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }), left: pct(d - first) });
  }

  const rows: { key: string; label: string; color: string; bar?: Campaign; dots: { id: string; date: string; title: string; planned: boolean }[] }[] = [
    ...campaigns.map(c => ({
      key: `c${c.id}`, label: c.name, color: c.color, bar: c,
      dots: posts.filter(p => p.campaign_id === c.id).map(p => ({ id: `p${p.id}`, date: p.post_date, title: `${p.platform}: ${p.title}`, planned: p.status === 'Planned' })),
    })),
  ];
  const loose = posts.filter(p => p.campaign_id === null);
  if (loose.length) rows.push({ key: 'loose', label: 'Not in a campaign', color: '#64748b', dots: loose.map(p => ({ id: `p${p.id}`, date: p.post_date, title: `${p.platform}: ${p.title}`, planned: p.status === 'Planned' })) });
  if (deadlines.length) rows.push({ key: 'design', label: 'Design requests (due)', color: '#003F8A', dots: deadlines.map(d => ({ id: d.id, date: d.date, title: d.label, planned: false })) });

  return (
    <div role="region" aria-label="Campaign timeline" tabIndex={0} style={{ overflowX: 'auto', background: 'white', border: '1px solid rgba(226,232,240,0.9)', borderRadius: 12 }}>
      <div style={{ minWidth: span * PX_PER_DAY + LABEL_W, position: 'relative' }}>
        <div style={{ display: 'flex', height: 30, borderBottom: '1px solid #E2E8F0', position: 'relative' }}>
          <div style={{ width: LABEL_W, flexShrink: 0, position: 'sticky', left: 0, background: 'white', zIndex: 2 }} />
          <div style={{ position: 'relative', flex: 1 }}>
            {months.map(m => <span key={m.left} style={{ position: 'absolute', left: m.left, marginLeft: 4, top: 8, fontSize: '0.68rem', fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap' }}>{m.label}</span>)}
          </div>
        </div>
        {rows.map(r => (
          <div key={r.key} style={{ display: 'flex', height: 46, borderBottom: '1px solid #F1F5F9', alignItems: 'center' }}>
            <div style={{ width: LABEL_W, flexShrink: 0, position: 'sticky', left: 0, background: 'white', zIndex: 2, padding: '0 12px', fontSize: '0.8rem', fontWeight: 700, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>{r.label}</div>
            <div style={{ position: 'relative', flex: 1, height: '100%' }}>
              {r.bar && (
                <div title={`${r.bar.name}: ${fmt(r.bar.start_date)} to ${fmt(r.bar.end_date)}`}
                  style={{ position: 'absolute', left: x(r.bar.start_date), width: pct(dayNum(r.bar.end_date) - dayNum(r.bar.start_date) + 1), top: 15, height: 16, borderRadius: 99, background: `${r.color}30`, border: `1.5px solid ${r.color}` }} />
              )}
              {r.dots.map(d => (
                <span key={d.id} title={`${fmt(d.date)} · ${d.title}${d.planned ? ' (planned)' : ''}`} role="img" aria-label={`${fmt(d.date)}: ${d.title}`}
                  style={{ position: 'absolute', left: x(d.date), marginLeft: -6, top: 17, width: 12, height: 12, borderRadius: 99, boxSizing: 'border-box',
                           background: d.planned ? 'white' : r.color, border: `2px solid ${r.color}`, boxShadow: '0 0 0 2px white' }} />
              ))}
            </div>
          </div>
        ))}
        <div aria-hidden="true" style={{ position: 'absolute', left: LABEL_W, right: 0, top: 30, bottom: 0, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: x(today()), top: 0, bottom: 0, width: 2, background: '#ef4444', opacity: 0.55 }} />
        </div>
      </div>
      <p style={{ fontSize: '0.7rem', color: '#64748b', padding: '8px 12px' }}>
        Bars are campaign dates. Filled dots are posts you made, hollow dots are planned. The red line is today.
      </p>
    </div>
  );
}

const CampaignsPage = () => {
  const { user } = useAuth();
  const { tickets } = useTickets();
  const isClient = user?.role === 'Client';
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'timeline' | 'posts'>('timeline');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [cDraft, setCDraft] = useState<CampaignDraft | null>(null);
  const [pDraft, setPDraft] = useState<PostDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const { toasts, addToast, removeToast } = useToast();
  const campaignListRef = useReveal<HTMLUListElement>(`${tab}:${campaigns.length}:${loading}`);
  const postListRef = useReveal<HTMLUListElement>(`${tab}:${posts.length}:${campaignFilter}:${platformFilter}:${loading}`);

  const load = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([apiJson<Campaign[]>('/api/campaigns'), apiJson<Post[]>('/api/social-posts')]);
      setCampaigns(c); setPosts(p); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const deadlines = useMemo(() => tickets.filter(t => t.due_at).map(t => ({ id: `t${t.id}`, label: `${t.number} ${t.title}`, date: t.due_at })), [tickets]);
  const nameOf = (id: number | null) => campaigns.find(c => c.id === id);
  const shownPosts = posts.filter(p => (!campaignFilter || String(p.campaign_id ?? 'none') === campaignFilter) && (!platformFilter || p.platform === platformFilter));

  const run = async (fn: () => Promise<unknown>, close: () => void, done?: string) => {
    setSaving(true); setError('');
    try { await fn(); close(); await load(); if (done) addToast(done); }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong'); }
    finally { setSaving(false); }
  };

  const saveCampaign = (e: FormEvent) => {
    e.preventDefault();
    if (!cDraft) return;
    const { id, ...json } = cDraft;
    void run(() => apiJson(id ? `/api/campaigns/${id}` : '/api/campaigns', { method: id ? 'PUT' : 'POST', json: { ...json, description: json.description || null } }), () => setCDraft(null), id ? 'Campaign saved' : 'Campaign added');
  };
  const savePost = (e: FormEvent) => {
    e.preventDefault();
    if (!pDraft) return;
    const { id, hasImage, file, removeImage, ...d } = pDraft;
    void run(async () => {
      const saved = await apiJson<Post>(id ? `/api/social-posts/${id}` : '/api/social-posts', { method: id ? 'PUT' : 'POST',
        json: { ...d, campaign_id: d.campaign_id ? Number(d.campaign_id) : null, post_url: d.post_url.trim() || null, notes: d.notes || null } });
      if (file) {
        const body = new FormData();
        body.append('file', file);
        const res = await authFetch(`/api/social-posts/${saved.id}/image`, { method: 'POST', body });
        if (!res.ok) throw new Error(`The post was saved, but the image was not: ${((await res.json().catch(() => null)) as { detail?: string } | null)?.detail ?? 'upload failed'}`);
      } else if (removeImage && hasImage) {
        await apiJson(`/api/social-posts/${saved.id}/image`, { method: 'DELETE' });
      }
    }, () => setPDraft(null), id ? 'Post saved' : 'Post logged');
  };
  const remove = (path: string, what: string) => {
    if (!window.confirm(`Delete ${what}?`)) return;
    setRemoving(path);                                   // collapse the row first, then delete it
    window.setTimeout(() => { void run(() => apiJson(path, { method: 'DELETE' }), () => undefined, 'Deleted').finally(() => setRemoving(null)); }, 320);
  };

  const newCampaign = () => setCDraft({ name: '', description: '', color: COLORS[campaigns.length % COLORS.length], start_date: today(), end_date: today() });
  const newPost = (campaignId = '') => setPDraft({ campaign_id: campaignId, platform: 'Instagram', title: '', post_url: '', post_date: today(), status: 'Posted', notes: '', hasImage: false, file: null, removeImage: false });

  const box = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, padding: '1rem', background: 'white', border: '1px solid rgba(226,232,240,0.9)', borderRadius: 12, marginBottom: 14 } as const;

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '0.5rem 0 3rem' }}>
      {isClient && <Link to="/client-portal" className="btn-ghost" style={{ gap: 6, textDecoration: 'none', marginBottom: 10 }}><ArrowLeft size={14} aria-hidden="true" /> My requests</Link>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 'clamp(1.3rem,3vw,1.7rem)', fontFamily: 'var(--font-body)', fontWeight: 800, color: '#0F172A' }}>Campaigns and posts</h1>
          <p style={{ fontSize: '0.85rem', color: '#64748B', marginTop: 4 }}>
            {isClient ? 'Keep a record of the posts you publish yourself. They never go to the design team.' : 'What clients have recorded (read only).'}
          </p>
        </div>
        {isClient && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn-ghost" onClick={newCampaign} style={{ gap: 6 }}><Plus size={14} aria-hidden="true" /> Campaign</button>
            <button type="button" className="btn-primary" onClick={() => newPost()} style={{ gap: 6 }}><Plus size={14} aria-hidden="true" /> Log a post</button>
          </div>
        )}
      </div>

      {error && <p role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem', marginBottom: 10 }}>{error}</p>}

      {cDraft && (
        <form onSubmit={saveCampaign} aria-label="Campaign" style={box}>
          <Field label="Campaign name"><input className="input-field" required maxLength={80} autoFocus value={cDraft.name} onChange={e => setCDraft({ ...cDraft, name: e.target.value })} style={{ width: '100%' }} /></Field>
          <Field label="Starts"><input className="input-field" type="date" required value={cDraft.start_date} max={cDraft.end_date} onChange={e => setCDraft({ ...cDraft, start_date: e.target.value })} style={{ width: '100%' }} /></Field>
          <Field label="Ends"><input className="input-field" type="date" required value={cDraft.end_date} min={cDraft.start_date} onChange={e => setCDraft({ ...cDraft, end_date: e.target.value })} style={{ width: '100%' }} /></Field>
          <Field label="Colour">
            <div style={{ display: 'flex', gap: 6 }}>
              {COLORS.map(c => <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={cDraft.color === c} onClick={() => setCDraft({ ...cDraft, color: c })}
                style={{ width: 24, height: 24, borderRadius: 99, background: c, border: cDraft.color === c ? '3px solid #0F172A' : '2px solid white', boxShadow: '0 0 0 1px #cbd5e1', cursor: 'pointer' }} />)}
            </div>
          </Field>
          <div style={{ gridColumn: '1 / -1' }}><Field label="Notes (optional)"><textarea className="input-field" maxLength={1000} rows={2} value={cDraft.description} onChange={e => setCDraft({ ...cDraft, description: e.target.value })} style={{ width: '100%' }} /></Field></div>
          <div style={{ display: 'flex', gap: 8, gridColumn: '1 / -1' }}>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? <span className="app-spinner app-spinner--sm" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}{cDraft.id ? 'Save changes' : 'Add campaign'}</button>
            <button type="button" className="btn-ghost" onClick={() => setCDraft(null)}>Cancel</button>
          </div>
        </form>
      )}

      {pDraft && (
        <form onSubmit={savePost} aria-label="Social post" style={box}>
          <div style={{ gridColumn: '1 / -1' }}><Field label="What did you post?"><input className="input-field" required maxLength={200} autoFocus placeholder="e.g. Festival offer reel" value={pDraft.title} onChange={e => setPDraft({ ...pDraft, title: e.target.value })} style={{ width: '100%' }} /></Field></div>
          <Field label="Platform"><select className="input-field" value={pDraft.platform} onChange={e => setPDraft({ ...pDraft, platform: e.target.value })} style={{ width: '100%' }}>{PLATFORMS.map(p => <option key={p}>{p}</option>)}</select></Field>
          <Field label="Date"><input className="input-field" type="date" required value={pDraft.post_date} onChange={e => setPDraft({ ...pDraft, post_date: e.target.value })} style={{ width: '100%' }} /></Field>
          <Field label="Status"><select className="input-field" value={pDraft.status} onChange={e => setPDraft({ ...pDraft, status: e.target.value as Post['status'] })} style={{ width: '100%' }}><option value="Posted">Posted</option><option value="Planned">Planned</option></select></Field>
          <Field label="Campaign">
            <select className="input-field" value={pDraft.campaign_id} onChange={e => setPDraft({ ...pDraft, campaign_id: e.target.value })} style={{ width: '100%' }}>
              <option value="">None</option>{campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <div style={{ gridColumn: '1 / -1' }}><Field label="Link to the post (optional)"><input className="input-field" type="url" maxLength={500} placeholder="https://" value={pDraft.post_url} onChange={e => setPDraft({ ...pDraft, post_url: e.target.value })} style={{ width: '100%' }} /></Field></div>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Upload the post (optional image)">
              <input className="input-field" type="file" accept="image/png,image/jpeg,image/gif,image/webp" style={{ width: '100%' }}
                onChange={e => setPDraft({ ...pDraft, file: e.target.files?.[0] ?? null, removeImage: false })} />
            </Field>
            {pDraft.hasImage && !pDraft.file && (
              <label style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', gap: 6, marginTop: 6 }}>
                <input type="checkbox" checked={pDraft.removeImage} onChange={e => setPDraft({ ...pDraft, removeImage: e.target.checked })} /> Remove the current image
              </label>
            )}
          </div>
          <div style={{ gridColumn: '1 / -1' }}><Field label="Notes (optional)"><textarea className="input-field" maxLength={1000} rows={2} value={pDraft.notes} onChange={e => setPDraft({ ...pDraft, notes: e.target.value })} style={{ width: '100%' }} /></Field></div>
          <div style={{ display: 'flex', gap: 8, gridColumn: '1 / -1' }}>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? <span className="app-spinner app-spinner--sm" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}{pDraft.id ? 'Save changes' : 'Save post'}</button>
            <button type="button" className="btn-ghost" onClick={() => setPDraft(null)}>Cancel</button>
          </div>
        </form>
      )}

      <div role="group" aria-label="View" style={{ display: 'inline-flex', border: '1px solid rgba(226,232,240,0.9)', borderRadius: 10, background: 'white', marginBottom: 12 }}>
        {([['timeline', 'Timeline'], ['posts', `Posts (${posts.length})`]] as const).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}
            style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem', fontWeight: 700, border: 'none', cursor: 'pointer', background: tab === k ? '#003F8A' : 'transparent', color: tab === k ? 'white' : '#64748b', borderRadius: 9 }}>{label}</button>
        ))}
      </div>

      {loading && <p role="status" style={{ color: '#94a3b8' }}>Loading…</p>}

      {!loading && tab === 'timeline' && (
        campaigns.length === 0 && posts.length === 0
          ? <Empty text={isClient ? 'Add a campaign to plan it on a timeline, or log a post you have made.' : 'No campaigns yet.'} />
          : <>
              <Timeline campaigns={campaigns} posts={posts} deadlines={isClient ? deadlines : []} />
              {campaigns.length > 0 && (
                <ul ref={campaignListRef} style={{ listStyle: 'none', padding: 0, margin: '14px 0 0', display: 'grid', gap: 8 }}>
                  {campaigns.map(c => (
                    <li key={c.id} className={`glass-card collapsible${removing === `/api/campaigns/${c.id}` ? ' removing' : ''}`} style={{ padding: '0.7rem 1rem', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderLeft: `4px solid ${c.color}` }}>
                      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                        <p style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0F172A' }}>{c.name}</p>
                        <p style={{ fontSize: '0.75rem', color: '#64748b' }}>{fmt(c.start_date)} to {fmt(c.end_date)} · {c.post_count} post{c.post_count === 1 ? '' : 's'}{c.description ? ` · ${c.description}` : ''}</p>
                      </div>
                      {isClient && <>
                        <button type="button" className="chip" onClick={() => newPost(String(c.id))}>Log a post</button>
                        <button type="button" className="btn-ghost" aria-label={`Edit ${c.name}`} onClick={() => setCDraft({ id: c.id, name: c.name, description: c.description ?? '', color: c.color, start_date: c.start_date, end_date: c.end_date })}><Pencil size={13} aria-hidden="true" /></button>
                        <button type="button" className="btn-ghost" aria-label={`Delete ${c.name}`} onClick={() => remove(`/api/campaigns/${c.id}`, `the campaign "${c.name}" (its posts stay in your record)`)}><Trash2 size={13} aria-hidden="true" /></button>
                      </>}
                    </li>
                  ))}
                </ul>
              )}
            </>
      )}

      {!loading && tab === 'posts' && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <select className="input-field" aria-label="Filter by campaign" value={campaignFilter} onChange={e => setCampaignFilter(e.target.value)}>
              <option value="">All campaigns</option><option value="none">Not in a campaign</option>{campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="input-field" aria-label="Filter by platform" value={platformFilter} onChange={e => setPlatformFilter(e.target.value)}>
              <option value="">All platforms</option>{PLATFORMS.map(p => <option key={p}>{p}</option>)}
            </select>
            {(campaignFilter || platformFilter) && <button type="button" className="chip" onClick={() => { setCampaignFilter(''); setPlatformFilter(''); }}><X size={12} aria-hidden="true" /> Clear</button>}
          </div>
          {shownPosts.length === 0
            ? <Empty text={posts.length === 0 ? (isClient ? 'No posts recorded yet. Use "Log a post" after you publish something.' : 'No posts recorded yet.') : 'No posts match these filters.'} />
            : <ul ref={postListRef} style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                {shownPosts.map(p => {
                  const c = nameOf(p.campaign_id);
                  return (
                    <li key={p.id} className={`glass-card collapsible${removing === `/api/social-posts/${p.id}` ? ' removing' : ''}`} style={{ padding: '0.7rem 1rem', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderLeft: `4px solid ${c?.color ?? '#cbd5e1'}` }}>
                      {p.has_image && <PostImage id={p.id} title={p.title} />}
                      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                        <p style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0F172A', overflowWrap: 'anywhere' }}>{p.title}</p>
                        <p style={{ fontSize: '0.75rem', color: '#64748b' }}>{p.platform} · {fmt(p.post_date)} · {p.status}{c ? ` · ${c.name}` : ''}{p.notes ? ` · ${p.notes}` : ''}</p>
                      </div>
                      {p.post_url && <a href={p.post_url} target="_blank" rel="noopener noreferrer" className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>View post <ExternalLink size={11} aria-hidden="true" /></a>}
                      {isClient && <>
                        <button type="button" className="btn-ghost" aria-label={`Edit ${p.title}`} onClick={() => setPDraft({ id: p.id, campaign_id: p.campaign_id ? String(p.campaign_id) : '', platform: p.platform, title: p.title, post_url: p.post_url ?? '', post_date: p.post_date, status: p.status, notes: p.notes ?? '', hasImage: p.has_image, file: null, removeImage: false })}><Pencil size={13} aria-hidden="true" /></button>
                        <button type="button" className="btn-ghost" aria-label={`Delete ${p.title}`} onClick={() => remove(`/api/social-posts/${p.id}`, `"${p.title}"`)}><Trash2 size={13} aria-hidden="true" /></button>
                      </>}
                    </li>
                  );
                })}
              </ul>}
        </>
      )}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
};

const Empty = ({ text }: { text: string }) => (
  <div className="glass-card" style={{ textAlign: 'center', padding: '2.5rem 1.5rem', border: '2px dashed rgba(226,232,240,0.85)', color: '#64748B', fontSize: '0.85rem' }}>{text}</div>
);

export default CampaignsPage;
