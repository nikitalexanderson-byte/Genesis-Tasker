import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {featureAllowed} from "../app/feature-access.ts";
import {dataTransferAllowed,requireDataTransfer} from '../app/data-transfer-access.ts';
import {sharedProjectQuotaAvailable} from '../app/shared-project-quota.ts';
const now = Date.parse("2026-10-30T00:00:00Z");
const access = {schemaVersion:1, policyRevision:"synthetic", enforcementEnabled:true, declaredPlan:"premium", effectivePlan:"premium", lifetimePremium:false,
  validUntil:"2026-11-30T00:00:00Z", evaluatedAt:"2026-10-30T00:00:00Z", allowedFeatures:["tasks","diary"], freeFeatures:["tasks"]};
test('ordinary file transfer fails closed for Free, unknown access, malformed expiry and stale permissive policies',()=>{
  const paid={...access,allowedFeatures:['data-export']};
  for(const plan of ['standart','premium','business'])assert.equal(dataTransferAllowed({...paid,effectivePlan:plan},now),true,plan);
  assert.equal(dataTransferAllowed({...paid,lifetimePremium:true,effectivePlan:'business',validUntil:null},now+1e12),true);
  for(const value of [undefined,{...paid,schemaVersion:2},{...paid,effectivePlan:'free'},
    {...paid,validUntil:null},{...paid,validUntil:'2030-02-30T00:00:00Z'},
    {...paid,enforcementEnabled:false,validUntil:'2026-10-29T00:00:00Z',freeFeatures:['data-export']},
    {...paid,disabledFeatures:['data-export']},{...paid,allowedFeatures:[]}])assert.equal(dataTransferAllowed(value,now),false,JSON.stringify(value));
  assert.throws(()=>requireDataTransfer({...paid,effectivePlan:'free'}),{code:'FEATURE_SUBSCRIPTION_REQUIRED',feature:'data-export'});
});

test('shared creation uses the destination owner pool and excludes subprojects',()=>{
  const mine={count:100,limit:100,remaining:0,ownerId:'me'},inviter={count:30,limit:100,remaining:70,ownerId:'inviter'};
  assert.equal(sharedProjectQuotaAvailable(mine),false,'No new own workspace or root at the pool limit');
  assert.equal(sharedProjectQuotaAvailable(inviter),true,'Member own usage cannot block the inviter’s space');
  assert.equal(sharedProjectQuotaAvailable(mine,'existing-root'),true,'A subproject consumes no root capacity');
  assert.equal(sharedProjectQuotaAvailable(undefined),true,'Old responses defer to the authoritative server');
});
test("approved 3.1.4 packages distinguish free basics, Standart features and Business collaboration", () => {
  const policy = JSON.parse(readFileSync(new URL("../server/resources/feature-access-policy.json", import.meta.url)));
  assert.equal(policy.enforcementEnabled, true);
  assert.deepEqual(policy.features.stoicheion, ["free","standart","premium","business"]);
  assert.deepEqual(policy.features["stoicheion-timeline"], ["standart","premium","business"]);
  assert.deepEqual(policy.features.messenger, ["business"]);
  assert.deepEqual(policy.features["calendar-sync"], ["free","standart","premium","business"]);
  assert.deepEqual(policy.limits.free, {"personal-projects":5,habits:5,mindmaps:1,diary:100});
  assert.equal(featureAllowed(undefined, "diary", now), true);
  assert.equal(featureAllowed({...access,enforcementEnabled:false}, "unknown", now), true);
});
test("future active paid access is explicit; unknown capabilities fail closed", () => {
  assert.equal(featureAllowed(access,"diary",now),true);
  assert.equal(featureAllowed(access,"teams",now),false);
});
test("unpaid or expired status drops to free at the boundary", () => {
  for (const validUntil of [null,"invalid","2026-10-30T00:00:00Z",
    "2030-02-30T00:00:00Z", "2030-11-31T00:00:00Z", "2100-02-29T00:00:00Z",
    "2030-01-01T24:00:00Z", "2030-01-01T12:60:00Z", "2030-01-01T12:00:60Z",
    "2030-01-01T00:00:00+18:01", "2030-01-01T00:00:00-18:01",
    "2030-01-01T00:00:00+19:00", "2030-01-01T00:00:00+01:60"]) {
    assert.equal(featureAllowed({...access,validUntil},"diary",now),false);
    assert.equal(featureAllowed({...access,validUntil},"tasks",now),true);
  }
});

test("valid Gregorian leap dates and maximum Java-compatible offsets retain paid access", () => {
  for (const validUntil of ["2028-02-29T12:00:00+03:00", "2028-02-29T23:45:59+18:00",
    "2028-02-29T23:45:59-18:00", "2400-02-29T00:00:00Z"]) {
    assert.equal(featureAllowed({...access,validUntil},"diary",now),true,validUntil);
  }
});
test("server-assigned Premium4Life includes Business capabilities and does not expire", () => {
  const lifetime = {...access,lifetimePremium:true,declaredPlan:"premium4life",effectivePlan:"business",validUntil:null,allowedFeatures:[...access.allowedFeatures,"teams"]};
  assert.equal(featureAllowed(lifetime,"diary",now+1e12),true);
  assert.equal(featureAllowed(lifetime,"teams",now),true);
  assert.equal(featureAllowed(lifetime,"unknown",now),false);
  assert.equal(featureAllowed({...lifetime,validUntil:"2030-02-30T00:00:00Z"},"diary",now+1e12),true);
});
