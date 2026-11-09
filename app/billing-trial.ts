import type { FeatureAccess } from "./feature-access";
import approvedPolicy from "../server/resources/feature-access-policy.json" with {type:"json"};

export const BILLING_TRIAL_PLANS = ["standart", "premium", "business"] as const;
export type BillingTrialPlan = typeof BILLING_TRIAL_PLANS[number];
export type BillingTrialStatus = "available" | "active" | "expired" | "revoked" | "used" | "ineligible";
export type BillingTrial = {
  schemaVersion: 1;
  status: BillingTrialStatus;
  plan: BillingTrialPlan | null;
  label: string | null;
  startsAt: string | null;
  endsAt: string | null;
  serverNow: string;
  durationSeconds: 259200;
  eligiblePlans: BillingTrialPlan[];
};
export const BILLING_TRIAL_SECONDS = 259200;
export const BILLING_TRIAL_REFRESH_EVENT = "genesis:billing-trial-refresh";
const LABELS: Record<BillingTrialPlan, string> = {
  standart: "Trial-Standart", premium: "Trial-Premium", business: "Trial-Business",
};
const RANKS: Record<string, number> = { free: 0, standart: 1, premium: 2, business: 3, premium4life: 4 };
const STATUSES: BillingTrialStatus[] = ["available", "active", "expired", "revoked", "used", "ineligible"];

export function billingTrialName(plan: BillingTrialPlan | null | undefined): string {
  return plan && Object.hasOwn(LABELS, plan) ? LABELS[plan] : "";
}

/** Protocol timestamps are UTC, whole seconds and real Gregorian dates. */
export function billingTrialTimestamp(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return Number.NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && time > 0 && new Date(time).toISOString().replace(".000Z", "Z") === value ? time : Number.NaN;
}

export function isBillingTrial(value: unknown): value is BillingTrial {
  if (!value || typeof value !== "object") return false;
  const row = value as BillingTrial;
  if (row.schemaVersion !== 1 || row.durationSeconds !== BILLING_TRIAL_SECONDS || !STATUSES.includes(row.status)
    || !Number.isFinite(billingTrialTimestamp(row.serverNow)) || !Array.isArray(row.eligiblePlans)
    || row.eligiblePlans.some(plan => !BILLING_TRIAL_PLANS.includes(plan))
    || new Set(row.eligiblePlans).size !== row.eligiblePlans.length) return false;
  if (row.status !== "available" && row.eligiblePlans.length) return false;
  if (row.plan === null) {
    return row.label === null && row.startsAt === null && row.endsAt === null
      && ["available", "used", "ineligible"].includes(row.status);
  }
  if (!BILLING_TRIAL_PLANS.includes(row.plan) || row.label !== billingTrialName(row.plan)
    || row.status === "available") return false;
  const start = billingTrialTimestamp(row.startsAt), end = billingTrialTimestamp(row.endsAt), now = billingTrialTimestamp(row.serverNow);
  return Number.isFinite(start) && Number.isFinite(end) && end - start === BILLING_TRIAL_SECONDS * 1000
    && (row.status !== "active" || start <= now && now < end)
    && (row.status !== "expired" || now >= end);
}

export function billingTrialFrom(user: { trial?: unknown; featureAccess?: FeatureAccess }): BillingTrial | undefined {
  const value = user.featureAccess?.trial ?? user.trial;
  return isBillingTrial(value) ? value : undefined;
}

export function availableBillingTrials(value: unknown): BillingTrialPlan[] {
  return isBillingTrial(value) && value.status === "available"
    ? BILLING_TRIAL_PLANS.filter(plan => value.eligiblePlans.includes(plan)) : [];
}

/** Display metadata can arrive from catalog and session in either order; neither grants access. */
export function latestBillingTrial(...values: unknown[]): BillingTrial | undefined {
  const priority: Record<BillingTrialStatus, number> = {available:0,active:1,ineligible:2,used:3,expired:4,revoked:5};
  return values.filter(isBillingTrial).reduce<BillingTrial | undefined>((latest, value) => {
    if (!latest) return value;
    const time = billingTrialTimestamp(value.serverNow), previous = billingTrialTimestamp(latest.serverNow);
    return time > previous || time === previous && priority[value.status] > priority[latest.status] ? value : latest;
  }, undefined);
}

