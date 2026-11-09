import type {GenesisUser} from './cloud-sync';
import {planGuidanceTopic,type PlanGuidanceRequest,type PlanGuidanceNotice} from './plan-guidance-types.ts';
import type {UpgradeRequest} from './upgrade-events';

export const GUIDANCE_QUIET_MS=6000;
export const GUIDANCE_ERROR_BACKOFF_MS=60000;
export const GUIDANCE_CHANGED_EVENT='genesis:plan-guidance-changed';
export const GUIDANCE_OPEN_EVENT='genesis:plan-guidance-open';
export type GuidanceInboxState={userId:string;notice:PlanGuidanceNotice|null;readId?:string};

/** A slow read of A cannot remove replacement B or another account's notice. */
export function applyGuidanceInboxUpdate(userId:string,current:GuidanceInboxState,update:GuidanceInboxState):GuidanceInboxState {
  if(update.userId!==userId||update.notice===null&&update.readId&&current.userId===userId&&current.notice?.id!==update.readId)return current;
  return update;
}

/** Suppress uncertain/stale profiles; the server always rechecks the entitlement. */
export function planGuidanceEligible(user:GenesisUser|null):boolean {
  return Boolean(user?.uid&&user.emailVerification?.required===false&&user.featureAccess?.schemaVersion===1
    &&user.featureAccess.enforcementEnabled&&user.featureAccess.effectivePlan==='free'
    &&user.featureAccess.source!=='trial'&&!user.featureAccess.lifetimePremium);
}

/** Compute waits from two server timestamps, then use a monotonic foreground timer. */
export function planGuidanceWait(nextAt:unknown,serverNow:unknown):number {
  if(typeof nextAt!=='string'||typeof serverNow!=='string')return GUIDANCE_ERROR_BACKOFF_MS;
  const wait=Date.parse(nextAt)-Date.parse(serverNow);
  return Number.isFinite(wait)?Math.max(GUIDANCE_QUIET_MS,Math.min(259200000,wait)):GUIDANCE_ERROR_BACKOFF_MS;
}

export function contextualGuidance(request:UpgradeRequest):PlanGuidanceRequest|null {
  if(!['quota','feature'].includes(request.reason??'')||request.feature==='assistant'||request.feature==='calendar-sync')return null;
  const supported=['personal-projects','habits','mindmaps','diary','shared-projects','shared-mindmaps','advice'];
  const resource=request.resource&&supported.includes(request.resource)?request.resource:undefined;
  const feature=request.feature&&/^[a-z][a-z0-9-]{0,63}$/.test(request.feature)?request.feature:undefined;
  return {topic:planGuidanceTopic(resource??feature??'overview'),reason:request.reason as 'quota'|'feature',...(resource?{resource}:{}),...(feature?{feature}:{})};
}

export function guidanceElementVisible(element:Element|null):boolean {
  return Boolean(element&&element.getClientRects().length&&!element.closest('[hidden],[inert]'));
}

/** Existing dialogs, inline editors and focused inputs keep their protected working space. */
export function guidanceWorkspaceQuiet(document:Document,ownDialog?:Element|null):boolean {
  if(document.visibilityState!=='visible')return false;
  const focused=document.activeElement;
  if(focused?.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')&&!ownDialog?.contains(focused))return false;
  return !Array.from(document.querySelectorAll('dialog[open],[aria-modal="true"],[role="dialog"],.modal-backdrop,.notification-dock[data-expanded="true"],main textarea,main [contenteditable]:not([contenteditable="false"]),main form:not([role="search"]) input:not([type="search"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])'))
    .some(element=>element!==ownDialog&&!ownDialog?.contains(element)&&guidanceElementVisible(element));
}
