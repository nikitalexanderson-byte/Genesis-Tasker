"use client";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { billingPlanName } from './billing';
import type { Language } from './i18n';
import { partnerText, type PartnerCopyKey } from './partner-copy';
import { loadPartnerDashboard, loadPartners, lookupPartner, lookupPartnerClient, mutatePartner, partnerDecimal, partnerMinor,
  type PartnerDashboard, type PartnerFilters, type PartnerList, type PartnerPayment, type PartnerPayout, type PartnerTarget, type PartnerClientTarget } from './partner-api';
import './partners.css';

type Copy = (key: PartnerCopyKey) => string;
type Mutation = ReturnType<typeof usePartnerMutation>;
const blankFilters: PartnerFilters = { from: '', to: '', offset: 0 };
const auditLabels: Record<string, PartnerCopyKey> = { 'partner-assigned':'assign', 'availability-changed':'saveAccess',
  'external-payout-recorded':'recordPayout', 'payout-corrected':'correction', 'actual-costs-confirmed':'confirmCosts',
  'estimated-costs-recorded':'saveEstimate', 'client-binding-ended':'bindingEnded', 'client-manually-bound-forward-only':'manualAttribution' };
const money = (amount: number | null, language: Language) => amount === null ? '—' : new Intl.NumberFormat(language, { style: 'currency', currency: 'RUB' }).format(amount / 100);
const date = (value: string | null, language: Language) => value ? new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) : '—';
const failure = (error: unknown): PartnerCopyKey => /CONFLICT|CHANGED|ALREADY_ASSIGNED/.test(String(error)) ? 'conflict'
  : /INVALID|CONFIRMATION_REQUIRED|NEW_ACCOUNT_ONLY|SELF_REFERRAL/.test(String(error)) ? 'invalid'
  : /FORBIDDEN|DISABLED|ACCESS_DENIED|NOT_APPROVED|NOT_FOUND|ACCOUNT_REQUIRED/.test(String(error)) ? 'unavailable' : 'error';

/** Keep an uncertain operation intact: retry reuses the exact body and request ID. */
function usePartnerMutation(language: Language, refresh: () => void) {
  const operation = useRef<{ path: string; input: Record<string, unknown>; onSuccess?: () => void } | null>(null);
  const locking = useRef(false);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [feedback, setFeedback] = useState<PartnerCopyKey | null>(null);
  const send = async () => {
    if (locking.current || !operation.current) return false;
    locking.current = true; setBusy(true); setFeedback(null);
    try {
      const completed = operation.current;
      await mutatePartner(completed.path, completed.input);
      operation.current = null; setUncertain(false); setFeedback('saved'); completed.onSuccess?.(); refresh(); return true;
    } catch (error) {
      const key = failure(error); setFeedback(key);
      if (key === 'error') setUncertain(true);
      else { operation.current = null; setUncertain(false); refresh(); }
      return false;
    } finally { locking.current = false; setBusy(false); }
  };
  return { busy, locked: busy || uncertain,
    run: (path: string, input: Record<string, unknown>, onSuccess?: () => void) => {
      if (operation.current) return Promise.resolve(false);
      operation.current = { path, input: { ...input, requestId: crypto.randomUUID() }, onSuccess }; return send();
    },
    feedback: <div className="partner-feedback" aria-live="polite">{feedback && <p role={feedback === 'saved' ? 'status' : 'alert'}>{partnerText(feedback, language)}</p>}
      {uncertain && <button type="button" disabled={busy} onClick={() => void send()}>{partnerText('retry', language)}</button>}</div> };
}

function Field({ title, children }: { title: string; children: ReactNode }) {
  return <label className="partner-field"><span>{title}</span>{children}</label>;
}
function Empty({ t }: { t: Copy }) { return <p className="partner-empty">{t('empty')}</p>; }

function CopyValue({ value, title, t }: { value: string; title: string; t: Copy }) {
  const [copied, setCopied] = useState(false), [failed, setFailed] = useState(false);
  return <div className="partner-copy"><Field title={title}><input readOnly value={value} onFocus={event => event.currentTarget.select()} /></Field>
    <button type="button" onClick={() => { void navigator.clipboard.writeText(value).then(() => { setCopied(true); setFailed(false); }).catch(() => setFailed(true)); }}>{copied ? t('copied') : t('copy')}</button>
    {failed && <span role="alert">{t('error')}</span>}</div>;
}

