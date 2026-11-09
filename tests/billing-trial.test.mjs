import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {
  BILLING_TRIAL_PLANS, BILLING_TRIAL_SECONDS, billingTrialName, isBillingTrial, availableBillingTrials,
  createTrialAccessController, beginTrialTransport, acceptTrialTransport, invalidateTrialAccess,
  resolvedFeatureAccess, billingTrialImprovesPaid, latestBillingTrial,
} from "../app/billing-trial.ts";
import {featureAllowed, featureLimit} from "../app/feature-access.ts";
import {dataTransferAllowed} from "../app/data-transfer-access.ts";

const now = Date.parse("2026-11-03T00:00:00Z");
const endsAt = "2026-11-06T00:00:00Z";
const meta = (plan = "business") => ({
  schemaVersion:1, status:"active", plan, label:billingTrialName(plan),
  startsAt:"2026-11-03T00:00:00Z", endsAt, serverNow:"2026-11-03T00:00:00Z",
  durationSeconds:259200, eligiblePlans:[],
});
const paid = (plan = "free") => ({
  schemaVersion:1, policyRevision:"test", enforcementEnabled:true, declaredPlan:plan,
  effectivePlan:plan, lifetimePremium:false, validUntil:plan === "free" ? null : "2026-12-03T00:00:00Z",
  evaluatedAt:"2026-11-03T00:00:00Z", allowedFeatures:plan === "free" ? ["tasks"] : ["tasks", "data-export", "mindmaps"],
  freeFeatures:["tasks"], limits:{mindmaps:plan === "free" ? 1 : 20}, freeLimits:{mindmaps:1},
});
const overlay = (baseline = paid(), plan = "business") => ({
  ...baseline, source:"trial", effectivePlan:plan, validUntil:endsAt, trial:meta(plan),
  paidAccess:baseline, allowedFeatures:["tasks","data-export","mindmaps","shared-projects"], limits:{mindmaps:100},
});
const evaluated = (access, serverNow) => ({
  ...access, evaluatedAt:serverNow,
  ...(access.trial ? {trial:{...access.trial,serverNow}} : {}),
  ...(access.paidAccess ? {paidAccess:{...access.paidAccess,evaluatedAt:serverNow}} : {}),
});
const pureController = () => {
  let clock = 1000;
  const controller = createTrialAccessController(() => clock);
  return {controller, set: value => {clock = value;}, advance: value => {clock += value;}};
};

test("trial protocol accepts only the three exact plans, UTC windows and one 72-hour duration", () => {
  assert.deepEqual(BILLING_TRIAL_PLANS, ["standart","premium","business"]);
  assert.deepEqual(BILLING_TRIAL_PLANS.map(billingTrialName), ["Trial-Standart","Trial-Premium","Trial-Business"]);
  for (const plan of BILLING_TRIAL_PLANS) assert(isBillingTrial(meta(plan)));
  for (const change of [
    {schemaVersion:2}, {status:"unknown"}, {plan:"free"}, {plan:"premium4life"}, {label:"Trial-Standard"},
    {durationSeconds:259201}, {startsAt:"2026-11-03T00:00:00+00:00"}, {endsAt:"2026-11-06T00:00:01Z"},
    {serverNow:"2026-02-30T00:00:00Z"}, {serverNow:"2026-11-02T23:59:59Z"},
    {serverNow:endsAt}, {eligiblePlans:["business"]},
  ]) assert.equal(isBillingTrial({...meta(),...change}), false, JSON.stringify(change));
  assert(isBillingTrial({...meta(),status:"expired",serverNow:endsAt}));
  const available = {...meta(), status:"available", plan:null, label:null, startsAt:null, endsAt:null, eligiblePlans:[...BILLING_TRIAL_PLANS]};
  assert.deepEqual(availableBillingTrials(available), BILLING_TRIAL_PLANS);
  assert.deepEqual(availableBillingTrials({...available,eligiblePlans:["free"]}), []);
  assert.deepEqual(availableBillingTrials({...available,eligiblePlans:["premium","premium"]}), []);
  assert.deepEqual(availableBillingTrials({...available,durationSeconds:1}), []);
});

test("new session metadata suppresses stale catalog trial offers without creating a lease", () => {
  const available = {...meta(),status:"available",plan:null,label:null,startsAt:null,endsAt:null,eligiblePlans:["business"]};
  assert.equal(latestBillingTrial(available,meta()).status,"active");
  assert.equal(latestBillingTrial(meta(),available).status,"active");
  const expired = {...meta(),status:"expired",serverNow:endsAt};
  assert.equal(latestBillingTrial(available,expired).status,"expired");
  assert.deepEqual(availableBillingTrials(latestBillingTrial(available,expired)),[]);
});

