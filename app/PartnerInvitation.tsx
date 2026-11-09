"use client";
import { useEffect, useState } from 'react';
import type { Language } from './i18n';
import { capturePartnerInvitation, loadPartnerInvitation, type PartnerInvitationStatus } from './partner-api';
import { partnerText } from './partner-copy';
import './partners.css';

export function PartnerInvitation({ language, onBusyChange }: { language: Language; onBusyChange: (busy: boolean) => void }) {
  const [status, setStatus] = useState<PartnerInvitationStatus | null>(null), [code, setCode] = useState(''), [busy, setBusy] = useState(false);
  const [error, setError] = useState<'invalid' | 'error' | null>(null), [attempt, setAttempt] = useState(0);
  useEffect(() => { const controller = new AbortController(); let active = true;
    void (async () => {
      const next = await loadPartnerInvitation(controller.signal); if (!active) return; setStatus(next); setError(null);
      const referral = new URL(window.location.href).searchParams.get('ref');
      if (!next.enabled || !referral || referral.length > 100) return;
      setBusy(true); onBusyChange(true);
      try { const result = await capturePartnerInvitation(referral); if (active) setStatus({ ...next, invitation: result.invitation }); }
      catch (error) { if (active) setError(/PARTNER_CODE/.test(String(error)) ? 'invalid' : 'error'); }
      finally { if (active) { setBusy(false); onBusyChange(false); } }
    })().catch(() => { if (active && new URL(window.location.href).searchParams.has('ref')) setError('error'); });
    return () => { active = false; controller.abort(); onBusyChange(false); };
  }, [onBusyChange, attempt]);
  if (!status?.enabled && !error) return null;
  if (!status?.enabled) return <div className="partner-invitation" data-no-translate><p role="alert">{partnerText('error', language)}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>{partnerText('retry', language)}</button></div>;
  return <details className="partner-invitation" open={Boolean(status.invitation || error)} data-no-translate><summary>{partnerText('code', language)}</summary>
    {status.invitation ? <p role="status">{partnerText('invitationSaved', language)}: {status.invitation.label}</p> : <form onSubmit={event => {
      event.preventDefault(); if (busy) return; setBusy(true); onBusyChange(true); setError(null);
      void capturePartnerInvitation(code.trim()).then(result => setStatus({ ...status, invitation: result.invitation })).catch(error => setError(/PARTNER_CODE/.test(String(error)) ? 'invalid' : 'error'))
        .finally(() => { setBusy(false); onBusyChange(false); });
    }}><label className="partner-field"><span>{partnerText('code', language)}</span><input autoComplete="off" required maxLength={100} value={code} disabled={busy} onChange={event => setCode(event.target.value)} /></label>
      <button type="submit" disabled={busy}>{partnerText('useCode', language)}</button></form>}
    <p>{partnerText('crossDeviceHelp', language)}</p>{error && <p role="alert">{partnerText(error, language)}</p>}
  </details>;
}
