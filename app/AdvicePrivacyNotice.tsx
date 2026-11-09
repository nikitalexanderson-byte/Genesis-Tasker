"use client";

import {useCallback,useEffect,useId,useRef,useState} from 'react';
import type {GenesisUser} from './cloud-sync';
import labels from './daily-advice-copy.json';
import {DialogCloseButton} from './DialogCloseButton';
import {ExperimentalIcon} from './ExperimentalIcon';
import {translateText} from './i18n';
import './daily-advice.css';

export function AdvicePrivacyNotice({language}:{language:GenesisUser['language']}) {
  const copy=labels[language], title=useId();
  const [open,setOpen]=useState(false);
  const close=useCallback(()=>setOpen(false),[]);
  return <div className="daily-advice-privacy" data-no-translate>
    <button type="button" className="secondary-button daily-advice-origin-button" aria-haspopup="dialog" onClick={()=>setOpen(true)}>
      <ExperimentalIcon name="info"/>{copy.privacyTitle}
    </button>
    {open?<AdviceOriginDialog copy={copy} title={title} onClose={close} closeLabel={translateText('Закрыть',language)}/>:null}
  </div>;
}

function AdviceOriginDialog({copy,title,onClose,closeLabel}:{copy:typeof labels.ru;title:string;onClose:()=>void;closeLabel:string}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const node=dialog.current;if(!node)return;
    const outside=(event:MouseEvent)=>{if(event.target===node){const box=node.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)onClose();}};
    node.addEventListener('click',outside);node.showModal();
    return()=>{node.removeEventListener('click',outside);if(node.open)node.close();};
  },[onClose]);
  return <dialog ref={dialog} className="daily-advice-origin-dialog" aria-labelledby={title} onClose={onClose}>
    <header><h2 id={title}>{copy.privacyTitle}</h2><DialogCloseButton type="button" aria-label={closeLabel} onClick={onClose}/></header>
    <p>{copy.privacyNotice}</p><p>{copy.ageLegal}</p>
  </dialog>;
}