test("cached, imported or catalog-only metadata never establishes a trial lease", () => {
  const {controller} = pureController(), access = overlay();
  assert.equal(controller.resolve(access), access.paidAccess);
  const copy = JSON.parse(JSON.stringify(access));
  assert.equal(controller.resolve(copy).effectivePlan, "free");
  availableBillingTrials({...meta(),status:"available",plan:null,label:null,startsAt:null,endsAt:null,eligiblePlans:["business"]});
  assert.equal(controller.resolve(access), access.paidAccess);
  assert.deepEqual(controller.accept("account",access,{generation:0,sequence:1,startedAt:1000}), {accepted:false,lease:false});
});

test("a trusted request lease excludes round-trip latency and fractional server seconds", () => {
  const {controller,advance,set} = pureController(), access = overlay();
  const checkpoint = controller.beginTransport();
  advance(45000);
  assert.deepEqual(controller.accept("account",access,checkpoint), {accepted:true,lease:true});
  const deadline = 1000 + 259200000 - 1000;
  assert.equal(controller.remaining(access), 259200000 - 1000 - 45000);
  set(deadline - 1); assert.equal(controller.resolve(access), access);
  set(deadline); assert.equal(controller.resolve(access), access.paidAccess);
  assert.equal(controller.remaining(access), 0);
  set(deadline + 999); assert.equal(controller.resolve(access), access.paidAccess);
});

test("a nonmonotonic clock cannot recreate or extend a live lease", () => {
  const {controller,set} = pureController(), access = overlay();
  controller.accept("account",access,controller.beginTransport());
  set(2000); assert.equal(controller.resolve(access), access);
  set(1999); assert.equal(controller.resolve(access), access.paidAccess);
  set(3000); assert.equal(controller.resolve(access), access.paidAccess);
});

test("visibility invalidation rejects earlier responses and requires a new trusted request", () => {
  const {controller} = pureController(), access = overlay(), pending = controller.beginTransport();
  controller.invalidate();
  assert.deepEqual(controller.accept("account",access,pending), {accepted:false,lease:false});
  assert.equal(controller.resolve(access), access.paidAccess);
  controller.accept("account",access,controller.beginTransport());
  assert.equal(controller.resolve(access), access);
  controller.invalidate(); assert.equal(controller.resolve(access), access.paidAccess);
});

test("an older active response cannot overwrite a newer revoke or paid response", () => {
  const {controller,advance} = pureController(), access = overlay();
  const older = controller.beginTransport(); advance(1);
  const newer = controller.beginTransport();
  const revoked = {...paid("premium"),source:"subscription",trial:{...meta(),status:"revoked"}};
  assert.deepEqual(controller.accept("account",revoked,newer), {accepted:true,lease:false});
  assert.deepEqual(controller.accept("account",access,older), {accepted:false,lease:false});
  assert.equal(controller.resolve(revoked), revoked);
  assert.equal(controller.resolve(access), access.paidAccess);
});

test("a later-dispatched active response cannot replace a newer server revocation or expiry", () => {
  for (const [status,serverNow] of [["revoked","2026-11-03T00:00:01Z"],["expired",endsAt]]) {
    const {controller} = pureController();
    const requestA = controller.beginTransport(), requestB = controller.beginTransport();
    const terminal = evaluated({...paid("premium"),source:"subscription",trial:{...meta(),status}},serverNow);
    const delayedActive = overlay();
    // B is evaluated first but returns after A. Request sequence alone would wrongly accept B.
    assert.deepEqual(controller.accept("account",terminal,requestA),{accepted:true,lease:false});
    assert.deepEqual(controller.accept("account",delayedActive,requestB),{accepted:false,lease:false});
    assert.equal(controller.resolve(terminal),terminal);
    assert.equal(controller.resolve(delayedActive),delayedActive.paidAccess);
  }
});

