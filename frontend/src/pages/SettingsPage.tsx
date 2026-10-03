import React, { useState } from 'react';
import { authFetch } from '../api';
import { Bell, MessageSquare, Save, TestTube2, CheckCircle2, AlertTriangle, Mail } from 'lucide-react';

const SECTION_LABEL: React.CSSProperties = {
  fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase',
  letterSpacing: '0.1em', color: '#94a3b8', marginBottom: 12,
};

const FIELD_LABEL: React.CSSProperties = {
  fontSize: '0.78rem', fontWeight: 700, color: '#0f172a',
  display: 'block', marginBottom: 6,
};

const HINT: React.CSSProperties = {
  fontSize: '0.7rem', color: '#94a3b8', marginTop: 5, lineHeight: 1.5,
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type TestState = 'idle' | 'testing' | 'ok' | 'fail';

const SettingsPage: React.FC = () => {
  /* Slack */
  const [slackWebhook, setSlackWebhook] = useState(
    () => localStorage.getItem('cfg_slack_webhook') ?? ''
  );
  const [slackChannel, setSlackChannel] = useState(
    () => localStorage.getItem('cfg_slack_channel') ?? '#design-alerts'
  );
  const [slackBreachAlert,   setSlackBreachAlert]   = useState(() => localStorage.getItem('cfg_slack_breach')   !== 'false');
  const [slackEscalateAlert, setSlackEscalateAlert] = useState(() => localStorage.getItem('cfg_slack_escalate') !== 'false');
  const [slackNewTicket,     setSlackNewTicket]     = useState(() => localStorage.getItem('cfg_slack_new')      !== 'false');

  /* Email */
  const [emailRecipients, setEmailRecipients] = useState(
    () => localStorage.getItem('cfg_email_recipients') ?? 'lead@mccia.in'
  );
  const [emailOnBreach, setEmailOnBreach] = useState(() => localStorage.getItem('cfg_email_breach') !== 'false');

  /* SLA thresholds */
  const [warnHours,   setWarnHours]   = useState(() => Number(localStorage.getItem('cfg_sla_warn_hours')   || 4));
  const [critHours,   setCritHours]   = useState(() => Number(localStorage.getItem('cfg_sla_crit_hours')   || 1));
  const [autoClose,   setAutoClose]   = useState(() => Number(localStorage.getItem('cfg_auto_close_days')  || 7));

  const [saveSt,   setSaveSt]   = useState<SaveState>('idle');
  const [testSt,   setTestSt]   = useState<TestState>('idle');

  const save = () => {
    setSaveSt('saving');
    localStorage.setItem('cfg_slack_webhook',   slackWebhook);
    localStorage.setItem('cfg_slack_channel',   slackChannel);
    localStorage.setItem('cfg_slack_breach',    String(slackBreachAlert));
    localStorage.setItem('cfg_slack_escalate',  String(slackEscalateAlert));
    localStorage.setItem('cfg_slack_new',       String(slackNewTicket));
    localStorage.setItem('cfg_email_recipients',emailRecipients);
    localStorage.setItem('cfg_email_breach',    String(emailOnBreach));
    localStorage.setItem('cfg_sla_warn_hours',  String(warnHours));
    localStorage.setItem('cfg_sla_crit_hours',  String(critHours));
    localStorage.setItem('cfg_auto_close_days', String(autoClose));
    setTimeout(() => setSaveSt('saved'), 600);
    setTimeout(() => setSaveSt('idle'),  2500);
  };

  const testSlack = async () => {
    if (!slackWebhook) { setTestSt('fail'); setTimeout(() => setTestSt('idle'), 2000); return; }
    setTestSt('testing');
    try {
      const res = await authFetch('/api/integrations/slack/test', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ webhook_url: slackWebhook, channel: slackChannel }),
        signal:  AbortSignal.timeout(5000),
      });
      setTestSt(res.ok ? 'ok' : 'fail');
    } catch {
      setTestSt('fail');
    }
    setTimeout(() => setTestSt('idle'), 3000);
  };

  return (
    <div style={{ maxWidth: 680, paddingBottom: '3rem' }}>
      {/* ── Slack ──────────────────────────── */}
      <div className="glass-card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div className="icon-tile" style={{ background: 'rgba(74,21,75,0.07)', borderColor: 'rgba(74,21,75,0.15)', color: '#4a154b' }}>
            <MessageSquare size={16} />
          </div>
          <div>
            <p style={{ ...SECTION_LABEL, marginBottom: 2 }}>Slack Integration</p>
            <p style={{ fontSize: '0.75rem', color: '#64748b' }}>Post SLA alerts and ticket events to a Slack channel via Incoming Webhook.</p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={FIELD_LABEL}>Webhook URL</label>
            <input
              type="url"
              className="input-field"
              placeholder="https://hooks.slack.com/services/T.../B.../..."
              value={slackWebhook}
              onChange={e => setSlackWebhook(e.target.value)}
            />
            <p style={HINT}>Create one at <strong>api.slack.com/apps</strong> → Incoming Webhooks.</p>
          </div>

          <div>
            <label style={FIELD_LABEL}>Default Channel</label>
            <input
              type="text"
              className="input-field"
              placeholder="#design-alerts"
              value={slackChannel}
              onChange={e => setSlackChannel(e.target.value)}
              style={{ maxWidth: 220 }}
            />
          </div>

          {/* Alert toggles */}
          <div>
            <p style={{ ...FIELD_LABEL, marginBottom: 10 }}>Send alerts for…</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'SLA breach',           val: slackBreachAlert,   set: setSlackBreachAlert   },
                { label: 'Ticket escalation',    val: slackEscalateAlert, set: setSlackEscalateAlert },
                { label: 'New ticket created',   val: slackNewTicket,     set: setSlackNewTicket     },
              ].map(({ label, val, set }) => (
                <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, color: '#374151' }}>
                  <input type="checkbox" checked={val} onChange={e => set(e.target.checked)}
                    style={{ width: 15, height: 15, accentColor: '#003F8A', cursor: 'pointer' }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* Test button */}
          <div>
            <button
              onClick={testSlack}
              disabled={testSt === 'testing'}
              className="btn-ghost"
              style={{ gap: 6, fontSize: '0.78rem', padding: '0.5rem 1rem' }}
            >
              {testSt === 'testing' ? <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>◌</span> Testing…</> :
               testSt === 'ok'      ? <><CheckCircle2 size={14} style={{ color: '#059669' }} /> Message sent!</> :
               testSt === 'fail'    ? <><AlertTriangle size={14} style={{ color: '#EF4444' }} /> Failed — check URL</> :
               <><TestTube2 size={14} /> Send test message</>}
            </button>
          </div>
        </div>
      </div>

      {/* ── Email ──────────────────────────── */}
      <div className="glass-card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div className="icon-tile">
            <Mail size={16} />
          </div>
          <div>
            <p style={SECTION_LABEL}>Email Alerts</p>
            <p style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: -10 }}>Receive SLA breach notifications by email (uses backend SMTP config).</p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={FIELD_LABEL}>Recipient emails (comma-separated)</label>
            <input
              type="text"
              className="input-field"
              placeholder="lead@mccia.in, manager@mccia.in"
              value={emailRecipients}
              onChange={e => setEmailRecipients(e.target.value)}
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, color: '#374151' }}>
            <input type="checkbox" checked={emailOnBreach} onChange={e => setEmailOnBreach(e.target.checked)}
              style={{ width: 15, height: 15, accentColor: '#003F8A', cursor: 'pointer' }}
            />
            Email on SLA breach
          </label>
        </div>
      </div>

      {/* ── SLA thresholds ─────────────────── */}
      <div className="glass-card" style={{ padding: '1.5rem', marginBottom: '1.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div className="icon-tile" style={{ background: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.15)', color: '#b91c1c' }}>
            <Bell size={16} />
          </div>
          <div>
            <p style={SECTION_LABEL}>SLA Thresholds</p>
            <p style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: -10 }}>Control when warning and critical alerts fire before the deadline.</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
          {[
            { label: 'Warn before deadline',  sublabel: 'hours', val: warnHours,  set: setWarnHours  },
            { label: 'Critical before deadline', sublabel: 'hours', val: critHours,  set: setCritHours  },
            { label: 'Auto-close after delivery', sublabel: 'days',  val: autoClose,  set: setAutoClose  },
          ].map(({ label, sublabel, val, set }) => (
            <div key={label}>
              <label style={FIELD_LABEL}>{label}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number" min={1} max={999}
                  value={val}
                  onChange={e => set(Number(e.target.value))}
                  className="input-field"
                  style={{ width: 80, textAlign: 'center' }}
                />
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600 }}>{sublabel}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Save */}
      <button onClick={save} className="btn-primary" style={{ gap: 8, padding: '0.75rem 1.75rem' }}>
        {saveSt === 'saving' ? <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>◌</span> Saving…</> :
         saveSt === 'saved'  ? <><CheckCircle2 size={15} /> Saved!</>  :
         <><Save size={15} /> Save Settings</>}
      </button>
    </div>
  );
};

export default SettingsPage;