/** The paid tier is evaluated independently of trial metadata at the server snapshot time. */
function isPaidSnapshot(access: FeatureAccess): boolean {
  if (access.schemaVersion !== 1 || !Object.hasOwn(RANKS, access.declaredPlan)
    || !Object.hasOwn(RANKS, access.effectivePlan) || access.paidAccess !== undefined
    || typeof access.enforcementEnabled !== "boolean"
    || !Array.isArray(access.allowedFeatures) || !Array.isArray(access.freeFeatures)) return false;
  const evaluatedAt = billingTrialTimestamp(access.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) return false;
  if (access.declaredPlan === "premium4life") {
    return access.lifetimePremium === true && access.effectivePlan === "business" && access.validUntil === null;
  }
  if (access.lifetimePremium !== false) return false;
  const expiry = billingTrialTimestamp(access.validUntil);
  if (access.validUntil !== null && !Number.isFinite(expiry)) return false;
  const effective = access.declaredPlan !== "free" && expiry > evaluatedAt ? access.declaredPlan : "free";
  return access.effectivePlan === effective;
}

function isOrdinaryPaidAccess(access: FeatureAccess): boolean {
  // Old profiles predate the source field. Trial-shaped profiles do not qualify for that compatibility path.
  if (access.source === undefined) return access.trial === undefined && access.paidAccess === undefined;
  return access.source === "subscription" && isPaidSnapshot(access);
}

/** A trial may fail closed to its independent paid snapshot, never another trial. */
export function paidAccessAfterTrial(access: FeatureAccess): FeatureAccess {
  const paid = access.paidAccess;
  if (paid && paid !== access && paid.source === undefined && paid.trial === undefined
    && paid.declaredPlan === access.declaredPlan && isPaidSnapshot(paid)) return paid;
  const disabledFeatures = [...new Set([...approvedPolicy.disabledFeatures, ...(access.disabledFeatures ?? [])])];
  const freeFeatures = Object.entries(approvedPolicy.features).filter(([feature, plans]) => plans.some(plan => plan === "free") && !disabledFeatures.includes(feature)).map(([feature]) => feature);
  return {
    schemaVersion: 1, policyRevision: access.policyRevision, enforcementEnabled: true,
    declaredPlan: "free", effectivePlan: "free", lifetimePremium: false, validUntil: null,
    evaluatedAt: access.evaluatedAt, allowedFeatures: freeFeatures,
    freeFeatures, disabledFeatures,
    limits: approvedPolicy.limits.free, freeLimits: approvedPolicy.limits.free,
    adviceDailyLimit: access.freeAdviceDailyLimit, freeAdviceDailyLimit: access.freeAdviceDailyLimit,
  };
}

export function billingTrialImprovesPaid(access: FeatureAccess | undefined, plan: BillingTrialPlan | null): boolean {
  if (!access || !plan) return false;
  const paid = isOrdinaryPaidAccess(access) ? access : paidAccessAfterTrial(access);
  return (RANKS[plan] ?? -1) > (paid.lifetimePremium ? 4 : RANKS[paid.effectivePlan] ?? 4);
}

export type TrialTransportCheckpoint = Readonly<{ generation: number; sequence: number; startedAt: number }>;
export type TrialTransportDecision = { accepted: boolean; lease: boolean };
type TrialLease = {
  ownerId: string; ownerVersion: number; generation: number; deadline: number; lastNow: number; invalid: boolean;
};
const monotonicNow = () => typeof performance === "undefined" ? Number.NaN : performance.now();

