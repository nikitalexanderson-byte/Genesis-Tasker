import {captureMessagingSessionGuard} from '../cloud-sync';
import {privateAccountIsRequired,requirePrivateAccount,subscribePrivateAccount} from './product-session.ts';

let revision=0,watching=false;
function watch(){
 if(watching)return;watching=true;subscribePrivateAccount(()=>{revision++;});
 if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')revision++;});
 if(typeof window!=='undefined'){window.addEventListener('pagehide',()=>{revision++;});window.addEventListener('genesis-local-session-ended',()=>{revision++;});}
}
/** Memory-only operation admission, separate from message wire/key identity.
 * A hide/lock/unlock cycle permanently retires earlier continuations, even if
 * the same owner is foreground and unlocked again when they finally return. */
export function captureMessagingAccess(ownerId:string){
 watch();const epoch=revision,session=captureMessagingSessionGuard(ownerId),protectedOwner=privateAccountIsRequired(ownerId);
 const account=protectedOwner?requirePrivateAccount(ownerId):null;
 const current=()=>{
  session();if(epoch!==revision||typeof document!=='undefined'&&document.visibilityState!=='visible'||privateAccountIsRequired(ownerId)!==protectedOwner)throw new Error('E2EE_MESSAGE_CUSTODY_RETIRED');
  if(account){account.requireOpen();if(requirePrivateAccount(ownerId)!==account)throw new Error('E2EE_MESSAGE_CUSTODY_RETIRED');}
 };current();return current;
}
