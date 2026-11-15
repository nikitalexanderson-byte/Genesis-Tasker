"use client";
import {useState} from 'react';
import {createPortal} from 'react-dom';
import {useFeatureAccess} from './FeatureAccessContext';
import {featureAllowed} from './feature-access';
import {futureModelingCopy} from './future-modeling';
import {ExperimentalIcon} from './ExperimentalIcon';
import {DialogCloseButton} from './DialogCloseButton';
import availability from './aurora/availability.json';
import {useDialogAccessibility} from './use-dialog-accessibility';
import {GnoWizard} from './aurora/GnoWizard';
import {gnoCopy} from './aurora/gno-copy';
import {webAuroraHost,type AuroraTaskRequest} from './aurora/host';
import type {PrimaryDrawSnapshot,OptionalTemporalTriadSnapshot} from './aurora/types';
import './future-modeling.css';

type Props={language:string;userId?:string;primary?:PrimaryDrawSnapshot|null;temporal?:OptionalTemporalTriadSnapshot|null;onAddTask?:(value:AuroraTaskRequest)=>void};
function SignedInGuide({language,userId,onClose,primary,temporal,onAddTask}:Props&{userId:string;onClose:()=>void}){
 const [host]=useState(()=>webAuroraHost({ownerId:userId,language,close:onClose,addTask:onAddTask}));
 return <GnoWizard host={host} primary={primary??null} temporal={temporal??null}/>;
}
/** An orientation list alone is deliberately insufficient: the method needs
 * real saved card instances. Old guide copy remains in the source archive.
 */
export function FutureModelingGuideDialog({language,userId,primary,temporal,onAddTask,onClose}:Props&{onClose:()=>void}){
 const copy={...futureModelingCopy(language),...gnoCopy(language)},dialog=useDialogAccessibility<HTMLElement>(onClose,!userId);
 if(userId)return <SignedInGuide language={language} userId={userId} primary={primary} temporal={temporal} onAddTask={onAddTask} onClose={onClose}/>;
 return <div className="modal-backdrop future-modeling-backdrop"><section className="future-modeling-dialog" role="dialog" aria-modal="true" aria-labelledby="future-modeling-title" ref={dialog} lang={copy.language} data-no-translate>
  <header><h2 id="future-modeling-title">{copy.title}</h2><DialogCloseButton className="future-modeling-close" aria-label={copy.close} onClick={onClose}/></header>
  <p>{availability[copy.language as keyof typeof availability]?.login??availability.en.login}</p>
  <button type="button" className="secondary-button" onClick={onClose}>{copy.close}</button>
 </section></div>;
}
export function FutureModelingGuideTrigger(props:Props&{open:boolean;onOpen:()=>void}){
 const access=useFeatureAccess(),allowed=featureAllowed(access,'future-modeling',undefined,true),copy={...futureModelingCopy(props.language),...gnoCopy(props.language)};
 if(!allowed||!props.userId||props.primary?.cards.length!==9)return null;
 return <div className="future-modeling" lang={copy.language} data-no-translate>
  <button type="button" className="year-details-button future-modeling-trigger" data-testid="future-modeling-open" aria-haspopup="dialog" aria-expanded={allowed&&props.open}
   onClick={()=>{if(featureAllowed(access,'future-modeling',Date.now(),true))props.onOpen();}}>
   <span aria-hidden="true"><ExperimentalIcon name="future-modeling"/></span><span><strong>{copy.title}</strong><small>{copy.subtitle}</small></span><ExperimentalIcon name="chevron"/>
  </button>
 </div>;
}
/** Keep this owner mounted outside the responsive trigger locations. Moving a
 * trigger must not unmount the wizard or discard its in-flight edits/readings. */
export function FutureModelingGuide({open,onClose,...props}:Props&{open:boolean;onClose:()=>void}){
 const access=useFeatureAccess();
 if(!open||!featureAllowed(access,'future-modeling',undefined,true)||!props.userId||props.primary?.cards.length!==9)return null;
 return createPortal(<FutureModelingGuideDialog {...props} onClose={onClose}/>,document.body);
}
