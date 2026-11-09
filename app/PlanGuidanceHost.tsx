"use client";
import {useEffect,useId,useRef,useState} from 'react';
import {acknowledgePlanGuidance,captureAccountSessionGuard,claimPlanGuidance,loadBillingCatalog,readPlanGuidance,releasePlanGuidance,type GenesisUser} from './cloud-sync';
import {BILLING_FALLBACK_POLICY,billingPlanAllows,billingPlanLimits,billingPlanName,type BillingPolicy} from './billing';
import {BILLING_FEATURE_COPY_KEYS,UPGRADE_FEATURES,UPGRADE_RESOURCE_NAMES,upgradeCopy,upgradeLabel} from './upgrade-copy';
import billingFeatureCopy from './billing-feature-copy.json';
import copy from './plan-guidance-copy.json';
import {DialogCloseButton} from './DialogCloseButton';
import {ExperimentalIcon} from './ExperimentalIcon';
import {useDialogAccessibility} from './use-dialog-accessibility';
import {requestUpgrade,UPGRADE_REQUEST_EVENT,type UpgradeRequest} from './upgrade-events';
import {planGuidanceTopic,type PlanGuidanceNotice,type PlanGuidanceRequest} from './plan-guidance-types';
import {contextualGuidance,GUIDANCE_CHANGED_EVENT,GUIDANCE_ERROR_BACKOFF_MS,GUIDANCE_OPEN_EVENT,GUIDANCE_QUIET_MS,guidanceElementVisible,guidanceWorkspaceQuiet,planGuidanceEligible,planGuidanceWait} from './plan-guidance-model';
import './plan-guidance.css';

type OpenNotice={notice:PlanGuidanceNotice;token?:string};
type GuidanceEvent={userId:string;notice:PlanGuidanceNotice|null;readId?:string};
const resources=['personal-projects','habits','mindmaps','diary'] as const;
const introFeatures=new Set(['habit-timer','dream-journal','dream-voice','dark-palettes']);
function notify(userId:string,notice:PlanGuidanceNotice|null,readId?:string){window.dispatchEvent(new CustomEvent<GuidanceEvent>(GUIDANCE_CHANGED_EVENT,{detail:{userId,notice,readId}}));}

function PlanIntroduction({user,notice,automatic,onClose,onVisible}:{user:GenesisUser;notice:PlanGuidanceNotice;automatic:boolean;onClose:()=>void;onVisible:()=>void}) {
  const text=copy[user.language],title=useId(),body=useId(),native=useRef<HTMLDialogElement|null>(null);
  const focus=useDialogAccessibility<HTMLDialogElement>(onClose),[policy,setPolicy]=useState<BillingPolicy>(BILLING_FALLBACK_POLICY);
  const latest=useRef({onVisible,onClose});useEffect(()=>{latest.current={onVisible,onClose};},[onVisible,onClose]);
  useEffect(()=>{
    const element=native.current;
    if(!element||document.visibilityState!=='visible'||automatic&&!guidanceWorkspaceQuiet(document,element)){latest.current.onClose();return;}
    element.showModal();const frame=requestAnimationFrame(()=>{if(document.visibilityState==='visible'&&guidanceElementVisible(element))latest.current.onVisible();else latest.current.onClose();});
    return()=>{cancelAnimationFrame(frame);element.close();};
  },[automatic]);
  useEffect(()=>{let live=true;const guard=captureAccountSessionGuard();void loadBillingCatalog().then(catalog=>{guard();if(live&&catalog.policy?.features)setPolicy(catalog.policy);}).catch(()=>{});return()=>{live=false;};},[user.uid]);
  const common=upgradeCopy(user.language),features=billingFeatureCopy[user.language];
  return <dialog className="plan-guidance-dialog" ref={element=>{native.current=element;focus(element);}} aria-labelledby={title} aria-describedby={body} data-no-translate
    onCancel={event=>{event.preventDefault();onClose();}}>
    <header className="plan-guidance-header"><h2 id={title}>{text.title}</h2><DialogCloseButton onClick={onClose} aria-label={text.close}/></header>
    <p id={body} className="plan-guidance-context">{text[notice.topic]}</p>
    <div className="plan-guidance-plans">
      {(['standart','premium'] as const).map(plan=><section key={plan} className="plan-guidance-plan" aria-labelledby={`${title}-${plan}`}>
        <h3 id={`${title}-${plan}`}>{billingPlanName(plan)}</h3>
        <dl>{resources.map((resource,index)=>{const limit=billingPlanLimits(policy,plan)[resource];return <div key={resource}><dt>{upgradeLabel(UPGRADE_RESOURCE_NAMES[index][0],UPGRADE_RESOURCE_NAMES[index][1],user.language)}</dt><dd>{limit===null?common.unlimited:typeof limit==='number'?new Intl.NumberFormat(user.language).format(limit):'—'}</dd></div>;})}</dl>
        <ul>{UPGRADE_FEATURES.filter(([feature])=>introFeatures.has(feature)&&billingPlanAllows(policy,plan,feature)&&!billingPlanAllows(policy,'free',feature)).map(([feature,ru,en])=><li key={feature}><ExperimentalIcon name="check"/><span>{BILLING_FEATURE_COPY_KEYS[feature]?(features as Record<string,string>)[BILLING_FEATURE_COPY_KEYS[feature]]:upgradeLabel(ru,en,user.language)}</span></li>)}</ul>
        <button type="button" className="primary-button" onClick={()=>{onClose();requestUpgrade({plan,reason:'compare'});}}>{text.choose.replace('{plan}',billingPlanName(plan))}</button>
      </section>)}
    </div>
    <footer className="plan-guidance-footer"><span>{text.free}</span><button type="button" className="secondary-button" onClick={onClose}>{text.later}</button></footer>
  </dialog>;
}

