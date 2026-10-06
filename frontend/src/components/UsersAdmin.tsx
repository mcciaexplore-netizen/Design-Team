import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Pencil, UserPlus, UserX, UserCheck, X } from 'lucide-react';
import { apiJson } from '../api';
import { useAuth } from '../contexts/AuthContext';

type Role = 'Design Lead' | 'Designer' | 'Client';
interface AdminUser {
  id: number; email: string; full_name: string; role: Role; client_org: string | null;
  is_active: boolean; must_change_password: boolean; created_at: string | null;
}
interface Issued { user: AdminUser; temporary_password: string }

const ROLES: Role[] = ['Design Lead', 'Designer', 'Client'];
const LABEL: React.CSSProperties = { fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-strong)', display: 'block', marginBottom: 5 };

function TempPasswordCard({ issued, title, onClose }: { issued: Issued; title: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(issued.temporary_password); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* clipboard blocked: the password is selectable on screen */ }
  };
  return (
    <div role="status" className="glass-card" style={{ padding: '1.1rem 1.25rem', borderColor: 'rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--text-strong)' }}>{title}</p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-soft)', marginTop: 4, lineHeight: 1.5 }}>
            Share this with <strong>{issued.user.full_name}</strong> ({issued.user.email}) privately. It is shown <strong>only once</strong>, and they must choose a new password at first sign-in.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <code style={{ background: 'white', border: '1px solid var(--border-soft)', borderRadius: 8, padding: '0.4rem 0.7rem', fontSize: '1rem', letterSpacing: '0.04em', userSelect: 'all' }}>{issued.temporary_password}</code>
            <button type="button" className="btn-ghost" onClick={() => void copy()}>{copied ? <><Check size={14} aria-hidden="true" /> Copied</> : <><Copy size={14} aria-hidden="true" /> Copy</>}</button>
          </div>
        </div>
        <button type="button" aria-label="Dismiss" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-hint)', padding: 4 }}><X size={16} /></button>
      </div>
    </div>
  );
}

function AddUserForm({ onCreated, onCancel }: { onCreated: (i: Issued) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('Designer');
  const [org, setOrg] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      onCreated(await apiJson<Issued>('/api/admin/users', { method: 'POST', json: { full_name: name, email, role, client_org: role === 'Client' ? org : null } }));
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create the user.'); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={e => void submit(e)} className="glass-card" style={{ padding: '1.25rem', display: 'grid', gap: '0.9rem', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
      <div><label htmlFor="nu-name" style={LABEL}>Full name</label><input id="nu-name" className="input-field" required minLength={2} maxLength={80} value={name} onChange={e => setName(e.target.value)} style={{ width: '100%' }} autoFocus /></div>
      <div><label htmlFor="nu-email" style={LABEL}>Email</label><input id="nu-email" className="input-field" type="email" required value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%' }} /></div>
      <div>
        <label htmlFor="nu-role" style={LABEL}>Role</label>
        <select id="nu-role" className="input-field" value={role} onChange={e => setRole(e.target.value as Role)} style={{ width: '100%' }}>
          {ROLES.map(r => <option key={r}>{r}</option>)}
        </select>
      </div>
      {role === 'Client' && (
        <div><label htmlFor="nu-org" style={LABEL}>Company</label><input id="nu-org" className="input-field" required maxLength={80} value={org} onChange={e => setOrg(e.target.value)} style={{ width: '100%' }} /></div>
      )}
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" className="btn-primary" disabled={busy}><UserPlus size={14} aria-hidden="true" /> {busy ? 'Creating…' : 'Create & generate password'}</button>
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        {error && <span role="alert" style={{ color: 'var(--danger-text)', fontSize: '0.8rem', fontWeight: 600 }}>{error}</span>}
      </div>
    </form>
  );
}

function EditRow({ u, onSaved, onCancel }: { u: AdminUser; onSaved: (u: AdminUser) => void; onCancel: () => void }) {
  const [name, setName] = useState(u.full_name);
  const [role, setRole] = useState<Role>(u.role);
  const [org, setOrg] = useState(u.client_org ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      onSaved(await apiJson<AdminUser>(`/api/admin/users/${u.id}`, { method: 'PATCH', json: { full_name: name, role, client_org: role === 'Client' ? org : undefined } }));
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={e => void save(e)} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', width: '100%' }}>
      <div style={{ flex: '1 1 160px' }}><label htmlFor={`en-${u.id}`} style={LABEL}>Name</label><input id={`en-${u.id}`} className="input-field" required minLength={2} maxLength={80} value={name} onChange={e => setName(e.target.value)} style={{ width: '100%' }} /></div>
      <div style={{ flex: '0 1 150px' }}>
        <label htmlFor={`er-${u.id}`} style={LABEL}>Role</label>
        <select id={`er-${u.id}`} className="input-field" value={role} onChange={e => setRole(e.target.value as Role)} style={{ width: '100%' }}>{ROLES.map(r => <option key={r}>{r}</option>)}</select>
      </div>
      {role === 'Client' && <div style={{ flex: '1 1 140px' }}><label htmlFor={`eo-${u.id}`} style={LABEL}>Company</label><input id={`eo-${u.id}`} className="input-field" required maxLength={80} value={org} onChange={e => setOrg(e.target.value)} style={{ width: '100%' }} /></div>}
      <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
      {error && <span role="alert" style={{ color: 'var(--danger-text)', fontSize: '0.8rem', fontWeight: 600, flexBasis: '100%' }}>{error}</span>}
    </form>
  );
}

