'use client';

import { useRef, useState } from 'react';
import { PILL_BLUE } from '../../components/site/ui';
import type { STRIPE_TEXT } from '../../../lib/earnkit/stripe';

/** v4.6: the paste step. A same-origin POST to /connect/stripe; the key is cleared from the field once sent. */
export default function StripeForm({ token, text }: { token: string; text: typeof STRIPE_TEXT }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const H1 = 'ek-serif text-[44px] leading-none text-s-text md:text-[56px]';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const key = field.current?.value ?? '';
    if (!key.trim()) return;
    setBusy(true);
    setStatus('');
    try {
      const r = await fetch('/connect/stripe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: token, key }) });
      if (field.current) field.current.value = '';
      const j = (await r.json()) as { line?: string };
      if (r.ok) {
        setDone(j.line ?? text.saved);
        requestAnimationFrame(() => doneRef.current?.focus());
        return;
      }
      setStatus(j.line || text.failed);
    } catch {
      if (field.current) field.current.value = '';
      setStatus(text.failed);
    }
    setBusy(false);
  }

  if (done !== null)
    return (
      <div data-ek-stripe-done="" className="flex flex-col gap-4">
        <h1 id="stripe-title" ref={doneRef} tabIndex={-1} className={`${H1} outline-none`}>
          {text.doneTitle}
        </h1>
        <p className="text-[17px] leading-relaxed text-s-card-body md:text-[19px]">{done}</p>
      </div>
    );
  return (
    <form onSubmit={submit} className="flex flex-col gap-5" autoComplete="off">
      <h1 id="stripe-title" className={H1}>
        {text.title}
      </h1>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-[17px] leading-relaxed text-s-card-body md:text-[19px]">
        {text.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <label className="flex flex-col gap-2 text-[15px] text-s-card-body">
        {text.label}
        <input
          ref={field} type="text" name="stripe-read-key" required spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off"
          data-1p-ignore data-lpignore="true" data-form-type="other" placeholder={text.placeholder}
          style={{ WebkitTextSecurity: 'disc' } as React.CSSProperties}
          className="min-h-11 rounded-xl border border-s-chip-line bg-transparent px-4 text-[16px] text-s-text"
        />
      </label>
      <button type="submit" disabled={busy} className={`${PILL_BLUE} disabled:opacity-60`}>
        {text.button}
      </button>
      <p role="status" aria-live="polite" className="min-h-6 text-[15px] text-s-card-body">
        {status}
      </p>
    </form>
  );
}
