import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2, HardDrive, Mail, Save, Send } from 'lucide-react';
import { apiJson } from '../api';
import { useAuth } from '../contexts/AuthContext';
import ChangePasswordForm from '../components/ChangePasswordForm';
import { useReveal } from '../hooks/useReveal';
import UsersAdmin from '../components/UsersAdmin';
import DeleteAllData from '../components/DeleteAllData';

const SECTION_LABEL: React.CSSProperties = { fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748b', marginBottom: 2 };
const HINT: React.CSSProperties = { fontSize: '0.72rem', color: '#64748b', marginTop: 5, lineHeight: 1.5 };

interface IntegrationSettings {
  email_configured: boolean; email_from: string | null; email_host: string | null; file_storage: string;
  drive_connect_ready: boolean; drive_redirect_uri: string; drive_connected_as: string | null;
  drive_connected_at: string | null; drive_expires_at: string | null; drive_lapsed: boolean;
}

/* What Google's sign-in came back with (?drive=… on the way back to Settings). */
const DRIVE_RETURN: Record<string, Result> = {
  connected: { ok: true, text: 'Google Drive is connected. New uploads go to the folder "DesignDesk files" in that Drive.' },
  refused: { ok: false, text: 'Google Drive was not connected: access was not allowed on the Google page.' },
  expired: { ok: false, text: 'That sign-in took too long. Click Connect Google Drive again.' },
  failed: { ok: false, text: 'Google did not complete the sign-in. Check the redirect URI below is on the OAuth client, then try again.' },
  'no-folder': { ok: false, text: 'Signed in, but Google would not let DesignDesk make its folder. Check the Google Drive API is enabled.' },
  'not-set-up': { ok: false, text: 'Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel first.' },
  'other-account': { ok: false, text: 'That is a different Google account from the one connected, so nothing changed: files saved so far only open with the connected account. Sign in with that account, or use Switch Google account.' },
};
const SWITCH_WARNING = 'Switch to a different Google account?\n\nFiles already saved to the current Drive will stop opening in DesignDesk. New uploads go to the new account\'s Drive.';
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
interface Prefs {
  in_app_enabled: boolean;
  muted_events: string[]; available_events: Record<string, string>;
}
type Result = { ok: boolean; text: string } | null;

function Toggle({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label htmlFor={id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '2px 0' }}>
      <input id={id} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ width: 16, height: 16, marginTop: 2, accentColor: '#003F8A' }} />
      <span style={{ fontSize: '0.84rem', color: '#0f172a' }}>{label}{hint && <span style={{ display: 'block', ...HINT, marginTop: 1 }}>{hint}</span>}</span>
    </label>
  );
}

function ResultLine({ r }: { r: Result }) {
  if (!r) return null;
  const Icon = r.ok ? CheckCircle2 : AlertTriangle;
  return <p role="status" style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: '0.78rem', marginTop: 8, color: r.ok ? '#059669' : '#b91c1c' }}><Icon size={14} style={{ flexShrink: 0, marginTop: 2 }} /> {r.text}</p>;
}

/* ── Email & file storage (leads) ─────────────── */
interface IntegrationsTabProps { driveReturn: string | null }

