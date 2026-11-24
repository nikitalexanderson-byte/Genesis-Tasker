import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PrivateMembershipModal} from '../../app/PrivateMembershipModal';
import {holdPrivateEditorFence} from '../../app/private-ui-fence';
import {useDialogAccessibility} from '../../app/use-dialog-accessibility';
import copy from '../../contracts/e2ee/membership-review-copy-v2.json';
const requested=new URL(location.href).searchParams.get('lang')??'ru';
const language=(Object.hasOwn(copy,requested)?requested:'ru') as keyof typeof copy;
const c=copy[language];document.documentElement.lang=language;

function Review({close}:{close:()=>void}){
 const ref=useDialogAccessibility<HTMLDivElement>(close);
 useLayoutEffect(()=>holdPrivateEditorFence(),[]);
 return <PrivateMembershipModal titleId="review-title" onRequestClose={close}><div ref={ref} className="workspace-recovery-dialog private-vault-dialog private-migration-dialog private-membership-dialog" tabIndex={-1}>
  <header className="workspace-recovery-heading"><h2 id="review-title">{c.title}</h2><p>{c.notice}</p></header>
  <label className="backup-check"><input type="checkbox"/>{c.planAck}</label>
  <button data-dialog-initial-focus type="button" className="text-button" onClick={close}>{c.keep}</button>
 </div></PrivateMembershipModal>;
}
// Actual modal + editor-fence components only. No account, keys, transport or
// simulated auth success is provided; this tests browser focus/input custody.
function Fixture(){
 const parent=useRef<HTMLDialogElement>(null),[review,setReview]=useState(false);
 useEffect(()=>{parent.current?.showModal();},[]);
 return <><main id="genesis-app-content"><dialog ref={parent} aria-label="Synthetic team editor" className="shared-projects-modal">
  <label>Retained draft<input defaultValue="SYNTHETIC RETAINED DRAFT"/></label>
  <button type="button" onClick={()=>setReview(true)}>Review access</button>
 </dialog></main>{review?<Review close={()=>setReview(false)}/>:null}</>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