function CostForm({ payment, partnerId, mutation, t }: { payment: PartnerPayment; partnerId: string; mutation: Mutation; t: Copy }) {
  const [fee, setFee] = useState(partnerDecimal(payment.feeMinor)), [tax, setTax] = useState(partnerDecimal(payment.taxMinor)), [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const confirmed = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'confirmed';
    const feeMinor = fee.trim() ? partnerMinor(fee) : null, taxMinor = tax.trim() ? partnerMinor(tax) : null;
    if ((fee.trim() && feeMinor === null) || (tax.trim() && taxMinor === null) || (confirmed && (feeMinor === null || taxMinor === null))) { setInvalid(true); return; }
    setInvalid(false); void mutation.run(`/${partnerId}/payments/${payment.id}/calculation`, { expectedRevision: payment.revision, feeMinor, taxMinor, confirmed, reason });
  };
  return <details className="partner-actions"><summary>{t('editCosts')}</summary><form onSubmit={submit}><fieldset disabled={mutation.locked}>
    <div className="partner-form-grid"><Field title={t('fee')}><input inputMode="decimal" value={fee} placeholder={t('unknown')} onChange={event => setFee(event.target.value)} /></Field>
      <Field title={t('tax')}><input inputMode="decimal" value={tax} placeholder={t('unknown')} onChange={event => setTax(event.target.value)} /></Field></div>
    <Field title={t('reason')}><textarea required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></Field>
    <div className="partner-buttons"><button type="submit" value="estimate">{t('saveEstimate')}</button><button type="submit" value="confirmed">{t('confirmCosts')}</button></div>
    {invalid && <p role="alert">{t('invalid')}</p>}</fieldset></form></details>;
}

function PayoutForm({ dashboard, mutation, t }: { dashboard: PartnerDashboard; mutation: Mutation; t: Copy }) {
  const [amount, setAmount] = useState(''), [paidOn, setPaidOn] = useState(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }));
  const [note, setNote] = useState(''), [checked, setChecked] = useState(false), [invalid, setInvalid] = useState(false);
  return <details className="partner-actions"><summary>{t('recordPayout')}</summary><p>{t('payoutHelp')}</p>
    <form onSubmit={event => { event.preventDefault(); const amountMinor = partnerMinor(amount); if (amountMinor === null || amountMinor <= 0) { setInvalid(true); return; }
      setInvalid(false); void mutation.run(`/${dashboard.partner.id}/payouts`, { expectedRevision: dashboard.partner.revision, amountMinor, paidOn, note, alreadyPaid: checked },
        () => { setAmount(''); setNote(''); setChecked(false); }); }}><fieldset disabled={mutation.locked}>
      <div className="partner-form-grid"><Field title={`${t('amount')} · RUB`}><input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></Field>
        <Field title={t('date')}><input type="date" required value={paidOn} onChange={event => setPaidOn(event.target.value)} /></Field></div>
      <Field title={t('note')}><textarea maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></Field>
      <label className="partner-check"><input type="checkbox" required checked={checked} onChange={event => setChecked(event.target.checked)} />{t('alreadyPaid')}</label>
      <button type="submit">{t('recordPayout')}</button>{invalid && <p role="alert">{t('invalid')}</p>}
    </fieldset></form></details>;
}

function PayoutCorrection({ payout, dashboard, mutation, t }: { payout: PartnerPayout; dashboard: PartnerDashboard; mutation: Mutation; t: Copy }) {
  const [amount, setAmount] = useState(''), [reason, setReason] = useState(''), [invalid, setInvalid] = useState(false);
  return <details className="partner-actions"><summary>{t('correction')}</summary><form onSubmit={event => {
    event.preventDefault(); const deltaMinor = partnerMinor(amount, true); if (deltaMinor === null || deltaMinor === 0) { setInvalid(true); return; }
    setInvalid(false); void mutation.run(`/${dashboard.partner.id}/payouts/${payout.id}/corrections`, { expectedRevision: dashboard.partner.revision, deltaMinor, reason }, () => { setAmount(''); setReason(''); });
  }}><fieldset disabled={mutation.locked}><Field title={`${t('delta')} · RUB`}><input required inputMode="text" value={amount} onChange={event => setAmount(event.target.value)} /></Field>
    <Field title={t('reason')}><textarea required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></Field>
    <button type="submit">{t('saveCorrection')}</button>{invalid && <p role="alert">{t('invalid')}</p>}</fieldset></form></details>;
}