function ActivePlanGuidanceHost({user,section}:{user:GenesisUser;section:string}) {
  const current=useRef({user,section}),[open,setOpen]=useState<OpenNotice|null>(null);
  const closeRef=useRef<()=>void>(()=>{}),visibleRef=useRef<()=>void>(()=>{});
  useEffect(()=>{current.current={user,section};},[user,section]);
  useEffect(()=>{
    let live=true,pending=false,lease:string|null=null,shown=false,claimVersion=0,leaseVersion=0,quietAt=performance.now(),nextTry=quietAt+GUIDANCE_QUIET_MS;
    let timer=0,contextFrame=0;const requests=new Set<AbortController>(),guard=captureAccountSessionGuard();
    const active=()=>{try{guard();return live&&current.current.user.uid===user.uid&&planGuidanceEligible(current.current.user);}catch{return false;}};
    const cancelContextWait=()=>{if(contextFrame)cancelAnimationFrame(contextFrame);contextFrame=0;};
    const release=(token:string)=>{try{guard();void releasePlanGuidance(token).catch(()=>{});}catch{/* Old account leases expire on the server. */}};
    const forgetLease=()=>{if(lease&&!shown)release(lease);lease=null;};
    const schedule=(wait=GUIDANCE_QUIET_MS)=>{window.clearTimeout(timer);if(live&&document.visibilityState==='visible')timer=window.setTimeout(()=>void automatic(),Math.max(GUIDANCE_QUIET_MS,wait));};
    const close=()=>{forgetLease();setOpen(null);quietAt=performance.now();schedule(Math.max(GUIDANCE_QUIET_MS,nextTry-performance.now()));};
    closeRef.current=close;
    const acknowledge=async(token:string)=>{
      if(!active()||document.visibilityState!=='visible'){release(token);return;}
      if(lease!==token||shown)return;const version=leaseVersion;shown=true;
      const controller=new AbortController();requests.add(controller);
      try {
        const result=await acknowledgePlanGuidance(token,controller.signal);if(!active()||version!==claimVersion)return;
        if(result.ok&&result.notice){if(lease===token)lease=null;nextTry=performance.now()+planGuidanceWait(result.nextAt,result.notice.createdAt);notify(user.uid,result.notice);}
        else if(lease===token){shown=false;close();}
      }catch{if(active()&&version===claimVersion){nextTry=performance.now()+GUIDANCE_ERROR_BACKOFF_MS;if(lease===token){shown=false;close();}}}
      finally{requests.delete(controller);}
    };
    visibleRef.current=()=>{if(lease&&!shown)void acknowledge(lease);};
    const claim=async(request:PlanGuidanceRequest,contextual=false)=>{
      if(!active()||document.visibilityState!=='visible'||!navigator.onLine||pending&&!contextual)return;
      pending=true;const version=++claimVersion,controller=new AbortController();requests.add(controller);
      try {
        const result=await claimPlanGuidance(request,controller.signal);
        if(!active()||version!==claimVersion){if(result.token)release(result.token);return;}
        nextTry=performance.now()+planGuidanceWait(result.nextAt,result.serverNow);
        if(!result.show||!result.notice||!result.token)return;
        if(contextual) {
          if(document.visibilityState==='visible'&&guidanceElementVisible(document.querySelector('dialog.upgrade-dialog[open]'))){lease=result.token;leaseVersion=version;shown=false;await acknowledge(result.token);}
          else release(result.token);
        } else if(guidanceWorkspaceQuiet(document)&&performance.now()-quietAt>=GUIDANCE_QUIET_MS) {
          lease=result.token;leaseVersion=version;shown=false;setOpen({notice:result.notice,token:result.token});
        } else release(result.token);
      }catch{if(active()&&version===claimVersion)nextTry=performance.now()+GUIDANCE_ERROR_BACKOFF_MS;}
      finally{requests.delete(controller);pending=false;schedule(Math.max(GUIDANCE_QUIET_MS,nextTry-performance.now()));}
    };
    const automatic=async()=>{
      if(!active()||lease)return;
      const wait=Math.max(nextTry-performance.now(),quietAt+GUIDANCE_QUIET_MS-performance.now());
      if(wait>0){schedule(wait);return;}
      if(!navigator.onLine||!guidanceWorkspaceQuiet(document)){schedule();return;}
      await claim({topic:planGuidanceTopic(current.current.section),reason:'scheduled'});
    };
    const interaction=()=>{quietAt=performance.now();if(!lease)schedule(Math.max(GUIDANCE_QUIET_MS,nextTry-quietAt));};
    const visibility=()=>{if(document.visibilityState!=='visible'){window.clearTimeout(timer);cancelContextWait();forgetLease();setOpen(null);}else interaction();};
    const explicitOpen=(event:Event)=>{
      const detail=(event as CustomEvent<GuidanceEvent>).detail;
      if(!active()||detail?.userId!==user.uid||!detail.notice||document.visibilityState!=='visible')return;
      const notice=detail.notice;cancelContextWait();forgetLease();setOpen({notice});
      const controller=new AbortController();requests.add(controller);void readPlanGuidance(notice.id,controller.signal).then(()=>{if(active())notify(user.uid,null,notice.id);}).catch(()=>{}).finally(()=>requests.delete(controller));
    };
    let contextualKey='',contextualAt=-Infinity;
    const context=(event:Event)=>{
      const request=contextualGuidance((event as CustomEvent<UpgradeRequest>).detail??{});if(!request||!active()){cancelContextWait();return;}
      const key=JSON.stringify(request),at=performance.now();if(key===contextualKey&&at-contextualAt<5000)return;contextualKey=key;contextualAt=at;
      cancelContextWait();claimVersion++;forgetLease();setOpen(null);quietAt=at;
      // React may need several paints before the existing native dialog is actually open.
      const deadline=at+5000;
      const waitForDialog=()=>{
        contextFrame=0;
        if(!active()||document.visibilityState!=='visible'||performance.now()>=deadline)return;
        if(guidanceElementVisible(document.querySelector('dialog.upgrade-dialog[open]'))){void claim(request,true);return;}
        contextFrame=requestAnimationFrame(waitForDialog);
      };
      contextFrame=requestAnimationFrame(waitForDialog);
    };
    window.addEventListener(UPGRADE_REQUEST_EVENT,context);window.addEventListener(GUIDANCE_OPEN_EVENT,explicitOpen);window.addEventListener('online',interaction);window.addEventListener('focus',interaction);
    document.addEventListener('visibilitychange',visibility);document.addEventListener('pointerdown',interaction,true);document.addEventListener('keydown',interaction,true);document.addEventListener('input',interaction,true);document.addEventListener('focusin',interaction,true);
    document.addEventListener('wheel',interaction,{capture:true,passive:true});document.addEventListener('touchmove',interaction,{capture:true,passive:true});
    schedule();
    return()=>{live=false;window.clearTimeout(timer);cancelContextWait();forgetLease();requests.forEach(controller=>controller.abort());
      window.removeEventListener(UPGRADE_REQUEST_EVENT,context);window.removeEventListener(GUIDANCE_OPEN_EVENT,explicitOpen);window.removeEventListener('online',interaction);window.removeEventListener('focus',interaction);
      document.removeEventListener('visibilitychange',visibility);document.removeEventListener('pointerdown',interaction,true);document.removeEventListener('keydown',interaction,true);document.removeEventListener('input',interaction,true);document.removeEventListener('focusin',interaction,true);
      document.removeEventListener('wheel',interaction,true);document.removeEventListener('touchmove',interaction,true);
    };
  },[user.uid]);
  return open?<PlanIntroduction key={open.notice.id} user={user} notice={open.notice} automatic={Boolean(open.token)} onClose={()=>closeRef.current()} onVisible={()=>visibleRef.current()}/>:null;
}

export default function PlanGuidanceHost({user,section}:{user:GenesisUser;section:string}) {
  return planGuidanceEligible(user)?<ActivePlanGuidanceHost key={user.uid} user={user} section={section}/>:null;
}
