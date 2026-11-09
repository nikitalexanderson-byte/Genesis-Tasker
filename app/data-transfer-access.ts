import {featureAllowed, type FeatureAccess} from './feature-access.ts';
import {requestUpgrade} from './upgrade-events.ts';
import {resolvedFeatureAccess} from './billing-trial.ts';

/** File transfer needs a current server entitlement, including for device-only data. */
export function dataTransferAllowed(access: FeatureAccess | undefined, now = Date.now()): boolean {
  const current = resolvedFeatureAccess(access);
  return Boolean(current?.schemaVersion === 1
    && ['standart', 'premium', 'business', 'premium4life'].includes(current.effectivePlan)
    && featureAllowed(access, 'data-export', now, true));
}

/** Use again at the final read/write boundary after an asynchronous preview or export. */
export function allowDataTransfer(access: FeatureAccess | undefined): boolean {
  if (dataTransferAllowed(access)) return true;
  requestUpgrade({feature: 'data-export', reason: 'feature'});
  return false;
}

export function requireDataTransfer(access: FeatureAccess | undefined): void {
  if (!allowDataTransfer(access)) throw Object.assign(new Error('FEATURE_SUBSCRIPTION_REQUIRED'),
    {code: 'FEATURE_SUBSCRIPTION_REQUIRED', feature: 'data-export'});
}
