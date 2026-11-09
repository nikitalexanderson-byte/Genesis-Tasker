import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { physisNumber } from './types';
export function NumberField({ label, value, onChange, min = 0, max = 1e9, required = false }: {
  label: string; value: number | null; onChange: (value: number | null) => void; min?: number; max?: number; required?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (value === null ? '' : String(value));
  const invalid = text !== '' && physisNumber(text, min, max) === null;
  return <label className="physis-field">{label}<input inputMode="decimal" type="text" required={required} value={text} aria-invalid={invalid || undefined}
    onChange={event => { const input = event.target.value; event.currentTarget.setCustomValidity(input !== '' && physisNumber(input, min, max) === null ? `Введите число от ${min} до ${max}.` : ''); setDraft(input); if (input === '' || physisNumber(input, min, max) !== null) onChange(input === '' ? null : physisNumber(input, min, max)); }}
    onBlur={() => { if (!invalid) setDraft(null); }} />{invalid ? <span className="physis-muted">Введите число от {min} до {max}.</span> : null}</label>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="physis-field">{label}{children}</label>; }
export function usePhysisAction() {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = async (action: () => Promise<unknown>) => {
    if (running.current) return;
    running.current = true;
    setError(''); setBusy(true);
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : 'Не удалось выполнить действие.'); }
    finally { running.current = false; setBusy(false); }
  };
  return { error, busy, run, setError };
}