function OwnerAccess({ dashboard, mutation, t }: { dashboard: PartnerDashboard; mutation: Mutation; t: Copy }) {
  const [acceptsInvitations, setInvites] = useState(dashboard.partner.acceptsInvitations), [panelEnabled, setPanel] = useState(dashboard.partner.panelEnabled), [reason, setReason] = useState('');
  return <details className="partner-actions"><summary>{t('saveAccess')}</summary><p>{t('availabilityHelp')}</p><form onSubmit={event => { event.preventDefault();
    void mutation.run(`/${dashboard.partner.id}/availability`, { expectedRevision: dashboard.partner.revision, acceptsInvitations, panelEnabled, reason });
  }}><fieldset disabled={mutation.locked}><label className="partner-check"><input type="checkbox" checked={acceptsInvitations} disabled={!dashboard.partner.accountAvailable} onChange={event => setInvites(event.target.checked)} />{t('invitesEnabled')}</label>
    <label className="partner-check"><input type="checkbox" checked={panelEnabled} onChange={event => setPanel(event.target.checked)} />{t('panelEnabled')}</label>
    <Field title={t('reason')}><textarea required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></Field>
    <button type="submit">{t('saveAccess')}</button></fieldset></form></details>;
}

function ManualBinding({ dashboard, mutation, t }: { dashboard: PartnerDashboard; mutation: Mutation; t: Copy }) {
  const [email, setEmail] = useState(''), [target, setTarget] = useState<PartnerClientTarget | null>(null), [reason, setReason] = useState('');
  const [looking, setLooking] = useState(false), [error, setError] = useState<PartnerCopyKey | null>(null);
  return <details className="partner-actions"><summary>{t('manualAttribution')}</summary><p>{t('forwardOnly')}</p>
    <form onSubmit={event => { event.preventDefault(); if (looking) return; setLooking(true); setError(null); setTarget(null);
      void lookupPartnerClient(email).then(result => setTarget(result.user)).catch(error => setError(failure(error))).finally(() => setLooking(false)); }}>
      <Field title={t('existingEmail')}><input required type="email" value={email} disabled={mutation.locked} onChange={event => { setEmail(event.target.value); setTarget(null); }} /></Field>
      <button type="submit" disabled={looking || mutation.locked}>{t('findAccount')}</button></form>
    {error && <p role="alert">{t(error)}</p>}{target && <form onSubmit={event => { event.preventDefault(); void mutation.run(`/${dashboard.partner.id}/clients`, {
      userId: target.id, expectedClientId: target.binding?.id ?? null, reason, noHistoricalAccrual: true }); }}><fieldset disabled={mutation.locked}>
      <p>{target.displayName} · {target.email}{target.binding ? ` · ${target.binding.label}` : ''}</p>
      <Field title={t('reason')}><textarea required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></Field>
      <label className="partner-check"><input type="checkbox" required />{t('forwardOnly')}</label><button type="submit">{t('applyBinding')}</button></fieldset></form>}
  </details>;
}