test("a terminal window stays terminal at equal or newer server times across invalidation", () => {
  const {controller} = pureController();
  const revoked = {...paid(),source:"subscription",trial:{...meta(),status:"revoked"}};
  assert.equal(controller.accept("account",revoked,controller.beginTransport()).accepted,true);
  for (const serverNow of [meta().serverNow,"2026-11-03T00:00:01Z"]) {
    const access = evaluated(overlay(),serverNow);
    assert.deepEqual(controller.accept("account",access,controller.beginTransport()),{accepted:false,lease:false});
    controller.invalidate();
    assert.deepEqual(controller.accept("account",access,controller.beginTransport()),{accepted:false,lease:false});
    assert.equal(controller.resolve(access),access.paidAccess);
  }
  const other = overlay();
  assert.deepEqual(controller.accept("other-account",other,controller.beginTransport()),{accepted:true,lease:true});
  assert.equal(controller.resolve(other),other);
  assert.equal(controller.accept("account",overlay(),controller.beginTransport()).accepted,false);
  assert.equal(controller.resolve(other),other);
});

test("server-time ordering also protects a paid upgrade when request dispatch order is reversed", () => {
  const {controller} = pureController();
  const requestA = controller.beginTransport(), requestB = controller.beginTransport();
  const purchased = evaluated({...paid("business"),source:"subscription",trial:meta()},"2026-11-03T00:00:02Z");
  const staleTrial = evaluated(overlay(),"2026-11-03T00:00:01Z");
  assert.deepEqual(controller.accept("account",purchased,requestA),{accepted:true,lease:false});
  assert.deepEqual(controller.accept("account",staleTrial,requestB),{accepted:false,lease:false});
  assert.equal(controller.resolve(purchased),purchased);
  assert.equal(controller.remaining(purchased),null);
});

test("fresh paid updates remain usable after a terminal trial without restoring its old lease", () => {
  for (const [status,serverNow,nextTime] of [
    ["revoked",meta().serverNow,"2026-11-03T00:00:01Z"],
    ["expired",endsAt,"2026-11-06T00:00:01Z"],
  ]) {
    const {controller} = pureController(), old = overlay();
    controller.accept("account",old,controller.beginTransport());
    const terminal = evaluated({...paid(),source:"subscription",trial:{...meta(),status}},serverNow);
    assert.equal(controller.accept("account",terminal,controller.beginTransport()).accepted,true);
    const purchased = evaluated({...paid("business"),source:"subscription",trial:{...meta(),status}},nextTime);
    assert.deepEqual(controller.accept("account",purchased,controller.beginTransport()),{accepted:true,lease:false});
    assert.equal(controller.resolve(purchased),purchased);
    assert.equal(controller.resolve(old),old.paidAccess);
    assert.equal(controller.remaining(old),null);
  }
});

test("an inconsistent or missing server evaluation cannot supersede a newer trusted profile", () => {
  const {controller} = pureController();
  const current = evaluated(overlay(),"2026-11-03T00:00:02Z");
  assert.equal(controller.accept("account",current,controller.beginTransport()).lease,true);
  for (const response of [
    {...paid(),source:"subscription",evaluatedAt:undefined},
    evaluated({...paid(),source:"subscription"},"2026-11-03T00:00:01Z"),
    {...evaluated(overlay(),"2026-11-03T00:00:03Z"),evaluatedAt:"2026-11-03T00:00:04Z"},
  ]) {
    assert.deepEqual(controller.accept("account",response,controller.beginTransport()),{accepted:false,lease:false});
    assert.equal(controller.resolve(current),current);
  }
});

test("account switches invalidate the previous owner and its pending requests", () => {
  const {controller,advance} = pureController(), first = overlay(), second = overlay();
  controller.accept("first",first,controller.beginTransport());
  const oldRequest = controller.beginTransport(); advance(1);
  controller.accept("second",second,controller.beginTransport());
  assert.equal(controller.resolve(first), first.paidAccess);
  assert.equal(controller.resolve(second), second);
  assert.equal(controller.accept("first",overlay(),oldRequest).accepted, false);
});

test("an older response cannot establish a different owner before the first profile is settled", () => {
  const {controller,advance} = pureController(), first = overlay(), second = overlay();
  const older = controller.beginTransport(); advance(1);
  const newer = controller.beginTransport();
  assert.equal(controller.accept("second",second,newer).accepted, true);
  assert.equal(controller.accept("first",first,older).accepted, false);
  assert.equal(controller.resolve(second), second);
  assert.equal(controller.resolve(first), first.paidAccess);
});

test("a newer pure paid response revokes the old trial object without changing paid access", () => {
  const {controller} = pureController(), access = overlay();
  controller.accept("account",access,controller.beginTransport());
  const upgraded = {...paid("business"),source:"subscription",trial:meta()};
  assert.deepEqual(controller.accept("account",upgraded,controller.beginTransport()), {accepted:true,lease:false});
  assert.equal(controller.resolve(access), access.paidAccess);
  assert.equal(controller.resolve(upgraded), upgraded);
  assert.equal(billingTrialImprovesPaid(upgraded,"business"), false);
});

