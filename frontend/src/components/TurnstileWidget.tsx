import { useEffect, useRef } from 'react';

interface TurnstileApi {
  render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void }) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
}
declare global { interface Window { turnstile?: TurnstileApi } }

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error('Could not load the verification check.')); };
    document.head.appendChild(s);
  });
  return loading;
}

interface Props { siteKey: string; onToken: (token: string) => void; resetSignal?: number }

/** Cloudflare Turnstile CAPTCHA. Calls onToken with the response token, or '' when it expires or fails. */
export default function TurnstileWidget({ siteKey, onToken, resetSignal = 0 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    let cancelled = false;
    loadScript().then(() => {
      if (cancelled || !host.current || !window.turnstile) return;
      widget.current = window.turnstile.render(host.current, {
        sitekey: siteKey,
        callback: t => cb.current(t),
        'expired-callback': () => cb.current(''),
        'error-callback': () => cb.current(''),
      });
    }).catch(() => cb.current(''));
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetSignal && widget.current && window.turnstile) { window.turnstile.reset(widget.current); cb.current(''); }
  }, [resetSignal]);

  return <div ref={host} />;
}
