import {requirePrivateAccount} from './product-session.ts';
import {advancePrivateSharedExecution} from './shared-web-live.ts';

/** The browser executes only while the existing unlocked foreground session
 * is current. No root is transferred to a service worker or a server worker. */
export function startPrivateExecutionPump(ownerId:string){
 let stopped=false,busy=false;const account=requirePrivateAccount(ownerId);
 const tick=async()=>{if(stopped||busy||document.visibilityState!=='visible'||!navigator.onLine||account.mode!=='online')return;busy=true;
  const current=()=>{account.requireOpen();if(stopped||document.visibilityState!=='visible'||requirePrivateAccount(ownerId)!==account)throw new Error('E2EE_ACCOUNT_CHANGED');};
  try{current();const result=await advancePrivateSharedExecution(ownerId,current);current();if(result.changed)window.dispatchEvent(new Event('genesis:shared-updates'));if(result.errors.length)window.dispatchEvent(new CustomEvent('genesis:private-execution-error',{detail:{count:result.errors.length,codes:result.errors}}));}
  catch(error){if(!stopped&&document.visibilityState==='visible'&&error instanceof Error&&error.message!=='E2EE_ACCOUNT_CHANGED')window.dispatchEvent(new CustomEvent('genesis:private-execution-error',{detail:{count:1,codes:['E2EE_PRIVATE_EXECUTION_PENDING']}}));}
  finally{busy=false;}
 };
 const wake=()=>{void tick();},timer=setInterval(wake,30000);document.addEventListener('visibilitychange',wake);window.addEventListener('online',wake);wake();
 return()=>{stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',wake);window.removeEventListener('online',wake);};
}