/** Pure, injectable clock controller. Only accepted profile responses acquire leases. */
export function createTrialAccessController(clock: () => number = monotonicNow) {
  let generation = 0;
  let sequence = 0;
  let latestAcceptedSequence = 0;
  let currentOwner = "";
  const checkpoints = new WeakSet<object>();
  const leases = new WeakMap<FeatureAccess, TrialLease>();
  const ownerVersions = new Map<string, number>();
  const ownerServerTimes = new Map<string, number>();
  const terminalWindows = new Set<string>();
  const readLease = (access: FeatureAccess | undefined) => {
    if (!access) return null;
    const lease = leases.get(access);
    if (!lease || lease.invalid || lease.generation !== generation || ownerVersions.get(lease.ownerId) !== lease.ownerVersion) return null;
    const now = clock();
    if (!Number.isFinite(now) || now < lease.lastNow) { lease.invalid = true; return null; }
    lease.lastNow = now;
    return { lease, now };
  };
  return {
    beginTransport(): TrialTransportCheckpoint {
      const checkpoint = Object.freeze({ generation, sequence: ++sequence, startedAt: clock() });
      checkpoints.add(checkpoint);
      return checkpoint;
    },
    accept(ownerId: string, access: FeatureAccess | undefined, checkpoint: TrialTransportCheckpoint, allowLease = true): TrialTransportDecision {
      const denied = { accepted: false, lease: false }, ordinary = { accepted: true, lease: false };
      if (!checkpoints.has(checkpoint)) return denied;
      checkpoints.delete(checkpoint);
      if (!ownerId || checkpoint.generation !== generation || checkpoint.sequence <= latestAcceptedSequence) return denied;
      const trial = access && isBillingTrial(access.trial) ? access.trial : undefined;
      const evaluatedAt = billingTrialTimestamp(access?.evaluatedAt);
      const serverNow = trial ? billingTrialTimestamp(trial.serverNow) : evaluatedAt;
      const previousServerTime = ownerServerTimes.get(ownerId);
      // Dispatch order is not server evaluation order. Reject a stale state before publishing its profile.
      if (previousServerTime !== undefined && (!Number.isFinite(serverNow) || serverNow < previousServerTime)) return denied;
      if (trial && evaluatedAt !== serverNow) return denied;
      const window = trial?.plan ? JSON.stringify([ownerId, trial.plan, trial.startsAt, trial.endsAt]) : undefined;
      // Whole-second timestamps can tie. Once terminal, this immutable window cannot regain a lease.
      if (window && trial?.status === "active" && terminalWindows.has(window)) return denied;
      latestAcceptedSequence = checkpoint.sequence;
      if (currentOwner && currentOwner !== ownerId) generation++;
      currentOwner = ownerId;
      const version = checkpoint.sequence;
      ownerVersions.set(ownerId, version);
      if (Number.isFinite(serverNow)) ownerServerTimes.set(ownerId, serverNow);
      if (window && (trial?.status === "expired" || trial?.status === "revoked")) terminalWindows.add(window);
      if (!allowLease || !access || access.schemaVersion !== 1 || !trial || trial.status !== "active"
        || access.source !== "trial") return ordinary;
      const now = clock(), start = billingTrialTimestamp(trial.startsAt), end = billingTrialTimestamp(trial.endsAt);
      if (!Number.isFinite(now) || !Number.isFinite(checkpoint.startedAt) || now < checkpoint.startedAt
        || serverNow < start || serverNow >= end) return ordinary;
      if (access.effectivePlan !== trial.plan || access.validUntil !== trial.endsAt
        || access.lifetimePremium || !access.enforcementEnabled || paidAccessAfterTrial(access) !== access.paidAccess
        || !billingTrialImprovesPaid(access, trial.plan)) return ordinary;
      // Anchor at request start, and subtract one second for serverNow's second precision.
      // Neither round-trip latency nor a fractional server second can extend the grant.
      const deadline = checkpoint.startedAt + Math.max(0, end - serverNow - 1000);
      leases.set(access, { ownerId, ownerVersion: version, generation, deadline, lastNow: now, invalid: false });
      return { accepted: true, lease: now < deadline };
    },
    resolve(access: FeatureAccess | undefined): FeatureAccess | undefined {
      if (!access || isOrdinaryPaidAccess(access)) return access;
      if (access.source !== "trial") return paidAccessAfterTrial(access);
      const current = readLease(access);
      return current && current.now < current.lease.deadline ? access : paidAccessAfterTrial(access);
    },
    remaining(access: FeatureAccess | undefined): number | null {
      const current = readLease(access);
      return current ? Math.max(0, current.lease.deadline - current.now) : null;
    },
    invalidate(): void { generation++; },
  };
}

const liveTrials = createTrialAccessController();
export const beginTrialTransport = () => liveTrials.beginTransport();
export function acceptTrialTransport(ownerId: string, access: FeatureAccess | undefined, checkpoint: TrialTransportCheckpoint): boolean {
  const visible = typeof document === "undefined" || document.visibilityState === "visible";
  return liveTrials.accept(ownerId, access, checkpoint, visible).accepted;
}
export const resolvedFeatureAccess = (access: FeatureAccess | undefined) => liveTrials.resolve(access);
export const billingTrialRemaining = (access: FeatureAccess | undefined) => liveTrials.remaining(access);
export const invalidateTrialAccess = () => liveTrials.invalidate();
export function requestBillingTrialRefresh() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(BILLING_TRIAL_REFRESH_EVENT));
}