test("hidden responses can publish profile state but never establish a trial lease", () => {
  const {controller} = pureController(), access = overlay();
  assert.deepEqual(controller.accept("account",access,controller.beginTransport(),false), {accepted:true,lease:false});
  assert.equal(controller.resolve(access), access.paidAccess);
});

test("malformed or nonimproving trial overlays fail closed to paid access or known Free limits", () => {
  for (const changed of [
    {trial:{...meta(),durationSeconds:1}}, {trial:undefined}, {effectivePlan:"premium4life"},
    {source:"unexpected"}, {paidAccess:undefined}, {validUntil:"2030-01-01T00:00:00Z"},
  ]) {
    const {controller} = pureController(), access = {...overlay(),...changed};
    assert.equal(controller.accept("account",access,controller.beginTransport()).lease, false);
    assert.equal(controller.resolve(access).effectivePlan, "free");
    assert.equal(controller.resolve(access).limits.mindmaps, 1);
  }
  const {controller} = pureController(), same = overlay(paid("business"));
  assert.equal(controller.accept("account",same,controller.beginTransport()).lease, false);
  assert.equal(controller.resolve(same), same.paidAccess);
});

test("missing or subscription source cannot turn a cached trial overlay into paid rights", () => {
  invalidateTrialAccess();
  for (const plan of ["free","standart"]) for (const source of [undefined,"subscription"]) {
    const {controller} = pureController();
    const access = JSON.parse(JSON.stringify(overlay(paid(plan))));
    if (source === undefined) delete access.source; else access.source = source;
    assert.equal(controller.resolve(access),access.paidAccess);
    assert.equal(controller.remaining(access),null);
    assert.equal(featureAllowed(access,"shared-projects",now),false);
    assert.equal(featureLimit(access,"mindmaps",now),plan === "free" ? 1 : 20);
    assert.equal(dataTransferAllowed(access,now),plan !== "free");
    assert.deepEqual(controller.accept("account",access,controller.beginTransport()),{accepted:true,lease:false});
    assert.equal(controller.resolve(access),access.paidAccess);
  }
});

test("trial-shaped profiles without a valid independent paid baseline use known Free rights", () => {
  for (const source of [undefined,"subscription"]) {
    const {controller} = pureController(), access = {...overlay(),source,paidAccess:undefined};
    assert.equal(controller.resolve(access).effectivePlan,"free");
    assert.equal(controller.resolve(access).limits.mindmaps,1);
    assert.deepEqual(controller.accept("account",access,controller.beginTransport()),{accepted:true,lease:false});
    assert.equal(controller.resolve(access).effectivePlan,"free");
  }
  for (const changed of [
    {effectivePlan:"business"}, {lifetimePremium:true}, {source:"subscription"},
    {trial:meta()}, {paidAccess:paid()},
  ]) {
    const {controller} = pureController(), access = overlay({...paid(),...changed});
    assert.equal(controller.accept("account",access,controller.beginTransport()).lease,false);
    assert.equal(controller.resolve(access).effectivePlan,"free");
    assert.equal(controller.resolve(access).limits.mindmaps,1);
  }
});

test("legacy ordinary profiles remain compatible and genuine paid metadata needs no trial lease", () => {
  for (const plan of ["free","standart","premium","business"]) {
    const {controller} = pureController(), legacy = paid(plan);
    assert.equal(controller.resolve(legacy),legacy);
    assert.deepEqual(controller.accept("account",legacy,controller.beginTransport()),{accepted:true,lease:false});
    const subscription = {...legacy,source:"subscription",trial:meta()};
    assert.equal(controller.resolve(subscription),subscription);
    assert.deepEqual(controller.accept("account",subscription,controller.beginTransport()),{accepted:true,lease:false});
    assert.equal(controller.remaining(subscription),null);
  }
  const {controller} = pureController();
  const lifetime = {...paid("business"),declaredPlan:"premium4life",lifetimePremium:true,validUntil:null,source:"subscription",trial:meta()};
  assert.equal(controller.resolve(lifetime),lifetime);
  assert.deepEqual(controller.accept("account",lifetime,controller.beginTransport()),{accepted:true,lease:false});
  const expiredPaid = {...paid("premium"),effectivePlan:"free",validUntil:"2026-11-02T00:00:00Z",source:"subscription",trial:meta()};
  assert.equal(controller.resolve(expiredPaid),expiredPaid);
});