export default function UsersAdmin() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [issued, setIssued] = useState<{ data: Issued; title: string } | null>(null);
  const [rowError, setRowError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try { setUsers(await apiJson<AdminUser[]>('/api/admin/users')); setLoadError(''); }
    catch (e) { setLoadError(e instanceof Error ? e.message : 'Could not load users.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const replace = (u: AdminUser) => setUsers(list => list?.map(x => (x.id === u.id ? u : x)) ?? list);

  const toggleActive = async (u: AdminUser) => {
    if (u.is_active && !window.confirm(`Deactivate ${u.full_name}? They will be signed out and unable to sign in until you reactivate them.`)) return;
    setBusyId(u.id); setRowError('');
    try { replace(await apiJson<AdminUser>(`/api/admin/users/${u.id}`, { method: 'PATCH', json: { is_active: !u.is_active } })); }
    catch (e) { setRowError(e instanceof Error ? e.message : 'Could not update the user.'); }
    finally { setBusyId(null); }
  };

  const resetPassword = async (u: AdminUser) => {
    if (!window.confirm(`Issue a new temporary password for ${u.full_name}? Their current password stops working and they are signed out everywhere.`)) return;
    setBusyId(u.id); setRowError('');
    try {
      const r = await apiJson<Issued>(`/api/admin/users/${u.id}/reset-password`, { method: 'POST' });
      replace(r.user); setIssued({ data: r, title: 'Temporary password issued' });
    } catch (e) { setRowError(e instanceof Error ? e.message : 'Could not reset the password.'); }
    finally { setBusyId(null); }
  };

  if (loadError) return <p role="alert" style={{ color: 'var(--danger-text)', fontSize: '0.85rem' }}>{loadError} <button type="button" className="chip" onClick={() => void load()}>Retry</button></p>;
  if (!users) return <p role="status" style={{ color: 'var(--text-hint)', fontSize: '0.85rem' }}>Loading…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-soft)', flex: 1, minWidth: 220 }}>Add staff and clients, change roles, deactivate leavers and issue temporary passwords.</p>
        {!adding && <button type="button" className="btn-primary" onClick={() => setAdding(true)}><UserPlus size={14} aria-hidden="true" /> Add user</button>}
      </div>

      {issued && <TempPasswordCard issued={issued.data} title={issued.title} onClose={() => setIssued(null)} />}
      {adding && <AddUserForm onCancel={() => setAdding(false)} onCreated={i => { setAdding(false); setIssued({ data: i, title: 'Account created' }); void load(); }} />}
      {rowError && <p role="alert" style={{ color: 'var(--danger-text)', fontSize: '0.82rem', fontWeight: 600 }}>{rowError}</p>}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }} aria-label="Users">
        {users.map(u => {
          const self = String(u.id) === me?.id;
          return (
            <li key={u.id} className="glass-card" style={{ padding: '0.85rem 1rem', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', opacity: u.is_active ? 1 : 0.65 }}>
              {editing === u.id ? (
                <EditRow u={u} onCancel={() => setEditing(null)} onSaved={x => { replace(x); setEditing(null); }} />
              ) : (
                <>
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <p style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-strong)' }}>{u.full_name}{self && <span style={{ color: 'var(--text-hint)', fontWeight: 600 }}> (you)</span>}</p>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-soft)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}{u.client_org ? ` · ${u.client_org}` : ''}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className="badge-green" style={{ background: u.role === 'Design Lead' ? 'rgba(24,24,27,0.08)' : undefined, color: u.role === 'Design Lead' ? 'var(--text-strong)' : undefined }}>{u.role}</span>
                    {!u.is_active && <span className="badge-red">Deactivated</span>}
                    {u.must_change_password && u.is_active && <span className="badge-red" title="Has not yet replaced the temporary password">Temp password</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" className="btn-ghost" onClick={() => setEditing(u.id)} aria-label={`Edit ${u.full_name}`}><Pencil size={13} aria-hidden="true" /> Edit</button>
                    {!self && <button type="button" className="btn-ghost" disabled={busyId === u.id} onClick={() => void resetPassword(u)} aria-label={`Reset password for ${u.full_name}`}><KeyRound size={13} aria-hidden="true" /> Reset password</button>}
                    {!self && (
                      <button type="button" className="btn-ghost" disabled={busyId === u.id} onClick={() => void toggleActive(u)} aria-label={`${u.is_active ? 'Deactivate' : 'Reactivate'} ${u.full_name}`}>
                        {u.is_active ? <><UserX size={13} aria-hidden="true" /> Deactivate</> : <><UserCheck size={13} aria-hidden="true" /> Reactivate</>}
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
