import { useEffect, useState, type FormEvent } from 'react';
import { apiJson } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useTickets } from '../contexts/TicketsContext';
import { useRequestForm, useRequestFormOptions, type RequestForm } from '../hooks/useRequestForm';
import { buildBody, type RequestFormOptions, type RequestPrefill } from '../requestForm';
import DesignRequestFields, { DraftBanner, ErrorSummary } from './DesignRequestFields';

interface Props { onCreated: (ticket: { id: string; number: string }) => void; onCancel: () => void; prefill?: RequestPrefill | null }

/** The client's New Request dialog body: the standard design request form. The server sets priority and assignee. */
export default function ClientRequestForm({ onCreated, onCancel, prefill }: Props) {
  const { options, error: loadError } = useRequestFormOptions();
  if (loadError) return <p role="alert" style={{ padding: '1.5rem', color: '#b91c1c' }}>{loadError}</p>;
  if (!options) return <p role="status" style={{ padding: '1.5rem', color: '#94a3b8' }}>Loading…</p>;
  return <Body options={options} onCreated={onCreated} onCancel={onCancel} prefill={prefill} />;
}

function Body({ options, onCreated, onCancel, prefill }: Props & { options: RequestFormOptions }) {
  const { user } = useAuth();
  const { refresh } = useTickets();
  const form: RequestForm = useRequestForm({ options, idPrefix: 'nr', draftName: `portal-${user?.id ?? 'anon'}`, needsIdentity: false, prefill });
  const [org, setOrg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The sign-in session does not carry the organisation, so ask who we are.
  useEffect(() => {
    apiJson<{ client_org?: string | null }>('/api/auth/me').then(me => setOrg(me.client_org ?? null)).catch(() => undefined);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.validateAll()) return;
    setBusy(true);
    try {
      const created = await apiJson<{ id: number; ticket_number: string }>('/api/requests', { method: 'POST', body: buildBody(form.values, form.files, false) });
      form.submitted();
      await refresh();
      onCreated({ id: String(created.id), number: created.ticket_number });
    } catch (err) {
      setError(form.showServerError(err instanceof Error ? err.message : 'Could not submit the request.'));
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={e => void submit(e)} noValidate style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        <p style={{ fontSize: '0.8rem', color: '#64748B' }}>
          Requesting as <strong>{user?.name}</strong>{org ? ` · ${org}` : ''}. Please submit a separate request for each recurring creative. Priority and the designer are set automatically.
        </p>
        <DraftBanner form={form} />
        <ErrorSummary form={form} />
        <DesignRequestFields options={options} form={form} idPrefix="nr" />
        {error && <p role="alert" style={{ fontSize: '0.85rem', color: '#b91c1c' }}>{error}</p>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0.9rem 1.5rem', borderTop: '1px solid rgba(226,232,240,0.85)' }}>
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button>
      </div>
    </form>
  );
}