test("subscription profiles cannot disguise a higher effective or lifetime tier", () => {
  const {controller} = pureController();
  for (const changed of [
    {declaredPlan:"free",effectivePlan:"business"}, {lifetimePremium:true},
    {declaredPlan:"premium4life",lifetimePremium:false},
    {validUntil:null}, {effectivePlan:"premium4life"}, {evaluatedAt:"invalid"},
  ]) {
    const access = {...paid("premium"),source:"subscription",trial:meta(),...changed};
    assert.equal(controller.resolve(access).effectivePlan,"free");
    assert.equal(controller.resolve(access).limits.mindmaps,1);
  }
});

test("live trial checks use the trusted monotonic lease rather than an altered wall clock", () => {
  invalidateTrialAccess();
  const access = overlay();
  assert(acceptTrialTransport("clock-test",access,beginTrialTransport()));
  assert.equal(featureAllowed(access,"shared-projects",0), true);
  assert.equal(featureAllowed(access,"shared-projects",Date.parse("2100-01-01T00:00:00Z")), true);
  assert.equal(featureLimit(access,"mindmaps",0), 100);
  assert.equal(dataTransferAllowed(access,0), true);
  invalidateTrialAccess();
  assert.equal(featureAllowed(access,"shared-projects",now), false);
  assert.equal(dataTransferAllowed(access,now), false);
  assert.equal(featureLimit(access,"mindmaps",now), 1);
});

test("stale trial import/export checks retain a valid paid baseline and still honor its own expiry", () => {
  invalidateTrialAccess();
  const access = overlay(paid("standart"));
  assert.equal(resolvedFeatureAccess(access), access.paidAccess);
  assert.equal(dataTransferAllowed(access,now), true);
  assert.equal(featureAllowed(access,"shared-projects",now), false);
  assert.equal(featureLimit(access,"mindmaps",now), 20);
  const expired = Date.parse("2026-12-03T00:00:00Z");
  assert.equal(dataTransferAllowed(access,expired), false);
  assert.equal(featureLimit(access,"mindmaps",expired), 1);
  assert.equal(featureAllowed(undefined,"tasks",now), true);
  assert.equal(dataTransferAllowed(undefined,now), false);
});

test("trial copy covers all supported languages with the same parameter names", () => {
  const copy = JSON.parse(readFileSync(new URL("../app/billing-trial-copy.json",import.meta.url),"utf8"));
  assert.deepEqual(Object.keys(copy).sort(), ["ru","en","el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja"].sort());
  const keys = Object.keys(copy.ru).sort();
  assert.equal(keys.length,29);
  const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
  for (const [language,values] of Object.entries(copy)) {
    assert.deepEqual(Object.keys(values).sort(),keys,language);
    for (const key of keys) {
      assert.equal(typeof values[key],"string",language+"."+key);
      assert(values[key].trim(),language+"."+key);
      assert.deepEqual(placeholders(values[key]),placeholders(copy.ru[key]),language+"."+key);
    }
  }
});

// Two devices may have unrelated wall clocks and monotonic origins. Neither can extend the one server window.
test("all trial plans expire on independent device clocks despite wall-clock and timezone changes",()=>{
  const originalNow=Date.now, originalZone=process.env.TZ;
  try {
    for(const plan of BILLING_TRIAL_PLANS) {
      const one=pureController(),two=pureController(),first=overlay(paid(),plan),second=overlay(paid(),plan);
      two.set(9_000_000);
      one.controller.accept("same-owner",first,one.controller.beginTransport());
      two.controller.accept("same-owner",second,two.controller.beginTransport());
      for(const [wall,zone] of [[0,"Pacific/Honolulu"],[Date.parse("2099-01-01"),"Pacific/Kiritimati"],[Date.parse("2000-01-01"),"UTC"]]){
        Date.now=()=>wall;process.env.TZ=zone;
        assert.equal(one.controller.resolve(first),first);assert.equal(two.controller.resolve(second),second);
      }
      one.advance(BILLING_TRIAL_SECONDS*1000);two.advance(BILLING_TRIAL_SECONDS*1000);
      Date.now=()=>0;
      assert.equal(one.controller.resolve(first),first.paidAccess);assert.equal(two.controller.resolve(second),second.paidAccess);
    }
  }finally{Date.now=originalNow;if(originalZone===undefined)delete process.env.TZ;else process.env.TZ=originalZone;}
});