export function PartnerDashboardView({ language, adminId, onChanged }: { language: Language; adminId?: string; onChanged?: () => void }) {
  const t: Copy = key => partnerText(key, language);
  const [filters, setFilters] = useState<PartnerFilters>(blankFilters), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [version, setVersion] = useState(0), [dashboard, setDashboard] = useState<PartnerDashboard | null>(null), [error, setError] = useState<PartnerCopyKey | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = () => { setLoading(true); setError(null); setVersion(value => value + 1); onChanged?.(); };
  const applyFilters = (next: PartnerFilters) => { setLoading(true); setError(null); setFilters(next); };
  const mutation = usePartnerMutation(language, refresh);
  useEffect(() => { const controller = new AbortController();
    void loadPartnerDashboard(filters, adminId, controller.signal).then(result => { if (!controller.signal.aborted) setDashboard(result); })
      .catch(error => { if (!controller.signal.aborted) { setDashboard(null); setError(failure(error)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort();
  }, [filters, adminId, version]);
  if (error) return <div className="partner-state" role="alert"><p>{t(error)}</p><button type="button" onClick={refresh}>{t('retry')}</button></div>;
  if (!dashboard) return <p role="status">{t('loading')}</p>;
  const { partner, totals } = dashboard;
  const summary: [PartnerCopyKey, string][] = [['visits', String(totals.visits)], ['registrations', String(totals.registrations)], ['paying', String(totals.payingClients)],
    ['received', money(totals.receivedMinor, language)], ['refunds', money(totals.refundedMinor, language)], ['confirmedShare', money(totals.confirmedShareMinor, language)],
    ['preliminary', `${money(totals.preliminaryShareMinor, language)}${totals.unknownPreliminaryCount ? ` · ${t('unknown')}: ${totals.unknownPreliminaryCount}` : ''}`],
    ['paid', money(totals.paidMinor, language)], ['balance', money(totals.confirmedBalanceMinor, language)], ['held', money(totals.heldMinor, language)],
    ['pendingAdjustment', money(totals.pendingAdjustmentMinor, language)], ['payable', money(totals.payableMinor, language)]];
  return <div className="partner-dashboard" aria-busy={loading} data-no-translate>
    <header className="partner-heading"><h2>{partner.label}</h2><span className="partner-status">{t('share')}</span></header>
    <p role="note">{t('channelHelp')}</p>
    <section className="partner-card"><CopyValue value={partner.link} title={t('link')} t={t} /><CopyValue value={partner.code} title={t('code')} t={t} />
      <p>{t('statisticsHelp')}</p><p>{t('crossDeviceHelp')}</p>{!partner.acceptsInvitations && <p>{t('availabilityHelp')}</p>}</section>
    <section aria-label={t('allTime')}><h3>{t('allTime')}</h3><dl className="partner-totals">{summary.map(([key, value]) => <div className={key === 'payable' ? 'partner-total-primary' : ''} key={key}><dt>{t(key)}</dt><dd>{value}</dd></div>)}</dl></section>
    <details className="partner-card"><summary>{t('base')}</summary><p>{t('formulaHelp')}</p><p>{t('taxHelp')}</p><p>{t('pendingHelp')}</p><p>{t('refundHelp')}</p><p>{t('channelHelp')}</p><p>{t('indefinite')}</p></details>
    {adminId && <section className="partner-card partner-owner-tools">{mutation.feedback}
      <OwnerAccess key={`access:${partner.revision}`} dashboard={dashboard} mutation={mutation} t={t} />
      <PayoutForm dashboard={dashboard} mutation={mutation} t={t} /><ManualBinding dashboard={dashboard} mutation={mutation} t={t} /></section>}
    <form className="partner-filter" onSubmit={event => { event.preventDefault(); applyFilters({ from, to, offset: 0 }); }}>
      <Field title={t('from')}><input type="date" value={from} onChange={event => setFrom(event.target.value)} /></Field>
      <Field title={t('to')}><input type="date" value={to} min={from || undefined} onChange={event => setTo(event.target.value)} /></Field><button disabled={loading} type="submit">{t('filter')}</button></form>
    <section className="partner-section" aria-label={t('purchases')}><h3>{t('purchases')}</h3>{!dashboard.payments.length && <Empty t={t} />}
      <div className="partner-records">{dashboard.payments.map(payment => <article className="partner-card" key={payment.id}>
        <header><strong>{payment.clientAlias}</strong><time dateTime={payment.confirmedAt}>{date(payment.confirmedAt, language)}</time></header>
        <p>{t('package')}: {billingPlanName(payment.plan)} · {payment.periodMonths ? `${payment.periodMonths} ${t('months')}` : t('lifetime')}</p><span className={`partner-status ${payment.state}`}>{t(payment.state)}</span>
        <dl className="partner-operation">{([['received', payment.amountMinor], ['refunds', payment.refundedMinor], ['fee', payment.feeMinor], ['tax', payment.taxMinor], ['base', payment.baseMinor], ['share', payment.shareMinor]] as const)
          .map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{money(value, language)}</dd></div>)}</dl>
        {adminId && <CostForm key={`${payment.id}:${payment.revision}`} payment={payment} partnerId={partner.id} mutation={mutation} t={t} />}</article>)}</div></section>
    <section className="partner-section" aria-label={t('clients')}><h3>{t('clients')}</h3>{!dashboard.clients.length && <Empty t={t} />}
      <div className="partner-records">{dashboard.clients.map(client => <article className="partner-card" key={client.id}><header><strong>{client.alias}</strong><time dateTime={client.boundAt}>{date(client.boundAt, language)}</time></header>
        <p>{t('purchases')}: {client.payments} · {date(client.lastPaymentAt, language)}</p>{client.accountDeleted && <span>{t('deleted')}</span>}{client.endedAt && <p>{t('bindingEnded')}: {date(client.endedAt, language)}</p>}</article>)}</div></section>
    <section className="partner-section" aria-label={t('history')}><h3>{t('history')}</h3>{!dashboard.history.length && <Empty t={t} />}
      <div className="partner-records">{dashboard.history.map(item => <article className="partner-card" key={item.id}><header><strong>{item.clientAlias} · {t(item.state)} · {item.revision}</strong><time dateTime={item.createdAt}>{date(item.createdAt, language)}</time></header>
        <p>{billingPlanName(item.plan)} · {date(item.paymentConfirmedAt, language)}</p>
        <dl className="partner-operation">{([['fee', item.feeMinor], ['tax', item.taxMinor], ['refunds', item.refundedMinor], ['base', item.baseMinor], ['share', item.shareMinor]] as const)
          .map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{money(value, language)}</dd></div>)}</dl>
        <p>{item.systemReason ? t(item.kind === 'refund' ? 'refundHelp' : 'pendingHelp') : item.reason || t('correction')}</p></article>)}</div></section>
    <section className="partner-section" aria-label={t('payouts')}><h3>{t('payouts')}</h3>{!dashboard.payouts.length && <Empty t={t} />}
      <div className="partner-records">{dashboard.payouts.map(payout => <article className="partner-card" key={payout.id}><header><strong>{money(payout.amountMinor, language)}</strong><time dateTime={payout.paidOn}>{date(payout.paidOn, language)}</time></header>
        {payout.note && <p>{payout.note}</p>}{payout.corrections.map(correction => <p key={correction.id}>{t('correction')}: {money(correction.deltaMinor, language)} · {date(correction.createdAt, language)}{correction.reason && ` · ${correction.reason}`}</p>)}
        {payout.corrections.length > 0 && <strong>{t('paid')}: {money(payout.correctedMinor, language)}</strong>}
        {adminId && <PayoutCorrection payout={payout} dashboard={dashboard} mutation={mutation} t={t} />}</article>)}</div></section>
    {adminId && <section className="partner-section"><h3>{t('audit')}</h3>{!dashboard.audit.length && <Empty t={t} />}{dashboard.audit.map(item => <article className="partner-card" key={item.id}><header><strong>{t(auditLabels[item.action] ?? 'audit')}</strong><time dateTime={item.createdAt}>{date(item.createdAt, language)}</time></header>{item.action !== 'partner-assigned' && <p>{item.reason}</p>}</article>)}</section>}
    <nav className="partner-buttons" aria-label={t('history')}><button type="button" disabled={loading || filters.offset === 0} onClick={() => applyFilters({ ...filters, offset: Math.max(0, filters.offset - 25) })}>{t('previous')}</button>
      <span>{filters.offset / 25 + 1}</span><button type="button" disabled={loading || !dashboard.page.hasMore} onClick={() => applyFilters({ ...filters, offset: filters.offset + 25 })}>{t('next')}</button></nav>
  </div>;
}

export function AdminPartnersPanel({ language }: { language: Language }) {
  const t: Copy = key => partnerText(key, language);
  const [list, setList] = useState<PartnerList | null>(null), [version, setVersion] = useState(0), [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<PartnerCopyKey | null>(null), [days, setDays] = useState('30'), [confirmed, setConfirmed] = useState(false);
  const [email, setEmail] = useState(''), [label, setLabel] = useState(''), [target, setTarget] = useState<PartnerTarget | null>(null), [looking, setLooking] = useState(false);
  const refresh = () => { setError(null); setVersion(value => value + 1); };
  const mutation = usePartnerMutation(language, refresh);
  useEffect(() => { const controller = new AbortController();
    void loadPartners(controller.signal).then(result => { if (!controller.signal.aborted) { setList(result); setDays(String(result.settings.invitationDays)); } })
      .catch(error => { if (!controller.signal.aborted) setError(failure(error)); }); return () => controller.abort();
  }, [version]);
  if (selected) return <div className="partners-page" data-no-translate><button type="button" onClick={() => setSelected(null)}>← {t('partners')}</button>
    <PartnerDashboardView key={selected} language={language} adminId={selected} onChanged={refresh} /></div>;
  return <section className="partners-page" aria-label={t('partners')} data-no-translate><h2>{t('partners')}</h2>{mutation.feedback}
    {error && <div role="alert"><p>{t(error)}</p><button type="button" onClick={refresh}>{t('retry')}</button></div>}
    {!list && !error && <p role="status">{t('loading')}</p>}{list && <>
      <details className="partner-card" open={!list.settings.confirmed}><summary>{t('policy')}</summary><p>{t('share')}</p><p>{t('indefinite')}</p><p>{t('crossDeviceHelp')}</p>
        <form onSubmit={event => { event.preventDefault(); void mutation.run('/policy', { expectedRevision: list.settings.revision, invitationDays: Number(days), retentionDays: null, confirmed }); }}><fieldset disabled={mutation.locked}>
          <Field title={t('invitationDays')}><input type="number" required min={1} max={365} step={1} value={days} onChange={event => setDays(event.target.value)} /></Field>
          <label className="partner-check"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t('confirmPolicy')}</label><button type="submit">{t('savePolicy')}</button></fieldset></form></details>
      <details className="partner-card"><summary>{t('assign')}</summary><form onSubmit={event => { event.preventDefault(); if (looking) return; setLooking(true); setError(null); setTarget(null);
        void lookupPartner(email).then(result => { setTarget(result.user); setLabel(result.user.displayName); }).catch(error => setError(failure(error))).finally(() => setLooking(false)); }}>
        <Field title={t('existingEmail')}><input type="email" required value={email} list="partner-approved-emails" disabled={mutation.locked} onChange={event => { setEmail(event.target.value); setTarget(null); }} /></Field>
        <datalist id="partner-approved-emails">{list.approvedEmails.map(value => <option key={value} value={value} />)}</datalist><button type="submit" disabled={looking || mutation.locked}>{t('findAccount')}</button></form>
        {target && <form onSubmit={event => { event.preventDefault(); void mutation.run('', { userId: target.id, email: target.email, label }); }}><fieldset disabled={mutation.locked}><p>{target.email}</p>
          <Field title={t('label')}><input required maxLength={120} value={label} onChange={event => setLabel(event.target.value)} /></Field><button type="submit">{t('assign')}</button></fieldset></form>}</details>
      {!list.partners.length && <Empty t={t} />}<div className="partner-records">{list.partners.map(partner => <article className="partner-card" key={partner.id}>
        <h3>{partner.label}</h3><p>{t('registrations')}: {partner.totals.registrations} · {t('paying')}: {partner.totals.payingClients}</p><p>{t('payable')}: <strong>{money(partner.totals.payableMinor, language)}</strong></p>
        <button type="button" onClick={() => setSelected(partner.id)}>{t('open')}</button></article>)}</div></>}
  </section>;
}

export function PartnerPage({ language, onBack }: { language: Language; onBack: () => void }) {
  return <section className="partners-page" data-exp-layout="view" data-no-translate><header className="partner-heading"><h1>{partnerText('partner', language)}</h1>
    <button type="button" onClick={onBack}>← {partnerText('back', language)}</button></header><PartnerDashboardView language={language} /></section>;
}
