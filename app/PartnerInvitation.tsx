"use client";
import { useEffect, useState } from 'react';
import type { Language } from './i18n';
import { referralApi } from './cloud-sync';
import { capturePartnerInvitation, loadPartnerInvitation, type PartnerInvitationStatus } from './partner-api';
import { partnerText } from './partner-copy';
import copy from './referral-copy.json';
import './partners.css';

export function PartnerInvitation({ language, onBusyChange }: { language: Language; onBusyChange: (busy: boolean) => void }) {
  const c = copy[language];
  const [status, setStatus] = useState<PartnerInvitationStatus | null>(null), [accepted, setAccepted] = useState(false), [code, setCode] = useState(''), [busy, setBusy] = useState(false);
  const [error, setError] = useState<'invalid' | 'error' | null>(null), [attempt, setAttempt] = useState(0);
  useEffect(() => { const controller = new AbortController(); let active = true;
    const params = new URL(window.location.href).searchParams, referral = params.get('invite') ?? params.get('ref');
    void (async () => {
      const results = await Promise.allSettled([loadPartnerInvitation(controller.signal), referralApi<{accepted:boolean}>('/referrals/invitation',{signal:controller.signal})]);
      if (!active) return;
      const next = results[0].status === 'fulfilled' ? results[0].value : {enabled:false,invitationDays:null,invitation:null};
      const saved = results[1].status === 'fulfilled' && results[1].value.accepted;
      setStatus(next); setAccepted(saved); setError(null);
      if (!referral || referral.length > 100 || saved || next.invitation) return;
      setBusy(true); onBusyChange(true);
      try {
        if(referral.startsWith('g_')) {const result=await referralApi<{accepted:boolean}>('/referrals/invitation',{method:'POST',body:JSON.stringify({code:referral}),signal:controller.signal});if(active)setAccepted(result.accepted);}
        else { const result = await capturePartnerInvitation(referral); if (active) setStatus({ ...next, invitation: result.invitation }); }
      }
      catch (error) { if (active) setError(/PARTNER_CODE/.test(String(error)) ? 'invalid' : 'error'); }
      finally { if (active) { setBusy(false); onBusyChange(false); } }
    })().catch(() => { if (active) setError('error'); }).finally(()=>{if(active){setBusy(false);onBusyChange(false);}});
    return () => { active = false; controller.abort(); onBusyChange(false); };
  }, [onBusyChange, attempt]);
  return <details className="partner-invitation" open={Boolean(accepted || status?.invitation || error)} data-no-translate><summary>{c.invitation}</summary>
    {accepted || status?.invitation ? <p role="status">{accepted ? c.saved : `${partnerText('invitationSaved', language)}: ${status?.invitation?.label}`}</p> : <form onSubmit={event => {
      event.preventDefault(); if (busy) return; setBusy(true); onBusyChange(true); setError(null);
      void (async()=>{if(code.trim().startsWith('g_')) {const result=await referralApi<{accepted:boolean}>('/referrals/invitation',{method:'POST',body:JSON.stringify({code:code.trim()})});setAccepted(result.accepted);}
      else {const result=await capturePartnerInvitation(code.trim());setStatus({enabled:true,invitationDays:status?.invitationDays??null,invitation:result.invitation});}})().catch(error => setError(/(?:PARTNER|REFERRAL)_CODE/.test(String(error)) ? 'invalid' : 'error'))
        .finally(() => { setBusy(false); onBusyChange(false); });
    }}><label className="partner-field"><span>{c.code}</span><input autoComplete="off" required maxLength={100} value={code} disabled={busy} onChange={event => setCode(event.target.value)} /></label>
      <button type="submit" disabled={busy}>{c.apply}</button></form>}
    <p>{partnerText('crossDeviceHelp', language)}</p>{error && <><p role="alert">{partnerText(error, language)}</p><button type="button" disabled={busy} onClick={()=>setAttempt(value=>value+1)}>{c.retry}</button></>}
  </details>;
}
