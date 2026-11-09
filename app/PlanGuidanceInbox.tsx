"use client";
import {useEffect,useRef,useState} from 'react';
import {captureAccountSessionGuard,loadPlanGuidance,readPlanGuidance,type GenesisUser} from './cloud-sync';
import type {Language} from './i18n';
import {translateText} from './i18n';
import {ExperimentalIcon} from './ExperimentalIcon';
import copy from './plan-guidance-copy.json';
import type {PlanGuidanceNotice} from './plan-guidance-types';
import {applyGuidanceInboxUpdate,GUIDANCE_CHANGED_EVENT,GUIDANCE_OPEN_EVENT,planGuidanceEligible,type GuidanceInboxState} from './plan-guidance-model';

type GuidanceUpdate=GuidanceInboxState;
export function usePlanGuidanceInbox(user:GenesisUser|null,expanded:boolean) {
  const userId=user?.uid??'',eligible=planGuidanceEligible(user);
  const [state,setState]=useState<GuidanceUpdate>({userId:'',notice:null}),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
  const action=useRef<AbortController|null>(null),alive=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;action.current?.abort();};},[]);
  useEffect(()=>{
    if(!eligible)return;
    let live=true,lastAttempt=-Infinity;const guard=captureAccountSessionGuard();let pending:AbortController|null=null;
    const refresh=()=>{
      if(!live||document.visibilityState!=='visible'||!navigator.onLine||pending||performance.now()-lastAttempt<5000)return;
      try{guard();}catch{return;}lastAttempt=performance.now();const controller=new AbortController();pending=controller;
      void loadPlanGuidance(controller.signal).then(result=>{guard();if(live)setState({userId,notice:result.notice});}).catch(()=>{}).finally(()=>{if(pending===controller)pending=null;});
    };
    const changed=(event:Event)=>{const detail=(event as CustomEvent<GuidanceUpdate>).detail;try{guard();if(live&&detail?.userId===userId){pending?.abort();pending=null;setState(current=>applyGuidanceInboxUpdate(userId,current,detail));}}catch{/* Old session event. */}};
    window.addEventListener(GUIDANCE_CHANGED_EVENT,changed);window.addEventListener('focus',refresh);window.addEventListener('online',refresh);window.addEventListener('genesis:notification-inbox-open',refresh);document.addEventListener('visibilitychange',refresh);refresh();
    return()=>{live=false;pending?.abort();window.removeEventListener(GUIDANCE_CHANGED_EVENT,changed);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);window.removeEventListener('genesis:notification-inbox-open',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[userId,eligible,expanded]);
  const notice=eligible&&state.userId===userId?state.notice:null;
  const read=async()=>{
    if(!notice||busy)return;const guard=captureAccountSessionGuard(),controller=new AbortController();action.current=controller;setBusy(true);setFailed(false);
    try{await readPlanGuidance(notice.id,controller.signal);guard();if(alive.current){const update={userId,notice:null,readId:notice.id};setState(current=>applyGuidanceInboxUpdate(userId,current,update));window.dispatchEvent(new CustomEvent<GuidanceUpdate>(GUIDANCE_CHANGED_EVENT,{detail:update}));}}
    catch{if(alive.current&&!controller.signal.aborted)setFailed(true);}finally{if(alive.current)setBusy(false);}
  };
  const open=()=>{if(notice)window.dispatchEvent(new CustomEvent<GuidanceUpdate>(GUIDANCE_OPEN_EVENT,{detail:{userId,notice}}));};
  return {notice,busy,failed,read,open};
}

export function PlanGuidanceInboxRow({notice,language,busy,failed,onOpen,onRead}:{notice:PlanGuidanceNotice;language:Language;busy:boolean;failed:boolean;onOpen:()=>void;onRead:()=>void}) {
  const text=copy[language];
  return <article className="notification-plan-guidance" data-no-translate>
    <button type="button" className="notification-item-open" onClick={onOpen} aria-haspopup="dialog"><span className="notification-item-heading"><ExperimentalIcon name="projects"/>{text.compare}</span><strong>{text.title}</strong><small>{text[notice.topic]}</small>
      {failed?<small role="status">{translateText('Не удалось обновить уведомления. Повторите попытку.',language)}</small>:null}</button>
    <button type="button" className="notification-read" disabled={busy} aria-label={text.read} title={text.read} onClick={onRead}><ExperimentalIcon name="check"/></button>
  </article>;
}