function IntegrationsTab({ driveReturn }: IntegrationsTabProps) {
  const [cfg, setCfg] = useState<IntegrationSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [emailResult, setEmailResult] = useState<Result>(null);
  const [checkingDrive, setCheckingDrive] = useState(false);
  const [driveResult, setDriveResult] = useState<Result>(driveReturn ? DRIVE_RETURN[driveReturn] ?? null : null);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    try { setCfg(await apiJson<IntegrationSettings>('/api/settings/integrations')); setLoadError(null); }
    catch (e) { setLoadError(e instanceof Error ? e.message : 'Could not load settings.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const testEmail = async () => {
    setTesting(true); setEmailResult(null);
    try {
      const r = await apiJson<{ ok: boolean; detail: string }>('/api/integrations/email/test', { method: 'POST' });
      setEmailResult({ ok: r.ok, text: r.detail });
    } catch (e) { setEmailResult({ ok: false, text: e instanceof Error ? e.message : 'Test failed.' }); }
    finally { setTesting(false); }
  };

  const connectDrive = async (switchAccount = false) => {
    if (switchAccount && !window.confirm(SWITCH_WARNING)) return;
    setConnecting(true); setDriveResult(null);
    try { window.location.href = (await apiJson<{ url: string }>(`/api/integrations/drive/connect?switch=${switchAccount}`, { method: 'POST' })).url; }
    catch (e) { setDriveResult({ ok: false, text: e instanceof Error ? e.message : 'Could not start the Google sign-in.' }); setConnecting(false); }
  };

  const testDrive = async () => {
    setCheckingDrive(true); setDriveResult(null);
    try {
      const r = await apiJson<{ ok: boolean; detail: string }>('/api/integrations/drive/test', { method: 'POST' });
      setDriveResult({ ok: r.ok, text: r.detail });
    } catch (e) { setDriveResult({ ok: false, text: e instanceof Error ? e.message : 'Check failed.' }); }
    finally { setCheckingDrive(false); }
  };

  if (loadError) return <p role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{loadError} <button type="button" className="chip" onClick={() => void load()}>Retry</button></p>;
  if (!cfg) return <p role="status" style={{ color: '#64748B', fontSize: '0.85rem' }}>Loading…</p>;

  return (
    <section className="glass-card" style={{ padding: '1.5rem' }} aria-labelledby="email-h">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div className="icon-tile"><Mail size={16} /></div>
        <div>
          <h2 id="email-h" style={SECTION_LABEL}>Email</h2>
          <p style={{ fontSize: '0.75rem', color: '#64748b' }}>Confirmations, review links and reminders. Set in Vercel with the SMTP_* settings (e.g. Zoho Mail).</p>
        </div>
        <span className={cfg.email_configured ? 'badge-green' : 'badge-red'} style={{ marginLeft: 'auto' }}>{cfg.email_configured ? 'Connected' : 'Not set up'}</span>
      </div>
      {cfg.email_configured && <p style={HINT}>Sending as <strong>{cfg.email_from}</strong> through {cfg.email_host}.</p>}
      <div style={{ marginTop: 10 }}>
        <button type="button" className="btn-ghost" onClick={() => void testEmail()} disabled={testing || !cfg.email_configured}>
          <Send size={14} /> {testing ? 'Sending…' : 'Send me a test email'}
        </button>
        <ResultLine r={emailResult} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(226,232,240,0.85)' }}>
        <div className="icon-tile"><HardDrive size={16} /></div>
        <div>
          <h2 style={SECTION_LABEL}>File storage</h2>
          <p style={{ fontSize: '0.75rem', color: '#64748b' }}>New uploads are saved to: <strong>{cfg.file_storage}</strong>. Google Drive needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel, then Connect Google Drive below; DEPLOY.md has the steps.</p>
        </div>
      </div>
      {cfg.drive_connect_ready && (
        <div style={{ marginTop: 10 }}>
          {cfg.drive_lapsed ? (
            <p style={{ ...HINT, color: '#b91c1c' }}><strong>Google Drive is disconnected</strong>: Google ended the sign-in. New uploads are kept in the database until you reconnect.</p>
          ) : cfg.drive_connected_at ? (
            <p style={HINT}>
              Connected to the Drive of <strong>{cfg.drive_connected_as ?? 'a Google account'}</strong> on {when(cfg.drive_connected_at)}.
              {cfg.drive_expires_at && <> Google ends this sign-in on <strong>{when(cfg.drive_expires_at)}</strong>: reconnect before then (you'll get a reminder a day ahead).</>}
            </p>
          ) : (
            <p style={HINT}>Not connected yet. Sign in with the Google account whose Drive should hold the files.</p>
          )}
          <button type="button" className="btn-primary" onClick={() => void connectDrive()} disabled={connecting} style={{ marginTop: 6 }}>
            <HardDrive size={14} /> {connecting ? 'Opening Google…' : cfg.drive_connected_at ? 'Reconnect Google Drive' : 'Connect Google Drive'}
          </button>
          {cfg.drive_connected_at && (
            <button type="button" className="btn-ghost" onClick={() => void connectDrive(true)} disabled={connecting} style={{ marginTop: 6, marginLeft: 8 }}>
              Switch Google account
            </button>
          )}
        </div>
      )}
      <p style={{ ...HINT, marginTop: 8 }}>Redirect URI for the Google OAuth client: <code style={{ userSelect: 'all' }}>{cfg.drive_redirect_uri}</code></p>
      <div style={{ marginTop: 10 }}>
        <button type="button" className="btn-ghost" onClick={() => void testDrive()} disabled={checkingDrive}>
          <HardDrive size={14} /> {checkingDrive ? 'Checking…' : 'Check Google Drive'}
        </button>
        <ResultLine r={driveResult} />
      </div>
    </section>
  );
}

/* ── My notifications (everyone) ──────────────── */
function MyNotificationsTab() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Result>(null);

  const load = useCallback(async () => {
    try { setPrefs(await apiJson<Prefs>('/api/me/preferences')); setLoadError(null); }
    catch (e) { setLoadError(e instanceof Error ? e.message : 'Could not load your preferences.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loadError) return <p role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{loadError} <button type="button" className="chip" onClick={() => void load()}>Retry</button></p>;
  if (!prefs) return <p role="status" style={{ color: '#64748B', fontSize: '0.85rem' }}>Loading…</p>;

  const set = (patch: Partial<Prefs>) => { setPrefs({ ...prefs, ...patch }); setResult(null); };

  const save = async () => {
    setSaving(true); setResult(null);
    try {
      const { in_app_enabled, muted_events } = prefs;
      setPrefs(await apiJson<Prefs>('/api/me/preferences', { method: 'PUT', json: { in_app_enabled, muted_events } }));
      setResult({ ok: true, text: 'Preferences saved.' });
    } catch (e) { setResult({ ok: false, text: e instanceof Error ? e.message : 'Could not save.' }); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <section className="glass-card" style={{ padding: '1.5rem' }} aria-labelledby="chan-h">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div className="icon-tile"><Bell size={16} /></div>
          <div><h2 id="chan-h" style={SECTION_LABEL}>How you're notified</h2><p style={{ fontSize: '0.75rem', color: '#64748b' }}>Notifications appear in the bell at the top of the page.</p></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Toggle id="p-inapp" checked={prefs.in_app_enabled} onChange={v => set({ in_app_enabled: v })} label="In-app notifications (the bell)" />
        </div>
      </section>

      <section className="glass-card" style={{ padding: '1.5rem' }} aria-labelledby="ev-h">
        <h2 id="ev-h" style={{ ...SECTION_LABEL, marginBottom: 10 }}>Tell me when…</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Object.entries(prefs.available_events).map(([key, label]) => (
            <Toggle key={key} id={`ev-${key}`} checked={!prefs.muted_events.includes(key)} label={label}
              onChange={on => set({ muted_events: on ? prefs.muted_events.filter(k => k !== key) : [...prefs.muted_events, key] })} />
          ))}
        </div>
      </section>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}><Save size={14} /> {saving ? 'Saving…' : 'Save preferences'}</button>
        <ResultLine r={result} />
      </div>
    </div>
  );
}

function AccountTab() {
  return (
    <section className="glass-card" style={{ padding: '1.5rem' }} aria-labelledby="pw-h">
      <h2 id="pw-h" style={{ ...SECTION_LABEL, marginBottom: 14 }}>Change password</h2>
      <ChangePasswordForm />
    </section>
  );
}

type TabKey = 'me' | 'account' | 'users' | 'integrations' | 'danger';

const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const isLead = user?.role === 'Design Lead';   // an Admin arrives as 'Design Lead' too (auth.frontend_role)
  // What Google's sign-in came back with, read once per visit to Settings, so coming back later doesn't repeat it.
  const [driveReturn] = useState(() => new URLSearchParams(window.location.search).get('drive'));
  const [tab, setTab] = useState<TabKey>(driveReturn && isLead ? 'integrations' : 'me');
  useEffect(() => {   // drop ?drive=… so a reload doesn't show the message again
    if (driveReturn) window.history.replaceState(null, '', window.location.pathname);
  }, [driveReturn]);
  const revealRef = useReveal<HTMLDivElement>(tab);
  const tabs: [TabKey, string][] = [
    ['me', 'My notifications'],
    ['account', 'Password'],
    ...(isLead ? [['users', 'Users'], ['integrations', 'Email & storage'], ['danger', 'Danger zone']] as [TabKey, string][] : []),
  ];

  return (
    <div ref={revealRef} style={{ maxWidth: tab === 'users' ? 900 : 720, paddingBottom: '3rem' }}>
      <div role="tablist" aria-label="Settings sections" style={{ display: 'inline-flex', flexWrap: 'wrap', background: '#F8FAFC', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-md)', padding: 4, marginBottom: '1.25rem' }}>
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            style={{ padding: '0.45rem 1rem', borderRadius: 8, border: 'none', cursor: 'pointer', background: tab === key ? 'white' : 'transparent', boxShadow: tab === key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none', color: tab === key ? '#003F8A' : 'var(--text-hint)', fontSize: '0.8rem', fontWeight: 700 }}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'account' ? <AccountTab />
        : tab === 'users' && isLead ? <UsersAdmin />
        : tab === 'integrations' && isLead ? <IntegrationsTab driveReturn={driveReturn} />
        : tab === 'danger' && isLead ? <DeleteAllData />
        : <MyNotificationsTab />}
    </div>
  );
};

export default SettingsPage;
