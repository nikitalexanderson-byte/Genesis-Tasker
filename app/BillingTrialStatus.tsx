"use client";
import type {GenesisUser} from "./cloud-sync";
import {billingTrialFrom, billingTrialName, billingTrialRemaining, requestBillingTrialRefresh, type BillingTrialPlan} from "./billing-trial";
import trialCopy from "./billing-trial-copy.json";
import {requestUpgrade} from "./upgrade-events";

export function billingTrialText(template: string, values: Record<string, string> = {}) {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) => values[key] ?? placeholder);
}

export function BillingTrialStatus({user, onPayment, compact = false}: {
  user: GenesisUser; onPayment?: (plan: BillingTrialPlan | null) => void; compact?: boolean;
}) {
  const trial = billingTrialFrom(user);
  if (!trial || trial.status === "available" || trial.status === "ineligible") return null;
  const text = trialCopy[user.language], label = billingTrialName(trial.plan) || text.trialTitle;
  const needsCheck = trial.status === "active" && (billingTrialRemaining(user.featureAccess) ?? 0) <= 0;
  const message = trial.status === "active" ? text.active : trial.status === "expired" ? text.expired
    : trial.status === "revoked" ? text.revoked : text.used;
  const date = trial.endsAt ? new Intl.DateTimeFormat(user.language, {
    year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit", timeZoneName:"short",
  }).format(new Date(trial.endsAt)) : "";
  const payment = () => onPayment ? onPayment(trial.plan)
    : requestUpgrade({reason:"compare", ...(trial.plan ? {plan:trial.plan} : {})});
  return <section className={compact ? "billing-trial-status is-compact" : "billing-trial-status"}
    data-subscription-trial={trial.status} data-no-translate aria-label={text.trialTitle} tabIndex={-1}>
    <p className="billing-trial-heading" role="status">{needsCheck ? `${label} · ${text.checking}` : billingTrialText(message, {trial:label})}</p>
    {date ? <p>{billingTrialText(text.endsAt, {date})}</p> : null}
    {needsCheck ? <p className="billing-trial-checking">{text.onlineRequired}</p> : null}
    {!compact ? <p className="billing-trial-note">{text.noCharge}</p> : null}
    <div className="billing-trial-actions">
      <button type="button" className="secondary-button" data-trial-payment={trial.plan ?? "compare"} onClick={payment}>{text.payment}</button>
      {needsCheck ? <button type="button" className="secondary-button" onClick={requestBillingTrialRefresh}>{text.refresh}</button> : null}
    </div>
  </section>;
}
