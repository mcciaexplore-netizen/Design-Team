import { useState, type FormEvent } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { ApiError, publicForm } from '../api';
import TurnstileWidget from '../components/TurnstileWidget';
import DesignRequestFields, { DraftBanner, ErrorSummary, IdentityFields } from '../components/DesignRequestFields';
import { useRequestForm, useRequestFormOptions } from '../hooks/useRequestForm';
import { buildBody, type RequestFormOptions } from '../requestForm';

/** One ticket the request became (one per ticked design). */
interface Created { ticket_number: string; design: string; tracking_url: string }

/** Public design request form. Submitting it creates and assigns a ticket; no sign-in needed. */
export default function RequestFormPage() {
  const { options, error: loadError } = useRequestFormOptions();
  return (
    <div style={{ padding: '2rem 1rem' }}>
      <main style={{ maxWidth: 640, margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-strong)' }}>Request for Creative / Graphic Design work</h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-soft)', margin: '6px 0 20px' }}>
          Fill in the form and attach the circular or file. Please submit a separate request for each recurring creative.
          {' '}Already sent some? <a className="login-link-btn" href="/">See where all requests stand</a>
        </p>
        {loadError && <p role="alert" style={{ color: '#b91c1c' }}>{loadError}</p>}
        {options && <RequestFormBody options={options} />}
      </main>
    </div>
  );
}

function RequestFormBody({ options }: { options: RequestFormOptions }) {
  const form = useRequestForm({ options, idPrefix: 'rf', draftName: 'public', needsIdentity: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ tickets: Created[] } | null>(null);
  const [captcha, setCaptcha] = useState('');
  const [captchaReset, setCaptchaReset] = useState(0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.validateAll()) return;
    const body = buildBody(form.values, form.files, true);
    const trap = new FormData(e.currentTarget as HTMLFormElement).get('website');   // the honeypot, if a bot filled it
    if (trap) body.set('website', String(trap));
    if (options.turnstile_site_key) {
      if (!captcha) { setError('Please complete the verification check.'); return; }
      body.set('cf-turnstile-response', captcha);
    }
    setBusy(true);
    try {
      const res = await publicForm<{ tickets?: Created[] }>('/api/public/requests', body);
      form.submitted();
      setDone({ tickets: res.tickets ?? [] });   // no tickets: the honeypot answer
      setCaptcha(''); setCaptchaReset(n => n + 1);   // a token works once; the next request needs a fresh one
    } catch (err) {
      setError(form.showServerError(err instanceof ApiError ? err.message : 'Could not submit the request.'));
      setCaptchaReset(n => n + 1);
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="glass-card" role="status" style={{ padding: '2rem', textAlign: 'center' }}>
        <CheckCircle2 size={36} color="#256B45" style={{ margin: '0 auto 10px' }} />
        <h2 style={{ fontWeight: 800, marginBottom: 6 }}>Request received</h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-soft)' }}>
          {done.tickets[0] && <>Your ticket number is <strong>{done.tickets[0].ticket_number}</strong>. </>}The design team has been notified and will be in touch.
        </p>
        {done.tickets[0] && (
          <p style={{ fontSize: '0.85rem', marginTop: 10 }}>
            <a href={done.tickets[0].tracking_url} style={{ fontWeight: 700 }}>Track this request</a> any time. Bookmark the link, no sign-in needed.
            {' '}Or <a href="/" style={{ fontWeight: 700 }}>see all requests</a> and where each one stands.
          </p>
        )}
        <button type="button" className="btn-primary" style={{ marginTop: 16 }} onClick={() => { setDone(null); form.reset(); }}>Submit another request</button>
      </div>
    );
  }

  return (
    <form onSubmit={e => void submit(e)} noValidate className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      {/* Honeypot: hidden from people, tempting to bots. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }}>
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>

      <DraftBanner form={form} />
      <ErrorSummary form={form} />
      <IdentityFields form={form} idPrefix="rf" />
      <DesignRequestFields options={options} form={form} idPrefix="rf" />

      {options.turnstile_site_key && <TurnstileWidget siteKey={options.turnstile_site_key} onToken={setCaptcha} resetSignal={captchaReset} />}

      {error && <p role="alert" style={{ fontSize: '0.85rem', color: '#b91c1c' }}>{error}</p>}
      <button type="submit" className="btn-primary" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Submitting…' : 'Submit request'}</button>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-hint)' }}>Never share passwords through this form.</p>
    </form>
  );
}
