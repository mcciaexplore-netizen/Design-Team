import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { publicJson } from '../api';
import {
  checkNewFiles, clearDraft, clearPerson, emptyValues, fieldForServerError, fieldId, loadDraft, loadPerson, saveDraft, savePerson,
  todayISO, validate, type FieldErrors, type RequestFormOptions, type RequestPrefill, type RequestValues,
} from '../requestForm';

/** Loads the choices, questions and limits the server accepts. */
export function useRequestFormOptions() {
  const [options, setOptions] = useState<RequestFormOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    publicJson<RequestFormOptions>('/api/public/request-form').then(setOptions)
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load the form.'));
  }, []);
  return { options, error };
}

export interface Estimate { standard_ready_by: string; rush: boolean; priority: string | null }

/** The standard "ready by" date for this kind of request, and whether the requested date is a rush. Debounced. */
export function useEstimate(requirement: string, deliveryDate: string): Estimate | null {
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  useEffect(() => {
    if (!requirement) return;
    let stale = false;
    const timer = setTimeout(() => {
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) && deliveryDate >= todayISO();
      const query = `design_requirement=${encodeURIComponent(requirement)}${validDate ? `&delivery_date=${deliveryDate}` : ''}`;
      publicJson<Estimate>(`/api/public/request-form/estimate?${query}`)
        .then(r => { if (!stale) setEstimate(r); })
        .catch(() => { if (!stale) setEstimate(null); });   // the estimate is a courtesy: never block the form on it
    }, 400);
    return () => { stale = true; clearTimeout(timer); };
  }, [requirement, deliveryDate]);
  return requirement ? estimate : null;
}

interface Config {
  options: RequestFormOptions;
  idPrefix: string;
  /** Storage name of this form's draft ("public", or per signed-in user). */
  draftName: string;
  /** The public form asks for name and email; the signed-in dialog does not. */
  needsIdentity: boolean;
  /** Opening from "Request again": these answers are used instead of the saved draft. */
  prefill?: RequestPrefill | null;
}

/** All the state of a design request form: answers, files, validation, the saved draft and the remembered person. */
export function useRequestForm({ options, idPrefix, draftName, needsIdentity, prefill }: Config) {
  const [initial] = useState(() => {
    const draft = prefill ? null : loadDraft(draftName);
    const person = needsIdentity ? loadPerson() : null;
    return { values: { ...emptyValues(), ...(prefill ?? draft ?? {}), ...(person ?? {}) }, restored: !!draft, remembered: !!person };
  });
  const [values, setValues] = useState<RequestValues>(initial.values);
  const [files, setFiles] = useState<File[]>([]);
  const [fileNotes, setFileNotes] = useState<string[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<{ key: string; message: string } | null>(null);
  const [restored, setRestored] = useState(initial.restored);
  const [remembered, setRemembered] = useState(initial.remembered);
  const edited = useRef(false);   // nothing is saved until the person changes something
  const finished = useRef(false); // set after a successful submit so the cleared draft is not written back

  const change = useCallback((fn: (v: RequestValues) => RequestValues) => {
    edited.current = true;
    setServerError(null);
    setValues(fn);
  }, []);

  const set = useCallback(<K extends keyof RequestValues>(key: K, value: RequestValues[K]) => {
    change(v => (key === 'design_requirement' ? { ...v, [key]: value, details: {} } : { ...v, [key]: value }));
  }, [change]);
  const setDetail = useCallback((id: string, value: string | string[]) => change(v => ({ ...v, details: { ...v.details, [id]: value } })), [change]);

  // Autosave the draft shortly after the last change, and once more when the form closes.
  const latest = useRef(values);
  latest.current = values;
  useEffect(() => {
    if (!edited.current) return;
    const timer = setTimeout(() => { if (!finished.current) saveDraft(draftName, values); }, 600);
    return () => clearTimeout(timer);
  }, [values, draftName]);
  useEffect(() => () => { if (edited.current && !finished.current) saveDraft(draftName, latest.current); }, [draftName]);

  const clientErrors = useMemo(() => (attempted ? validate(values, options, needsIdentity) : {}), [attempted, values, options, needsIdentity]);
  const errors: FieldErrors = serverError ? { ...clientErrors, [serverError.key]: serverError.message } : clientErrors;
  const summary = Object.entries(errors).map(([key, message]) => ({ key, message }));

  const focusField = useCallback((key: string) => document.getElementById(fieldId(idPrefix, key))?.focus(), [idPrefix]);

  /** Checks everything; on problems shows them, moves focus to the first one and returns false. */
  const validateAll = (): boolean => {
    setAttempted(true);
    const found = Object.keys(validate(values, options, needsIdentity));
    if (found.length) focusField(found[0]);
    return found.length === 0;
  };

  /** Show a server message beside the field it is about. Returns the message back when it is not about one field. */
  const showServerError = (message: string): string | null => {
    const key = fieldForServerError(message, values, options);
    if (!key) return message;
    setServerError({ key, message });
    focusField(key);
    return null;
  };

  const addFiles = (incoming: File[]) => {
    const { ok, notes } = checkNewFiles(files, incoming, options);
    setFiles(prev => [...prev, ...ok]);
    setFileNotes(notes);
  };
  const removeFile = (index: number) => { setFiles(prev => prev.filter((_, i) => i !== index)); setFileNotes([]); };

  const discardDraft = () => {
    clearDraft(draftName);
    edited.current = false;
    setValues(v => ({ ...emptyValues(), name: v.name, email: v.email }));
    setRestored(false);
  };

  const forgetPerson = () => {
    clearPerson();
    change(v => ({ ...v, name: '', email: '' }));
    setRemembered(false);
  };

  /** Call after the server accepted the request: forget the draft and, on the public form, remember who submitted. */
  const submitted = () => {
    finished.current = true;
    clearDraft(draftName);
    if (needsIdentity) savePerson(values.name.trim(), values.email.trim());
  };

  /** Back to a blank form (for "Submit another request"). The remembered person stays filled in. */
  const reset = () => {
    finished.current = false;
    edited.current = false;
    setValues(v => ({ ...emptyValues(), name: v.name, email: v.email }));
    setFiles([]); setFileNotes([]); setAttempted(false); setServerError(null); setRestored(false);
    setRemembered(needsIdentity && !!loadPerson());
  };

  return {
    values, set, setDetail, files, addFiles, removeFile, fileNotes, errors, summary, focusField, validateAll, showServerError,
    restored, discardDraft, remembered, forgetPerson, submitted, reset,
  };
}

export type RequestForm = ReturnType<typeof useRequestForm>;
