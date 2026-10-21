import type { ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { useEstimate, type RequestForm } from '../hooks/useRequestForm';
import { DEPARTMENTS, fieldId, questionKey, requestLabel, shortDate, todayISO, type Question, type RequestFormOptions } from '../requestForm';
import FileDropzone from './FileDropzone';

const errorStyle = { fontSize: '0.78rem', color: '#b91c1c', marginTop: 4 } as const;
const noBorder = { border: 'none', padding: 0, margin: 0, minWidth: 0 } as const;

/** Accessibility attributes that tie an input to its error message. */
function a11y(form: RequestForm, prefix: string, key: string) {
  const id = fieldId(prefix, key);
  const invalid = !!form.errors[key];
  return { id, 'aria-invalid': invalid || undefined, 'aria-describedby': invalid ? `${id}-error` : undefined };
}

function FieldError({ form, prefix, name }: { form: RequestForm; prefix: string; name: string }) {
  const message = form.errors[name];
  return message ? <p id={`${fieldId(prefix, name)}-error`} style={errorStyle}>{message}</p> : null;
}

/** Lists everything that needs fixing, each as a link that jumps to the field. */
export function ErrorSummary({ form }: { form: RequestForm }) {
  if (form.summary.length === 0) return null;
  const n = form.summary.length;
  return (
    <div role="alert" style={{ border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', borderRadius: 10, padding: '0.7rem 0.9rem' }}>
      <strong style={{ fontSize: '0.85rem', color: '#991b1b' }}>Please fix {n} {n === 1 ? 'thing' : 'things'} before sending</strong>
      <ul style={{ margin: '6px 0 0', paddingLeft: '1.1rem', fontSize: '0.82rem' }}>
        {form.summary.map(({ key, message }) => (
          <li key={key}><a href={`#${key}`} style={{ color: '#991b1b' }} onClick={e => { e.preventDefault(); form.focusField(key); }}>{message}</a></li>
        ))}
      </ul>
    </div>
  );
}

/** Name and email, asked only on the public form. */
export function IdentityFields({ form, idPrefix }: { form: RequestForm; idPrefix: string }) {
  return (
    <>
      <div>
        <label htmlFor={fieldId(idPrefix, 'name')} style={requestLabel}>Name *</label>
        <input {...a11y(form, idPrefix, 'name')} className="input-field" maxLength={120} autoComplete="name" value={form.values.name} onChange={e => form.set('name', e.target.value)} />
        <FieldError form={form} prefix={idPrefix} name="name" />
      </div>
      <div>
        <label htmlFor={fieldId(idPrefix, 'email')} style={requestLabel}>Email *</label>
        <input {...a11y(form, idPrefix, 'email')} className="input-field" type="email" maxLength={254} autoComplete="email" value={form.values.email} onChange={e => form.set('email', e.target.value)} />
        <FieldError form={form} prefix={idPrefix} name="email" />
        {form.remembered && (
          <p style={{ fontSize: '0.75rem', color: 'var(--text-soft)', marginTop: 4 }}>
            Remembered on this device. Not you? <button type="button" className="chip" onClick={form.forgetPerson}>Clear</button>
          </p>
        )}
      </div>
    </>
  );
}

/** "Draft restored · Discard", shown when answers saved earlier were put back. */
export function DraftBanner({ form }: { form: RequestForm }) {
  if (!form.restored) return null;
  return (
    <p role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', color: '#475569', background: '#F8FAFC', border: '1px solid rgba(226,232,240,0.9)', borderRadius: 10, padding: '0.5rem 0.8rem' }}>
      <span style={{ flex: 1 }}>Draft restored</span> ·
      <button type="button" className="chip" onClick={form.discardDraft}>Discard</button>
    </p>
  );
}

function QuestionField({ q, design, form, prefix }: { q: Question; design: string; form: RequestForm; prefix: string }) {
  const key = questionKey(design, q.id);
  const label = `${q.label}${q.required ? ' *' : ''}`;
  const answer = form.values.details[design]?.[q.id];
  if (q.type === 'multiselect') {
    const picked = Array.isArray(answer) ? answer : [];
    const props = a11y(form, prefix, key);
    return (
      <fieldset style={noBorder}>
        <legend style={requestLabel}>{label}</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
          {q.options.map((o, i) => (
            <label key={o} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.88rem' }}>
              <input type="checkbox" {...(i === 0 ? props : { 'aria-describedby': props['aria-describedby'] })} checked={picked.includes(o)}
                onChange={e => form.setDetail(design, q.id, e.target.checked ? [...picked, o] : picked.filter(x => x !== o))} /> {o}
            </label>
          ))}
        </div>
        <FieldError form={form} prefix={prefix} name={key} />
      </fieldset>
    );
  }
  const text = typeof answer === 'string' ? answer : '';
  const props = { ...a11y(form, prefix, key), className: 'input-field', value: text };
  return (
    <div>
      <label htmlFor={props.id} style={requestLabel}>{label}</label>
      {q.type === 'select' ? (
        <select {...props} onChange={e => form.setDetail(design, q.id, e.target.value)}>
          <option value="">Select…</option>
          {q.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input {...props} type={q.type === 'number' ? 'number' : 'text'} min={q.type === 'number' ? 1 : undefined} maxLength={200}
          onChange={e => form.setDetail(design, q.id, e.target.value)} />
      )}
      <FieldError form={form} prefix={prefix} name={key} />
    </div>
  );
}

/** A warning when the requested date is earlier than the usual turnaround for the chosen designs. */
function EstimateNote({ requirements, deliveryDate }: { requirements: string[]; deliveryDate: string }) {
  const estimate = useEstimate(requirements, deliveryDate);
  if (!estimate?.rush) return null;
  return (
    <p role="status" style={{ fontSize: '0.82rem', color: '#92400e', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '0.45rem 0.7rem' }}>
      You asked for {shortDate(deliveryDate)}, earlier than usual. This will be marked {estimate.priority} and may not be possible.
    </p>
  );
}

interface Props { options: RequestFormOptions; form: RequestForm; idPrefix: string }

/** The design request questions shared by the public form and the client's New Request dialog. */
export default function DesignRequestFields({ options, form, idPrefix }: Props) {
  const { values } = form;
  const p = idPrefix;
  const chosen = values.design_requirements;
  const several = chosen.length > 1;
  // Each ticked design's own questions, in a labelled group once there is more than one.
  const questions: ReactNode = chosen.filter(d => (options.questions[d] ?? []).length > 0).map(design => (
    <fieldset key={design} aria-label={`Details for ${design}`}
      style={several ? { border: '1px solid rgba(226,232,240,0.9)', borderRadius: 10, padding: '0.8rem 0.9rem 0.9rem', margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }
        : { ...noBorder, display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      {several && <legend style={{ ...requestLabel, padding: '0 6px', marginBottom: 0 }}>{design}</legend>}
      {options.questions[design].map(q => <QuestionField key={q.id} q={q} design={design} form={form} prefix={p} />)}
    </fieldset>
  ));
  const setLink = (i: number, value: string) => form.set('links', values.links.map((l, j) => (j === i ? value : l)));
  return (
    <>
      <div>
        <label htmlFor={fieldId(p, 'event_name')} style={requestLabel}>Event name *</label>
        <input {...a11y(form, p, 'event_name')} className="input-field" maxLength={200} value={values.event_name} onChange={e => form.set('event_name', e.target.value)} />
        <FieldError form={form} prefix={p} name="event_name" />
      </div>
      <div>
        <label htmlFor={fieldId(p, 'event_date')} style={requestLabel}>Event / Workshop date *</label>
        <input {...a11y(form, p, 'event_date')} type="date" className="input-field" value={values.event_date} onChange={e => form.set('event_date', e.target.value)} />
        <FieldError form={form} prefix={p} name="event_date" />
      </div>
      <div>
        <label htmlFor={fieldId(p, 'department')} style={requestLabel}>Department</label>
        <select {...a11y(form, p, 'department')} className="input-field" value={values.department} onChange={e => form.set('department', e.target.value)}>
          <option value="">Select department</option>
          {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <FieldError form={form} prefix={p} name="department" />
      </div>

      <fieldset style={noBorder}>
        <legend style={requestLabel}>Design requirement *</legend>
        <p id={`${p}-requirement-hint`} style={{ fontSize: '0.78rem', color: 'var(--text-soft)', margin: '-2px 0 8px' }}>
          Tick everything you need. They all go on one request, with one designer and one approval.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {options.design_requirements.map((o, i) => (
            <label key={o} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.88rem' }}>
              <input type="checkbox" {...(i === 0 ? a11y(form, p, 'design_requirement') : { 'aria-describedby': form.errors.design_requirement ? `${fieldId(p, 'design_requirement')}-error` : undefined })}
                checked={chosen.includes(o)} onChange={e => form.toggleRequirement(o, e.target.checked)} /> {o}
            </label>
          ))}
        </div>
        <FieldError form={form} prefix={p} name="design_requirement" />
      </fieldset>

      {chosen.includes(options.other_label) && (
        <div>
          <label htmlFor={fieldId(p, 'other_details')} style={requestLabel}>Please specify the design requirement *</label>
          <input {...a11y(form, p, 'other_details')} className="input-field" maxLength={1000} value={values.other_details} onChange={e => form.set('other_details', e.target.value)} />
          <FieldError form={form} prefix={p} name="other_details" />
        </div>
      )}

      {questions}

      <div>
        <label htmlFor={fieldId(p, 'delivery_date')} style={requestLabel}>Expected delivery date *</label>
        <input {...a11y(form, p, 'delivery_date')} type="date" className="input-field" min={todayISO()} value={values.delivery_date} onChange={e => form.set('delivery_date', e.target.value)} />
        <FieldError form={form} prefix={p} name="delivery_date" />
        <EstimateNote requirements={chosen} deliveryDate={values.delivery_date} />
      </div>
      <div>
        <label htmlFor={fieldId(p, 'num_creatives')} style={requestLabel}>No. of creatives required</label>
        <input {...a11y(form, p, 'num_creatives')} type="number" min={1} max={100} className="input-field" value={values.num_creatives} onChange={e => form.set('num_creatives', e.target.value)} />
        <FieldError form={form} prefix={p} name="num_creatives" />
      </div>
      <div>
        <label htmlFor={fieldId(p, 'content')} style={requestLabel}>Share content for the design creatives</label>
        <textarea id={fieldId(p, 'content')} className="input-field" rows={5} maxLength={5000} value={values.content} onChange={e => form.set('content', e.target.value)}
          placeholder="Text, links, or any other requirement. You can also describe it in the attached document." />
      </div>

      <fieldset style={noBorder}>
        <legend style={requestLabel}>Reference links (Google Drive, Canva, Figma, brand assets…)</legend>
        <div id={fieldId(p, 'links')} tabIndex={-1} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {values.links.map((link, i) => (
            <div key={i}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input {...a11y(form, p, `link:${i}`)} className="input-field" aria-label={`Reference link ${i + 1}`} placeholder="https://" maxLength={600} value={link} onChange={e => setLink(i, e.target.value)} />
                <button type="button" className="btn-ghost" aria-label={`Remove link ${i + 1}`} onClick={() => form.set('links', values.links.filter((_, j) => j !== i))}><X size={14} /></button>
              </div>
              <FieldError form={form} prefix={p} name={`link:${i}`} />
            </div>
          ))}
          <FieldError form={form} prefix={p} name="links" />
          {values.links.length < options.max_reference_links && (
            <div><button type="button" className="chip" onClick={() => form.set('links', [...values.links, ''])}><Plus size={11} /> Add a link</button></div>
          )}
        </div>
      </fieldset>

      <FileDropzone id={fieldId(p, 'files')} files={form.files} notes={form.fileNotes} maxFiles={options.max_files} maxMb={options.max_upload_mb} totalMb={options.max_request_mb}
        onAdd={form.addFiles} onRemove={form.removeFile} />
    </>
  );
}
