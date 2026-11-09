import {requestUpgrade} from './upgrade-events.ts';
import {resolvedFeatureAccess, type BillingTrial} from './billing-trial.ts';
/** Server-owned entitlement. Never infer payment from a locally editable user plan. */
export type FeatureAccess = {
  schemaVersion: 1;
  policyRevision: string;
  enforcementEnabled: boolean;
  declaredPlan: string;
  effectivePlan: string;
  lifetimePremium: boolean;
  validUntil: string | null;
  evaluatedAt: string;
  source?: "subscription" | "trial";
  trial?: BillingTrial;
  paidAccess?: FeatureAccess;
  allowedFeatures: string[];
  freeFeatures: string[];
  disabledFeatures?: string[];
  limits?: Record<string, number | null>;
  freeLimits?: Record<string, number | null>;
  adviceDailyLimit?: number | null;
  freeAdviceDailyLimit?: number | null;
};

function subscriptionExpiry(value: string | null): number {
  if (typeof value !== "string") return Number.NaN;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts || parts[0] !== value) return Number.NaN;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = parts;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const leap = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const offsetHour = Number(offsetHourText ?? 0), offsetMinute = Number(offsetMinuteText ?? 0);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]
    || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59
    || offsetHour > 18 || offsetMinute > 59 || (offsetHour === 18 && offsetMinute !== 0)) return Number.NaN;
  return Date.parse(value);
}

export function featureAllowed(access: FeatureAccess | undefined, feature: string, now = Date.now(), strict = false): boolean {
  const current = resolvedFeatureAccess(access);
  if ((current?.disabledFeatures ?? ["assistant"]).includes(feature)) return false;
  if (!strict && !current?.enforcementEnabled) return true;
  if (!current || current.schemaVersion !== 1) return false;
  const liveTrial = current === access && current.source === "trial";
  const expiry = subscriptionExpiry(current.validUntil);
  const expired = !liveTrial && !current.lifetimePremium && current.effectivePlan !== "free" && (!Number.isFinite(expiry) || now >= expiry);
  if (strict && expired) return false;
  return (expired ? current.freeFeatures : current.allowedFeatures).includes(feature);
}

export function featureLimit(access: FeatureAccess | undefined, resource: string, now = Date.now()): number | null {
  const current = resolvedFeatureAccess(access);
  if (!current?.enforcementEnabled) return null;
  const liveTrial = current === access && current.source === "trial";
  const expiry = subscriptionExpiry(current.validUntil);
  const expired = !liveTrial && !current.lifetimePremium && current.effectivePlan !== "free" && (!Number.isFinite(expiry) || now >= expiry);
  const limit = (expired ? current.freeLimits : current.limits)?.[resource];
  return typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 0 ? limit : null;
}

export function featureQuotaAllows(access: FeatureAccess | undefined, resource: string, count: number, now = Date.now()): boolean {
  const limit = featureLimit(access, resource, now);
  return limit === null || count < limit;
}

// Account-scoped transport snapshot. Never populated by an import, plan selector or redirect.
const accountAccess = new Map<string, FeatureAccess>();
export function rememberFeatureAccess(userId: string, access?: FeatureAccess) {
  if (access) accountAccess.set(userId, access); else accountAccess.delete(userId);
}
export function currentFeatureAccess(userId: string): FeatureAccess | undefined { return accountAccess.get(userId); }
export function requireFeature(access: FeatureAccess | undefined, feature: string) {
  if (!featureAllowed(access,feature)) {
    requestUpgrade({feature,reason:'feature'});
    throw Object.assign(new Error('FEATURE_SUBSCRIPTION_REQUIRED'),{code:'FEATURE_SUBSCRIPTION_REQUIRED',feature});
  }
}
export function requireQuotaGrowth(access: FeatureAccess | undefined, resource: string, before: number, after: number) {
  const limit = featureLimit(access, resource);
  if (after > before && limit !== null && after > limit) {
    requestUpgrade({resource,limit,used:before,reason:'quota'});
    throw Object.assign(new Error('Достигнут лимит тарифа. Существующие данные сохраняются. Изменить тариф можно в настройках аккаунта.'),{code:`SUBSCRIPTION_QUOTA_${resource}`});
  }
}
