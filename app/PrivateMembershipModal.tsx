'use client';
import {useLayoutEffect,useRef,type ReactNode} from 'react';

/** Keep the initiating native editor open, with its input intact. Only the
 * access review occupies the top layer until it is explicitly closed. */
export function PrivateMembershipModal({titleId,onRequestClose,children}:{titleId:string;onRequestClose:()=>void;children:ReactNode}){
 const modalRef=useRef<HTMLDialogElement>(null);
 useLayoutEffect(()=>{const modal=modalRef.current;if(!modal)return;modal.showModal();return()=>{if(modal.open)modal.close();};},[]);
 return <dialog ref={modalRef} className="private-vault-gate private-membership-gate" aria-labelledby={titleId} onCancel={event=>{event.preventDefault();onRequestClose();}} data-no-translate>{children}</dialog>;
}
