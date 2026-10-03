import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2, Mail, MessageSquare, Save, Send } from 'lucide-react';
import { apiJson } from '../api';
import { useAuth } from '../contexts/AuthContext';

const SECTION_LABEL: React.CSSProperties = { fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748b', marginBottom: 2 };
const FIELD_LABEL: React.CSSProperties = { fontSize: '0.78rem', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 6 };
const HINT: React.CSSProperties = { fontSize: '0.72rem', color: '#64748b', marginTop: 5, lineHeight: 1.5 };

interface IntegrationSettings {
  slack_configured: boolean; slack_webhook_masked: string; slack_channel: string;
  slack_events: { breach: boolean; escalate: boolean; new: boolean };
  email_recipients: string[]; email_on_breach: boolean; smtp_configured: boolean;
}
interface Prefs {
  in_app_enabled: boolean; email_enabled: boolean; digest_enabled: boolean;
  quiet_hours_start: number | null; quiet_hours_end: number | null;
  muted_events: string[]; available_events: Record<string, string>; smtp_configured: boolean;
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
  return <p role="status" style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: '0.78rem', marginTop: 8, color: r.ok ? '#047857' : '#b91c1c' }}><Icon size={14} style={{ flexShrink: 0, marginTop: 2 }} /> {r.text}</p>;
}

/* ── Integrations (leads) ─────────────────────── */
function IntegrationsTab() {
  const [cfg, setCfg] = useState<IntegrationSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [webhook, setWebhook] = useState('');
  const [channel, setChannel] = useState('');
  const [events, setEvents] = useState({ breach: true, escalate: true, new: true });
  const [recipients, setRecipients] = useState('');
  const [onBreach, setOnBreach] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<Result>(null);
  const [slackResult, setSlackResult] = useState<Result>(null);
  const [emailResult, setEmailResult] = useState<Result>(null);
  const [testing, setTesting] = useState<'slack' | 'email' | null>(null);

  const apply = (c: IntegrationSettings) => {
    setCfg(c); setChannel(c.slack_channel); setEvents(c.slack_events); setRecipients(c.email_recipients.join(', ')); setOnBreach(c.email_on_breach); setWebhook('');
  };

  const load = useCallback(async () => {
    try { apply(await apiJson<IntegrationSettings>('/api/settings/integrations')); setLoadError(null); }
    catch (e) { setLoadError(e instanceof Error ? e.message : 'Could not load settings.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true); setSaveResult(null);
    const list = recipients.split(/[,\s;]+/).map(s => s.trim()).filter(Boolean);
    try {
      const body: Record<string, unknown> = { slack_channel: channel.trim(), slack_events: events, email_recipients: list, email_on_breach: onBreach };
      if (webhook.trim()) body.slack_webhook = webhook.trim();
      apply(await apiJson<IntegrationSettings>('/api/settings/integrations', { method: 'PUT', json: body }));
      setSaveResult({ ok: true, text: 'Settings saved.' });
    } catch (e) { setSaveResult({ ok: false, text: e instanceof Error ? e.message : 'Could not save.' }); }
    finally { setSaving(false); }
  };

  const removeWebhook = async () => {
    setSaving(true); setSaveResult(null);
    try { apply(await apiJson<IntegrationSettings>('/api/settings/integrations', { method: 'PUT', json: { slack_webhook: '' } })); setSaveResult({ ok: true, text: 'Slack webhook removed.' }); }
    catch (e) { setSaveResult({ ok: false, text: e instanceof Error ? e.message : 'Could not remove it.' }); }
    finally { setSaving(false); }
  };

  const testSlack = async () => {
    setTesting('slack'); setSlackResult(null);
    try {
      const r = await apiJson<{ ok: boolean; detail: string }>('/api/integrations/slack/test', { method: 'POST', json: { webhook_url: webhook.trim() || null, channel: channel.trim() } });
      setSlackResult({ ok: r.ok, text: r.detail });
    } catch (e) { setSlackResult({ ok: false, text: e instanceof Error ? e.message : 'Test failed.' }); }
    finally { setTesting(null); }
  };

  const testEmail = async () => {
    setTesting('email'); setEmailResult(null);
    try {
      const r = await apiJson<{ ok: boolean; detail: string }>('/api/integrations/email/test', { method: 'POST', json: {} });
      setEmailResult({ ok: r.ok, text: r.detail });
    } catch (e) { setEmailResult({ ok: false, text: e instanceof Error ? e.message : 'Test failed.' }); }
    finally { setTesting(null); }
  };

  if (loadError) return <p role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{loadError} <button type="button" className="chip" onClick={() => void load()}>Retry</button></p>;
  if (!cfg) return <p role="status" style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Loading…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <section className="glass-card" style={{ padding: '1.5rem' }} aria-labelledby="slack-h">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div className="icon-tile" style={{ background: 'rgba(74,21,75,0.07)', borderColor: 'rgba(74,21,75,0.15)', color: '#4a154b' }}><MessageSquare size={16} /></div>
          <div>
            <h2 id="slack-h" style={SECTION_LABEL}>Slack integration</h2>
            <p style={{ fontSize: '0.75rem', color: '#64748b' }}>Post new tickets, SLA breaches and escalations to a Slack channel via an Incoming Webhook.</p>
          </div>
          <span className={cfg.slack_configured ? 'badge-green' : 'badge-red'} style={{ marginLeft: 'auto' }}>{cfg.slack_configured ? 'Connected' : 'Not set up'}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label htmlFor="slack-url" style={FIELD_LABEL}>Webhook URL</label>
            <input id="slack-url" className="input-field" type="url" autoComplete="off" value={webhook} onChange={e => setWebhook(e.target.value)}
              placeholder={cfg.slack_configured ? `Saved: ${cfg.slack_webhook_masked} — paste a new URL to replace it` : 'https://hooks.slack.com/services/T…/B…/…'} />
            <p style={HINT}>Create one at <strong>api.slack.com/apps</strong> → Incoming Webhooks. The URL is stored on the server and never shown again.
              {cfg.slack_configured && <> <button type="button" className="chip" onClick={() => void removeWebhook()} disabled={saving}>Remove saved webhook</button></>}</p>
          </div>
          <div>
            <label htmlFor="slack-ch" style={FIELD_LABEL}>Channel (optional)</label>
            <input id="slack-ch" className="input-field" value={channel} maxLength={80} onChange={e => setChannel(e.target.value)} placeholder="#design-alerts" style={{ maxWidth: 260 }} />
            <p style={HINT}>Modern Slack apps post to the channel chosen when the webhook was created; this only applies to legacy webhooks.</p>
          </div>
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend style={FIELD_LABEL}>Send alerts for…</legend>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Toggle id="ev-breach" checked={events.breach} onChange={v => setEvents(e => ({ ...e, breach: v }))} label="SLA breach" />
              <Toggle id="ev-esc" checked={events.escalate} onChange={v => setEvents(e => ({ ...e, escalate: v }))} label="Client changes requested" />
              <Toggle id="ev-new" checked={events.new} onChange={v => setEvents(e => ({ ...e, new: v }))} label="New ticket created / design approved" />
            </div>
          </fieldset>
          <div>
            <button type="button" className="btn-ghost" onClick={() => void testSlack()} disabled={testing !== null || (!webhook.trim() && !cfg.slack_configured)}>
              <Send size={14} /> {testing === 'slack' ? 'Sending…' : 'Send test message'}
            </button>
            <ResultLine r={slackResult} />
          </div>
        </div>
      </section>

      <section className="glass-card" style={{ padding: '1.5rem' }} aria-labelledby="email-h">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div className="icon-tile"><Mail size={16} /></div>
          <div>
            <h2 id="email-h" style={SECTION_LABEL}>Email</h2>
            <p style={{ fontSize: '0.75rem', color: '#64748b' }}>Notifications, daily digests and client review links are sent by email.</p>
          </div>
          <span className={cfg.smtp_configured ? 'badge-green' : 'badge-red'} style={{ marginLeft: 'auto' }}>{cfg.smtp_configured ? 'Server ready' : 'Not configured'}</span>
        </div>

        {!cfg.smtp_configured && (
          <p role="note" style={{ fontSize: '0.8rem', color: '#92400e', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, padding: '0.6rem 0.8rem', marginBottom: 14 }}>
            Email isn't set up on the server yet, so nothing is sent. Ask whoever hosts DesignDesk to set <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>, <code>SMTP_PASSWORD</code> and <code>SMTP_FROM</code>. In-app notifications work regardless.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label htmlFor="email-rcp" style={FIELD_LABEL}>Escalation recipients</label>
            <input id="email-rcp" className="input-field" value={recipients} onChange={e => setRecipients(e.target.value)} placeholder="lead@mccia.in, ops@mccia.in" />
            <p style={HINT}>Separate addresses with commas.</p>
          </div>
          <Toggle id="email-breach" checked={onBreach} onChange={setOnBreach} label="Email these people when an SLA is breached" />
          <div>
            <button type="button" className="btn-ghost" onClick={() => void testEmail()} disabled={testing !== null}>
              <Mail size={14} /> {testing === 'email' ? 'Sending…' : 'Send test email to me'}
            </button>
            <ResultLine r={emailResult} />
          </div>
        </div>
      </section>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}><Save size={14} /> {saving ? 'Saving…' : 'Save settings'}</button>
        <ResultLine r={saveResult} />
      </div>
    </div>
  );
}

/* ── My notifications (everyone) ──────────────── */
function MyNotificationsTab() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [digestResult, setDigestResult] = useState<Result>(null);
  const [digestBusy, setDigestBusy] = useState(false);

  const load = useCallback(async () => {
    try { setPrefs(await apiJson<Prefs>('/api/me/preferences')); setLoadError(null); }
    catch (e) { setLoadError(e instanceof Error ? e.message : 'Could not load your preferences.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loadError) return <p role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{loadError} <button type="button" className="chip" onClick={() => void load()}>Retry</button></p>;
  if (!prefs) return <p role="status" style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Loading…</p>;

  const set = (patch: Partial<Prefs>) => { setPrefs({ ...prefs, ...patch }); setResult(null); };
  const quietOn = prefs.quiet_hours_start !== null && prefs.quiet_hours_end !== null;
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

  const save = async () => {
    setSaving(true); setResult(null);
    try {
      const { in_app_enabled, email_enabled, digest_enabled, quiet_hours_start, quiet_hours_end, muted_events } = prefs;
      setPrefs(await apiJson<Prefs>('/api/me/preferences', { method: 'PUT', json: { in_app_enabled, email_enabled, digest_enabled, quiet_hours_start, quiet_hours_end, muted_events } }));
      setResult({ ok: true, text: 'Preferences saved.' });
    } catch (e) { setResult({ ok: false, text: e instanceof Error ? e.message : 'Could not save.' }); }
    finally { setSaving(false); }
  };

  const sendDigest = async () => {
    setDigestBusy(true); setDigestResult(null);
    try { const r = await apiJson<{ ok: boolean; detail: string }>('/api/me/digest/send', { method: 'POST' }); setDigestResult({ ok: r.ok, text: r.detail }); }
    catch (e) { setDigestResult({ ok: false, text: e instanceof Error ? e.message : 'Could not send.' }); }
    finally { setDigestBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <section className="glass-card" style={{ padding: '1.5rem' }} aria-labelledby="chan-h">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div className="icon-tile"><Bell size={16} /></div>
          <div><h2 id="chan-h" style={SECTION_LABEL}>How you're notified</h2><p style={{ fontSize: '0.75rem', color: '#64748b' }}>Choose where DesignDesk reaches you.</p></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Toggle id="p-inapp" checked={prefs.in_app_enabled} onChange={v => set({ in_app_enabled: v })} label="In-app notifications (the bell)" />
          <Toggle id="p-email" checked={prefs.email_enabled} onChange={v => set({ email_enabled: v })} label="Email notifications"
            hint={prefs.smtp_configured ? undefined : 'Email isn’t configured on the server yet, so no emails are sent for now.'} />
          <Toggle id="p-quiet" checked={quietOn} onChange={v => set(v ? { quiet_hours_start: 20, quiet_hours_end: 8 } : { quiet_hours_start: null, quiet_hours_end: null })}
            label="Quiet hours" hint="No emails during this window (India time). In-app notifications still arrive." />
          {quietOn && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginLeft: 26, flexWrap: 'wrap' }}>
              <label htmlFor="q-start" style={{ fontSize: '0.78rem' }}>From</label>
              <select id="q-start" className="input-field" style={{ width: 'auto' }} value={prefs.quiet_hours_start ?? 20} onChange={e => set({ quiet_hours_start: Number(e.target.value) })}>{hours.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}</select>
              <label htmlFor="q-end" style={{ fontSize: '0.78rem' }}>to</label>
              <select id="q-end" className="input-field" style={{ width: 'auto' }} value={prefs.quiet_hours_end ?? 8} onChange={e => set({ quiet_hours_end: Number(e.target.value) })}>{hours.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}</select>
            </div>
          )}
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

      <section className="glass-card" style={{ padding: '1.5rem' }} aria-labelledby="dg-h">
        <h2 id="dg-h" style={{ ...SECTION_LABEL, marginBottom: 10 }}>Daily digest</h2>
        <Toggle id="p-digest" checked={prefs.digest_enabled} onChange={v => set({ digest_enabled: v })} label="Email me a daily summary at about 9:00 AM IST"
          hint="Overdue work, what's due in the next 24 hours, and what's waiting for review." />
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn-ghost" onClick={() => void sendDigest()} disabled={digestBusy}><Send size={14} /> {digestBusy ? 'Sending…' : 'Send me one now'}</button>
          <ResultLine r={digestResult} />
        </div>
      </section>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}><Save size={14} /> {saving ? 'Saving…' : 'Save preferences'}</button>
        <ResultLine r={result} />
      </div>
    </div>
  );
}

const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const isLead = user?.role === 'Design Lead';
  const [tab, setTab] = useState<'me' | 'integrations'>('me');

  return (
    <div style={{ maxWidth: 720, paddingBottom: '3rem' }}>
      {isLead && (
        <div role="tablist" aria-label="Settings sections" style={{ display: 'inline-flex', background: '#F8FAFC', border: '1px solid rgba(226,232,240,0.85)', borderRadius: 'var(--radius-md)', padding: 4, marginBottom: '1.25rem' }}>
          {([['me', 'My notifications'], ['integrations', 'Integrations & alerts']] as const).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
              style={{ padding: '0.45rem 1rem', borderRadius: 8, border: 'none', cursor: 'pointer', background: tab === key ? 'white' : 'transparent', boxShadow: tab === key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none', color: tab === key ? '#003F8A' : '#64748B', fontSize: '0.8rem', fontWeight: 700 }}>
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === 'integrations' && isLead ? <IntegrationsTab /> : <MyNotificationsTab />}
    </div>
  );
};

export default SettingsPage;
